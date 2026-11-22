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
export interface FillItem { collection: CmsCollection; key: string; id: string; fields: Record<string, unknown>; previous?: Record<string, unknown> }
/** Fields that --overwrite-field may replace when the CMS already has a value. */
export const overwritableFields = ['release_date'] as const;
/**
 * upgrade: 適合情報を「仕様上の候補」から「確認済み」に上げる更新。CSVで status が candidate→confirmed に変わり、
 * 根拠がメーカーの個別確認（manufacturer_individual / official_individual）のときだけ認める。
 */
export interface ImportPlan { create: ImportItem[]; skipped: number; fill: FillItem[]; upgrade: FillItem[] }
const individualEvidence = new Set(['manufacturer_individual', 'official_individual']);

/** 候補→確認済みの更新なら、変わる項目を返す（参照ID以外の根拠の列だけが変わる場合に限る）。 */
function compatibilityUpgrade(previous: Record<string, unknown>, next: Record<string, unknown>): { fields: Record<string, unknown>; previous: Record<string, unknown> } | null {
  if (previous.compatibility_status !== 'candidate' || next.compatibility_status !== 'confirmed') return null;
  if (typeof next.evidence_type !== 'string' || !individualEvidence.has(next.evidence_type)) return null;
  const changeable = new Set(['compatibility_status', 'evidence_type', 'evidence_url', 'checked_at', 'notes']);
  const fields: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const old = previous[key] ?? null;
    const after = next[key] ?? null;
    if (old === after) continue;
    if (!changeable.has(key) || after === null) return null;
    fields[key] = after;
    before[key] = old;
  }
  return { fields, previous: before };
}
type Fetch = typeof globalThis.fetch;
interface ApiOptions { origin: string; token: string; fetch?: Fetch; retryDelayMs?: number | undefined; writeIntervalMs?: number | undefined }

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
/** Fields that are blank in the CMS and filled in the CSV; null when anything else differs. */
function blankFills(previous: Record<string, unknown>, next: Record<string, unknown>, overwrite: ReadonlySet<string> = new Set()): { fields: Record<string, unknown>; previous: Record<string, unknown> } | null {
  const fields: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const old = previous[key] ?? null;
    const after = next[key] ?? null;
    if (old === after) continue;
    if (after === null || (old !== null && !overwrite.has(key))) return null;
    fields[key] = after;
    before[key] = old;
  }
  return { fields, previous: before };
}

