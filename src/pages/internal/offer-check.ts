import type { APIRoute } from 'astro';
import { getPublishedCatalog } from '../../lib/cms-catalog';
import { runOfferCheck } from '../../lib/offer-check';
import type { OfferDatabase } from '../../lib/offer-store';
import { clearPublishedOffersCache } from '../../lib/published-offers';
import { runStandRankingProbe, saveStandRankingProbe } from '../../lib/stand-ranking-probe';
import { chooseRankingCredentials, clearRankingCache, updateRankingIfDue, type RankingDatabase } from '../../lib/tv-ranking';

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
  // トークンは Cloudflare のシークレットにだけ置く。未設定なら商品APIの販売店は確認しない。
  const secret = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
  const vcToken = secret(env.VC_API_TOKEN);
  // Yahoo!ショッピング：アプリケーションIDがあれば公式ストアの価格・在庫を確認し、sid/pid があればアフィリエイトにする。
  const yahooAppId = secret(env.YAHOO_APP_ID);
  const yahoo = yahooAppId ? { appId: yahooAppId, vcSid: secret(env.YAHOO_VC_SID), vcPid: secret(env.YAHOO_VC_PID) } : null;
  const result = await runOfferCheck({ db, stands: catalog.stands, vcToken, yahoo });
  clearPublishedOffersCache();
  console.log('[offers] check finished', JSON.stringify(result));
  // テレビの売れ筋順（楽天市場ランキング、楽天が未設定なら Yahoo!ショッピングのランキング）。
  // 前回から7日たっていれば更新する。失敗しても販売情報の結果には影響させない。
  const credentials = chooseRankingCredentials({ rakutenAppId: secret(env.RAKUTEN_APP_ID), rakutenAccessKey: secret(env.RAKUTEN_ACCESS_KEY), yahooAppId });
  let ranking: unknown;
  try {
    ranking = await updateRankingIfDue({ db: db as unknown as RankingDatabase, televisions: catalog.televisions, credentials });
    clearRankingCache();
  } catch (error) {
    ranking = { status: 'error', detail: error instanceof Error ? error.message : String(error) };
  }
  console.log('[ranking] update finished', JSON.stringify(ranking));
  // スタンドの売れ筋順（サンワダイレクト）を商品APIの rank=monthly で取れるかの試験。表示には使わない。
  let standRankingProbe: unknown = null;
  if (vcToken) {
    try {
      const probe = await runStandRankingProbe({ token: vcToken, stands: catalog.stands });
      await saveStandRankingProbe(db as unknown as RankingDatabase, probe);
      standRankingProbe = { monthly_items: probe.monthly.items, monthly_error: probe.monthly.error, same_order_as_score: probe.same_order_as_score, stands_found: Object.keys(probe.stand_positions).length };
    } catch (error) {
      standRankingProbe = { error: error instanceof Error ? error.message : String(error) };
    }
    console.log('[stand-ranking-probe] finished', JSON.stringify(standRankingProbe));
  }
  return Response.json({ offers: result, ranking, standRankingProbe }, { headers: { 'Cache-Control': 'no-store' } });
};
