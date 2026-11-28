/**
 * 比較表・独自情報用の仕様データ（data/stand-specs.csv・data/tv-details.csv）の読み込みと検証。
 * どちらも公式の仕様表・寸法図から作る。分からない値は空欄（推測で埋めない）。
 * 列の説明は docs/CSV.md の「仕様データ」。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { Catalog, Stand } from './data';

export const standSpecColumns = [
  'stand_id', 'sku', 'style', 'height_adjust', 'min_inches', 'max_inches',
  'width_mm', 'depth_min_mm', 'depth_max_mm', 'height_min_mm', 'height_max_mm', 'size_text',
  'bracket_center_min_mm', 'bracket_center_max_mm', 'product_weight_kg', 'tilt', 'swivel',
  'wall_distance_mm', 'casters', 'shelf', 'one_liner', 'spec_note', 'spec_source_url', 'spec_checked_at',
] as const;

export const tvDetailColumns = [
  'television_id', 'model', 'width_mm', 'height_mm', 'depth_mm', 'height_with_stand_mm', 'depth_with_stand_mm',
  'stand_width_mm', 'tabletop_min_width_mm', 'tabletop_min_depth_mm',
  'vesa_center_from_bottom_mm', 'back_shape', 'screw', 'detail_note', 'source_url', 'checked_at',
] as const;

/** 設置タイプ。stand_type ごとに使える値が決まっている。 */
export const standStyles: Record<Stand['stand_type'], readonly string[]> = {
  floor: ['wall_close', 'floor_caster', 'floor', 'low'],
  tabletop: ['tabletop'],
  wall: ['wall_fixed', 'wall_tilt', 'wall_arm'],
};
export const styleLabels: Record<string, string> = {
  wall_close: '壁寄せ', floor_caster: 'キャスター付き', floor: '据え置き', low: 'ロータイプ', tabletop: '卓上',
  wall_fixed: '壁掛け（角度固定）', wall_tilt: '壁掛け（角度調整）', wall_arm: '壁掛け（アーム）',
};
export const heightAdjustments = ['electric', 'manual', 'steps'] as const;
export const backShapes = ['flat', 'lower_bulge', 'center_bulge', 'upper_bulge'] as const;

export const ONE_LINER_MAX = 40;

type Row = Record<string, string>;

export interface SpecValidation { errors: string[]; warnings: string[] }

function readCsv(filename: string, columns: readonly string[], label: string): Row[] {
  const records = parse(readFileSync(filename, 'utf8'), {
    bom: true, skip_empty_lines: true, trim: true, relax_column_count: false,
    columns: (header: string[]) => {
      if (header.join(',') !== columns.join(',')) throw new Error(`${label}: 見出しは ${columns.join(',')} にしてください`);
      return header;
    },
  }) as Row[];
  return records;
}

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

/** 数値の列。空欄は null。範囲外・数値でなければエラーを積む。 */
function number(row: Row, column: string, where: string, errors: string[], range: [number, number], integer = false): number | null {
  const raw = row[column] ?? '';
  if (raw === '') return null;
  if (!/^\d+(\.\d+)?$/u.test(raw)) { errors.push(`${where}: ${column} は数字だけで書いてください（${raw}）`); return null; }
  const value = Number(raw);
  if (integer && !Number.isInteger(value)) errors.push(`${where}: ${column} は整数にしてください（${raw}）`);
  if (value < range[0] || value > range[1]) errors.push(`${where}: ${column} が範囲外です（${raw}、${range[0]}〜${range[1]}）`);
  return value;
}

function pair(row: Row, low: string, high: string, where: string, errors: string[], range: [number, number], integer = false) {
  const a = number(row, low, where, errors, range, integer);
  const b = number(row, high, where, errors, range, integer);
  if (a !== null && b !== null && a > b) errors.push(`${where}: ${low}（${a}）が ${high}（${b}）より大きいです`);
  return [a, b] as const;
}

function sourceAndDate(row: Row, urlColumn: string, dateColumn: string, hasValues: boolean, where: string, errors: string[]) {
  const url = row[urlColumn] ?? '';
  const date = row[dateColumn] ?? '';
  if (url && !/^https:\/\/[^\s]+$/u.test(url)) errors.push(`${where}: ${urlColumn} は https:// のURLにしてください`);
  if (/example\.(com|net|org)|\.invalid\b|localhost/iu.test(url)) errors.push(`${where}: ${urlColumn} にテスト用のURLは使えません`);
  if (date && (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || Number.isNaN(Date.parse(date)))) errors.push(`${where}: ${dateColumn} は YYYY-MM-DD にしてください`);
  if (date && date > today()) errors.push(`${where}: ${dateColumn} が未来の日付です（${date}）`);
  if (hasValues && (!url || !date)) errors.push(`${where}: 値を入れた行は ${urlColumn}（出典）と ${dateColumn}（確認日）が必要です`);
}

