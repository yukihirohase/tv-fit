import type { Television } from './data';
import { yahooErrorDetail } from './yahoo-shopping';

/**
 * テレビの売れ筋順。モールの「テレビ」ランキングを週1回取得し、
 * 商品名に含まれる型番で当サイトのテレビと照合して、当サイト掲載機種の中で 1位から振り直す。
 *
 * 元データは次の優先順で、認証情報があるものを使う。
 * 1. 楽天市場ランキングAPI（楽天ウェブサービス）：シークレット RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY。
 *    楽天ウェブサービスの管理画面で、アプリの「許可されたWebサイト」に tv-fit.com を登録しておく
 *    （サーバーからの呼び出しでも Referer / Origin が必要）。
 * 2. Yahoo!ショッピング 高評価トレンドランキングAPI：シークレット YAHOO_APP_ID（販売情報と共用）。
 *    注文した人の数やレビュー評価を組み合わせた順位（純粋な売上順ではない）。
 *
 * - 価格.com のランキングは利用規約（情報の複製・転載の禁止）により使わない。
 * - データを表示するページには各APIのクレジットを出す（フッター）。
 */
export const RAKUTEN_RANKING_URL = 'https://openapi.rakuten.co.jp/ichibaranking/api/IchibaItem/Ranking/20220601';
/** 楽天市場の「TV・オーディオ・カメラ > テレビ」ジャンル（https://ranking.rakuten.co.jp/daily/563843/）。 */
export const RAKUTEN_TV_GENRE_ID = '563843';
/** ランキングAPIの最大ページ数（1ページ30件）。 */
export const RAKUTEN_RANKING_MAX_PAGES = 34;
/** 更新の間隔。定期チェック（6時間ごと）のたびに、前回からこれ以上たっていれば更新する。 */
export const RANKING_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000 - 3 * 60 * 60 * 1000;
/** 失敗したときの再試行の間隔（定期チェック1回おきではなく、毎回やり直す）。 */
export const RANKING_RETRY_MS = 5 * 60 * 60 * 1000;
/** これより古い順位は表示しない（取得が止まったときに古い順位を出し続けないため）。 */
export const RANKING_STALE_MS = 30 * 24 * 60 * 60 * 1000;

/** Yahoo!ショッピング 高評価トレンドランキングAPI。 */
export const YAHOO_RANKING_URL = 'https://shopping.yahooapis.jp/ShoppingWebService/V1/highRatingTrendRanking';
/** Yahoo!ショッピングの「テレビ、オーディオ、カメラ > テレビ、映像機器 > テレビ > テレビ」（https://shopping.yahoo.co.jp/categoryranking/49520/list）。 */
export const YAHOO_TV_CATEGORY_ID = '49520';
/** 1回の取得件数（API の上限 100）と、取得する最大件数（API は 1,000 件まで）。 */
export const YAHOO_RANKING_LIMIT = 100;
export const YAHOO_RANKING_MAX_ITEMS = 1000;

export type RankingSource = 'rakuten' | 'yahoo';
export const RANKING_SOURCE_NAMES: Record<RankingSource, string> = { rakuten: '楽天市場', yahoo: 'Yahoo!ショッピング' };

export interface RakutenCredentials { appId: string; accessKey: string; referer?: string }
export interface YahooRankingCredentials { appId: string }
export type RankingCredentials = ({ source: 'rakuten' } & RakutenCredentials) | ({ source: 'yahoo' } & YahooRankingCredentials);
export interface RankingSourceItem { rank: number; name: string }

/** 楽天の認証情報がそろっていれば楽天、無ければ Yahoo!（アプリケーションIDがあれば）。どちらも無ければ null。 */
export function chooseRankingCredentials(secrets: { rakutenAppId?: string | null; rakutenAccessKey?: string | null; yahooAppId?: string | null }): RankingCredentials | null {
  if (secrets.rakutenAppId && secrets.rakutenAccessKey) return { source: 'rakuten', appId: secrets.rakutenAppId, accessKey: secrets.rakutenAccessKey };
  if (secrets.yahooAppId) return { source: 'yahoo', appId: secrets.yahooAppId };
  return null;
}

