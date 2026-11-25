import type { APIRoute } from 'astro';
import { readOffers, type OfferDatabase } from '../lib/offer-store';
import { readRankingRun, type RankingDatabase } from '../lib/tv-ranking';

export const prerender = false;

/**
 * 販売情報チェックの集計（運用確認用・読み取りのみ）。価格や URL は出さず、件数と失敗理由だけを返す。
 */
export const GET: APIRoute = async () => {
  // @ts-expect-error cloudflare:workers is resolved by the Cloudflare adapter.
  const { env } = await import('cloudflare:workers');
  const db = env.DB as OfferDatabase | undefined;
  const offers = db ? await readOffers(db) : [];
  const count = (values: (string | null)[]) => Object.entries(values.reduce<Record<string, number>>((all, value) => {
    const key = value ?? '-';
    all[key] = (all[key] ?? 0) + 1;
    return all;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const latest = (values: (string | null)[]) => values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const body = {
    offers: offers.length,
    last_checked_at: latest(offers.map(offer => offer.checked_at)),
    last_success_at: latest(offers.map(offer => offer.last_success_at)),
    availability: Object.fromEntries(count(offers.map(offer => offer.availability))),
    errors: count(offers.map(offer => offer.last_error)).filter(([key]) => key !== '-'),
    // 売れ筋順（楽天市場ランキング）の更新状況。表がまだ無ければ null。
    ranking: db ? await readRankingRun(db as unknown as RankingDatabase).catch(() => null) : null,
  };
  return Response.json(body, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
};
