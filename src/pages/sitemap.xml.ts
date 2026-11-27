import type { APIRoute } from 'astro';
import { getSeoConfig } from '../lib/seo';
import { sitemapEntries, sitemapXml } from '../lib/sitemap';
import { getSitemapSource } from '../lib/sitemap-source';

export const prerender = false;

export const GET: APIRoute = async () => {
  const config = getSeoConfig();
  let entries: ReturnType<typeof sitemapEntries> = [];
  if (config.indexingEnabled) {
    const { televisions, summary } = await getSitemapSource();
    entries = sitemapEntries(televisions, summary);
  }
  return new Response(sitemapXml(entries, config.siteUrl), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
};
