import { z } from 'zod';
import { normalizeModel } from './normalize';
import { indexExclusions } from '../config/indexing';

export const compatibilityStatuses = ['confirmed', 'candidate', 'incompatible', 'unknown'] as const;
export const evidenceTypes = ['manufacturer_individual', 'official_individual', 'specification', 'insufficient'] as const;
export const standTypes = ['floor', 'tabletop', 'wall'] as const;
const text = z.string().trim().min(1).max(300).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), '制御文字は使用できません');
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/u, 'IDは小文字英数字とハイフンで指定してください');
const safeUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'URLは認証情報を含まないHTTPSで指定してください');
const nullableUrl = z.preprocess((value) => value === '' || value === undefined ? null : value, safeUrl.nullable());
const positive = (max: number, integer = false) => z.preprocess((value) => {
  if (value === '' || value === undefined || value === null) return null;
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/u.test(value)) return Number.NaN;
  return typeof value === 'string' ? Number(value) : value;
}, (integer ? z.number().int() : z.number()).positive().max(max).nullable());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, '実在する日付を指定してください');
const nullableDate = z.preprocess((value) => value === '' || value === undefined ? null : value, date.nullable());
const vesaPattern = z.object({ width: z.number().int().positive().max(5000), height: z.number().int().positive().max(5000) }).strict();

export const televisionSchema = z.object({
  id,
  manufacturer: text,
  model: text,
  screen_inches: positive(300),
  weight_kg: positive(2000),
  vesa_width_mm: positive(5000, true),
  vesa_height_mm: positive(5000, true),
  source_url: nullableUrl,
}).strict().refine((tv) => (tv.vesa_width_mm === null) === (tv.vesa_height_mm === null), 'VESAの幅と高さは両方指定するか両方空欄にしてください');

export const standSchema = z.object({
  id,
  manufacturer: text,
  sku: text,
  stand_type: z.enum(standTypes),
  max_weight_kg: positive(2000).refine((value) => value !== null, '耐荷重は必須です').transform((value) => value as number),
  vesa_patterns: z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    if (!/^\d+x\d+(;\d+x\d+)*$/u.test(value)) return value;
    return value.split(';').map((pattern) => {
      const [width, height] = pattern.split('x').map(Number);
      return { width, height };
    });
  }, z.array(vesaPattern).min(1).refine((patterns) => new Set(patterns.map((p) => `${p.width}x${p.height}`)).size === patterns.length, 'VESAパターンが重複しています')),
  source_url: safeUrl,
  product_url: nullableUrl,
}).strict();

export const compatibilitySchema = z.object({
  television_id: id,
  stand_id: id,
  status: z.enum(compatibilityStatuses),
  evidence_type: z.enum(evidenceTypes),
  evidence_url: nullableUrl,
  checked_at: nullableDate,
  notes: z.string().trim().max(3000).refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), '制御文字は使用できません'),
}).strict().superRefine((entry, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message });
  if (entry.status === 'confirmed' && !['manufacturer_individual', 'official_individual'].includes(entry.evidence_type)) fail('confirmedにはメーカー等による個別適合確認の根拠が必要です');
  if (entry.status !== 'unknown' && (!entry.evidence_url || !entry.checked_at || !entry.notes)) fail('判定には出典URL・確認日・注意事項または根拠の説明が必要です');
  if (entry.status === 'candidate' && entry.evidence_type !== 'specification') fail('candidateにはspecificationの根拠を指定してください');
  if (entry.evidence_type === 'insufficient' && entry.status !== 'unknown') fail('根拠不足はunknownとして記録してください');
});

export type Television = z.infer<typeof televisionSchema>;
export type Stand = z.infer<typeof standSchema>;
export type Compatibility = z.infer<typeof compatibilitySchema>;
export interface Catalog { televisions: Television[]; stands: Stand[]; compatibility: Compatibility[] }
export interface CatalogOptions { allowFixtures?: boolean; now?: Date }
const fixtureText = /(?:^fixture(?:-|$)|架空|^dummy(?:-|$)|^sample(?:-|$))/iu;
function fixtureUrl(value: string): boolean {
  const host = new URL(value).hostname;
  return host === 'invalid' || host.endsWith('.invalid') || host === 'example.com' || host.endsWith('.example') || host === 'localhost';
}

export const csvColumns = {
  televisions: ['id', 'manufacturer', 'model', 'screen_inches', 'weight_kg', 'vesa_width_mm', 'vesa_height_mm', 'source_url'],
  stands: ['id', 'manufacturer', 'sku', 'stand_type', 'max_weight_kg', 'vesa_patterns', 'source_url', 'product_url'],
  compatibility: ['television_id', 'stand_id', 'status', 'evidence_type', 'evidence_url', 'checked_at', 'notes'],
} as const;

