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
