import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadCatalog } from '../src/lib/csv';
import { standSpecColumns, tvDetailColumns, validateSpecFiles, validateStandSpecs, validateTvDetails } from '../src/lib/specs';

const fixtures = loadCatalog(resolve('fixtures/catalog'), { allowFixtures: true });
const floor = fixtures.stands.find(stand => stand.stand_type === 'floor')!;
const wall = fixtures.stands.find(stand => stand.stand_type === 'wall') ?? { ...floor, id: 'fixture-wall', stand_type: 'wall' as const };
const stands = [floor, wall];
const tv = { ...fixtures.televisions[0]!, screen_inches: 55 };
const blankStand = Object.fromEntries(standSpecColumns.map(column => [column, ''])) as Record<string, string>;
const blankTv = Object.fromEntries(tvDetailColumns.map(column => [column, ''])) as Record<string, string>;
const standRow = (overrides: Record<string, string> = {}) => ({ ...blankStand, stand_id: floor.id, sku: floor.sku, ...overrides });
const source = { spec_source_url: 'https://www.sanwa.co.jp/product/syohin?code=X', spec_checked_at: '2026-11-01' };

describe('stand-specs.csv', () => {
  it('accepts official values with a source and confirmation date', () => {
    const result = validateStandSpecs([standRow({ style: 'floor_caster', height_adjust: 'manual', min_inches: '32', max_inches: '65', width_mm: '780', depth_min_mm: '720', depth_max_mm: '720', height_min_mm: '1613.5', height_max_mm: '1813.5', bracket_center_min_mm: '1400', bracket_center_max_mm: '1600', product_weight_kg: '20.9', tilt: '±10°', casters: '1', shelf: '1', one_liner: 'キャスター付きで掃除や模様替えがしやすい', ...source })], [floor]);
    expect(result.errors).toEqual([]);
  });

  it('allows a template row that has only the ids', () => {
    expect(validateStandSpecs([standRow()], [floor]).errors).toEqual([]);
  });

  it.each([
    [{ stand_id: 'unknown' }, 'stands.csv にありません'],
    [{ sku: 'OTHER' }, 'sku が stands.csv'],
    [{ style: 'wall_arm', ...source }, 'には使えません'],
    [{ min_inches: '65', max_inches: '32', ...source }, 'より大きい'],
    [{ width_mm: '78cm', ...source }, '数字だけ'],
    [{ height_max_mm: '1000', bracket_center_max_mm: '1200', bracket_center_min_mm: '1100', ...source }, '製品の高さを超えて'],
    [{ casters: 'あり', ...source }, '1（あり）'],
    [{ tilt: '10度くらい', ...source }, '上8°・下10°'],
    [{ one_liner: 'あ'.repeat(41) }, '40字以内'],
    [{ max_inches: '65' }, '出典'],
    [{ max_inches: '65', spec_source_url: 'http://www.sanwa.co.jp/', spec_checked_at: '2026-11-01' }, 'https://'],
    [{ max_inches: '65', spec_source_url: source.spec_source_url, spec_checked_at: '2999-01-01' }, '未来'],
  ])('rejects %o', (overrides, message) => {
    expect(validateStandSpecs([standRow(overrides)], [floor]).errors.join('\n')).toContain(message);
  });

  it('rejects duplicates, wall-only rules and warns about missing stands', () => {
    const wallRow = { ...blankStand, stand_id: wall.id, sku: wall.sku, height_adjust: 'electric', casters: '1', ...source };
    const result = validateStandSpecs([standRow(), standRow(), wallRow], stands);
    expect(result.errors.join('\n')).toMatch(/重複/);
    expect(result.errors.join('\n')).toMatch(/height_adjust は書けません/);
    expect(result.errors.join('\n')).toMatch(/キャスターは付きません/);
    expect(validateStandSpecs([], stands).warnings).toHaveLength(2);
  });
});

describe('tv-details.csv', () => {
  const tvRow = (overrides: Record<string, string> = {}) => ({ ...blankTv, television_id: tv.id, model: tv.model, ...overrides });
  const tvSource = { source_url: 'https://www.sony.jp/bravia/', checked_at: '2026-11-01' };

  it('accepts plausible dimensions', () => {
    expect(validateTvDetails([tvRow({ width_mm: '1230', height_mm: '712', depth_mm: '48', height_with_stand_mm: '775', depth_with_stand_mm: '280', screw: 'M6', back_shape: 'lower_bulge', vesa_center_from_bottom_mm: '320', ...tvSource })], { televisions: [tv] }).errors).toEqual([]);
  });

  it.each([
    [{ width_mm: '123', ...tvSource }, '画面幅'],
    [{ height_mm: '712', height_with_stand_mm: '700', ...tvSource }, 'スタンド込みの高さ'],
    [{ height_mm: '712', vesa_center_from_bottom_mm: '800', ...tvSource }, 'VESA中心'],
    [{ screw: 'M6x16', ...tvSource }, 'M6 のように'],
    [{ back_shape: 'round', ...tvSource }, 'back_shape'],
    [{ model: 'OTHER' }, 'model が televisions.csv'],
    [{ depth_mm: '48' }, '出典'],
  ])('rejects %o', (overrides, message) => {
    expect(validateTvDetails([tvRow(overrides)], { televisions: [tv] }).errors.join('\n')).toContain(message);
  });
});

describe('repository data', () => {
  it('passes validation for the committed spec CSVs', () => {
    const catalog = loadCatalog(resolve('data'));
    const result = validateSpecFiles(catalog);
    expect(result.errors).toEqual([]);
  });
});
