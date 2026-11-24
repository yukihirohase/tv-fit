import { describe, expect, it } from 'vitest';
import { candidateCondition, confirmedNotesText } from '../src/lib/compatibility-notes';

describe('confirmedNotesText', () => {
  it('drops the direct-table mark and the portrait-orientation note', () => {
    expect(confirmedNotesText('サンワサプライ直販サイトの対応表で「◯（対応）」。テレビ: VESA 300×300mm。付属ボルトが合わない場合は市販の適合ボルトを用意。縦向き設置の可否はテレビ・スタンド双方の仕様で確認。'))
      .toBe('テレビ: VESA 300×300mm。付属ボルトが合わない場合は市販の適合ボルトを用意。');
  });

  it('keeps the condition, including nested parentheses', () => {
    expect(confirmedNotesText('サンワサプライ直販サイトの対応表で「◯（対応）」（条件: 付属（または別途用意）のスペーサー使用で取付け可能）。テレビ: VESA 800×400mm。'))
      .toBe('条件: 付属（または別途用意）のスペーサー使用で取付け可能。テレビ: VESA 800×400mm。');
  });

  it('leaves other evidence text untouched', () => {
    const notes = 'サンワサプライ公式サイトの対応表に掲載（同社がテレビ背面の寸法図をもとに確認）。テレビ: VESA 300×300mm。';
    expect(confirmedNotesText(notes)).toBe(notes);
  });
});

describe('candidateCondition', () => {
  it('extracts a conditional-support note and ignores plain candidates', () => {
    expect(candidateCondition('サンワサプライ直販サイトの対応表で「◯※（条件付き対応）」: その他の条件あり（サンワサプライへの問い合わせが必要）。コネクタ部…'))
      .toBe('サンワサプライの対応表では条件付き対応：その他の条件あり（サンワサプライへの問い合わせが必要）。');
    expect(candidateCondition('仕様上の候補（メーカーによる個別の適合確認ではありません）。')).toBeNull();
  });
});
