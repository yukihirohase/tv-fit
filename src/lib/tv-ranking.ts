import type { Television } from './data';

/**
 * テレビの売れ筋順。楽天市場ランキングAPI（楽天ウェブサービス）の「テレビ」ジャンルの順位を週1回取得し、
 * 商品名に含まれる型番で当サイトのテレビと照合して、当サイト掲載機種の中で 1位から振り直す。
 *
 * - 価格.com のランキングは利用規約（情報の複製・転載の禁止）により使わない。
 * - 認証情報は Cloudflare のシークレット RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY。未設定なら更新しない。
 * - 楽天ウェブサービスの管理画面で、アプリの「許可されたWebサイト」に tv-fit.com を登録しておく
 *   （サーバーからの呼び出しでも Referer / Origin が必要）。
 * - データを表示するページには楽天ウェブサービスのクレジットを出す（フッター）。
 */
export const RAKUTEN_RANKING_URL = 'https://openapi.rakuten.co.jp/ichibaranking/api/IchibaItem/Ranking/20220601';
/** 楽天市場の「TV・オーディオ・カメラ > テレビ」ジャンル（https://ranking.rakuten.co.jp/daily/563843/）。 */
export const RAKUTEN_TV_GENRE_ID = '563843';
/** ランキングAPIの最大ページ数（1ページ30件）。 */
export const RAKUTEN_RANKING_MAX_PAGES = 34;
/** 更新の間隔。定期チェック（6時間ごと）のたびに、前回からこれ以上たっていれば更新する。 */
export const RANKING_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000 - 3 * 60 * 60 * 1000;
/** これより古い順位は表示しない（取得が止まったときに古い順位を出し続けないため）。 */
export const RANKING_STALE_MS = 30 * 24 * 60 * 60 * 1000;

export interface RakutenCredentials { appId: string; accessKey: string; referer?: string }
export interface RankingSourceItem { rank: number; name: string }

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
const normalizeName = (value: string) => value.normalize('NFKC').toUpperCase();
const modelChars = (model: string) => normalizeName(model).replace(/[^A-Z0-9]/gu, '');

/**
 * 型番の正規表現。英数字の間のハイフン・空白の有無は問わず、前後が英数字でないこと（似た型番の取り違えを防ぐ）。
 * 例：「43A400 Pro」は「43A400PRO」「43A400 PRO」にも一致するが、「43A400」だけの商品名には一致しない。
 */
function modelPattern(model: string): RegExp | null {
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
export async function fetchRakutenRanking(credentials: RakutenCredentials, options: { fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void>; delayMs?: number; maxPages?: number } = {}): Promise<{ ok: true; items: RankingSourceItem[] } | { ok: false; detail: string }> {
  const { fetcher = fetch, delayMs = 1500, maxPages = RAKUTEN_RANKING_MAX_PAGES } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
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
const SOURCE = 'rakuten_tv';

export async function ensureRankingTables(db: RankingDatabase): Promise<void> {
  await db.prepare(RANKING_TABLE_SQL).bind().run();
  await db.prepare(RANKING_RUNS_SQL).bind().run();
}

export interface RankingRun { attempted_at: string; succeeded_at: string | null; source_items: number | null; matched: number | null; last_error: string | null }

export async function readRankingRun(db: RankingDatabase): Promise<RankingRun | null> {
  const { results } = await db.prepare('SELECT attempted_at, succeeded_at, source_items, matched, last_error FROM tvfit_ranking_runs WHERE source = ?').bind(SOURCE).all<RankingRun>();
  return results[0] ?? null;
}

export interface TvRanking { asOf: string; ranks: Map<string, number> }

export async function readRanking(db: RankingDatabase): Promise<TvRanking | null> {
  const { results } = await db.prepare('SELECT television_id, rank, as_of FROM tvfit_tv_ranking ORDER BY rank').bind().all<{ television_id: string; rank: number; as_of: string }>();
  if (results.length === 0) return null;
  return { asOf: results[0]!.as_of, ranks: new Map(results.map(row => [row.television_id, Number(row.rank)])) };
}

async function recordRun(db: RankingDatabase, run: RankingRun): Promise<void> {
  await db.prepare(`INSERT INTO tvfit_ranking_runs (source, attempted_at, succeeded_at, source_items, matched, last_error) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source) DO UPDATE SET attempted_at = excluded.attempted_at, succeeded_at = COALESCE(excluded.succeeded_at, tvfit_ranking_runs.succeeded_at),
      source_items = COALESCE(excluded.source_items, tvfit_ranking_runs.source_items), matched = COALESCE(excluded.matched, tvfit_ranking_runs.matched), last_error = excluded.last_error`)
    .bind(SOURCE, run.attempted_at, run.succeeded_at, run.source_items, run.matched, run.last_error).run();
}

export type RankingUpdateResult = { status: 'skipped'; reason: string } | { status: 'updated'; sourceItems: number; matched: number } | { status: 'error'; detail: string };

/**
 * 前回の試行から RANKING_INTERVAL_MS 以上たっていれば、ランキングを取り直して保存する。
 * 取得に失敗したときは前回の順位を残す（エラーだけ記録する）。
 */
export async function updateRankingIfDue(options: { db: RankingDatabase; televisions: readonly Pick<Television, 'id' | 'model'>[]; credentials: RakutenCredentials | null; fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => Date; force?: boolean }): Promise<RankingUpdateResult> {
  const { db, televisions, credentials, now = () => new Date() } = options;
  if (!credentials) return { status: 'skipped', reason: '楽天APIの認証情報が未設定' };
  if (televisions.length === 0) return { status: 'skipped', reason: 'テレビを読めなかった' };
  await ensureRankingTables(db);
  const previous = await readRankingRun(db);
  const started = now();
  if (!options.force && previous && started.getTime() - new Date(previous.attempted_at).getTime() < RANKING_INTERVAL_MS) return { status: 'skipped', reason: '前回から7日たっていない' };
  const fetched = await fetchRakutenRanking(credentials, { ...(options.fetcher ? { fetcher: options.fetcher } : {}), ...(options.sleep ? { sleep: options.sleep } : {}) });
  const attempted_at = started.toISOString();
  if (!fetched.ok) {
    await recordRun(db, { attempted_at, succeeded_at: null, source_items: null, matched: null, last_error: fetched.detail });
    return { status: 'error', detail: fetched.detail };
  }
  const ranks = matchRanking(fetched.items, televisions);
  if (ranks.size === 0) {
    const detail = `楽天API: 掲載中の型番に一致する商品がありませんでした（${fetched.items.length}件）`;
    await recordRun(db, { attempted_at, succeeded_at: null, source_items: fetched.items.length, matched: 0, last_error: detail });
    return { status: 'error', detail };
  }
  const statements = [db.prepare('DELETE FROM tvfit_tv_ranking').bind(),
    ...[...ranks].map(([id, value]) => db.prepare('INSERT INTO tvfit_tv_ranking (television_id, rank, source_rank, as_of) VALUES (?, ?, ?, ?)').bind(id, value.rank, value.sourceRank, attempted_at))];
  // 入れ替えは1回の batch（D1 ではトランザクション）で行い、途中で順位が欠けた状態を見せない。
  if (db.batch) await db.batch(statements);
  else for (const statement of statements) await statement.run();
  await recordRun(db, { attempted_at, succeeded_at: attempted_at, source_items: fetched.items.length, matched: ranks.size, last_error: null });
  return { status: 'updated', sourceItems: fetched.items.length, matched: ranks.size };
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
