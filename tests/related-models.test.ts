import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadCatalog } from '../src/lib/csv';
import type { Television } from '../src/lib/data';
import { relatedModels, sameVesa, seriesKey, SAME_SIZE_LIMIT } from '../src/lib/related-models';

const base = loadCatalog(resolve('fixtures/catalog'), { allowFixtures: true }).televisions[0]!;
const tv = (id: string, manufacturer: string, model: string, screen_inches: number | null, vesa: [number, number] | null = [300, 300]): Television =>
  ({ ...base, id, manufacturer, model, screen_inches, vesa_width_mm: vesa?.[0] ?? null, vesa_height_mm: vesa?.[1] ?? null });

describe('series key', () => {
  it('removes the screen size from the model number', () => {
    expect(seriesKey(tv('a', 'SONY', 'K-65XR80M2', 65))).toBe(seriesKey(tv('b', 'SONY', 'K-55XR80M2', 55)));
    expect(seriesKey(tv('a', 'LG', 'OLED65C5PJA', 65))).toBe(seriesKey(tv('b', 'LG', 'OLED55C5PJA', 55)));
    expect(seriesKey(tv('a', 'TCL', '43A400 Pro', 43))).toBe(seriesKey(tv('b', 'TCL', '50A400 Pro', 50)));
    expect(seriesKey(tv('a', 'SONY', 'K-65XR80M2', 65))).not.toBe(seriesKey(tv('b', 'SONY', 'K-65XR90M2', 65)));
  });

  it('does not match the size inside a longer number, or across makers', () => {
    expect(seriesKey(tv('a', 'X', 'AB-155Z', 55))).toBeNull();
    expect(seriesKey(tv('a', 'X', 'NOSIZE', 55))).toBeNull();
    expect(seriesKey(tv('a', 'X', 'A55B', null))).toBeNull();
    expect(seriesKey(tv('a', 'SONY', 'X55A', 55))).not.toBe(seriesKey(tv('b', 'LG', 'X65A', 65)));
  });
});

describe('related models', () => {
  const all = [
    tv('s65', 'SONY', 'K-65XR80M2', 65), tv('s55', 'SONY', 'K-55XR80M2', 55, [300, 200]), tv('s75', 'SONY', 'K-75XR80M2', 75),
    tv('s65b', 'SONY', 'K-65XR90M2', 65), tv('lg65', 'LG', 'OLED65C5PJA', 65), tv('tcl65', 'TCL', '65C8K', 65),
  ];

  it('lists other sizes of the series (largest first) and other models of the same size (same maker first, then by rank)', () => {
    const related = relatedModels(all[0]!, all, new Map([['tcl65', 1], ['lg65', 5]]));
    expect(related.series.map(item => item.id)).toEqual(['s75', 's55']);
    expect(related.sameSize.map(item => item.id)).toEqual(['s65b', 'tcl65', 'lg65']);
    expect([...related.series, ...related.sameSize].some(item => item.id === 's65')).toBe(false);
  });

  it('limits the same-size list', () => {
    const many = Array.from({ length: 20 }, (_, index) => tv(`m${index}`, 'TCL', `65Q${index}`, 65));
    expect(relatedModels(all[0]!, [...all, ...many]).sameSize).toHaveLength(SAME_SIZE_LIMIT);
  });

  it('marks only models with exactly the same VESA', () => {
    expect(sameVesa(all[0]!, all[2]!)).toBe(true);
    expect(sameVesa(all[0]!, all[1]!)).toBe(false);
    expect(sameVesa(all[0]!, tv('n', 'SONY', 'K-43XR80M2', 43, null))).toBe(false);
  });

  it('groups every published model of the real data into a series', () => {
    const real = loadCatalog(resolve('data')).televisions;
    expect(real.every(item => seriesKey(item) !== null)).toBe(true);
    // 同じシリーズに同じサイズが2つ入らない（シリーズの判定が粗すぎないこと）
    const seen = new Set<string>();
    for (const item of real) {
      const key = `${seriesKey(item)}|${item.screen_inches}`;
      expect(seen.has(key), `${item.manufacturer} ${item.model}`).toBe(false);
      seen.add(key);
    }
  });
});
