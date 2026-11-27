import type { APIRoute } from 'astro';
import { getPublishedCatalog } from '../lib/cms-catalog';
import { getSeoConfig } from '../lib/seo';
import { llmsTxt } from '../lib/sitemap';

export const prerender = false;

export const GET: APIRoute = async () => {
  const config = getSeoConfig();
  const catalog = await getPublishedCatalog();
  return new Response(llmsTxt(catalog, config.siteUrl, config.indexingEnabled), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' },
  });
};
