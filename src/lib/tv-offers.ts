import type { Television } from './data';
import { modelPattern, normalizeName, YAHOO_TV_CATEGORY_ID } from './tv-ranking';
import { vcAffiliate, yahooErrorDetail, YAHOO_SEARCH_URL, type YahooCredentials } from './yahoo-shopping';

/**
 * 型番ページに出すテレビ本体の商品画像と、Yahoo!ショッピングの商品ページへのリンク。
 *
 * - Yahoo!ショッピング商品検索API（v3）で「テレビ」カテゴリの新品を型番で検索し、
 *   商品名に型番がそのまま含まれる商品だけを使う（似た型番・別サイズ・付属品を拾わない）。
 * - 画像は API が返した URL をそのまま表示する（保存し直さない）。画像は商品ページへのリンクにする。
 * - リンクはバリューコマースの Yahoo!ショッピングのプログラム（sid / pid）で包む。無ければ商品ページへ直接リンクし、PR 表示もしない。
 * - 定期チェック（6時間ごと）のたびに、古い順に最大 TV_OFFER_BATCH 件だけ取り直す（1回の処理を短く保つ）。
 */
export const TV_OFFER_BATCH = 100;
/** 取り直す間隔。 */
export const TV_OFFER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** 取得に失敗しても、最後に取れてからこの期間は前回の画像を出し続ける。これより古いものは出さない。 */
export const TV_OFFER_STALE_MS = 30 * 24 * 60 * 60 * 1000;
/** テレビ本体とみなす最低価格（これ未満は部品・保証・設置サービスなどとして除く）。 */
const MIN_TV_PRICE = 10_000;
const ITEM_HOST = 'store.shopping.yahoo.co.jp';

export interface TvOffer {
  television_id: string;
  item_url: string | null;
  image_url: string | null;
  affiliate_url: string | null;
  pv_img_url: string | null;
  checked_at: string;
  last_success_at: string | null;
  last_error: string | null;
}

interface TvHit {
  name?: unknown;
  url?: unknown;
  price?: unknown;
  inStock?: unknown;
  image?: { small?: unknown; medium?: unknown };
  exImage?: { url?: unknown };
}

function httpsUrl(value: unknown, host?: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (host && url.hostname !== host) return null;
    return url.href;
  } catch { return null; }
}

/** 部品・アクセサリー・中古などの商品名を除く。 */
const NOT_TV = /(中古|訳あり|アウトレット|壁掛け?金具|保護パネル|液晶保護|交換部品|部品のみ)/u;

/**
 * 検索結果から、その型番のテレビ本体の商品を選ぶ。
 * 商品名に型番が（前後に英数字が続かない形で）含まれ、画像と商品ページがあり、テレビ本体らしい価格のもの。
 * 在庫ありを優先し、同じなら API の並び（おすすめ順）。
 */
export function pickTvHit(hits: readonly TvHit[], model: string): { item_url: string; image_url: string } | null {
  const pattern = modelPattern(model);
  if (!pattern) return null;
  const candidates = hits.flatMap((hit, index) => {
    if (typeof hit.name !== 'string') return [];
    const name = normalizeName(hit.name);
    if (!pattern.test(name) || NOT_TV.test(hit.name.normalize('NFKC'))) return [];
    const price = typeof hit.price === 'number' ? hit.price : Number(hit.price);
    if (!Number.isFinite(price) || price < MIN_TV_PRICE) return [];
    const item_url = httpsUrl(hit.url, ITEM_HOST);
    const image_url = httpsUrl(hit.exImage?.url) ?? httpsUrl(hit.image?.medium);
    return item_url && image_url ? [{ item_url, image_url, inStock: hit.inStock === true, index }] : [];
  });
  candidates.sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.index - b.index);
  const best = candidates[0];
  return best ? { item_url: best.item_url, image_url: best.image_url } : null;
}

export type TvObservation = { kind: 'found'; item_url: string; image_url: string } | { kind: 'missing'; detail: string } | { kind: 'error'; detail: string };