const flag = (row: Row, column: string, where: string, errors: string[]) => {
  const value = row[column] ?? '';
  if (!['', '0', '1'].includes(value)) errors.push(`${where}: ${column} は 1（あり）・0（なし）・空欄（不明）のどれかにしてください（${value}）`);
};

const angle = (row: Row, column: string, where: string, errors: string[]) => {
  const value = row[column] ?? '';
  if (value && (!/°/u.test(value) || value.length > 30)) errors.push(`${where}: ${column} は公式の表記を短く「上8°・下10°」のように書いてください（${value}）`);
};

/** data/stand-specs.csv の検証。stands.csv との対応（stand_id・sku・stand_type）も確かめる。 */
export function validateStandSpecs(rows: readonly Row[], stands: readonly Stand[]): SpecValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(stands.map(stand => [stand.id, stand]));
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const where = `stand-specs.csv ${index + 2}行目（${row.stand_id || '?'}）`;
    const stand = byId.get(row.stand_id ?? '');
    if (!stand) { errors.push(`${where}: stand_id が stands.csv にありません`); return; }
    if (seen.has(stand.id)) errors.push(`${where}: stand_id が重複しています`);
    seen.add(stand.id);
    if (row.sku !== stand.sku) errors.push(`${where}: sku が stands.csv（${stand.sku}）と違います`);
    if (row.style && !standStyles[stand.stand_type].includes(row.style)) {
      errors.push(`${where}: style「${row.style}」は ${stand.stand_type} には使えません（${standStyles[stand.stand_type].join('・')}）`);
    }
    if (row.height_adjust && !(heightAdjustments as readonly string[]).includes(row.height_adjust)) errors.push(`${where}: height_adjust は ${heightAdjustments.join('・')} か空欄にしてください`);
    if (row.height_adjust && stand.stand_type === 'wall') errors.push(`${where}: 壁掛け金具に height_adjust は書けません`);
    pair(row, 'min_inches', 'max_inches', where, errors, [10, 150], true);
    number(row, 'width_mm', where, errors, [10, 5000]);
    pair(row, 'depth_min_mm', 'depth_max_mm', where, errors, [5, 5000]);
    pair(row, 'height_min_mm', 'height_max_mm', where, errors, [10, 5000]);
    const [bracketMin, bracketMax] = pair(row, 'bracket_center_min_mm', 'bracket_center_max_mm', where, errors, [100, 3000]);
    const heightMax = number(row, 'height_max_mm', where, [], [10, 5000]);
    if (heightMax !== null && (bracketMax ?? bracketMin) !== null && (bracketMax ?? bracketMin)! > heightMax) {
      errors.push(`${where}: ブラケット中心の高さが製品の高さを超えています`);
    }
    number(row, 'product_weight_kg', where, errors, [0.05, 300]);
    number(row, 'wall_distance_mm', where, errors, [1, 1500]);
    angle(row, 'tilt', where, errors);
    angle(row, 'swivel', where, errors);
    flag(row, 'casters', where, errors);
    flag(row, 'shelf', where, errors);
    if (stand.stand_type === 'wall' && row.casters === '1') errors.push(`${where}: 壁掛け金具にキャスターは付きません`);
    const oneLiner = row.one_liner ?? '';
    if ([...oneLiner].length > ONE_LINER_MAX) errors.push(`${where}: one_liner は${ONE_LINER_MAX}字以内にしてください（${[...oneLiner].length}字）`);
    if (/https?:\/\//u.test(oneLiner)) errors.push(`${where}: one_liner にURLは書けません`);
    const filled = standSpecColumns.some(column => !['stand_id', 'sku', 'one_liner', 'spec_note', 'spec_source_url', 'spec_checked_at'].includes(column) && (row[column] ?? '') !== '');
    sourceAndDate(row, 'spec_source_url', 'spec_checked_at', filled, where, errors);
  });
  for (const stand of stands) if (!seen.has(stand.id)) warnings.push(`stand-specs.csv: ${stand.id}（${stand.sku}）の行がありません`);
  return { errors, warnings };
}

