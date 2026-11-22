import type { APIRoute } from 'astro';
import { getPublishedCatalog } from '../../lib/cms-catalog';
import { runOfferCheck } from '../../lib/offer-check';
import type { OfferDatabase } from '../../lib/offer-store';
import { clearPublishedOffersCache } from '../../lib/published-offers';

export const prerender = false;

/**
 * 販売情報の定期チェック。Worker の scheduled() からだけ呼ばれる。
 * 外部からのアクセスは src/worker.ts で 404 にしている。
 */
export const POST: APIRoute = async () => {
  // @ts-expect-error cloudflare:workers is resolved by the Cloudflare adapter.
  const { env } = await import('cloudflare:workers');
  const db = env.DB as OfferDatabase | undefined;
  if (!db) return new Response('DB binding is unavailable', { status: 500 });
  const catalog = await getPublishedCatalog({ compatibility: 'none' });
  const result = await runOfferCheck({ db, stands: catalog.stands });
  clearPublishedOffersCache();
  console.log('[offers] check finished', JSON.stringify(result));
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
};
