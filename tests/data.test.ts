import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isIndexableTelevision, specificationsMatch, televisionPath, validateCatalog, type Catalog } from '../src/lib/data';
import { normalizeModel } from '../src/lib/normalize';
import { loadCatalog } from '../src/lib/csv';

const now = new Date('2026-11-08T10:00:00Z');
const options = { allowFixtures: true, now };
const fixture = () => loadCatalog(resolve('fixtures/catalog'), options);

describe('CSV data validation and production boundaries', () => {
  it('accepts empty production CSVs without exposing test fixtures', () => {
    expect(loadCatalog()).toEqual({ televisions: [], stands: [], compatibility: [] });
    expect(() => loadCatalog(resolve('fixtures/catalog'))).toThrow(/架空データ|テストURL/u);
  });

  it('parses the explicitly selected fictional catalog and preserves formal models', () => {
    const catalog = fixture();
    expect(catalog.televisions[0]!.model).toBe('FICTION-43-A');
    expect(catalog.televisions[2]!.weight_kg).toBeNull();
    expect(catalog.stands[0]!.vesa_patterns).toEqual([{ width: 200, height: 200 }, { width: 300, height: 200 }]);
    expect(catalog.compatibility.map((entry) => entry.status)).toContain('unknown');
    expect(catalog.compatibility.map((entry) => entry.status)).toContain('incompatible');
  });

  it('accepts quoted commas and rejects altered headers and uneven records', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'tv-csv-'));
    try {
      for (const name of ['televisions', 'stands', 'compatibility']) writeFileSync(resolve(directory, `${name}.csv`), readFileSync(resolve('fixtures/catalog', `${name}.csv`)));
      const path = resolve(directory, 'compatibility.csv');
      writeFileSync(path, readFileSync(path, 'utf8').replace('架空の判断材料不足例。', '"架空の判断材料,不足例。"'));
      expect(loadCatalog(directory, options).compatibility.at(-1)?.notes).toBe('架空の判断材料,不足例。');
      writeFileSync(path, readFileSync(path, 'utf8').replace('television_id,', 'wrong_id,'));
      expect(() => loadCatalog(directory, options)).toThrow(/ヘッダー/u);
      writeFileSync(path, readFileSync(resolve('fixtures/catalog/compatibility.csv'), 'utf8') + '\nfixture-tv-one');
      expect(() => loadCatalog(directory, options)).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(['javascript:alert(1)', 'http://television.invalid/spec', 'https://user:password@television.invalid/spec'])(
    'rejects unsafe URL %s', (url) => {
      const catalog = fixture();
      catalog.televisions[0]!.source_url = url;
      expect(() => validateCatalog(catalog, options)).toThrow(/URL|HTTPS/u);
    },
  );

  it('rejects invalid positive numbers and half-defined VESA dimensions', () => {
    const catalog = fixture();
    catalog.televisions[0]!.weight_kg = -2;
    expect(() => validateCatalog(catalog, options)).toThrow();
    catalog.televisions[0]!.weight_kg = 9.5;
    catalog.televisions[0]!.vesa_height_mm = null;
    expect(() => validateCatalog(catalog, options)).toThrow(/VESA/u);
  });

  it('detects duplicate IDs, normalized model keys and canonical routes', () => {
    const catalog = fixture();
    catalog.televisions.push({ ...catalog.televisions[0]!, id: 'fixture-tv-collision', model: 'ｆｉｃｔｉｏｎ４３ａ' });
    expect(() => validateCatalog(catalog, options)).toThrow(/正規化/u);
    catalog.televisions.at(-1)!.model = 'FICTION_43_A';
    expect(() => validateCatalog(catalog, options)).toThrow(/テレビURL/u);
    catalog.televisions.at(-1)!.model = 'DIFFERENT';
    catalog.televisions.at(-1)!.id = catalog.televisions[0]!.id;
    expect(() => validateCatalog(catalog, options)).toThrow(/テレビID/u);
  });

  it('rejects a dynamic URL that would overwrite the static VESA guide', () => {
    const catalog = fixture();
    catalog.televisions[0]!.manufacturer = 'guides';
    catalog.televisions[0]!.model = 'vesa';
    expect(() => validateCatalog(catalog, options)).toThrow(/固定ページ/u);
  });

  it('rejects missing foreign keys and repeated compatibility pairs', () => {
    const catalog = fixture();
    catalog.compatibility[0]!.stand_id = 'fixture-missing';
    expect(() => validateCatalog(catalog, options)).toThrow(/存在しません/u);
    catalog.compatibility[0]!.stand_id = 'fixture-stand-confirmed';
    catalog.compatibility.push({ ...catalog.compatibility[0]! });
    expect(() => validateCatalog(catalog, options)).toThrow(/適合ペア/u);
  });

  it.each(['2026-02-30', '2026-13-01', '01/01/2026', '2027-01-01'])(
    'rejects invalid or future check date %s', (date) => {
      const catalog = fixture();
      catalog.compatibility[0]!.checked_at = date;
      expect(() => validateCatalog(catalog, options)).toThrow();
    },
  );

  it('uses Japan calendar dates when validating a check performed near midnight', () => {
    const catalog = fixture();
    catalog.compatibility[0]!.checked_at = '2026-11-09';
    expect(() => validateCatalog(catalog, { ...options, now: new Date('2026-11-08T15:01:00Z') })).not.toThrow();
  });

  it('requires individual official evidence for confirmed, including date and notes', () => {
    const catalog = fixture();
    catalog.compatibility[0]!.evidence_type = 'specification';
    expect(() => validateCatalog(catalog, options)).toThrow(/個別適合/u);
    catalog.compatibility[0]!.evidence_type = 'manufacturer_individual';
    catalog.compatibility[0]!.evidence_url = null;
    expect(() => validateCatalog(catalog, options)).toThrow(/出典URL/u);
    catalog.compatibility[0]!.evidence_url = 'https://stand.invalid/compatibility';
    catalog.compatibility[0]!.notes = '';
    expect(() => validateCatalog(catalog, options)).toThrow(/注意事項/u);
  });

  it('retains explicit incompatible and unknown records even if specs match', () => {
    const catalog = fixture();
    const entry = catalog.compatibility[0]!;
    entry.status = 'incompatible';
    expect(specificationsMatch(catalog.televisions[0]!, catalog.stands[0]!)).toBe(true);
    const validated = validateCatalog(catalog, options);
    expect(validated.compatibility[0]!.status).toBe('incompatible');
    entry.status = 'unknown';
    entry.evidence_type = 'insufficient';
    expect(validateCatalog(catalog, options).compatibility[0]!.status).toBe('unknown');
  });

  it('requires complete matching weight and VESA for specification candidates', () => {
    const catalog = fixture();
    catalog.televisions[0]!.weight_kg = 100;
    expect(() => validateCatalog(catalog, options)).toThrow(/candidate/u);
    expect(specificationsMatch(catalog.televisions[2]!, catalog.stands[0]!)).toBe(false);
  });
});

