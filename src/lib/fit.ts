import type {Compatibility, Stand, Television} from './data';

/** 「このテレビを付けたらどうなるか」を項目別に示すための内訳。判定（status）そのものは compatibility.csv が正本で、ここでは変えない。 */
export interface FitBreakdown {
  /** テレビのVESAがスタンドの対応パターンに含まれるか。テレビ側が未確認なら null。 */
  vesaMatch: boolean | null;
  /** 耐荷重からテレビ本体の質量を引いた残り（kg、小数1桁）。テレビ側が未確認なら null。 */
  weightMarginKg: number | null;
}

export function fitBreakdown(tv: Television, stand: Stand): FitBreakdown {
  const vesaMatch = tv.vesa_width_mm === null || tv.vesa_height_mm === null
    ? null
    : stand.vesa_patterns.some(p => p.width === tv.vesa_width_mm && p.height === tv.vesa_height_mm);
  const weightMarginKg = tv.weight_kg === null ? null : Math.round((stand.max_weight_kg - tv.weight_kg) * 10) / 10;
  return {vesaMatch, weightMarginKg};
}

const statusOrder: Record<Compatibility['status'], number> = {confirmed: 0, candidate: 1, unknown: 2, incompatible: 3};

/** 確認済み → 仕様上の候補 → 判断材料不足 → 非対応 の順。同じ区分の中は元の並びを保つ。 */
export function sortByStatus<T extends {compatibility: Compatibility | null}>(entries: readonly T[]): T[] {
  return entries
    .map((entry, index) => ({entry, index}))
    .sort((a, b) => statusOrder[a.entry.compatibility?.status ?? 'unknown'] - statusOrder[b.entry.compatibility?.status ?? 'unknown'] || a.index - b.index)
    .map(({entry}) => entry);
}
