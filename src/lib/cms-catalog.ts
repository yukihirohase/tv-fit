import type { Catalog, CatalogOptions } from './data';
import { catalogCollections, cmsCatalogFromRows, type CmsCollection, type CmsEntryRow } from './cms-mapping';

export const CMS_CATALOG_PAGE_SIZE = 100;
const MAX_COLLECTION_RECORDS = 20_000;

export interface CmsCollectionFilter {
  status: 'published';
  limit: number;
  cursor?: string;
  orderBy: { id: 'asc' };
}
export interface CmsCollectionPage {
  entries: readonly CmsEntryRow[];
  error?: unknown;
  nextCursor?: string;
  hasMore?: boolean;
}
export type CmsCollectionReader = (collection: CmsCollection, filter: CmsCollectionFilter) => Promise<CmsCollectionPage>;
export interface PublishedCatalogOptions {
  read?: CmsCollectionReader;
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

async function publishedRows(collection: CmsCollection, read: CmsCollectionReader): Promise<CmsEntryRow[]> {
  const rows: CmsEntryRow[] = [];
  const cursors = new Set<string>();
  const internalIds = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const filter: CmsCollectionFilter = {
      status: 'published', limit: CMS_CATALOG_PAGE_SIZE, orderBy: { id: 'asc' },
      ...(cursor === undefined ? {} : { cursor }),
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

/**
 * Runtime source for public pages. Drafts are never requested. Filesystem CSV
 * access stays in lib/csv.ts and is used only by validation/import commands.
 */
export async function getPublishedCatalog(options: PublishedCatalogOptions = {}): Promise<Catalog> {
  try {
    let read = options.read;
    if (!read) {
      const { getEmDashCollection } = await import('emdash');
      read = (collection, filter) => getEmDashCollection(collection, filter);
    }
    const reader = read;
    const [televisions, stands, compatibility] = await Promise.all(
      catalogCollections.map(collection => publishedRows(collection, reader)),
    );
    return cmsCatalogFromRows({
      televisions: televisions ?? [], stands: stands ?? [], compatibility: compatibility ?? [],
    }, options.validation);
  } catch (error) {
    if (error instanceof CMSCatalogUnavailableError) throw error;
    throw new CMSCatalogUnavailableError(error);
  }
}
