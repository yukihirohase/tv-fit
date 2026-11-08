import type { APIRoute } from 'astro';
import { canonicalUrl, getSeoConfig } from '../lib/seo';

export const prerender = true;

export const GET: APIRoute = () => {
  const config = getSeoConfig();
  // Crawlers must be allowed to read the page-level noindex directives.
  const body = 'User-agent: *\nAllow: /\n'
    + (config.indexingEnabled ? `Sitemap: ${canonicalUrl('/sitemap.xml', config.siteUrl)}\n` : '');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
