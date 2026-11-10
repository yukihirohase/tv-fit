import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { loadCatalog } from '../src/lib/csv';
import { televisionSchema, standSchema, compatibilitySchema, type Catalog } from '../src/lib/data';
import {
  catalogCollections, toCatalogRecord, toCmsRecord,
  type CmsCollection, type CmsEntryRow, type CmsCatalogRows,
} from '../src/lib/cms-mapping';

export interface ImportItem {
  collection: CmsCollection;
  key: string;
  data: Record<string, unknown>;
}
export interface ImportPlan { create: ImportItem[]; skipped: number }
type Fetch = typeof globalThis.fetch;
interface ApiOptions { origin: string; token: string; fetch?: Fetch }

/** Only a site origin is accepted; authenticated redirects are never followed. */
export function validateCmsOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('EMDASH_BASE_URLにCMSのオリジンを指定してください。'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('CMS URLはHTTPSのオリジンのみ指定できます。開発時はループバックのHTTPも使用できます。');
  }
  return url.origin;
}

function keyOf(collection: CmsCollection, fields: Record<string, unknown>): string {
  if (collection === 'compatibility') {
    if (typeof fields.television_id !== 'string' || typeof fields.stand_id !== 'string') throw new Error('CMSの適合情報に参照IDがありません。');
    return `${fields.television_id}:${fields.stand_id}`;
  }
  if (typeof fields.external_id !== 'string' || !fields.external_id) throw new Error('CMSの外部IDがありません。');
  return fields.external_id;
}

function equivalent(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.every(key => (a[key] ?? null) === (b[key] ?? null));
}

/** Preserve existing content. A retry skips identical rows; changes need editor review. */
export function buildImportPlan(catalog: Catalog, existing?: CmsCatalogRows): ImportPlan {
  const plan: ImportPlan = { create: [], skipped: 0 };
  for (const collection of catalogCollections) {
    const byKey = new Map<string, Record<string, unknown>>();
    for (const entry of existing?.[collection] ?? []) {
      const original = toCatalogRecord(collection, entry.data);
      const schema = collection === 'televisions' ? televisionSchema : collection === 'stands' ? standSchema : compatibilitySchema;
      const normalized = toCmsRecord(collection, schema.parse(original));
      const key = keyOf(collection, normalized);
      if (byKey.has(key)) throw new Error(`${collection}: CMS内で外部IDまたは適合ペアが重複しています。`);
      byKey.set(key, normalized);
    }
    for (const row of catalog[collection]) {
      const data = toCmsRecord(collection, row);
      const key = keyOf(collection, data);
      const previous = byKey.get(key);
      if (previous) {
        if (!equivalent(previous, data)) throw new Error(`${collection}/${key}: 既存データと異なるため取込を中止しました。管理画面で確認してください。`);
        plan.skipped += 1;
      } else plan.create.push({ collection, key, data });
    }
  }
  return plan;
}

function authenticated(options: ApiOptions) {
  const origin = validateCmsOrigin(options.origin);
  if (!options.token || /\s|[\u0000-\u001f\u007f]/u.test(options.token) || options.token.length > 4096) {
    throw new Error('EMDASH_API_TOKENに有効なAPIトークンを設定してください。');
  }
  return { origin, fetch: options.fetch ?? globalThis.fetch, headers: { Authorization: `Bearer ${options.token}` } };
}

async function requestJson(url: URL, init: RequestInit, options: ReturnType<typeof authenticated>): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await options.fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Error('CMS APIへ接続できませんでした。URL・ログイン制限・接続環境を確認してください。'); }
  if (!response.ok) throw new Error(`CMS APIがHTTP ${response.status}を返したため、取込を中止しました。`);
  let envelope: unknown;
  try { envelope = await response.json(); } catch { throw new Error('CMS APIがJSON以外を返しました。ログイン画面等への遷移がないか確認してください。'); }
  if (!envelope || typeof envelope !== 'object' || !('success' in envelope) || envelope.success !== true
    || !('data' in envelope) || !envelope.data || typeof envelope.data !== 'object') {
    throw new Error('CMS APIの応答形式を確認できないため、取込を中止しました。');
  }
  return envelope.data as Record<string, unknown>;
}