type FetchResult = { ok: true; items: RankingSourceItem[] } | { ok: false; detail: string };
interface FetchOptions { fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void>; delayMs?: number }
const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Yahoo! の応答から順位と商品名を取り出す。 */
export function parseYahooRanking(data: unknown): { items: RankingSourceItem[]; total: number | null } {
  const root = ((data as { high_rating_trend_ranking?: unknown } | null)?.high_rating_trend_ranking ?? data) as { ranking_data?: unknown; meta?: { total_results_available?: unknown } } | null;
  const list = Array.isArray(root?.ranking_data) ? root.ranking_data : [];
  const items = list.flatMap(entry => {
    const item = entry as { rank?: unknown; item_information?: { name?: unknown }; name?: unknown } | null;
    const rank = Number(item?.rank);
    const name = item?.item_information?.name ?? item?.name;
    return Number.isInteger(rank) && rank > 0 && typeof name === 'string' ? [{ rank, name }] : [];
  });
  const total = Number(root?.meta?.total_results_available);
  return { items, total: Number.isFinite(total) ? total : null };
}

/** Yahoo! の「テレビ」ランキングを最大 1,000 件取得する（100件ずつ、1秒以上あける）。 */
export async function fetchYahooRanking(credentials: YahooRankingCredentials, options: FetchOptions & { limit?: number; maxItems?: number } = {}): Promise<FetchResult> {
  const { fetcher = fetch, delayMs = 1100, limit = YAHOO_RANKING_LIMIT, maxItems = YAHOO_RANKING_MAX_ITEMS } = options;
  const sleep = options.sleep ?? defaultSleep;
  const items: RankingSourceItem[] = [];
  for (let offset = 1; offset <= maxItems; offset += limit) {
    if (offset > 1) await sleep(delayMs);
    const url = new URL(YAHOO_RANKING_URL);
    url.searchParams.set('appid', credentials.appId);
    url.searchParams.set('genre_category_id', YAHOO_TV_CATEGORY_ID);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(Math.min(limit, maxItems - offset + 1)));
    let response: Response;
    try {
      response = await fetcher(url.href, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? `Yahoo API ${error.name}: ${error.message}`.slice(0, 200) : 'Yahoo API fetch failed' };
    }
    if (!response.ok) {
      if (response.status === 404 && items.length > 0) break;
      return { ok: false, detail: await yahooErrorDetail(response) };
    }
    let body: unknown = null;
    try { body = await response.json(); } catch { /* 下で扱う */ }
    const page = parseYahooRanking(body);
    if (page.items.length === 0) {
      if (items.length > 0) break;
      return { ok: false, detail: 'Yahoo API: ランキングを読めませんでした（0件）' };
    }
    items.push(...page.items);
    if (page.items.length < limit || (page.total !== null && offset + limit > page.total)) break;
  }
  return { ok: true, items };
}

