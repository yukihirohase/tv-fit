import { isIndexEvidence, type Catalog } from './data';

/** テレビIDごと：適合情報の最終確認日と、インデックス条件を満たす根拠つきの判定があるか。 */
export interface TelevisionCompatibilitySummary { latestCheckedAt: string | null; hasEvidence: boolean }
export type CompatibilitySummary = Map<string, TelevisionCompatibilitySummary>;

export interface SummaryDatabase {
  prepare(query: string): { all<T = Record<string, unknown>>(): Promise<{ results: T[] }> };
}

/**
 * EmDash の公開済み適合情報（D1 の ec_compatibility）をテレビIDごとに集計する。
 * 適合情報は約1万2千件あり、EmDash の一覧APIで全件を読むと1件ずつの展開に時間がかかって
 * サイトマップが返らなくなるため、1回の集計SQLで必要な値だけを読む。
 * 空文字は値なしとして扱う（CMS 側の未入力）。
 */
export const COMPATIBILITY_SUMMARY_SQL = `SELECT television_id,
  MAX(NULLIF(checked_at, '')) AS latest_checked_at,
  MAX(CASE WHEN compatibility_status IS NOT NULL AND compatibility_status NOT IN ('', 'unknown')
    AND NULLIF(evidence_url, '') IS NOT NULL AND NULLIF(checked_at, '') IS NOT NULL THEN 1 ELSE 0 END) AS has_evidence
FROM ec_compatibility
WHERE status = 'published' AND deleted_at IS NULL AND television_id IS NOT NULL
GROUP BY television_id`;

interface SummaryRow { television_id: unknown; latest_checked_at: unknown; has_evidence: unknown }

export async function readCompatibilitySummary(db: SummaryDatabase): Promise<CompatibilitySummary> {
  const { results } = await db.prepare(COMPATIBILITY_SUMMARY_SQL).all<SummaryRow>();
  const summary: CompatibilitySummary = new Map();
  for (const row of results) {
    if (typeof row.television_id !== 'string' || row.television_id === '') continue;
    const latest = typeof row.latest_checked_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.latest_checked_at) ? row.latest_checked_at : null;
    summary.set(row.television_id, { latestCheckedAt: latest, hasEvidence: Number(row.has_evidence) === 1 });
  }
  return summary;
}

/** 読み込み済みのカタログから同じ集計を作る（テスト・フォールバック用）。 */
export function summaryFromCatalog(catalog: Pick<Catalog, 'compatibility'>): CompatibilitySummary {
  const summary: CompatibilitySummary = new Map();
  for (const entry of catalog.compatibility) {
    const current = summary.get(entry.television_id) ?? { latestCheckedAt: null, hasEvidence: false };
    if (entry.checked_at && (!current.latestCheckedAt || entry.checked_at > current.latestCheckedAt)) current.latestCheckedAt = entry.checked_at;
    if (isIndexEvidence(entry)) current.hasEvidence = true;
    summary.set(entry.television_id, current);
  }
  return summary;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; summary: CompatibilitySummary } | null = null;
export function clearCompatibilitySummaryCache(): void { cache = null; }

async function database(): Promise<SummaryDatabase | null> {
  try {
    // @ts-expect-error cloudflare:workers is resolved by the Cloudflare adapter.
    const { env } = await import('cloudflare:workers');
    return (env.DB as SummaryDatabase | undefined) ?? null;
  } catch {
    return null;
  }
}

/** 公開ページ用。D1 が読めない・表の形が変わった場合は null（呼び出し側で全件読込へ戻す）。 */
export async function getCompatibilitySummary(db?: SummaryDatabase | null): Promise<CompatibilitySummary | null> {
  if (!db && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.summary;
  const source = db ?? await database();
  if (!source) return null;
  try {
    const summary = await readCompatibilitySummary(source);
    if (!db) cache = { at: Date.now(), summary };
    return summary;
  } catch (error) {
    console.error('[sitemap] compatibility summary failed:', error);
    return null;
  }
}
