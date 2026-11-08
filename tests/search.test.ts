import { describe, expect, it } from 'vitest';
import { createSearch, type SearchItem } from '../src/lib/search';

// Deliberately fictional test records. These are never published or imported by the site.
const item = (model: string, id = model, manufacturer = '架空メーカーA'): SearchItem => ({
  id: `fixture-${id}`, manufacturer, model, screen_inches: null, url: `/fixture/${id.toLowerCase()}/`,
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected a fixture record or search result to exist');
  return value;
}

const rows = [
  item('FX-TV550-X'),
  item('FX-TV550'),
  item('Z-FX-TV550'),
  item('FX-TV551'),
  item('FX-TV550', 'other', '架空メーカーB'),
  item('ZZ-990'),
];

describe('model search', () => {
  it('ranks exact matches before prefix, substring and similar models', () => {
    const results = createSearch(rows)('FX-TV550', '架空メーカーA');
    expect(results.map((result) => result.item.model)).toEqual(['FX-TV550', 'FX-TV550-X', 'Z-FX-TV550', 'FX-TV551']);
    expect(results.map((result) => result.match)).toEqual(['exact', 'prefix', 'partial', 'similar']);
  });
  it('matches full width, case and hyphen differences while preserving official model text', () => {
    const result = createSearch(rows)('ｆｘ－ｔｖ５５０', '架空メーカーA')[0];
    expect(result).toEqual({ item: rows[1], match: 'exact' });
    expect(required(rows[1]).model).toBe('FX-TV550');
  });
  it('supports Unicode dash variants and whitespace', () => {
    expect(required(createSearch(rows)(' FX – TV 550 ', '架空メーカーA')[0]).match).toBe('exact');
  });
  it('restricts candidates to the selected manufacturer', () => {
    const results = createSearch(rows)('FX-TV550', '架空メーカーB');
    expect(results).toEqual([{ item: rows[4], match: 'exact' }]);
    expect(createSearch(rows)('FX-TV550', '未登録メーカー')).toEqual([]);
  });
  it('searches all manufacturers when none is selected', () => {
    expect(createSearch(rows)('FX-TV550').filter((result) => result.match === 'exact')).toHaveLength(2);
  });
  it('returns similarity as a suggestion, never as an exact match', () => {
    const results = createSearch([item('FX-TV550')])('FX-TV559');
    expect(results).toHaveLength(1);
    expect(required(results[0]).match).toBe('similar');
  });
  it('does not invent results for unknown queries or empty catalogs', () => {
    expect(createSearch(rows)('NONEXISTENT777')).toEqual([]);
    expect(createSearch([])('FX-TV550')).toEqual([]);
  });
  it('ignores blank, separator-only and overlong queries', () => {
    const search = createSearch(rows);
    expect(search('')).toEqual([]);
    expect(search('  ')).toEqual([]);
    expect(search('---')).toEqual([]);
    expect(search('x'.repeat(101))).toEqual([]);
  });
  it('caps suggestions while retaining a late exact match at the top', () => {
    const many = Array.from({ length: 30 }, (_, index) => item(`FX-${String(index).padStart(3, '0')}`));
    many.push(item('FX', 'exact'));
    const results = createSearch(many)('FX');
    expect(results).toHaveLength(12);
    expect(required(results[0]).item.model).toBe('FX');
    expect(required(results[0]).match).toBe('exact');
  });
});
