import { isIndexableTelevisionWith, televisionPath, type Television } from './data';
import { getManufacturers } from './manufacturers';
import { canonicalUrl, escapeXml } from './seo';
import type { CompatibilitySummary } from './compatibility-summary';

export interface SitemapEntry { path: string; lastmod?: string }

/** 固定ページ。内容の更新日を正確に追えないため lastmod は付けない。 */
export const staticSitemapPaths = ['/', '/guides/vesa/', '/about/'] as const;

function indexable(tv: Television, summary: CompatibilitySummary): boolean {
  return isIndexableTelevisionWith(tv, summary.get(tv.id)?.hasEvidence ?? false);
}

/** インデックス対象のメーカーと、その中のインデックス対象の型番。 */
function indexableManufacturers(televisions: readonly Television[], summary: CompatibilitySummary) {
  return getManufacturers(televisions)
    .map(manufacturer => ({ manufacturer, televisions: manufacturer.televisions.filter(tv => indexable(tv, summary)) }))
    .filter(item => item.televisions.length > 0);
}

/**
 * インデックス対象のページだけを、適合情報の最終確認日（型番ページの「最終確認」・dateModified と同じ値）つきで返す。
 */
export function sitemapEntries(televisions: readonly Television[], summary: CompatibilitySummary): SitemapEntry[] {
  const latest = (tv: Television) => summary.get(tv.id)?.latestCheckedAt ?? null;
  const entries: SitemapEntry[] = staticSitemapPaths.map(path => ({ path }));
  for (const { manufacturer, televisions: models } of indexableManufacturers(televisions, summary)) {
    const lastmod = models.flatMap(tv => latest(tv) ?? []).sort().at(-1);
    entries.push({ path: manufacturer.url, ...(lastmod ? { lastmod } : {}) });
  }
  for (const tv of televisions) {
    if (!indexable(tv, summary)) continue;
    const lastmod = latest(tv);
    entries.push({ path: televisionPath(tv), ...(lastmod ? { lastmod } : {}) });
  }
  const seen = new Set<string>();
  return entries.filter(entry => !seen.has(entry.path) && seen.add(entry.path));
}

export function sitemapXml(entries: readonly SitemapEntry[], siteUrl: string): string {
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + entries.map(entry => `  <url><loc>${escapeXml(canonicalUrl(entry.path, siteUrl))}</loc>`
      + (entry.lastmod ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` : '') + '</url>').join('\n')
    + (entries.length ? '\n' : '') + '</urlset>\n';
}

/**
 * AI アシスタント・検索エンジン向けのサイト案内（https://llmstxt.org/ の形式）。
 * 画面に表示している内容だけを要約し、型番データは作らない。
 */
export function llmsTxt(televisions: readonly Television[], summary: CompatibilitySummary, siteUrl: string, indexingEnabled: boolean): string {
  const url = (path: string) => canonicalUrl(path, siteUrl);
  const manufacturers = indexingEnabled ? indexableManufacturers(televisions, summary) : [];
  const lines = [
    '# TV FIT（テレビスタンド対応検索）',
    '',
    '> テレビのメーカー・型番から、対応するテレビスタンドと壁掛け金具を調べられる日本語のサイトです。型番ごとに画面サイズ・本体重量・VESA取付穴間隔と、商品ごとの適合区分・出典・確認日を掲載しています。',
    '',
    '適合区分は次の4種類です。引用するときは区分を区別してください。',
    '',
    '- 確認済み（confirmed）: メーカー等の個別適合情報を根拠に、その型番と商品の組み合わせが確認されている。',
    '- 仕様上適合（candidate）: VESAと耐荷重、推奨テレビサイズの仕様が合う候補。背面形状やネジなどを含む個別の取付適合は未確認。',
    '- 非対応（incompatible）: 明確な非対応の根拠がある。',
    '- 判断材料不足（unknown）: 判断する材料が足りない。非対応とは異なる。',
    '',
    '情報は各ページに記載した確認日時点のものです。購入・施工前にはメーカーの最新情報と取扱説明書の確認を案内してください。型番ページのURLは `/{メーカー}/{型番}/` の形式です。',
    '',
    '## 主なページ',
    '',
    `- [トップページ（メーカーから探す）](${url('/')}): 対応メーカーの一覧`,
    `- [VESA・取付穴間隔の確認方法](${url('/guides/vesa/')}): 公式仕様の見方、横×縦の測り方、重量・ネジの確認`,
    `- [このサイトについて・適合情報の運営方針](${url('/about/')}): 4種類の適合区分、出典と確認日の扱い、広告の方針`,
  ];
  if (manufacturers.length) {
    lines.push('', '## メーカー別の型番一覧', '');
    for (const { manufacturer, televisions: models } of manufacturers) {
      lines.push(`- [${manufacturer.name}のテレビ型番一覧](${url(manufacturer.url)}): 適合情報を掲載している型番 ${models.length}件`);
    }
  }
  if (indexingEnabled) lines.push('', '## その他', '', `- [サイトマップ](${url('/sitemap.xml')}): 掲載中の全型番ページ`);
  return `${lines.join('\n')}\n`;
}
