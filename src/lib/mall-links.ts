import mallLinksCsv from '../../data/mall-links.csv?raw';

/**
 * スタンドごとの、Amazon・楽天市場・Yahoo!ショッピングの商品ページURL（data/mall-links.csv）。
 * 登録が無いモールは、商品カードで「メーカー名＋型番」の検索結果へのリンクになる。
 * 価格・在庫は持たない（Yahoo!ショッピングは商品検索APIで別に確認する）。
 */
export const mallLinkColumns = ['stand_id', 'sku', 'amazon_url', 'rakuten_url', 'yahoo_url'] as const;

export interface MallPages { amazon: string | null; rakuten: string | null; yahoo: string | null }
export interface MallLinkRow extends MallPages { stand_id: string; sku: string }

/** モールごとに許すURLの形。誤ったURLやアフィリエイト以外への転送を入れないため。 */
const patterns: Record<keyof MallPages, RegExp> = {
  amazon: /^https:\/\/www\.amazon\.co\.jp\/dp\/[A-Z0-9]{10}\/$/u,
  rakuten: /^https:\/\/item\.rakuten\.co\.jp\/[a-z0-9_-]+\/[a-z0-9_-]+\/$/u,
  yahoo: /^https:\/\/store\.shopping\.yahoo\.co\.jp\/[a-z0-9_-]+\/[a-z0-9_-]+\.html$/u,
};

/** CSV を読んで検証する。URL にカンマ・引用符は使わない前提の単純な形式。 */
export function parseMallLinks(text: string): MallLinkRow[] {
  const lines = text.replace(/^﻿/u, '').split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  const header = lines.shift()?.split(',');
  if (!header || header.join(',') !== mallLinkColumns.join(',')) throw new Error(`mall-links.csv: ヘッダーは ${mallLinkColumns.join(',')}`);
  const seen = new Set<string>();
  return lines.map((line, index) => {
    const cells = line.split(',').map(cell => cell.trim());
    if (cells.length !== mallLinkColumns.length) throw new Error(`mall-links.csv ${index + 2}行目: 列の数が違います`);
    const [stand_id = '', sku = '', amazon = '', rakuten = '', yahoo = ''] = cells;
    if (!/^[a-z0-9-]+$/u.test(stand_id) || !sku) throw new Error(`mall-links.csv ${index + 2}行目: stand_id・sku が不正です`);
    if (seen.has(stand_id)) throw new Error(`mall-links.csv ${index + 2}行目: ${stand_id} が重複しています`);
    seen.add(stand_id);
    const pages: MallPages = { amazon: amazon || null, rakuten: rakuten || null, yahoo: yahoo || null };
    for (const mall of Object.keys(patterns) as (keyof MallPages)[]) {
      const url = pages[mall];
      if (url && !patterns[mall].test(url)) throw new Error(`mall-links.csv ${index + 2}行目: ${mall} のURLの形が違います（${url}）`);
    }
    return { stand_id, sku, ...pages };
  });
}

const byStand = new Map(parseMallLinks(mallLinksCsv).map(row => [row.stand_id, row]));

/** そのスタンドの各モールの商品ページ。登録が無ければ null。 */
export function mallPagesFor(standId: string): MallPages | null {
  return byStand.get(standId) ?? null;
}