describe('routes and index eligibility', () => {
  it('normalizes searches without changing formal model display', () => {
    expect(normalizeModel(' ＦＩＣＴＩＯＮ－４３–Ａ ')).toBe('fiction43a');
    expect(televisionPath(fixture().televisions[0]!)).toBe('/%E6%9E%B6%E7%A9%BA%E3%83%A1%E3%83%BC%E3%82%AB%E3%83%BC/fiction-43-a/');
  });

  it('excludes thin or unchecked TV pages from indexing', () => {
    const catalog: Catalog = fixture();
    expect(isIndexableTelevision(catalog.televisions[2]!, catalog)).toBe(false);
    expect(isIndexableTelevision(catalog.televisions[1]!, catalog)).toBe(false);
    catalog.televisions[0]!.source_url = null;
    expect(isIndexableTelevision(catalog.televisions[0]!, catalog)).toBe(false);
  });

  it('never indexes fictional fixtures even when explicitly loaded for tests', () => {
    const catalog = fixture();
    expect(isIndexableTelevision(catalog.televisions[0]!, catalog)).toBe(false);
  });

  it('requires complete specs and a sourced checked decision for ordinary index eligibility', () => {
    // Synthetic, in-memory eligibility input only. Never load into production data or build pages.
    // The reserved .test domain identifies this as a unit-test source, not a real manufacturer.
    const catalog = fixture();
    const tv = { ...catalog.televisions[0]!, id: 'unit-tv', manufacturer: 'Unit Manufacturer', model: 'UNIT-43-A', source_url: 'https://manufacturer.test/explicitly-synthetic-spec' };
    catalog.televisions = [tv];
    catalog.compatibility = [{ ...catalog.compatibility[0]!, television_id: tv.id }];
    expect(isIndexableTelevision(tv, catalog)).toBe(true);
    expect(isIndexableTelevision({ ...tv, weight_kg: null }, catalog)).toBe(false);
    expect(isIndexableTelevision({ ...tv, screen_inches: null }, catalog)).toBe(false);
    expect(isIndexableTelevision({ ...tv, vesa_width_mm: null }, catalog)).toBe(false);
    expect(isIndexableTelevision({ ...tv, source_url: null }, catalog)).toBe(false);
    catalog.compatibility[0]!.status = 'unknown';
    expect(isIndexableTelevision(tv, catalog)).toBe(false);
    catalog.compatibility[0]!.status = 'confirmed';
    catalog.compatibility[0]!.checked_at = null;
    expect(isIndexableTelevision(tv, catalog)).toBe(false);
    catalog.compatibility[0]!.checked_at = '2026-01-01';
    catalog.compatibility[0]!.evidence_url = null;
    expect(isIndexableTelevision(tv, catalog)).toBe(false);
    catalog.compatibility = [];
    expect(isIndexableTelevision(tv, catalog)).toBe(false);
  });

  it('honors explicit editorial exclusions even when all index eligibility requirements pass', () => {
    // In-memory synthetic unit input only; never included in a production CSV or build.
    const catalog = fixture();
    const tv = { ...catalog.televisions[0]!, id: 'unit-tv', manufacturer: 'Unit Manufacturer', model: 'UNIT-43-A', source_url: 'https://manufacturer.test/explicitly-synthetic-spec' };
    catalog.televisions = [tv];
    catalog.compatibility = [{ ...catalog.compatibility[0]!, television_id: tv.id }];
    expect(isIndexableTelevision(tv, catalog, {})).toBe(true);
    expect(isIndexableTelevision(tv, catalog, { [tv.id]: '内容が別ページと重複しているため' })).toBe(false);
    expect(isIndexableTelevision(tv, catalog, { 'different-tv': '別型番の除外' })).toBe(true);
    // Only own entries count; inherited Object keys must not suppress an unrelated TV.
    expect(isIndexableTelevision({ ...tv, id: 'constructor' }, { ...catalog, compatibility: [{ ...catalog.compatibility[0]!, television_id: 'constructor' }] }, {})).toBe(true);
  });
});
