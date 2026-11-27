import standSalesRankCsv from '../../data/stand-sales-rank.csv?raw';

/**
 * テレビスタンド・壁掛け金具の売れ筋順（data/stand-sales-rank.csv、品番 sku と順位 rank）。
 * 型番ページの一覧をこの順に並べる。同じ順位は並び順を変えない。順位の無い商品は最後。
 * 2026-11-27 に運営者から受け取った一覧（Book1.xlsx）。更新するときは CSV を差し替える。
 */
export const standSalesRankColumns = ['sku', 'rank'] as const;

const key = (sku: string) => sku.normalize('NFKC').trim().toUpperCase();

export function parseStandSalesRank(text: string): Map<string, number> {
  const lines = text.replace(/^﻿/u, '').split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  const header = lines.shift()?.split(',').map(cell => cell.trim());
  if (!header || header.join(',') !== standSalesRankColumns.join(',')) throw new Error(`stand-sales-rank.csv: ヘッダーは ${standSalesRankColumns.join(',')}`);
  const ranks = new Map<string, number>();
  lines.forEach((line, index) => {
    const [sku = '', rank = ''] = line.split(',').map(cell => cell.trim());
    const value = Number(rank);
    if (!sku || !/^\d+$/u.test(rank) || value < 1) throw new Error(`stand-sales-rank.csv ${index + 2}行目: 品番と1以上の整数の順位が必要です`);
    if (ranks.has(key(sku))) throw new Error(`stand-sales-rank.csv ${index + 2}行目: ${sku} が重複しています`);
    ranks.set(key(sku), value);
  });
  return ranks;
}

const ranks = parseStandSalesRank(standSalesRankCsv);

/** 品番の売れ筋順位。一覧に無ければ null。 */
export function standSalesRank(sku: string, table: ReadonlyMap<string, number> = ranks): number | null {
  return table.get(key(sku)) ?? null;
}

/** 売れ筋順に並べる（安定ソート。順位の無いものは元の順のまま最後）。 */
export function sortBySalesRank<T>(entries: readonly T[], skuOf: (entry: T) => string, table: ReadonlyMap<string, number> = ranks): T[] {
  const rankOf = (entry: T) => standSalesRank(skuOf(entry), table) ?? Number.POSITIVE_INFINITY;
  return entries
    .map((entry, index) => ({ entry, index, rank: rankOf(entry) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ entry }) => entry);
}
