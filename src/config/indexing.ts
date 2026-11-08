/**
 * 編集者がインデックス対象から除外するテレビIDと理由。
 * CSVの列は変更せず、内容の重複・別型番表記・確認中などを管理します。
 * 例: '対象テレビID': '別ページと内容が重複しているため'
 * 空の状態では手動除外はありません。除外したページも閲覧できます。
 */
export const indexExclusions: Readonly<Record<string, string>> = {};
