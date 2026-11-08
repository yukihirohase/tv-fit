export interface SeoEnvironment {
  PUBLIC_SITE_URL?: string;
  PUBLIC_INDEXING_ENABLED?: string;
}

export interface SeoConfig {
  siteUrl: string;
  configured: boolean;
  indexingEnabled: boolean;
}

const FALLBACK_SITE = 'https://example.invalid';

/** Indexing is an explicit deployment decision, never inferred from a preview URL. */
export function getSeoConfig(env: SeoEnvironment = import.meta.env): SeoConfig {
  let siteUrl = FALLBACK_SITE;
  let configured = false;
  try {
    const url = new URL(env.PUBLIC_SITE_URL ?? FALLBACK_SITE);
    const reserved = /(^|\.)(localhost|invalid|test|example|local)$/.test(url.hostname)
      || /(^|\.)example\.(com|net|org)$/.test(url.hostname)
      || /^(127\.|0\.|192\.168\.|10\.)/.test(url.hostname)
      || url.hostname === '[::1]';
    if (url.protocol === 'https:' && !url.username && !url.password && !reserved
      && url.pathname === '/' && !url.search && !url.hash && !url.port) {
      siteUrl = url.origin;
      configured = true;
    }
  } catch {
    // Local development intentionally has no public canonical domain.
  }
  return { siteUrl, configured, indexingEnabled: configured && env.PUBLIC_INDEXING_ENABLED === 'true' };
}

export function canonicalUrl(path: string, siteUrl = getSeoConfig().siteUrl): string {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\?#]/.test(path)) {
    throw new Error('Canonical paths must be absolute site paths without a query or fragment.');
  }
  return new URL(path, siteUrl).href;
}

export function robotsMeta(indexable = true, config = getSeoConfig()): string {
  return indexable && config.indexingEnabled ? 'index, follow' : 'noindex, follow';
}

/** Safe for an application/ld+json script. Never interpolate raw JSON in HTML. */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export interface BreadcrumbItem { name: string; path: string }

export function breadcrumbSchema(items: BreadcrumbItem[], siteUrl = getSeoConfig().siteUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem', position: index + 1, name: item.name,
      item: canonicalUrl(item.path, siteUrl),
    })),
  };
}

export function websiteSchema(siteUrl = getSeoConfig().siteUrl) {
  return {
    '@context': 'https://schema.org', '@type': 'WebSite',
    name: 'テレビスタンド対応検索', inLanguage: 'ja', url: canonicalUrl('/', siteUrl),
    description: 'テレビのメーカー・型番から、テレビスタンドと壁掛け金具の適合情報を確認するサイト。',
  };
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