/** API の応答から順位と商品名を取り出す（formatVersion 1 の {Item: {...}} と 2 の平らな形の両方に対応）。 */
export function parseRakutenRanking(data: unknown): RankingSourceItem[] {
  const items = (data as { Items?: unknown; items?: unknown } | null)?.Items ?? (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap(entry => {
    const item = (entry && typeof entry === 'object' && 'Item' in entry ? (entry as { Item: unknown }).Item : entry) as { rank?: unknown; itemName?: unknown } | null;
    const rank = Number(item?.rank);
    return Number.isInteger(rank) && rank > 0 && typeof item?.itemName === 'string' ? [{ rank, name: item.itemName }] : [];
  });
}

/** 照合用：全角→半角、大文字にそろえる。 */
export const normalizeName = (value: string) => value.normalize('NFKC').toUpperCase();
const modelChars = (model: string) => normalizeName(model).replace(/[^A-Z0-9]/gu, '');

/**
 * 型番の正規表現。英数字の間のハイフン・空白の有無は問わず、前後が英数字でないこと（似た型番の取り違えを防ぐ）。
 * 例：「43A400 Pro」は「43A400PRO」「43A400 PRO」にも一致するが、「43A400」だけの商品名には一致しない。
 */
export function modelPattern(model: string): RegExp | null {
  const chars = modelChars(model);
  if (chars.length < 4) return null;
  return new RegExp(`(?<![A-Z0-9])${[...chars].join('[-\\s・/]?')}(?![A-Z0-9])`, 'u');
}

/**
 * ランキングの商品を当サイトのテレビと照合し、当サイト内の順位（1から）を返す。
 * 1つの商品名に複数サイズの型番が並ぶ場合は、それぞれの型番に同じ順位を当てる。
 * 同じ型番が何度も出たら最上位だけを使う。同じ元順位の型番どうしは型番の昇順で並べる。
 */
export function matchRanking(items: readonly RankingSourceItem[], televisions: readonly Pick<Television, 'id' | 'model'>[]): Map<string, { rank: number; sourceRank: number }> {
  const patterns = televisions.flatMap(television => {
    const pattern = modelPattern(television.model);
    return pattern ? [{ television, pattern, length: modelChars(television.model).length }] : [];
  });
  const best = new Map<string, { sourceRank: number; model: string }>();
  for (const item of [...items].sort((a, b) => a.rank - b.rank)) {
    const name = normalizeName(item.name);
    const found = patterns.flatMap(({ television, pattern }) => {
      const match = pattern.exec(name);
      return match ? [{ television, start: match.index, end: match.index + match[0].length }] : [];
    });
    // 「43A400 PRO」の中の「43A400」のように、長い型番の一部として一致したものは除く。
    const kept = found.filter(a => !found.some(b => b !== a && b.start <= a.start && a.end <= b.end && b.end - b.start > a.end - a.start));
    for (const { television } of kept) {
      if (!best.has(television.id)) best.set(television.id, { sourceRank: item.rank, model: television.model });
    }
  }
  const ordered = [...best.entries()].sort((a, b) => a[1].sourceRank - b[1].sourceRank || a[1].model.localeCompare(b[1].model, 'ja'));
  return new Map(ordered.map(([id, value], index) => [id, { rank: index + 1, sourceRank: value.sourceRank }]));
}

/** ランキングを全ページ取得する。途中で失敗したら、それまでのページだけで判断しない（エラーにする）。 */
export async function fetchRakutenRanking(credentials: RakutenCredentials, options: FetchOptions & { maxPages?: number } = {}): Promise<FetchResult> {
  const { fetcher = fetch, delayMs = 1500, maxPages = RAKUTEN_RANKING_MAX_PAGES } = options;
  const sleep = options.sleep ?? defaultSleep;
  const referer = credentials.referer ?? 'https://tv-fit.com/';
  const items: RankingSourceItem[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    if (page > 1) await sleep(delayMs);
    const url = new URL(RAKUTEN_RANKING_URL);
    url.searchParams.set('applicationId', credentials.appId);
    url.searchParams.set('accessKey', credentials.accessKey);
    url.searchParams.set('genreId', RAKUTEN_TV_GENRE_ID);
    url.searchParams.set('page', String(page));
    url.searchParams.set('format', 'json');
    let response: Response;
    try {
      response = await fetcher(url.href, { headers: { Accept: 'application/json', Referer: referer, Origin: new URL(referer).origin }, signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? `楽天API ${error.name}: ${error.message}`.slice(0, 200) : '楽天API fetch failed' };
    }
    let body: unknown = null;
    try { body = await response.json(); } catch { /* 下で扱う */ }
    if (!response.ok) {
      // 最終ページを越えると 404（not_found）になる。1ページ以上取れていれば正常終了。
      if (response.status === 404 && items.length > 0) break;
      const error = body as { error?: unknown; error_description?: unknown; errors?: { errorMessage?: unknown } } | null;
      const message = [error?.error, error?.error_description, error?.errors?.errorMessage].filter(value => typeof value === 'string').join(': ');
      return { ok: false, detail: `楽天API HTTP ${response.status}${message ? ` ${message}` : ''}`.slice(0, 300) };
    }
    const pageItems = parseRakutenRanking(body);
    if (pageItems.length === 0) {
      if (items.length > 0) break;
      return { ok: false, detail: '楽天API: ランキングを読めませんでした（0件）' };
    }
    items.push(...pageItems);
    const pageCount = Number((body as { pageCount?: unknown } | null)?.pageCount);
    if (Number.isInteger(pageCount) && page >= pageCount) break;
  }
  return { ok: true, items };
}

// ---- 保存（D1。EmDash の表とは別の tvfit_ 表） ----

/** D1 の最小限のインターフェース（テストで差し替えるため）。 */
export interface RankingDatabase {
  prepare(query: string): { bind(...values: unknown[]): { run(): Promise<unknown>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }> } };
  batch?(statements: unknown[]): Promise<unknown>;
}

const RANKING_TABLE_SQL = `CREATE TABLE IF NOT EXISTS tvfit_tv_ranking (
  television_id TEXT PRIMARY KEY,
  rank INTEGER NOT NULL,
  source_rank INTEGER NOT NULL,
  as_of TEXT NOT NULL
)`;
const RANKING_RUNS_SQL = `CREATE TABLE IF NOT EXISTS tvfit_ranking_runs (
  source TEXT PRIMARY KEY,
  attempted_at TEXT NOT NULL,
  succeeded_at TEXT,
  source_items INTEGER,
  matched INTEGER,
  last_error TEXT
)`;
/** tvfit_ranking_runs.source の値（元データごとに1行）。 */
const RUN_KEYS: Record<RankingSource, string> = { rakuten: 'rakuten_tv', yahoo: 'yahoo_tv' };
const sourceOfRunKey = (key: unknown): RankingSource | null => (Object.entries(RUN_KEYS).find(([, value]) => value === key)?.[0] as RankingSource | undefined) ?? null;

export async function ensureRankingTables(db: RankingDatabase): Promise<void> {
  await db.prepare(RANKING_TABLE_SQL).bind().run();
  await db.prepare(RANKING_RUNS_SQL).bind().run();
}

export interface RankingRun { source?: RankingSource | null; attempted_at: string; succeeded_at: string | null; source_items: number | null; matched: number | null; last_error: string | null }

/** 元データを指定すればその更新状況、指定しなければ最後に試行した元データの更新状況。 */
export async function readRankingRun(db: RankingDatabase, source?: RankingSource): Promise<RankingRun | null> {
  const columns = 'source, attempted_at, succeeded_at, source_items, matched, last_error FROM tvfit_ranking_runs';
  const { results } = source
    ? await db.prepare(`SELECT ${columns} WHERE source = ?`).bind(RUN_KEYS[source]).all<RankingRun & { source: unknown }>()
    : await db.prepare(`SELECT ${columns} ORDER BY attempted_at DESC LIMIT 1`).bind().all<RankingRun & { source: unknown }>();
  const row = results[0];
  return row ? { ...row, source: sourceOfRunKey(row.source) } : null;
}

export interface TvRanking { asOf: string; ranks: Map<string, number>; source?: RankingSource | null }

export async function readRanking(db: RankingDatabase): Promise<TvRanking | null> {
  const { results } = await db.prepare('SELECT television_id, rank, as_of FROM tvfit_tv_ranking ORDER BY rank').bind().all<{ television_id: string; rank: number; as_of: string }>();
  if (results.length === 0) return null;
  const asOf = results[0]!.as_of;
  // 今の順位がどの元データか（その時刻に成功した更新）。
  const runs = await db.prepare('SELECT source FROM tvfit_ranking_runs WHERE succeeded_at = ?').bind(asOf).all<{ source: unknown }>();
  return { asOf, ranks: new Map(results.map(row => [row.television_id, Number(row.rank)])), source: sourceOfRunKey(runs.results[0]?.source) };
}

async function recordRun(db: RankingDatabase, source: RankingSource, run: RankingRun): Promise<void> {
  await db.prepare(`INSERT INTO tvfit_ranking_runs (source, attempted_at, succeeded_at, source_items, matched, last_error) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source) DO UPDATE SET attempted_at = excluded.attempted_at, succeeded_at = COALESCE(excluded.succeeded_at, tvfit_ranking_runs.succeeded_at),
      source_items = COALESCE(excluded.source_items, tvfit_ranking_runs.source_items), matched = COALESCE(excluded.matched, tvfit_ranking_runs.matched), last_error = excluded.last_error`)
    .bind(RUN_KEYS[source], run.attempted_at, run.succeeded_at, run.source_items, run.matched, run.last_error).run();
}

export type RankingUpdateResult = { status: 'skipped'; reason: string } | { status: 'updated'; source: RankingSource; sourceItems: number; matched: number } | { status: 'error'; detail: string };

/**
 * 前回の試行から RANKING_INTERVAL_MS 以上たっていれば、ランキングを取り直して保存する。
 * 取得に失敗したときは前回の順位を残す（エラーだけ記録する）。
 */
export async function updateRankingIfDue(options: { db: RankingDatabase; televisions: readonly Pick<Television, 'id' | 'model'>[]; credentials: RankingCredentials | null; fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => Date; force?: boolean }): Promise<RankingUpdateResult> {
  const { db, televisions, credentials, now = () => new Date() } = options;
  if (!credentials) return { status: 'skipped', reason: 'ランキングAPIの認証情報が未設定' };
  if (televisions.length === 0) return { status: 'skipped', reason: 'テレビを読めなかった' };
  const { source } = credentials;
  await ensureRankingTables(db);
  // 間隔は元データごとに数える（Yahoo!から楽天に切り替えたら、すぐ楽天で取り直す）。
  const previous = await readRankingRun(db, source);
  const started = now();
  if (!options.force && previous) {
    // 成功してから約7日は取り直さない。失敗が続いているときは、約5時間おき（定期チェックごと）にやり直す。
    const since = (at: string | null) => (at ? started.getTime() - new Date(at).getTime() : Number.POSITIVE_INFINITY);
    if (since(previous.succeeded_at) < RANKING_INTERVAL_MS) return { status: 'skipped', reason: '前回の更新から7日たっていない' };
    if (since(previous.attempted_at) < RANKING_RETRY_MS) return { status: 'skipped', reason: '前回の失敗から間がない' };
  }
  const fetchOptions = { ...(options.fetcher ? { fetcher: options.fetcher } : {}), ...(options.sleep ? { sleep: options.sleep } : {}) };
  const fetched = source === 'rakuten' ? await fetchRakutenRanking(credentials, fetchOptions) : await fetchYahooRanking(credentials, fetchOptions);
  const attempted_at = started.toISOString();
  if (!fetched.ok) {
    await recordRun(db, source, { attempted_at, succeeded_at: null, source_items: null, matched: null, last_error: fetched.detail });
    return { status: 'error', detail: fetched.detail };
  }
  const ranks = matchRanking(fetched.items, televisions);
  if (ranks.size === 0) {
    const detail = `${source === 'rakuten' ? '楽天API' : 'Yahoo API'}: 掲載中の型番に一致する商品がありませんでした（${fetched.items.length}件）`;
    await recordRun(db, source, { attempted_at, succeeded_at: null, source_items: fetched.items.length, matched: 0, last_error: detail });
    return { status: 'error', detail };
  }
  const statements = [db.prepare('DELETE FROM tvfit_tv_ranking').bind(),
    ...[...ranks].map(([id, value]) => db.prepare('INSERT INTO tvfit_tv_ranking (television_id, rank, source_rank, as_of) VALUES (?, ?, ?, ?)').bind(id, value.rank, value.sourceRank, attempted_at))];
  // 入れ替えは1回の batch（D1 ではトランザクション）で行い、途中で順位が欠けた状態を見せない。
  if (db.batch) await db.batch(statements);
  else for (const statement of statements) await statement.run();
  await recordRun(db, source, { attempted_at, succeeded_at: attempted_at, source_items: fetched.items.length, matched: ranks.size, last_error: null });
  return { status: 'updated', source, sourceItems: fetched.items.length, matched: ranks.size };
}

// ---- 表示 ----

const jstDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });

