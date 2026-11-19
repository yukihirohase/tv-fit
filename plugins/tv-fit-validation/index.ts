import {
  ContentSaveRejectedError, definePlugin,
  type ContentAccess, type ContentHookEvent, type ContentPolicyEvent,
  type PluginContext, type PluginDescriptor,
} from 'emdash';
import {
  catalogCollections, cmsCatalogFromRows, type CmsCollection,
} from '../../src/lib/cms-mapping';
import { type Catalog, type CatalogOptions } from '../../src/lib/data';
import { getManufacturers } from '../../src/lib/manufacturers';

export interface ValidationEntry {
  id: string;
  data: Record<string, unknown>;
  status?: string;
  draftRevisionId?: string | null;
}
export type ValidationSnapshot = { [Collection in CmsCollection]: readonly ValidationEntry[] };
export interface CmsMutation {
  collection: CmsCollection;
  id?: string;
  data: Record<string, unknown>;
}

function isCatalogCollection(value: string): value is CmsCollection {
  return (catalogCollections as readonly string[]).includes(value);
}
function validateSnapshot(snapshot: ValidationSnapshot, options: CatalogOptions): Catalog {
  const catalog = cmsCatalogFromRows(snapshot, options);
  // Manufacturer list routes have their own reserved paths and collision checks.
  getManufacturers(catalog.televisions);
  return catalog;
}

/** Validate the whole prospective catalog without changing any supplied values. */
export function validateCmsMutation(
  snapshot: ValidationSnapshot,
  mutation: CmsMutation,
  options: CatalogOptions = {},
): Catalog {
  const existing = mutation.id === undefined ? undefined
    : snapshot[mutation.collection].find(entry => entry.id === mutation.id);
  if (mutation.collection !== 'compatibility' && existing
    && Object.hasOwn(mutation.data, 'external_id')
    && mutation.data.external_id !== existing.data.external_id) {
    throw new Error('管理ID（external_id）は変更できません。関連する適合情報の参照先として保持します。');
  }
  const defaults = mutation.collection === 'compatibility'
    ? { compatibility_status: 'unknown', evidence_type: 'insufficient', notes: '' }
    : {};
  const prospective: ValidationSnapshot = {
    ...snapshot,
    [mutation.collection]: [
      ...snapshot[mutation.collection].filter(entry => entry.id !== mutation.id),
      { id: mutation.id ?? '__new-cms-entry__', data: { ...defaults, ...existing?.data, ...mutation.data } },
    ],
  };
  return validateSnapshot(prospective, options);
}

/** Deleting or unpublishing a referenced product must not orphan an explanation. */
export function validateCmsRemoval(
  snapshot: ValidationSnapshot,
  collection: CmsCollection,
  id: string,
  options: CatalogOptions = {},
): Catalog {
  return validateSnapshot({
    ...snapshot,
    [collection]: snapshot[collection].filter(entry => entry.id !== id),
  }, options);
}

function boundedReason(error: unknown): string {
  const message = error instanceof Error ? error.message : '検証に必要な情報を読み取れませんでした。';
  return message.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 450)
    || '検証に必要な情報を読み取れませんでした。';
}
function contentAccess(context: Pick<PluginContext, 'content'>): ContentAccess {
  if (!context.content) throw new Error('検証用のコンテンツ読み取り権限がありません。');
  return context.content;
}

/**
 * Read every page. Truncation or a broken cursor rejects the write rather than skipping validation.
 * 適合情報（数千件）は下書きリビジョンを1件ずつ読むと保存1回ごとに数千回の読み取りになり、
 * フックの制限時間を超えて保存できなくなる。参照先（テレビ・スタンド）の検証に要るのは
 * 一覧の値で足りるため、適合情報だけは一覧の値で検証する。
 */
async function collectSnapshot(
  context: Pick<PluginContext, 'content'>,
  mode: 'working' | 'published',
  collections: readonly CmsCollection[] = catalogCollections,
): Promise<ValidationSnapshot> {
  const content = contentAccess(context);
  const snapshot: Record<CmsCollection, ValidationEntry[]> = {
    televisions: [], stands: [], compatibility: [],
  };
  for (const collection of collections) {
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    const seenIds = new Set<string>();
    let pageCount = 0;
    do {
      const result = await content.list(collection, { limit: 100, ...(cursor ? { cursor } : {}) });
      for (const entry of result.items) {
        if (mode === 'published' ? entry.status !== 'published' : !['draft', 'published'].includes(entry.status)) continue;
        if (seenIds.has(entry.id)) throw new Error('検証用の一覧でコンテンツが重複しています。もう一度お試しください。');
        seenIds.add(entry.id);
        let data = entry.data;
        if (mode === 'working' && entry.draftRevisionId && collection !== 'compatibility') {
          if (!content.getRevision) throw new Error('下書きの検証に必要なリビジョン読み取り権限がありません。');
          const revision = await content.getRevision(collection, entry.id, entry.draftRevisionId);
          if (!revision) throw new Error('下書きリビジョンを読み取れません。保存を中止しました。');
          data = { ...data, ...revision.data };
        }
        snapshot[collection].push({ id: entry.id, status: entry.status, data });
      }
      if (!result.hasMore) break;
      if (!result.cursor || seenCursors.has(result.cursor) || ++pageCount >= 1000) {
        throw new Error('検証用の一覧を最後まで取得できません。保存を中止しました。');
      }
      seenCursors.add(result.cursor);
      cursor = result.cursor;
    } while (cursor);
  }
  return snapshot;
}

