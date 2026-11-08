import type { APIRoute } from 'astro';
import { loadCatalog, isIndexableTelevision, televisionPath } from '../lib/data';
import { canonicalUrl, escapeXml, getSeoConfig } from '../lib/seo';

export const prerender = true;

export const GET: APIRoute = () => {
  const config = getSeoConfig();
  const catalog = loadCatalog();
  const paths = config.indexingEnabled ? [
    '/', '/guides/vesa/', '/about/',
    ...catalog.televisions.filter(tv => isIndexableTelevision(tv, catalog)).map(televisionPath),
  ] : [];
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + [...new Set(paths)].map(path => `  <url><loc>${escapeXml(canonicalUrl(path, config.siteUrl))}</loc></url>`).join('\n')
    + '\n</urlset>\n';
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
