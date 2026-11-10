import type { APIRoute } from 'astro';
import { getPublishedCatalog } from '../lib/cms-catalog';
import { isIndexableTelevision, televisionPath } from '../lib/data';
import { canonicalUrl, escapeXml, getSeoConfig } from '../lib/seo';
import { getManufacturers, isIndexableManufacturer } from '../lib/manufacturers';

export const prerender = false;

export const GET: APIRoute = async () => {
  const config = getSeoConfig();
  const catalog = await getPublishedCatalog();
  const paths = config.indexingEnabled ? [
    '/', '/guides/vesa/', '/about/',
    ...getManufacturers(catalog.televisions).filter(manufacturer => isIndexableManufacturer(manufacturer, catalog)).map(manufacturer => manufacturer.url),
    ...catalog.televisions.filter(tv => isIndexableTelevision(tv, catalog)).map(televisionPath),
  ] : [];
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + [...new Set(paths)].map(path => `  <url><loc>${escapeXml(canonicalUrl(path, config.siteUrl))}</loc></url>`).join('\n')
    + '\n</urlset>\n';
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