export async function listExistingCmsRows(options: ApiOptions, status: 'all' | 'published' = 'all'): Promise<CmsCatalogRows> {
  const api = authenticated(options);
  const rows: Record<CmsCollection, CmsEntryRow[]> = { televisions: [], stands: [], compatibility: [] };
  for (const collection of catalogCollections) {
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 1000; page += 1) {
      const url = new URL(`/_emdash/api/content/${collection}`, api.origin);
      url.searchParams.set('status', status);
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);
      const data = await requestJson(url, { headers: api.headers }, api);
      if (!Array.isArray(data.items)) throw new Error('CMS APIの一覧形式が不正です。');
      for (const item of data.items) {
        if (!item || typeof item !== 'object' || !('data' in item)) throw new Error('CMS APIの項目形式が不正です。');
        rows[collection].push(item as CmsEntryRow);
      }
      if (!data.nextCursor) break;
      if (typeof data.nextCursor !== 'string' || seen.has(data.nextCursor)) throw new Error('CMS APIのページ送りを確認できませんでした。');
      seen.add(data.nextCursor);
      cursor = data.nextCursor;
      if (page === 999) throw new Error('CMS APIの一覧が上限を超えました。取込対象を確認してください。');
    }
  }
  return rows;
}

export async function applyImportPlan(plan: ImportPlan, options: ApiOptions): Promise<number> {
  const api = authenticated(options);
  let created = 0;
  for (const item of plan.create) {
    const url = new URL(`/_emdash/api/content/${item.collection}`, api.origin);
    const result = await requestJson(url, {
      method: 'POST',
      headers: { ...api.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: item.data, status: 'draft', locale: 'ja' }),
    }, api);
    if (!result.item || typeof result.item !== 'object' || !('id' in result.item) || typeof result.item.id !== 'string') {
      throw new Error('CMS APIの保存結果を確認できませんでした。管理画面で下書きを確認してください。');
    }
    created += 1;
  }
  return created;
}

export async function runCmsImport(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const unknown = args.filter((arg, index) => arg !== '--apply' && arg !== '--directory' && args[index - 1] !== '--directory');
  if (unknown.length) throw new Error('使用方法: npm run cms:import -- [--directory data] [--apply]');
  const directoryIndex = args.indexOf('--directory');
  const directory = directoryIndex >= 0 ? args[directoryIndex + 1] : 'data';
  if (!directory || directory.startsWith('--')) throw new Error('--directoryにCSVディレクトリを指定してください。');
  const catalog = loadCatalog(resolve(directory));
  const draftPlan = buildImportPlan(catalog);
  if (!args.includes('--apply')) {
    console.log(`検証のみ（書込なし）: テレビ ${catalog.televisions.length}件 / スタンド ${catalog.stands.length}件 / 適合 ${catalog.compatibility.length}件`);
    console.log(`下書き取込候補 ${draftPlan.create.length}件。CMSへの書込には --apply と環境変数が必要です。`);
    return;
  }
  const origin = env.EMDASH_BASE_URL ?? '';
  const token = env.EMDASH_API_TOKEN ?? '';
  if (!origin || !token) throw new Error('--applyにはEMDASH_BASE_URLとEMDASH_API_TOKENが必要です。');
  const options = { origin, token };
  const existing = await listExistingCmsRows(options);
  const plan = buildImportPlan(catalog, existing);
  try {
    const created = await applyImportPlan(plan, options);
    console.log(`下書き取込完了: 新規 ${created}件 / 同一内容でスキップ ${plan.skipped}件。公開操作は行っていません。`);
  } catch (error) {
    console.error('取込は複数リクエストです。途中まで保存された下書きがある場合は、管理画面で確認してから再実行してください。');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCmsImport(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : '取込に失敗しました。');
    process.exitCode = 1;
  });
}
