import type { Television } from './data';

/**
 * 検索結果に出るページ説明（meta description）。
 * 画面に表示している内容だけを、具体的な数値・件数で短く伝える（目安120字前後）。
 * 型番ページでは非対応・判断材料不足の商品を一覧に出さないため、説明にも書かない。
 */

const spec = (tv: Television): string => {
  const parts = [
    tv.screen_inches !== null ? `${tv.screen_inches}型` : null,
    tv.weight_kg !== null ? `${tv.weight_kg}kg` : null,
    tv.vesa_width_mm !== null && tv.vesa_height_mm !== null ? `VESA ${tv.vesa_width_mm}×${tv.vesa_height_mm}mm` : null,
  ].filter((part): part is string => part !== null);
  return parts.length ? `（${parts.join('・')}）` : '';
};

export function televisionDescription(tv: Television, counts: { stands: number; wall: number }): string {
  const name = `${tv.manufacturer} ${tv.model}`;
  if (counts.stands + counts.wall === 0) {
    return `${name}${spec(tv)}の画面サイズ・本体重量・VESA取付穴間隔。対応するテレビスタンド・壁掛け金具は確認中です。`;
  }
  return `${name}${spec(tv)}に対応するテレビスタンド${counts.stands}件・壁掛け金具${counts.wall}件。`
    + 'メーカー確認済みと仕様上適合を区別し、出典と確認日を掲載しています。';
}

export function manufacturerDescription(name: string, count: number): string {
  if (count === 0) return `${name}のテレビの型番データを準備中です。登録済みのメーカーからテレビスタンド・壁掛け金具の対応情報を探せます。`;
  return `${name}のテレビ${count}機種の型番一覧。型番を選ぶと、対応するテレビスタンド・壁掛け金具と、VESA・本体重量・出典を確認できます。`;
}

export const homeDescription = 'テレビの型番から、対応するテレビスタンド・壁掛け金具を探せます。'
  + 'SONY・Panasonic・SHARP・REGZA・LG・Hisense・TCLの型番ごとに、VESA・本体重量と適合の根拠（出典・確認日）を掲載。';
