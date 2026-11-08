import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadCatalog, type Catalog, type Television } from '../src/lib/data';
import { commonManufacturers, getManufacturers, isIndexableManufacturer, manufacturerPath } from '../src/lib/manufacturers';

const fixtures = loadCatalog(resolve('fixtures/catalog'), { allowFixtures: true });
const firstFixture = fixtures.televisions[0]!;

describe('manufacturer navigation', () => {
  it('provides real brand navigation labels without synthesizing television records', () => {
    const manufacturers = getManufacturers([]);
    expect(manufacturers.map(item => item.name)).toEqual([...commonManufacturers]);
    expect(manufacturers.map(item => item.url)).toEqual(['/sony/', '/panasonic/', '/sharp/', '/tvs-regza/', '/lg/', '/hisense/', '/tcl/']);
    expect(manufacturers.every(item => item.televisions.length === 0)).toBe(true);
  });

  it('groups fixture records by manufacturer and keeps original model/specification fields untouched', () => {
    const before = structuredClone(fixtures.televisions);
    const manufacturer = getManufacturers(fixtures.televisions).find(item => item.name === '架空メーカー')!;
    expect(manufacturer.televisions).toHaveLength(fixtures.televisions.length);
    expect(manufacturer.televisions.find(item => item.id === firstFixture.id)).toEqual(firstFixture);
    expect(fixtures.televisions).toEqual(before);
    expect(getManufacturers(fixtures.televisions).find(item => item.name === 'SONY')?.televisions).toEqual([]);
  });

  it('groups case/fullwidth aliases of a known brand without changing the source manufacturer', () => {
    // This is an explicitly fictional fixture record used only for grouping.
    const television = { ...firstFixture, manufacturer: 'Ｓｏｎｙ' };
    const manufacturers = getManufacturers([television]);
    expect(manufacturers).toHaveLength(7);
    expect(manufacturers[0]?.name).toBe('SONY');
    expect(manufacturers[0]?.televisions[0]?.manufacturer).toBe('Ｓｏｎｙ');
    expect(manufacturerPath(television.manufacturer)).toBe('/sony/');
  });

  it('rejects distinct names that collapse to the same URL instead of merging them', () => {
    const one = { ...firstFixture, manufacturer: '架空_Maker' };
    const two = { ...firstFixture, id: 'fixture-other', manufacturer: '架空-Maker' };
    expect(() => getManufacturers([one, two])).toThrow('メーカーURLが重複');
  });

  it('rejects spaces versus hyphens even when search normalization would consider them equivalent', () => {
    const one = { ...firstFixture, manufacturer: '架空 Maker' };
    const two = { ...firstFixture, id: 'fixture-other', manufacturer: '架空-Maker' };
    expect(() => getManufacturers([one, two])).toThrow('メーカーURLが重複');
  });

  it.each(['about', 'privacy', 'guides', '404'])('rejects a manufacturer path colliding with a static route: %s', name => {
    expect(() => manufacturerPath(name)).toThrow('固定ページと衝突');
    expect(() => getManufacturers([{ ...firstFixture, manufacturer: name }])).toThrow();
  });

  it('encodes Japanese routes while preserving the canonical display name', () => {
    expect(manufacturerPath('架空メーカー')).toBe(`/${encodeURIComponent('架空メーカー')}/`);
    expect(manufacturerPath('TVS　REGZA')).toBe('/tvs-regza/');
  });

  it('keeps empty, fixture-only, and thin manufacturer lists outside indexing', () => {
    const manufacturers = getManufacturers(fixtures.televisions);
    expect(manufacturers.every(manufacturer => !isIndexableManufacturer(manufacturer, fixtures))).toBe(true);
  });

  it('only permits a list with at least one indexable television record', () => {
    // Synthetic in-memory eligibility input, never loaded or emitted by production.
    const television: Television = { id: 'catalog-one', manufacturer: 'Synthetic eligibility brand', model: 'SPEC-ONE', screen_inches: 43, weight_kg: 9, vesa_width_mm: 200, vesa_height_mm: 200, source_url: 'https://source.test/spec' };
    const catalog: Catalog = { televisions: [television], stands: [], compatibility: [{ television_id: television.id, stand_id: 'catalog-stand', status: 'confirmed', evidence_type: 'manufacturer_individual', evidence_url: 'https://source.test/confirmation', checked_at: '2026-01-01', notes: 'Synthetic eligibility test only.' }] };
    const manufacturer = getManufacturers(catalog.televisions).find(item => item.name === television.manufacturer)!;
    expect(isIndexableManufacturer(manufacturer, catalog)).toBe(true);
    expect(isIndexableManufacturer(manufacturer, { ...catalog, compatibility: [] })).toBe(false);
  });
});
