import type { APIRoute } from 'astro';
import { getPublishedCatalog } from '../lib/cms-catalog';
import { getSeoConfig } from '../lib/seo';
import { sitemapEntries, sitemapXml } from '../lib/sitemap';

export const prerender = false;

export const GET: APIRoute = async () => {
  const config = getSeoConfig();
  const entries = config.indexingEnabled ? sitemapEntries(await getPublishedCatalog()) : [];
  return new Response(sitemapXml(entries, config.siteUrl), { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
