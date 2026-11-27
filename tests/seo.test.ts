import { describe, expect, it } from 'vitest';
import { canonicalUrl, escapeXml, getSeoConfig, robotsMeta, safeJsonLd } from '../src/lib/seo';
import { breadcrumbNode, websiteNode } from '../src/lib/structured-data';

describe('deployment indexing policy', () => {
  it('keeps an unconfigured build noindex even if indexing is requested', () => {
    const config = getSeoConfig({ PUBLIC_INDEXING_ENABLED: 'true' });
    expect(config.indexingEnabled).toBe(false);
    expect(robotsMeta(true, config)).toBe('noindex, follow');
  });

  it('requires both a public HTTPS origin and an explicit indexing flag', () => {
    const env = { PUBLIC_SITE_URL: 'https://tvstand.jp/' };
    expect(getSeoConfig(env).indexingEnabled).toBe(false);
    const config = getSeoConfig({ ...env, PUBLIC_INDEXING_ENABLED: 'true' });
    expect(config.indexingEnabled).toBe(true);
    expect(robotsMeta(true, config)).toBe('index, follow');
    expect(robotsMeta(false, config)).toBe('noindex, follow');
  });

  it.each([
    'javascript:alert(1)', 'http://tvstand.jp', 'https://example.invalid',
    'https://example.com', 'https://localhost', 'https://127.0.0.1',
    'https://user:password@tvstand.jp', 'https://tvstand.jp/subpath/',
  ])('rejects a nonproduction canonical origin: %s', origin => {
    expect(getSeoConfig({ PUBLIC_SITE_URL: origin, PUBLIC_INDEXING_ENABLED: 'true' }).configured).toBe(false);
  });
});

describe('canonical and structured data security', () => {
  it('builds absolute canonical URLs and refuses external path injection', () => {
    expect(canonicalUrl('/guides/vesa/', 'https://tvstand.jp')).toBe('https://tvstand.jp/guides/vesa/');
    for (const path of ['//evil.invalid/', '/\\evil.invalid/', '/?q=x', '/#x', 'https://evil.invalid']) {
      expect(() => canonicalUrl(path, 'https://tvstand.jp')).toThrow();
    }
  });

  it('escapes script breakouts while retaining the exact JSON value', () => {
    const value = { name: '</script><script>alert(1)</script>&\u2028\u2029' };
    const encoded = safeJsonLd(value);
    expect(encoded).not.toContain('<');
    expect(encoded).not.toContain('&');
    expect(JSON.parse(encoded)).toEqual(value);
  });

  it('has only visible website and breadcrumb information, without reviews or prices', () => {
    const website = websiteNode('https://tvstand.jp');
    expect(website).not.toHaveProperty('aggregateRating');
    expect(website).not.toHaveProperty('offers');
    const crumbs = breadcrumbNode([{ name: 'VESAの確認方法' }], 'https://tvstand.jp/guides/vesa/', 'https://tvstand.jp') as { itemListElement: unknown[] };
    expect(crumbs.itemListElement[1]).toMatchObject({
      position: 2, name: 'VESAの確認方法', item: 'https://tvstand.jp/guides/vesa/',
    });
    expect(escapeXml('https://tvstand.jp/?a=1&b=<x>')).toBe('https://tvstand.jp/?a=1&amp;b=&lt;x&gt;');
  });
});
