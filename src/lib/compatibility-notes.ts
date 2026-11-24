import type { Television } from './data';

const directTableMark = 'サンワサプライ直販サイトの対応表で「◯（対応）」';
const portraitNote = '縦向き設置の可否はテレビ・スタンド双方の仕様で確認。';
const conditionalMark = /^サンワサプライ直販サイトの対応表で「◯※（条件付き対応）」[:：]\s*([^。]*。)/u;

/** 個別適合確認済みの「適合の根拠と取付時の注意」から、表示しない定型文を外す。 */
export function confirmedNotesText(notes: string): string {
  let text = notes.replace(portraitNote, '');
  if (text.startsWith(directTableMark)) {
    text = text.slice(directTableMark.length);
    if (text.startsWith('（条件: ')) {
      // 「（条件: 付属（または別途用意）の…）。」のように入れ子の括弧があるので、対応する閉じ括弧を探す。
      let depth = 0;
      let end = -1;
      for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '（') depth += 1;
        else if (text[i] === '）' && (depth -= 1) === 0) { end = i; break; }
      }
      if (end > 0) text = `${text.slice(1, end)}${text.slice(end + 1)}`;
    }
    text = text.replace(/^。/u, '');
  }
  return text.trim();
}

/** 仕様上適合の「適合の根拠と取付時の注意」の本文（VESA・質量・サイズと注意文）。 */
export function candidateSpecLine(television: Television): string {
  const parts = [];
  if (television.vesa_width_mm !== null && television.vesa_height_mm !== null) parts.push(`VESA ${television.vesa_width_mm}×${television.vesa_height_mm}mm`);
  if (television.weight_kg !== null) parts.push(`本体質量 ${television.weight_kg}kg`);
  if (television.screen_inches !== null) parts.push(`${television.screen_inches}型`);
  return parts.join('、');
}

export const candidateFitText = 'VESA規格・耐荷重・テレビサイズは、いずれも適合条件を満たしています。\nただし、テレビ背面の形状によっては、スペーサーが必要になる場合があります。また、付属のネジが合わない場合は、テレビに適したサイズのネジを別途ご用意ください。';

/** 対応表で「◯※（条件付き対応）」とされた候補の条件。購入判断に効くので残す。 */
export function candidateCondition(notes: string): string | null {
  const match = notes.match(conditionalMark);
  return match ? `サンワサプライの対応表では条件付き対応：${match[1]}` : null;
}