export function buildImportPlan(catalog: Catalog, existing?: CmsCatalogRows, options: { fillBlanks?: boolean; overwriteFields?: readonly string[] } = {}): ImportPlan {
  const overwrite = new Set(options.overwriteFields ?? []);
  const plan: ImportPlan = { create: [], skipped: 0, fill: [], upgrade: [] };
  for (const collection of catalogCollections) {
    const ids = new Map<string, string | undefined>();
    const byKey = new Map<string, Record<string, unknown>>();
    for (const entry of existing?.[collection] ?? []) {
      const original = toCatalogRecord(collection, entry.data);
      const schema = collection === 'televisions' ? televisionSchema : collection === 'stands' ? standSchema : compatibilitySchema;
      const normalized = toCmsRecord(collection, schema.parse(original));
      const key = keyOf(collection, normalized);
      if (byKey.has(key)) throw new Error(`${collection}: CMS内で外部IDまたは適合ペアが重複しています。`);
      byKey.set(key, normalized);
      ids.set(key, entry.id);
    }
    for (const row of catalog[collection]) {
      const data = toCmsRecord(collection, row);
      const key = keyOf(collection, data);
      const previous = byKey.get(key);
      if (previous) {
        if (equivalent(previous, data)) { plan.skipped += 1; continue; }
        const id = ids.get(key);
        const upgrade = collection === 'compatibility' ? compatibilityUpgrade(previous, data) : null;
        if (upgrade && id) { plan.upgrade.push({ collection, key, id, fields: upgrade.fields, previous: upgrade.previous }); continue; }
        const fill = options.fillBlanks ? blankFills(previous, data, overwrite) : null;
        if (!fill || !id) throw new Error(`${collection}/${key}: 既存データと異なるため取込を中止しました。管理画面で確認してください。`);
        plan.fill.push({ collection, key, id, fields: fill.fields, previous: fill.previous });
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
  return { origin, fetch: options.fetch ?? globalThis.fetch, retryDelayMs: options.retryDelayMs, headers: { Authorization: `Bearer ${options.token}` } };
}

const retryableStatuses = new Set([429, 502, 503, 504]);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** GET is safe to retry; POST is never retried so a timed-out write cannot be duplicated. */
async function requestJson(url: URL, init: RequestInit, options: ReturnType<typeof authenticated> & { retryDelayMs?: number | undefined; writeIntervalMs?: number | undefined }): Promise<Record<string, unknown>> {
  const retries = (init.method ?? 'GET') === 'GET' ? 5 : 0;
  let response: Response | undefined;
  for (let attempt = 0; ; attempt += 1) {
    try { response = await options.fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
    catch { if (attempt < retries) { await sleep((options.retryDelayMs ?? 2_000) * 2 ** attempt); continue; } throw new Error('CMS APIへ接続できませんでした。URL・ログイン制限・接続環境を確認してください。'); }
    if (!retryableStatuses.has(response.status) || attempt >= retries) break;
    await sleep((options.retryDelayMs ?? 2_000) * 2 ** attempt);
  }
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
      const code = typeof body.error?.code === 'string' ? body.error.code : '';
      const message = typeof body.error?.message === 'string' ? body.error.message.slice(0, 200) : '';
      if (code || message) detail = ` (${[code, message].filter(Boolean).join(': ')})`;
    } catch { /* non-JSON error body */ }
    throw new Error(`CMS APIがHTTP ${response.status}を返したため、取込を中止しました。${detail}`);
  }
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
      url.searchParams.set('limit', '25');
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

export async function applyImportPlan(plan: Pick<ImportPlan, 'create'>, options: ApiOptions): Promise<number> {
  const api = { ...authenticated(options), writeIntervalMs: options.writeIntervalMs };
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
    if (created % 50 === 0) console.log(`下書き保存 ${created}/${plan.create.length}件`);
    if (options.writeIntervalMs !== 0) await sleep(options.writeIntervalMs ?? 300);
  }
  return created;
}

function itemOf(data: Record<string, unknown>): { status?: unknown; data: Record<string, unknown>; rev?: unknown } {
  const item = data.item;
  if (!item || typeof item !== 'object' || !('data' in item) || !item.data || typeof item.data !== 'object') {
    throw new Error('CMS APIの項目形式を確認できないため、更新を中止しました。');
  }
  const record = item as Record<string, unknown>;
  return { status: record.status, data: record.data as Record<string, unknown>, rev: record._rev ?? record.rev };
}

/**
 * Fill CMS fields that are still blank. Drafts only by default (published entries with
 * includePublished); the status is kept, and every write is read back; anything unexpected stops the run.
 */
export async function applyFillPlan(plan: Pick<ImportPlan, 'fill'>, options: ApiOptions, limit = Infinity, includePublished = false, label = '空欄補完'): Promise<{ filled: number; published: string[] }> {
  const api = authenticated(options);
  let filled = 0;
  const published: string[] = [];
  for (const item of plan.fill) {
    if (filled >= limit) break;
    const url = new URL(`/_emdash/api/content/${item.collection}/${encodeURIComponent(item.id)}`, api.origin);
    const current = itemOf(await requestJson(url, { headers: api.headers }, api));
    const allowed = includePublished ? ['draft', 'published'] : ['draft'];
    if (typeof current.status !== 'string' || !allowed.includes(current.status)) { published.push(item.key); continue; }
    for (const [field, value] of Object.entries(item.fields)) {
      const now = current.data[field] ?? null;
      const expected = item.previous?.[field] ?? null;
      if (now !== null && now !== value && now !== expected) throw new Error(`${item.collection}/${item.key}: CMSの${field}が取込計画の作成後に変わったため中止しました。`);
    }
    // EmDash: send only the changed fields with the read's _rev. Saving a published entry
    // stages a draft while the live version stays; publish it to keep the entry published.
    const body: Record<string, unknown> = { data: item.fields };
    if (current.rev !== undefined) body._rev = current.rev;
    await requestJson(url, { method: 'PUT', headers: { ...api.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, api);
    if (current.status === 'published') {
      await requestJson(new URL(`${url.pathname}/publish`, api.origin), { method: 'POST', headers: { ...api.headers, 'Content-Type': 'application/json' }, body: '{}' }, api);
    }
    const after = itemOf(await requestJson(url, { headers: api.headers }, api));
    if (after.status !== current.status) throw new Error(`${item.collection}/${item.key}: 更新後に状態が${String(current.status)}から${String(after.status)}に変わったため中止しました。管理画面で確認してください。`);
    for (const [field, value] of Object.entries(item.fields)) {
      if ((after.data[field] ?? null) !== value) throw new Error(`${item.collection}/${item.key}: ${field}の更新を確認できないため中止しました。`);
    }
    for (const [field, value] of Object.entries(current.data)) {
      if (!(field in item.fields) && JSON.stringify(after.data[field] ?? null) !== JSON.stringify(value ?? null)) {
        throw new Error(`${item.collection}/${item.key}: 対象外の${field}が変化したため中止しました。管理画面で確認してください。`);
      }
    }
    filled += 1;
    console.log(`${label} ${filled}件目: ${item.collection}/${item.key} [${String(current.status)}] (${Object.entries(item.fields).map(([field, value]) => item.previous?.[field] != null ? `${field}: ${String(item.previous[field])} → ${String(value)}` : field).join(', ')})`);
    if (options.writeIntervalMs !== 0) await sleep(options.writeIntervalMs ?? 300);
  }
  return { filled, published };
}

export interface PublishPlan { publish: { id: string; key: string }[]; alreadyPublished: number; blocked: string[] }

/**
 * 公開予定の適合情報を選ぶ。CSVと同じ内容の下書きで、参照先のテレビ・スタンドが公開済みのものだけ。
 * CMS内のペア重複は buildImportPlan と同じく中止する（公開済み同士の重複を作らないため）。
 */
export function buildPublishPlan(catalog: Catalog, existing: CmsCatalogRows): PublishPlan {
  buildImportPlan(catalog, existing);
  const statusOf = (entry: CmsEntryRow) => (entry as { status?: unknown }).status;
  const publishedIds = (collection: 'televisions' | 'stands') => new Set(existing[collection]
    .filter(entry => statusOf(entry) === 'published')
    .map(entry => toCatalogRecord(collection, entry.data).id as string));
  const tvs = publishedIds('televisions');
  const stands = publishedIds('stands');
  const csvKeys = new Set(catalog.compatibility.map(row => keyOf('compatibility', toCmsRecord('compatibility', row))));
  const plan: PublishPlan = { publish: [], alreadyPublished: 0, blocked: [] };
  for (const entry of existing.compatibility) {
    const status = statusOf(entry);
    const record = toCatalogRecord('compatibility', entry.data);
    const key = keyOf('compatibility', toCmsRecord('compatibility', compatibilitySchema.parse(record)));
    if (status === 'published') { plan.alreadyPublished += 1; continue; }
    if (status !== 'draft' || !entry.id || !csvKeys.has(key)) continue;
    if (!tvs.has(String(record.television_id)) || !stands.has(String(record.stand_id))) { plan.blocked.push(key); continue; }
    plan.publish.push({ id: entry.id, key });
  }
  return plan;
}

export async function applyPublishPlan(plan: PublishPlan, options: ApiOptions, limit = Infinity): Promise<number> {
  const api = authenticated(options);
  let published = 0;
  for (const item of plan.publish) {
    if (published >= limit) break;
    const url = new URL(`/_emdash/api/content/compatibility/${encodeURIComponent(item.id)}/publish`, api.origin);
    await requestJson(url, { method: 'POST', headers: { ...api.headers, 'Content-Type': 'application/json' }, body: '{}' }, api);
    published += 1;
    if (published % 50 === 0) console.log(`公開 ${published}/${Math.min(plan.publish.length, limit)}件`);
    if (options.writeIntervalMs !== 0) await sleep(options.writeIntervalMs ?? 300);
  }
  return published;
}

export async function runCmsImport(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const valued = ['--directory', '--fill-limit', '--publish-limit', '--overwrite-field'];
  const unknown = args.filter((arg, index) => !['--apply', '--fill-blanks', '--include-published', '--publish-compatibility', ...valued].includes(arg) && !valued.includes(args[index - 1] ?? ''));
  if (unknown.length) throw new Error('使用方法: npm run cms:import -- [--directory data] [--apply] [--fill-blanks [--include-published] [--fill-limit N] [--overwrite-field release_date]] [--publish-compatibility [--publish-limit N]]');
  const publishIndex = args.indexOf('--publish-limit');
  const publishLimit = publishIndex >= 0 ? Number(args[publishIndex + 1]) : Infinity;
  if (publishIndex >= 0 && (!Number.isInteger(publishLimit) || publishLimit < 1)) throw new Error('--publish-limitには1以上の整数を指定してください。');
  const fillBlanks = args.includes('--fill-blanks');
  const overwriteFields = args.flatMap((arg, index) => arg === '--overwrite-field' ? [args[index + 1] ?? ''] : []);
  for (const field of overwriteFields) {
    if (!(overwritableFields as readonly string[]).includes(field)) throw new Error(`--overwrite-fieldに指定できるのは ${overwritableFields.join(', ')} だけです。`);
  }
  if (overwriteFields.length && !fillBlanks) throw new Error('--overwrite-fieldは--fill-blanksと一緒に指定してください。');
  const limitIndex = args.indexOf('--fill-limit');
  const fillLimit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;
  if (limitIndex >= 0 && (!Number.isInteger(fillLimit) || fillLimit < 1)) throw new Error('--fill-limitには1以上の整数を指定してください。');
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
  if (args.includes('--publish-compatibility')) {
    const publishPlan = buildPublishPlan(catalog, existing);
    console.log(`公開対象の適合情報 ${publishPlan.publish.length}件 / 公開済み ${publishPlan.alreadyPublished}件 / 参照先のテレビ・スタンドが未公開のため保留 ${publishPlan.blocked.length}件`);
    if (publishPlan.blocked.length) console.log(`::warning::参照先が未公開のため公開しなかった適合情報（先頭20件）: ${publishPlan.blocked.slice(0, 20).join(', ')}`);
    const count = await applyPublishPlan(publishPlan, options, publishLimit);
    console.log(`公開完了: ${count}件を公開しました（残り ${publishPlan.publish.length - count}件）。`);
    return;
  }
  const plan = buildImportPlan(catalog, existing, { fillBlanks, overwriteFields });
  try {
    if (plan.upgrade.length) {
      // 公開済みの候補も更新する（公開状態は保つ）。候補→確認済み以外の変更はここに入らない。
      console.log(`適合区分の更新（候補→確認済み）の対象 ${plan.upgrade.length}件`);
      const result = await applyFillPlan({ fill: plan.upgrade }, options, Infinity, true, '適合区分の更新');
      console.log(`適合区分の更新: ${result.filled}件。`);
      if (result.published.length) console.log(`::warning::下書き・公開以外の状態のため更新しなかった項目: ${result.published.join(', ')}。管理画面で更新してください。`);
    }
    if (plan.fill.length) {
      console.log(`空欄補完の対象 ${plan.fill.length}件${Number.isFinite(fillLimit) ? `（今回は最大${fillLimit}件）` : ''}`);
      const result = await applyFillPlan(plan, options, fillLimit, args.includes('--include-published'));
      console.log(`空欄補完: 更新 ${result.filled}件。`);
      if (result.published.length) console.log(`::warning::公開済み（または下書き以外）のため更新しなかった項目: ${result.published.join(', ')}。管理画面で更新してください。`);
      if (Number.isFinite(fillLimit)) { console.log('件数指定のため新規登録は行っていません。'); return; }
    }
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