/** data/tv-details.csv の検証。televisions.csv との対応（television_id・model）も確かめる。 */
export function validateTvDetails(rows: readonly Row[], catalog: Pick<Catalog, 'televisions'>): SpecValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(catalog.televisions.map(tv => [tv.id, tv]));
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const where = `tv-details.csv ${index + 2}行目（${row.television_id || '?'}）`;
    const tv = byId.get(row.television_id ?? '');
    if (!tv) { errors.push(`${where}: television_id が televisions.csv にありません`); return; }
    if (seen.has(tv.id)) errors.push(`${where}: television_id が重複しています`);
    seen.add(tv.id);
    if (row.model !== tv.model) errors.push(`${where}: model が televisions.csv（${tv.model}）と違います`);
    const width = number(row, 'width_mm', where, errors, [200, 3500]);
    const height = number(row, 'height_mm', where, errors, [100, 2500]);
    const depth = number(row, 'depth_mm', where, errors, [5, 300]);
    const heightWithStand = number(row, 'height_with_stand_mm', where, errors, [100, 3000]);
    const depthWithStand = number(row, 'depth_with_stand_mm', where, errors, [5, 1000]);
    number(row, 'stand_width_mm', where, errors, [50, 3500]);
    number(row, 'tabletop_min_width_mm', where, errors, [50, 3500]);
    number(row, 'tabletop_min_depth_mm', where, errors, [50, 1500]);
    const vesaCenter = number(row, 'vesa_center_from_bottom_mm', where, errors, [10, 2000]);
    if (height !== null && heightWithStand !== null && heightWithStand < height) errors.push(`${where}: スタンド込みの高さが本体の高さより低いです`);
    if (depth !== null && depthWithStand !== null && depthWithStand < depth) errors.push(`${where}: スタンド込みの奥行が本体の奥行より小さいです`);
    if (height !== null && vesaCenter !== null && vesaCenter >= height) errors.push(`${where}: VESA中心の高さが本体の高さ以上です`);
    if (width !== null && tv.screen_inches !== null) {
      // 16:9 の画面の横幅より本体が狭いことはない（列ずれ・単位違いの検出）
      const screenWidth = tv.screen_inches * 25.4 * 16 / Math.sqrt(16 ** 2 + 9 ** 2);
      if (width < screenWidth * 0.97 || width > screenWidth * 1.15) errors.push(`${where}: 幅 ${width}mm が ${tv.screen_inches}型の画面幅（約${Math.round(screenWidth)}mm）と合いません。列ずれ・単位を確認してください`);
    }
    if (row.back_shape && !(backShapes as readonly string[]).includes(row.back_shape)) errors.push(`${where}: back_shape は ${backShapes.join('・')} か空欄にしてください`);
    if (row.screw && !/^M\d+$/u.test(row.screw)) errors.push(`${where}: screw は M6 のように書いてください（${row.screw}）`);
    const filled = tvDetailColumns.some(column => !['television_id', 'model', 'detail_note', 'source_url', 'checked_at'].includes(column) && (row[column] ?? '') !== '');
    sourceAndDate(row, 'source_url', 'checked_at', filled, where, errors);
  });
  for (const tv of catalog.televisions) if (!seen.has(tv.id)) warnings.push(`tv-details.csv: ${tv.id}（${tv.model}）の行がありません`);
  return { errors, warnings };
}

/** data/ の2つの仕様CSVを読み込んで検証する。ファイルが無ければ何もしない。 */
export function validateSpecFiles(catalog: Catalog, directory = resolve(process.cwd(), 'data')): SpecValidation & { counts: Record<string, number> } {
  const result = { errors: [] as string[], warnings: [] as string[], counts: {} as Record<string, number> };
  const run = (file: string, columns: readonly string[], check: (rows: Row[]) => SpecValidation) => {
    const filename = resolve(directory, file);
    if (!existsSync(filename)) return;
    try {
      const rows = readCsv(filename, columns, file);
      const { errors, warnings } = check(rows);
      result.errors.push(...errors); result.warnings.push(...warnings);
      result.counts[file] = rows.length;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  };
  run('stand-specs.csv', standSpecColumns, rows => validateStandSpecs(rows, catalog.stands));
  run('tv-details.csv', tvDetailColumns, rows => validateTvDetails(rows, catalog));
  return result;
}
