/**
 * 型番一覧の絞り込み用キー。全角・半角（NFKC）と大文字・小文字の違いをなくし、
 * 記号・空白をすべて除く（例：「ＫＪ－５５Ｘ８０Ｌ」「kj55x80l」「KJ 55/X80L」はどれも同じ）。
 */
export function modelFilterKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export interface ModelFilterItem { key: string; size: string }

/** 型番の部分一致（キー同士）と、画面サイズの完全一致（空なら全サイズ）で絞り込む。 */
export function matchesModelFilter(item: ModelFilterItem, query: string, size: string): boolean {
  const key = modelFilterKey(query);
  return (key === '' || item.key.includes(key)) && (size === '' || item.size === size);
}

/** 画面サイズの選択肢。数値の小さい順、重複なし。 */
export function screenSizeOptions(sizes: readonly (number | null)[]): number[] {
  return [...new Set(sizes.filter((size): size is number => size !== null))].sort((a, b) => a - b);
}

export const modelSortOrders = ['release-desc', 'release-asc', 'size-desc', 'size-asc'] as const;
export type ModelSortOrder = typeof modelSortOrders[number];
export const defaultModelSortOrder: ModelSortOrder = 'release-desc';
export const modelSortLabels: Record<ModelSortOrder, string> = {
  'release-desc': '発売日が新しい順',
  'release-asc': '発売日が古い順',
  'size-desc': 'サイズが大きい順',
  'size-asc': 'サイズが小さい順',
};

/**
 * 発売日の並び替え用の数値（YYYYMMDD）。旬は上旬=5日・中旬=15日・下旬=25日、月までは15日として扱う。
 * 未確認・読めない値は null（並び順にかかわらず末尾）。
 */
export function releaseSortKey(value: string | null | undefined): number | null {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}|上旬|中旬|下旬))?$/u.exec(value ?? '');
  if (!match) return null;
  const day = match[3] === undefined ? 15 : match[3] === '上旬' ? 5 : match[3] === '中旬' ? 15 : match[3] === '下旬' ? 25 : Number(match[3]);
  return Number(match[1]) * 10000 + Number(match[2]) * 100 + day;
}

export interface ModelSortItem { model: string; size: number | null; release: number | null }

function compareNullable(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

/** 型番一覧の比較。発売日順はサイズの大きい順、サイズ順は発売日の新しい順で同順位を決め、最後は型番順。 */
export function compareModels(a: ModelSortItem, b: ModelSortItem, order: ModelSortOrder = defaultModelSortOrder): number {
  const release = (direction: 1 | -1) => compareNullable(a.release, b.release, direction);
  const size = (direction: 1 | -1) => compareNullable(a.size, b.size, direction);
  const primary = order === 'release-desc' ? release(-1) || size(-1)
    : order === 'release-asc' ? release(1) || size(-1)
    : order === 'size-desc' ? size(-1) || release(-1)
    : size(1) || release(-1);
  return primary || a.model.localeCompare(b.model, 'ja', { numeric: true });
}

export function isModelSortOrder(value: string): value is ModelSortOrder {
  return (modelSortOrders as readonly string[]).includes(value);
}