/** Validate CSV rows, relational integrity, search keys, and publication boundaries. */
export function validateCatalog(input: unknown, options: CatalogOptions = {}): Catalog {
  const result = z.object({
    televisions: z.array(televisionSchema),
    stands: z.array(standSchema),
    compatibility: z.array(compatibilitySchema),
  }).strict().safeParse(input);
  if (!result.success) throw new Error(`CSV検証エラー: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n')}`);
  const catalog = result.data;
  const errors: string[] = [];
  const unique = (values: string[], label: string) => {
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value)) errors.push(`${label}が重複しています: ${value}`);
      seen.add(value);
    }
  };
  unique(catalog.televisions.map((tv) => tv.id), 'テレビID');
  unique(catalog.stands.map((stand) => stand.id), 'スタンドID');
  unique(catalog.televisions.map((tv) => `${normalizeModel(tv.manufacturer)}:${normalizeModel(tv.model)}`), '正規化したメーカー・型番');
  unique(catalog.stands.map((stand) => `${normalizeModel(stand.manufacturer)}:${normalizeModel(stand.sku)}`), '正規化したメーカー・商品型番');
  unique(catalog.televisions.map(televisionPath), 'テレビURL');
  for (const tv of catalog.televisions) {
    if (televisionPath(tv) === '/guides/vesa/') errors.push('テレビURLが固定ページと衝突しています: /guides/vesa/');
  }
  unique(catalog.compatibility.map((entry) => `${entry.television_id}:${entry.stand_id}`), '適合ペア');
  const tvs = new Map(catalog.televisions.map((tv) => [tv.id, tv]));
  const stands = new Map(catalog.stands.map((stand) => [stand.id, stand]));
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(options.now ?? new Date());
  for (const entry of catalog.compatibility) {
    const tv = tvs.get(entry.television_id);
    const stand = stands.get(entry.stand_id);
    if (!tv) errors.push(`適合データのテレビIDが存在しません: ${entry.television_id}`);
    if (!stand) errors.push(`適合データのスタンドIDが存在しません: ${entry.stand_id}`);
    if (entry.checked_at && entry.checked_at > today) errors.push(`確認日が未来です: ${entry.checked_at}`);
    if (entry.status === 'candidate' && tv && stand && !specificationsMatch(tv, stand)) errors.push(`candidateには重量・VESAの一致した仕様が必要です: ${entry.television_id}/${entry.stand_id}`);
  }
  if (!options.allowFixtures) {
    for (const item of [...catalog.televisions, ...catalog.stands]) {
      if ([item.id, item.manufacturer, 'model' in item ? item.model : item.sku].some((value) => fixtureText.test(value))) errors.push(`架空データは本番に含められません: ${item.id}`);
    }
    for (const item of [...catalog.televisions, ...catalog.stands, ...catalog.compatibility]) {
      for (const [key, value] of Object.entries(item)) {
        if (key.endsWith('_url') && typeof value === 'string') {
          if (fixtureUrl(value)) errors.push(`テストURLは本番に含められません: ${value}`);
        }
      }
    }
  }
  if (errors.length) throw new Error(`CSV整合性エラー:\n${errors.join('\n')}`);
  return catalog;
}

/** A specification match is a candidate only; it never establishes confirmed compatibility. */
export function specificationsMatch(tv: Television, stand: Stand): boolean {
  return tv.weight_kg !== null && tv.weight_kg <= stand.max_weight_kg &&
    tv.vesa_width_mm !== null && tv.vesa_height_mm !== null &&
    stand.vesa_patterns.some((pattern) => pattern.width === tv.vesa_width_mm && pattern.height === tv.vesa_height_mm);
}

function slug(value: string): string {
  const result = value.normalize('NFKC').toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/gu, '');
  if (!result || result === '.' || result === '..') throw new Error(`URLに使用できない名前です: ${value}`);
  return result;
}
export const manufacturerSlug = (manufacturer: string): string => slug(manufacturer);
export const modelSlug = (model: string): string => slug(model);
export const televisionPath = (tv: Television): string => `/${encodeURIComponent(manufacturerSlug(tv.manufacturer))}/${encodeURIComponent(modelSlug(tv.model))}/`;

/** Thin/unchecked pages remain accessible but stay outside search engine indexes. */
export function isIndexableTelevision(tv: Television, catalog: Catalog, exclusions: Readonly<Record<string, string>> = indexExclusions): boolean {
  return !Object.hasOwn(exclusions, tv.id) &&
    ![tv.id, tv.manufacturer, tv.model].some((value) => fixtureText.test(value)) &&
    tv.source_url !== null && !fixtureUrl(tv.source_url) &&
    tv.screen_inches !== null && tv.weight_kg !== null && tv.vesa_width_mm !== null && tv.vesa_height_mm !== null &&
    catalog.compatibility.some((entry) => entry.television_id === tv.id && entry.status !== 'unknown' && entry.evidence_url !== null && entry.checked_at !== null);
}