function policyMutation(event: ContentPolicyEvent): CmsMutation {
  const id = event.content.id;
  const data = event.content.data;
  if (!isCatalogCollection(event.collection) || typeof id !== 'string'
    || data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('公開対象のコンテンツを検証できません。');
  }
  return { collection: event.collection, id, data: data as Record<string, unknown> };
}

/**
 * 適合情報の保存は、その1行だけを検証する（参照先のテレビ・スタンドは全件読む）。
 * 全適合情報を毎回読むと件数に比例して遅くなり、数千件で制限時間を超えて保存できなくなるため。
 * 適合ペアの重複は、一括取込（scripts/cms-import.ts）が書き込み前に確認し、公開時の検証
 * （content:beforePublish）でも公開済み全体に対して確認する。
 */
async function compatibilitySnapshot(event: ContentHookEvent, context: PluginContext): Promise<ValidationSnapshot> {
  const snapshot = await collectSnapshot(context, 'working', ['televisions', 'stands']);
  if (event.isNew || !event.id) return snapshot;
  const content = contentAccess(context);
  const entry = await content.get('compatibility', event.id);
  if (!entry || !['draft', 'published'].includes(entry.status)) return snapshot;
  let data = entry.data;
  if (entry.draftRevisionId) {
    if (!content.getRevision) throw new Error('下書きの検証に必要なリビジョン読み取り権限がありません。');
    const revision = await content.getRevision('compatibility', entry.id, entry.draftRevisionId);
    if (!revision) throw new Error('下書きリビジョンを読み取れません。保存を中止しました。');
    data = { ...data, ...revision.data };
  }
  return { ...snapshot, compatibility: [{ id: entry.id, status: entry.status, data }] };
}

async function beforeSave(event: ContentHookEvent, context: PluginContext): Promise<void> {
  if (!isCatalogCollection(event.collection)) return;
  try {
    const snapshot = event.collection === 'compatibility'
      ? await compatibilitySnapshot(event, context)
      : await collectSnapshot(context, 'working');
    if (!event.isNew && (!event.id || !snapshot[event.collection].some(entry => entry.id === event.id))) {
      throw new Error('更新対象のコンテンツを読み取れません。保存を中止しました。');
    }
    validateCmsMutation(snapshot, {
      collection: event.collection,
      ...(event.id ? { id: event.id } : {}),
      data: event.content,
    });
  } catch (error) {
    throw new ContentSaveRejectedError(boundedReason(error));
  }
}

/** Static descriptor imported in astro.config; runtime loading stays in the plugin entrypoint. */
export function tvFitValidation(): PluginDescriptor {
  return {
    id: 'tv-fit-validation', version: '1.0.0', format: 'native',
    entrypoint: '@tv-fit/validation',
  };
}

export function createPlugin() {
  return definePlugin({
    id: 'tv-fit-validation', version: '1.0.0',
    capabilities: ['content:read', 'content:write', 'content:revisions:read', 'hooks.content-policy:register'],
    hooks: {
      'content:beforeSave': { timeout: 25000, handler: beforeSave },
      'content:beforePublish': {
        timeout: 10000,
        async handler(event, context) {
          if (!isCatalogCollection(event.collection)) return;
          try {
            validateCmsMutation(await collectSnapshot(context, 'published'), policyMutation(event));
            return undefined;
          } catch (error) {
            return { cancel: true as const, reason: boundedReason(error) };
          }
        },
      },
      'content:beforeUnpublish': {
        timeout: 10000,
        async handler(event, context) {
          if (!isCatalogCollection(event.collection)) return;
          try {
            const mutation = policyMutation(event);
            validateCmsRemoval(await collectSnapshot(context, 'published'), mutation.collection, mutation.id!);
            return undefined;
          } catch (error) {
            return { cancel: true as const, reason: boundedReason(error) };
          }
        },
      },
      'content:beforeDelete': {
        timeout: 10000,
        async handler(event, context) {
          if (!isCatalogCollection(event.collection)) return;
          try {
            validateCmsRemoval(await collectSnapshot(context, 'working'), event.collection, event.id);
            return undefined;
          } catch {
            return false;
          }
        },
      },
    },
  });
}

export default createPlugin;
