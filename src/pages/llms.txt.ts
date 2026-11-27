import type { APIRoute } from 'astro';
import { getSeoConfig } from '../lib/seo';
import { llmsTxt } from '../lib/sitemap';
import { getSitemapSource } from '../lib/sitemap-source';

export const prerender = false;

export const GET: APIRoute = async () => {
  const config = getSeoConfig();
  const { televisions, summary } = await getSitemapSource();
  return new Response(llmsTxt(televisions, summary, config.siteUrl, config.indexingEnabled), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'public, max-age=3600' },
  });
};
