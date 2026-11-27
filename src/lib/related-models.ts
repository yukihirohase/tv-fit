import type { Television } from './data';

/**
 * 型番ページの相互リンク：同じシリーズの他のサイズと、同じ画面サイズの他の機種。
 *
 * シリーズは、型番から画面サイズの数字（最初の1か所）を除いた残りが同じものとみなす
 * （例：K-65XR80M2 と K-55XR80M2 → K-#XR80M2）。型番に画面サイズの数字が無い機種はシリーズを作らない。
 */
export function seriesKey(tv: Pick<Television, 'manufacturer' | 'model' | 'screen_inches'>): string | null {
  if (tv.screen_inches === null || !Number.isInteger(tv.screen_inches)) return null;
  const size = String(tv.screen_inches);
  const index = tv.model.search(new RegExp(`(?<!\\d)${size}(?!\\d)`, 'u'));
  if (index < 0) return null;
  const rest = `${tv.model.slice(0, index)}#${tv.model.slice(index + size.length)}`;
  return `${tv.manufacturer.normalize('NFKC').toLowerCase()}|${rest.normalize('NFKC').toLowerCase()}`;
}

export const SAME_SIZE_LIMIT = 8;

export interface RelatedModels { series: Television[]; sameSize: Television[] }

/**
 * series：同じシリーズの他のサイズ（大きい順）。
 * sameSize：同じ画面サイズの他の機種。同じメーカーを先に、その中は売れ筋順（順位なしは後ろ）、同順は型番順。最大8件。
 * 同じシリーズの機種は sameSize に重ねて出さない。
 */
export function relatedModels(tv: Television, televisions: readonly Television[], ranks?: ReadonlyMap<string, number> | null, limit = SAME_SIZE_LIMIT): RelatedModels {
  const key = seriesKey(tv);
  const others = televisions.filter(item => item.id !== tv.id);
  const series = key === null ? [] : others
    .filter(item => seriesKey(item) === key)
    .sort((a, b) => (b.screen_inches ?? 0) - (a.screen_inches ?? 0) || a.model.localeCompare(b.model, 'ja'));
  const inSeries = new Set(series.map(item => item.id));
  const rank = (item: Television) => ranks?.get(item.id) ?? Number.POSITIVE_INFINITY;
  const sameSize = tv.screen_inches === null ? [] : others
    .filter(item => item.screen_inches === tv.screen_inches && !inSeries.has(item.id))
    .sort((a, b) => Number(b.manufacturer === tv.manufacturer) - Number(a.manufacturer === tv.manufacturer)
      || rank(a) - rank(b)
      || a.manufacturer.localeCompare(b.manufacturer, 'ja') || a.model.localeCompare(b.model, 'ja'))
    .slice(0, limit);
  return { series, sameSize };
}

/** 2機種の VESA が同じか（どちらかが未登録なら false）。 */
export function sameVesa(a: Television, b: Television): boolean {
  return a.vesa_width_mm !== null && a.vesa_height_mm !== null
    && a.vesa_width_mm === b.vesa_width_mm && a.vesa_height_mm === b.vesa_height_mm;
}