/** 「売れ筋ランキング 3位（436件中）（11/25時点）」。古い・無い順位は null。 */
export function rankingLabel(rank: number | null | undefined, total: number, asOf: string | null | undefined, now: Date = new Date()): string | null {
  if (!rank || !asOf || total <= 0) return null;
  const at = new Date(asOf);
  if (Number.isNaN(at.getTime()) || now.getTime() - at.getTime() > RANKING_STALE_MS) return null;
  return `売れ筋ランキング ${rank}位（${total}件中）（${jstDate.format(at)}時点）`;
}

/** 表示用に、古すぎる順位を除いて返す。 */
export function freshRanking(ranking: TvRanking | null, now: Date = new Date()): TvRanking | null {
  if (!ranking) return null;
  const at = new Date(ranking.asOf);
  return Number.isNaN(at.getTime()) || now.getTime() - at.getTime() > RANKING_STALE_MS ? null : ranking;
}

let cache: { at: number; ranking: TvRanking | null } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;
export function clearRankingCache(): void { cache = null; }

/** 公開ページ用。読めなくてもページは表示する（順位が出ないだけ）。 */
export async function getPublishedRanking(): Promise<TvRanking | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.ranking;
  let ranking: TvRanking | null = null;
  try {
    // @ts-expect-error cloudflare:workers is resolved by the Cloudflare adapter.
    const { env } = await import('cloudflare:workers');
    const db = env.DB as RankingDatabase | undefined;
    if (db) ranking = freshRanking(await readRanking(db));
  } catch (error) {
    // 表がまだ無い（初回の更新前）なども含め、順位なしで表示する。
    if (!(error instanceof Error && /no such table/u.test(error.message))) console.error('[ranking] 読み込めませんでした:', error instanceof Error ? error.message : error);
  }
  cache = { at: Date.now(), ranking };
  return ranking;
}
