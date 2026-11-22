import type { Offer } from './offers';
import { readOffers, type OfferDatabase } from './offer-store';

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; offers: Map<string, Offer[]> } | null = null;

export function clearPublishedOffersCache(): void { cache = null; }

async function database(): Promise<OfferDatabase | null> {
  try {
    // @ts-expect-error cloudflare:workers is resolved by the Cloudflare adapter.
    const { env } = await import('cloudflare:workers');
    return (env.DB as OfferDatabase | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * 公開ページ用：スタンドIDごとの販売情報。読めなくてもページは表示する
 * （価格・在庫が出ないだけで、適合情報と購入リンクはそのまま）。
 */
export async function getPublishedOffers(db?: OfferDatabase | null): Promise<Map<string, Offer[]>> {
  if (!db && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.offers;
  const source = db ?? await database();
  const offers = new Map<string, Offer[]>();
  if (!source) return offers;
  try {
    for (const offer of await readOffers(source)) offers.set(offer.stand_id, [...offers.get(offer.stand_id) ?? [], offer]);
  } catch (error) {
    console.error('[offers] 販売情報を読み込めませんでした:', error instanceof Error ? error.message : error);
    return offers;
  }
  if (!db) cache = { at: Date.now(), offers };
  return offers;
}
