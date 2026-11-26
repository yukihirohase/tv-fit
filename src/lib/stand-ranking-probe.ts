import type { Stand } from './data';
import type { RankingDatabase as ProbeDatabase } from './tv-ranking';
import { VC_EC_CODES, VC_SEARCH_URL } from './valuecommerce';

/**
 * スタンドの売れ筋順（サンワダイレクト）を商品APIで取れるかの試験。
 *
 * 商品APIの公式リファレンスには、検索例に「rank=monthly（月の売上順）」が載っているが、
 * パラメータ表には無い。実際に効くかを本番のトークンで確かめるため、定期チェックのたびに
 * 「rank=monthly 付き」と「付けない（お勧め順）」の検索結果を取り、並びの違いと
 * 登録済みスタンドの位置を記録する。結果は offer-status.json に出す。
 * サイトの表示順にはまだ使わない（中身を確かめてから決める）。
 */
export const SANWA_DIRECT_EC_CODE = VC_EC_CODES['direct.sanwa.co.jp']!;
export const PROBE_PAGES = 6;
export const PROBE_PER_PAGE = 50;

export interface ProbeVariant {
  params: Record<string, string>;
  http: number | null;
  status: string | null;
  /** items 以外の最上位の項目（件数などの手がかり）。 */
  meta: Record<string, unknown>;
  /** 商品1件に含まれる項目名（順位を表す項目があるかの手がかり）。 */
  item_fields: string[];
  pages: number;
  items: number;
  /** 先頭から最大30件の商品コード。 */
  top: string[];
  error: string | null;
}

export interface StandRankingProbe {
  checked_at: string;
  ec_code: string;
  monthly: ProbeVariant;
  score: ProbeVariant;
  /** rank=monthly 付きと無しで、1ページ目の並びが同じか。 */
  same_order_as_score: boolean | null;
  /** rank=monthly の結果での、登録済みスタンドの位置（1始まり）。見つからないものは含めない。 */
  stand_positions: Record<string, number>;
}

const normalize = (value: unknown) => typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]/gu, '') : '';
const codeOf = (item: Record<string, unknown>) => String(item.modelCode || item.productCode || item.guid || '').slice(0, 80);

async function fetchVariant(token: string, extra: Record<string, string>, pages: number, fetcher: typeof fetch, sleep: (ms: number) => Promise<void>): Promise<{ variant: ProbeVariant; list: Record<string, unknown>[] }> {
  const variant: ProbeVariant = { params: { ecCode: SANWA_DIRECT_EC_CODE, ...extra }, http: null, status: null, meta: {}, item_fields: [], pages: 0, items: 0, top: [], error: null };
  const list: Record<string, unknown>[] = [];
  const fields = new Set<string>();
  for (let page = 1; page <= pages; page += 1) {
    if (page > 1) await sleep(1000);
    const url = new URL(VC_SEARCH_URL);
    url.searchParams.set('token', token);
    url.searchParams.set('ecCode', SANWA_DIRECT_EC_CODE);
    for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
    url.searchParams.set('format', 'json');
    url.searchParams.set('results_per_page', String(PROBE_PER_PAGE));
    url.searchParams.set('page', String(page));
    let response: Response;
    try {
      response = await fetcher(url.href, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      variant.error = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : 'fetch failed';
      break;
    }
    variant.http = response.status;
    if (!response.ok) { variant.error = `HTTP ${response.status}`; break; }
    let data: Record<string, unknown>;
    try { data = await response.json() as Record<string, unknown>; } catch { variant.error = 'JSON を読めませんでした'; break; }
    variant.status = typeof data.status === 'string' ? data.status.slice(0, 60) : null;
    if (page === 1) {
      // トークンを含む項目は出さない（応答には入らない想定だが念のため）。
      for (const [key, value] of Object.entries(data)) {
        if (key === 'items' || /token/iu.test(key)) continue;
        variant.meta[key] = typeof value === 'string' ? value.slice(0, 100) : typeof value === 'number' || typeof value === 'boolean' || value === null ? value : typeof value;
      }
    }
    if (variant.status !== 'OK') { variant.error = `status ${variant.status}`; break; }
    const items = Array.isArray(data.items) ? data.items.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object') : [];
    for (const item of items) for (const key of Object.keys(item)) fields.add(key);
    list.push(...items);
    variant.pages = page;
    if (items.length < PROBE_PER_PAGE) break;
  }
  variant.item_fields = [...fields].sort();
  variant.items = list.length;
  variant.top = list.slice(0, 30).map(codeOf);
  return { variant, list };
}

export async function runStandRankingProbe(options: { token: string; stands: readonly Pick<Stand, 'id' | 'sku' | 'product_url'>[]; fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => Date; pages?: number }): Promise<StandRankingProbe> {
  const { token, stands, fetcher = fetch, now = () => new Date(), pages = PROBE_PAGES } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const monthly = await fetchVariant(token, { rank: 'monthly' }, pages, fetcher, sleep);
  await sleep(1000);
  const score = await fetchVariant(token, {}, 1, fetcher, sleep);
  const firstPage = (list: Record<string, unknown>[]) => list.slice(0, PROBE_PER_PAGE).map(codeOf).join('|');
  const same = monthly.list.length > 0 && score.list.length > 0 ? firstPage(monthly.list) === firstPage(score.list) : null;
  const positions: Record<string, number> = {};
  const direct = stands.filter(stand => stand.product_url?.includes('direct.sanwa.co.jp'));
  monthly.list.forEach((item, index) => {
    const codes = [normalize(item.modelCode), normalize(item.productCode)];
    for (const stand of direct) {
      if (positions[stand.id] === undefined && codes.includes(normalize(stand.sku))) positions[stand.id] = index + 1;
    }
  });
  return { checked_at: now().toISOString(), ec_code: SANWA_DIRECT_EC_CODE, monthly: monthly.variant, score: score.variant, same_order_as_score: same, stand_positions: positions };
}

const PROBES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS tvfit_probes (
  name TEXT PRIMARY KEY,
  checked_at TEXT NOT NULL,
  body TEXT NOT NULL
)`;
const PROBE_NAME = 'vc_stand_ranking';

export async function saveStandRankingProbe(db: ProbeDatabase, probe: StandRankingProbe): Promise<void> {
  await db.prepare(PROBES_TABLE_SQL).bind().run();
  await db.prepare('INSERT INTO tvfit_probes (name, checked_at, body) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET checked_at = excluded.checked_at, body = excluded.body')
    .bind(PROBE_NAME, probe.checked_at, JSON.stringify(probe)).run();
}

export async function readStandRankingProbe(db: ProbeDatabase): Promise<StandRankingProbe | null> {
  try {
    const { results } = await db.prepare('SELECT body FROM tvfit_probes WHERE name = ?').bind(PROBE_NAME).all<{ body: string }>();
    return results[0] ? JSON.parse(results[0].body) as StandRankingProbe : null;
  } catch { return null; }
}
