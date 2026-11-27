import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadCatalog } from '../src/lib/csv';
import { llmsTxt, sitemapEntries, sitemapXml } from '../src/lib/sitemap';
import { readCompatibilitySummary, summaryFromCatalog, type SummaryDatabase } from '../src/lib/compatibility-summary';
import { canonicalPagePath, trailingSlashRedirect } from '../src/lib/trailing-slash';

const fixtures = loadCatalog(resolve('fixtures/catalog'), { allowFixtures: true });
const summary = summaryFromCatalog(fixtures);
// 架空でない値に置き換えた型番（インデックス条件の確認用。実在の製品データではない）。
const realistic = { ...fixtures.televisions[0]!, id: 'tv-test-1', manufacturer: 'SONY', model: 'TEST-55', source_url: 'https://www.sony.jp/bravia/' };

describe('sitemap', () => {
  it('lists only the fixed pages when every television is a fictional fixture', () => {
    expect(sitemapEntries(fixtures.televisions, summary).map(entry => entry.path)).toEqual(['/', '/guides/vesa/', '/about/']);
  });

  it('uses the latest confirmation date of each television as lastmod', () => {
    const tv = fixtures.televisions[0]!;
    const base = fixtures.compatibility.find(entry => entry.television_id === tv.id)!;
    const catalog = { ...fixtures, compatibility: [
      { ...base, checked_at: '2026-01-05' }, { ...base, checked_at: '2026-03-01' }, { ...base, checked_at: null },
    ] };
    expect(summaryFromCatalog(catalog).get(tv.id)).toEqual({ latestCheckedAt: '2026-03-01', hasEvidence: base.status !== 'unknown' });
  });

  it('lists an indexable television and its manufacturer with the latest confirmation date', () => {
    const entries = sitemapEntries([realistic], new Map([['tv-test-1', { latestCheckedAt: '2026-04-02', hasEvidence: true }]]));
    expect(entries).toContainEqual({ path: '/sony/', lastmod: '2026-04-02' });
    expect(entries).toContainEqual({ path: '/sony/test-55/', lastmod: '2026-04-02' });
    expect(sitemapEntries([realistic], new Map([['tv-test-1', { latestCheckedAt: '2026-04-02', hasEvidence: false }]])).map(entry => entry.path))
      .toEqual(['/', '/guides/vesa/', '/about/']);
  });

  it('reads the D1 summary and ignores malformed rows', async () => {
    const db: SummaryDatabase = { prepare: () => ({ all: async <T>() => ({ results: [
      { television_id: 'a', latest_checked_at: '2026-02-03', has_evidence: 1 },
      { television_id: 'b', latest_checked_at: null, has_evidence: 0 },
      { television_id: '', latest_checked_at: '2026-02-03', has_evidence: 1 },
      { television_id: 'c', latest_checked_at: 'not-a-date', has_evidence: 1 },
    ] as T[] }) }) };
    const result = await readCompatibilitySummary(db);
    expect([...result]).toEqual([
      ['a', { latestCheckedAt: '2026-02-03', hasEvidence: true }],
      ['b', { latestCheckedAt: null, hasEvidence: false }],
      ['c', { latestCheckedAt: null, hasEvidence: true }],
    ]);
  });

  it('writes lastmod only when it is known and escapes locations', () => {
    const xml = sitemapXml([{ path: '/' }, { path: '/sony/kj-55x85l/', lastmod: '2026-03-01' }], 'https://tvstand.jp');
    expect(xml).toContain('<url><loc>https://tvstand.jp/</loc></url>');
    expect(xml).toContain('<url><loc>https://tvstand.jp/sony/kj-55x85l/</loc><lastmod>2026-03-01</lastmod></url>');
    expect(sitemapXml([], 'https://tvstand.jp')).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>');
  });
});

describe('llms.txt', () => {
  it('summarises the site and the four statuses without listing fictional data', () => {
    const text = llmsTxt(fixtures.televisions, summary, 'https://tvstand.jp', true);
    expect(text.startsWith('# TV FIT')).toBe(true);
    for (const status of ['confirmed', 'candidate', 'incompatible', 'unknown']) expect(text).toContain(`（${status}）`);
    expect(text).toContain('https://tvstand.jp/guides/vesa/');
    expect(text).toContain('https://tvstand.jp/sitemap.xml');
    expect(text).not.toContain('架空');
  });

  it('does not point to the sitemap when indexing is disabled', () => {
    expect(llmsTxt(fixtures.televisions, summary, 'https://tvstand.jp', false)).not.toContain('sitemap.xml');
  });
});

describe('trailing slash', () => {
  const redirect = (path: string, method = 'GET') => trailingSlashRedirect({ method, url: `https://tv-fit.com${path}` })?.href ?? null;

  it('sends page URLs without a trailing slash to the canonical URL', () => {
    expect(redirect('/about')).toBe('https://tv-fit.com/about/');
    expect(redirect('/sony/kj-55x85l?ref=a')).toBe('https://tv-fit.com/sony/kj-55x85l/?ref=a');
    expect(redirect('/guides/vesa', 'HEAD')).toBe('https://tv-fit.com/guides/vesa/');
  });

  it('leaves files, internal routes, slash URLs and non-GET requests alone', () => {
    for (const path of ['/', '/about/', '/robots.txt', '/sitemap.xml', '/llms.txt', '/offer-status.json', '/_emdash/api/setup/status', '/_astro/a.css', '/internal/offer-check']) {
      expect(redirect(path)).toBeNull();
    }
    expect(redirect('/about', 'POST')).toBeNull();
  });

  it('normalises canonical paths', () => {
    expect(canonicalPagePath('/about')).toBe('/about/');
    expect(canonicalPagePath('/about/')).toBe('/about/');
    expect(canonicalPagePath('/')).toBe('/');
  });
});