/** 型番で「テレビ」カテゴリの新品を検索する。 */
export async function observeTvOffer(model: string, appId: string, fetcher: typeof fetch = fetch): Promise<TvObservation> {
  const url = new URL(YAHOO_SEARCH_URL);
  url.searchParams.set('appid', appId);
  url.searchParams.set('query', model);
  url.searchParams.set('genre_category_id', YAHOO_TV_CATEGORY_ID);
  url.searchParams.set('condition', 'new');
  url.searchParams.set('results', '30');
  url.searchParams.set('image_size', '600');
  let response: Response;
  try {
    response = await fetcher(url.href, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    return { kind: 'error', detail: error instanceof Error ? `Yahoo API ${error.name}: ${error.message}`.slice(0, 200) : 'Yahoo API fetch failed' };
  }
  if (!response.ok) return { kind: 'error', detail: await yahooErrorDetail(response) };
  let data: { hits?: unknown };
  try { data = await response.json() as typeof data; } catch { return { kind: 'error', detail: 'Yahoo API: JSON を読めませんでした' }; }
  const hits = Array.isArray(data.hits) ? data.hits.filter((hit): hit is TvHit => hit !== null && typeof hit === 'object') : [];
  const picked = pickTvHit(hits, model);
  return picked ? { kind: 'found', ...picked } : { kind: 'missing', detail: `Yahoo API: 型番が一致するテレビなし（検索結果 ${hits.length}件）` };
}

// ---- 保存（D1。EmDash の表とは別の tvfit_ 表） ----

export interface TvOfferDatabase {
  prepare(query: string): { bind(...values: unknown[]): { run(): Promise<unknown>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }> } };
}

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS tvfit_tv_offers (
  television_id TEXT PRIMARY KEY,
  item_url TEXT,
  image_url TEXT,
  affiliate_url TEXT,
  pv_img_url TEXT,
  checked_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error TEXT
)`;

export async function ensureTvOffersTable(db: TvOfferDatabase): Promise<void> {
  await db.prepare(TABLE_SQL).bind().run();
}

const text = (value: unknown) => typeof value === 'string' ? value : null;
function toTvOffer(row: Record<string, unknown>): TvOffer | null {
  if (typeof row.television_id !== 'string' || typeof row.checked_at !== 'string') return null;
  return {
    television_id: row.television_id, item_url: text(row.item_url), image_url: text(row.image_url),
    affiliate_url: text(row.affiliate_url), pv_img_url: text(row.pv_img_url),
    checked_at: row.checked_at, last_success_at: text(row.last_success_at), last_error: text(row.last_error),
  };
}

/** 表がまだ無ければ空。 */
export async function readTvOffers(db: TvOfferDatabase, televisionId?: string): Promise<TvOffer[]> {
  try {
    const { results } = televisionId
      ? await db.prepare('SELECT * FROM tvfit_tv_offers WHERE television_id = ?').bind(televisionId).all()
      : await db.prepare('SELECT * FROM tvfit_tv_offers').bind().all();
    return results.flatMap(row => toTvOffer(row) ?? []);
  } catch (error) {
    if (error instanceof Error && /no such table/iu.test(error.message)) return [];
    throw error;
  }
}

async function saveTvOffer(db: TvOfferDatabase, offer: TvOffer): Promise<void> {
  await db.prepare(`INSERT INTO tvfit_tv_offers (television_id, item_url, image_url, affiliate_url, pv_img_url, checked_at, last_success_at, last_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (television_id) DO UPDATE SET item_url = excluded.item_url, image_url = excluded.image_url,
      affiliate_url = excluded.affiliate_url, pv_img_url = excluded.pv_img_url, checked_at = excluded.checked_at,
      last_success_at = excluded.last_success_at, last_error = excluded.last_error`)
    .bind(offer.television_id, offer.item_url, offer.image_url, offer.affiliate_url, offer.pv_img_url, offer.checked_at, offer.last_success_at, offer.last_error)
    .run();
}

/** 前回の記録と今回の結果から、次に保存する記録を作る。一時的なエラーでは前回の画像を残す。 */
export function nextTvOffer(previous: TvOffer | null, televisionId: string, observation: TvObservation, at: Date, credentials: Pick<YahooCredentials, 'vcSid' | 'vcPid'>): TvOffer {
  const checked_at = at.toISOString();
  if (observation.kind === 'found') {
    const affiliate = vcAffiliate(observation.item_url, credentials.vcSid, credentials.vcPid);
    return { television_id: televisionId, item_url: observation.item_url, image_url: observation.image_url, affiliate_url: affiliate?.affiliate_url ?? null, pv_img_url: affiliate?.pv_img_url ?? null, checked_at, last_success_at: checked_at, last_error: null };
  }
  if (observation.kind === 'missing') {
    return { television_id: televisionId, item_url: null, image_url: null, affiliate_url: null, pv_img_url: null, checked_at, last_success_at: previous?.last_success_at ?? null, last_error: observation.detail };
  }
  return { ...(previous ?? { television_id: televisionId, item_url: null, image_url: null, affiliate_url: null, pv_img_url: null, last_success_at: null }), checked_at, last_error: observation.detail };
}

export type TvOfferUpdateResult = { status: 'skipped'; reason: string } | { status: 'updated'; checked: number; found: number; missing: number; errors: number; remaining: number };

/**
 * 取得してから TV_OFFER_INTERVAL_MS 以上たったテレビ（未取得を先に、古い順）を、最大 batch 件取り直す。
 * 1件ごとに delayMs あける。
 */
export async function updateTvOffers(options: { db: TvOfferDatabase; televisions: readonly Pick<Television, 'id' | 'model'>[]; credentials: YahooCredentials | null; fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => Date; batch?: number; delayMs?: number }): Promise<TvOfferUpdateResult> {
  const { db, televisions, credentials, now = () => new Date(), batch = TV_OFFER_BATCH, delayMs = 1100 } = options;
  if (!credentials) return { status: 'skipped', reason: 'Yahoo!のアプリケーションIDが未設定' };
  if (televisions.length === 0) return { status: 'skipped', reason: 'テレビを読めなかった' };
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  await ensureTvOffersTable(db);
  const previous = new Map((await readTvOffers(db)).map(offer => [offer.television_id, offer]));
  const started = now().getTime();
  const due = televisions
    .filter(television => {
      const at = previous.get(television.id)?.checked_at;
      return !at || started - new Date(at).getTime() >= TV_OFFER_INTERVAL_MS;
    })
    .sort((a, b) => (previous.get(a.id)?.checked_at ?? '').localeCompare(previous.get(b.id)?.checked_at ?? ''));
  const targets = due.slice(0, batch);
  const result = { status: 'updated' as const, checked: 0, found: 0, missing: 0, errors: 0, remaining: due.length - targets.length };
  for (const television of targets) {
    if (result.checked > 0) await sleep(delayMs);
    const observation = await observeTvOffer(television.model, credentials.appId, options.fetcher);
    await saveTvOffer(db, nextTvOffer(previous.get(television.id) ?? null, television.id, observation, now(), credentials));
    result.checked += 1;
    result[observation.kind === 'found' ? 'found' : observation.kind === 'missing' ? 'missing' : 'errors'] += 1;
  }
  return result;
}

// ---- 表示 ----

/** 表示してよい記録か（画像があり、最後に取れてから古すぎない）。 */
export function displayTvOffer(offer: TvOffer | null | undefined, now: Date = new Date()): TvOffer | null {
  if (!offer?.image_url || !offer.item_url || !offer.last_success_at) return null;
  const at = new Date(offer.last_success_at).getTime();
  return Number.isNaN(at) || now.getTime() - at > TV_OFFER_STALE_MS ? null : offer;
}

/** 公開ページ用。読めなくてもページは表示する（画像の代わりに VESA の図が出るだけ）。 */
export async function getPublishedTvOffer(televisionId: string): Promise<TvOffer | null> {
  try {
    // @ts-expect-error cloudflare:workers is resolved by the Cloudflare adapter.
    const { env } = await import('cloudflare:workers');
    const db = env.DB as TvOfferDatabase | undefined;
    if (!db) return null;
    return displayTvOffer((await readTvOffers(db, televisionId))[0]);
  } catch (error) {
    console.error('[tv-offers] 読み込めませんでした:', error instanceof Error ? error.message : error);
    return null;
  }
}
