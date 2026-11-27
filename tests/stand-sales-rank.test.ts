import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseStandSalesRank, sortBySalesRank, standSalesRank } from '../src/lib/stand-sales-rank';
import { loadCatalog } from '../src/lib/csv';

describe('スタンド・壁掛け金具の売れ筋順', () => {
  it('data/stand-sales-rank.csv は正しい形で、登録済みの品番だけを含む', () => {
    const table = parseStandSalesRank(readFileSync('data/stand-sales-rank.csv', 'utf8'));
    const skus = new Set(loadCatalog('data').stands.map(stand => stand.sku.toUpperCase()));
    expect(table.size).toBeGreaterThan(0);
    expect([...table.keys()].filter(sku => !skus.has(sku))).toEqual([]);
    expect(standSalesRank('100-lad001')).toBe(1);
    expect(standSalesRank('FICTION-NONE')).toBeNull();
  });

  it('ヘッダー違い・順位の誤り・重複はエラー', () => {
    expect(() => parseStandSalesRank('品番,順位\nA,1')).toThrow('ヘッダー');
    expect(() => parseStandSalesRank('sku,rank\nA,0')).toThrow('2行目');
    expect(() => parseStandSalesRank('sku,rank\nA,x')).toThrow('2行目');
    expect(() => parseStandSalesRank('sku,rank\nA,1\na,2')).toThrow('重複');
  });

  it('順位の順に並べ、同じ順位は元の順、順位の無いものは最後', () => {
    const table = parseStandSalesRank('﻿sku,rank\r\nB,1\r\nC,2\r\nD,2\r\n');
    const sorted = sortBySalesRank(['X', 'D', 'C', 'Y', 'B'], sku => sku, table);
    expect(sorted).toEqual(['B', 'D', 'C', 'X', 'Y']);
  });
});
