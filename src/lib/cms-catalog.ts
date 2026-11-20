import type { Catalog, CatalogOptions } from './data';
import { catalogCollections, cmsCatalogFromRows, type CmsCollection, type CmsEntryRow } from './cms-mapping';

export const CMS_CATALOG_PAGE_SIZE = 100;
const MAX_COLLECTION_RECORDS = 20_000;

export interface CmsCollectionFilter {
  status: 'published';
  limit: number;
  cursor?: string;
  orderBy: { id: 'asc' };
  /** Exact match on an indexed content field (e.g. one television's compatibility rows). */
  where?: Record<string, string>;
}
export interface CmsCollectionPage {
  entries: readonly CmsEntryRow[];
  error?: unknown;
  nextCursor?: string;
  hasMore?: boolean;
}
export type CmsCollectionReader = (collection: CmsCollection, filter: CmsCollectionFilter) => Promise<CmsCollectionPage>;
/**
 * Which compatibility rows to read. 'all' for pages that need every television's status
 * (sitemap, manufacturer lists), 'none' when only products are shown, or one television's rows.
 */
export type CompatibilityScope = 'all' | 'none' | { televisionId: string };
export interface PublishedCatalogOptions {
  read?: CmsCollectionReader;
  compatibility?: CompatibilityScope;
  /** Fixture permission is explicit and is only used by isolated tests. */
  validation?: CatalogOptions;
}

export class CMSCatalogUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('適合情報を読み込めませんでした。時間をおいてもう一度お試しください。', { cause });
    this.name = 'CMSCatalogUnavailableError';
  }
}

/** Only an explicit missing-collection condition is an expected empty source. */
function missingCollection(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && error.code === 'COLLECTION_NOT_FOUND';
}

async function publishedRows(collection: CmsCollection, read: CmsCollectionReader, where?: Record<string, string>): Promise<CmsEntryRow[]> {
  const rows: CmsEntryRow[] = [];
  const cursors = new Set<string>();
  const internalIds = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const filter: CmsCollectionFilter = {
      status: 'published', limit: CMS_CATALOG_PAGE_SIZE, orderBy: { id: 'asc' },
      ...(cursor === undefined ? {} : { cursor }),
      ...(where ? { where } : {}),
    };
    const page = await read(collection, filter);
    if (page.error) {
      if (missingCollection(page.error) && rows.length === 0) return [];
      throw page.error;
    }
    if (!Array.isArray(page.entries)) throw new Error('CMSの一覧応答が不正です。');
    for (const row of page.entries) {
      if (row.id !== undefined) {
        if (internalIds.has(row.id)) throw new Error('CMSの一覧応答で同じレコードが繰り返されました。');
        internalIds.add(row.id);
      }
      rows.push(row);
    }
    if (rows.length > MAX_COLLECTION_RECORDS) throw new Error('CMSの一覧取得上限を超えました。');
    const hasMore = page.hasMore ?? page.nextCursor !== undefined;
    if (!hasMore) break;
    const nextCursor = page.nextCursor;
    if (typeof nextCursor !== 'string' || nextCursor.length === 0 || page.entries.length === 0
      || cursors.has(nextCursor)) throw new Error('CMSのページ送り応答が不正です。');
    cursors.add(nextCursor);
    cursor = nextCursor;
  }
  return rows;
}

// 公開ページは表示のたびにCMSを読む。数千件の適合情報を毎回読むと1ページ数十秒かかるため、
// 読み込んだ結果を同じWorker内で短時間だけ使い回す（Promiseは要求をまたいで共有しない）。
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const cache = new Map<string, { at: number; catalog: Catalog }>();
function scopeKey(scope: CompatibilityScope): string {
  return typeof scope === 'string' ? scope : `tv:${scope.televisionId}`;
}
/** Test hook: forget cached catalogs. */
export function clearPublishedCatalogCache(): void { cache.clear(); }

/**
 * Runtime source for public pages. Drafts are never requested. Filesystem CSV
 * access stays in lib/csv.ts and is used only by validation/import commands.
 */
export async function getPublishedCatalog(options: PublishedCatalogOptions = {}): Promise<Catalog> {
  const scope = options.compatibility ?? 'all';
  const cacheable = !options.read && !options.validation;
  const key = scopeKey(scope);
  const hit = cacheable ? cache.get(key) : undefined;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.catalog;
  try {
    let read = options.read;
    if (!read) {
      const { getEmDashCollection } = await import('emdash');
      read = (collection, filter) => getEmDashCollection(collection, filter);
    }
    const reader = read;
    const [televisions, stands, compatibility] = await Promise.all([
      publishedRows('televisions', reader),
      publishedRows('stands', reader),
      scope === 'none' ? Promise.resolve([])
        : publishedRows('compatibility', reader, scope === 'all' ? undefined : { television_id: scope.televisionId }),
    ]);
    const catalog = cmsCatalogFromRows({
      televisions: televisions ?? [], stands: stands ?? [], compatibility: compatibility ?? [],
    }, options.validation);
    if (cacheable) {
      if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
      cache.set(key, { at: Date.now(), catalog });
    }
    return catalog;
  } catch (error) {
    if (error instanceof CMSCatalogUnavailableError) throw error;
    throw new CMSCatalogUnavailableError(error);
  }
}
