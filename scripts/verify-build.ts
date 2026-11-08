import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { load } from 'cheerio';
import { loadEnv } from 'vite';
import { loadCatalog, isIndexableTelevision, televisionPath } from '../src/lib/data';
import { getSeoConfig, canonicalUrl } from '../src/lib/seo';

const root = resolve('dist');
assert(existsSync(resolve(root, 'index.html')), '先に npm run build を実行してください');
const catalog = loadCatalog();
const config = getSeoConfig(loadEnv('production', process.cwd(), 'PUBLIC_'));
const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? files(resolve(directory, entry.name)) : [resolve(directory, entry.name)]);
const builtFiles = files(root);
const htmlFiles = builtFiles.filter(path => path.endsWith('.html'));
for (const filename of builtFiles.filter(path => /\.(?:html|js|css|json|csv)$/u.test(path))) {
  assert(!/(?:fixture-tv-|fixture-stand-|FICTION-)/u.test(readFileSync(filename, 'utf8')), `${relative(root, filename)}: テスト専用データが公開物に混入しています`);
}
const seenTitles = new Set<string>();
const seenCanonicals = new Set<string>();
let externalLinkCount = 0;

for (const filename of htmlFiles) {
  const html = readFileSync(filename, 'utf8');
  const $ = load(html);
  const relativeFile = relative(root, filename).replaceAll('\\', '/');
  const route = relativeFile === 'index.html' ? '/' : relativeFile === '404.html' ? '/404/' : `/${relativeFile.replace(/index\.html$/, '')}`;
  const title = $('title').text();
  assert(title.trim().length > 0, `${route}: title が必要です`);
  assert(!seenTitles.has(title), `${route}: title が重複しています`);
  seenTitles.add(title);
  assert.equal($('html').attr('lang'), 'ja', `${route}: lang=ja が必要です`);
  assert(($('meta[name="description"]').attr('content') ?? '').length > 10, `${route}: description が必要です`);
  assert.equal($('meta[name="viewport"]').length, 1, `${route}: viewport が必要です`);
  assert.equal($('link[rel="canonical"]').length, 1, `${route}: canonical は1件必要です`);
  const canonical = $('link[rel="canonical"]').attr('href') ?? '';
  assert.equal(canonical, canonicalUrl(route, config.siteUrl), `${route}: canonical が一致しません`);
  assert(!seenCanonicals.has(canonical), `${route}: canonical が重複しています`);
  seenCanonicals.add(canonical);
  const tv = catalog.televisions.find(item => decodeURIComponent(televisionPath(item)) === route);
  const indexable = !['/404/', '/privacy/'].includes(route) && (!tv || isIndexableTelevision(tv, catalog));
  assert.equal($('meta[name="robots"]').attr('content'), config.indexingEnabled && indexable ? 'index, follow' : 'noindex, follow', `${route}: robots が一致しません`);
  assert.equal($('h1').length, 1, `${route}: h1 は1件必要です`);

  $('script[type="application/ld+json"]').each((_, element) => {
    const schema = JSON.parse($(element).text()) as unknown;
    const inspect = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        assert(!['aggregateRating', 'review', 'reviews', 'price', 'priceCurrency'].includes(key), `${route}: 未提供の価格・レビューを構造化できません`);
        inspect(child);
      }
    };
    inspect(schema);
  });
  $('a[target="_blank"]').each((_, element) => {
    const rel = ($(element).attr('rel') ?? '').split(/\s+/);
    assert(rel.includes('noopener') && rel.includes('noreferrer'), `${route}: 外部リンクの rel が不足しています`);
    externalLinkCount += 1;
  });
  $('a[data-affiliate-link]').each((_, element) => {
    const rel = ($(element).attr('rel') ?? '').split(/\s+/);
    assert(rel.includes('sponsored') && rel.includes('nofollow'), `${route}: 購入リンクは広告属性が必要です`);
    assert($(element).attr('href')?.startsWith('https://'), `${route}: 購入リンクはHTTPSが必要です`);
  });
  $('script[src]').each((_, element) => {
    const src = $(element).attr('src') ?? '';
    assert(src.startsWith('/_astro/'), `${route}: 予期しない初期スクリプト: ${src}`);
    assert(existsSync(resolve(root, src.slice(1))), `${route}: スクリプトが存在しません: ${src}`);
  });
  if (tv) assert($('h1').text().includes(tv.model), `${route}: 正式な型番を表示してください`);
}

const home = load(readFileSync(resolve(root, 'index.html'), 'utf8'));
const searchData = JSON.parse(home('[data-search-catalog]').text()) as { id: string }[];
assert.deepEqual(searchData.map(item => item.id).sort(), catalog.televisions.map(item => item.id).sort(), '検索データは本番CSVと一致させてください');
assert(!searchData.some(item => item.id.startsWith('fixture-')), '架空データを検索に公開できません');
assert.equal(home('form[role="search"]').length, 1, 'トップページに検索フォームが必要です');
assert(home('[data-search-model]').attr('maxlength') === '100', '検索文字数制限が必要です');
assert(htmlFiles.every(filename => !relative(root, filename).includes('fixture')), '架空ページを公開できません');
for (const tv of catalog.televisions) assert(existsSync(resolve(root, decodeURIComponent(televisionPath(tv)).slice(1), 'index.html')), `${tv.id}: 型番別静的HTMLがありません`);

const sitemap = load(readFileSync(resolve(root, 'sitemap.xml'), 'utf8'), { xmlMode: true });
const actualLocations = sitemap('loc').map((_, node) => sitemap(node).text()).get().sort();
const expectedLocations = config.indexingEnabled
  ? ['/', '/guides/vesa/', '/about/', ...catalog.televisions.filter(tv => isIndexableTelevision(tv, catalog)).map(televisionPath)]
    .map(path => canonicalUrl(path, config.siteUrl)).sort()
  : [];
assert.deepEqual(actualLocations, expectedLocations, 'サイトマップはインデックス可能なページのみにしてください');
const robots = readFileSync(resolve(root, 'robots.txt'), 'utf8');
assert(robots.includes('Allow: /'), 'noindex を読めるようクローラーを許可してください');
assert.equal(robots.includes('Sitemap:'), config.indexingEnabled, 'サイトマップ案内が公開設定と一致しません');
const headers = readFileSync(resolve(root, '_headers'), 'utf8');
for (const header of ['X-Content-Type-Options: nosniff', 'Content-Security-Policy:', 'Referrer-Policy:']) assert(headers.includes(header), `${header} がありません`);
console.log(`静的HTML検証成功: ${htmlFiles.length} ページ / 型番 ${catalog.televisions.length} 件 / 外部リンク ${externalLinkCount} 件 / サイトマップ ${actualLocations.length} 件`);
