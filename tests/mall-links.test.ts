import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../src/lib/csv';
import { mallPagesFor, parseMallLinks } from '../src/lib/mall-links';

const header = 'stand_id,sku,amazon_url,rakuten_url,yahoo_url';

describe('モールの商品ページ（data/mall-links.csv）', () => {
  it('登録済みのスタンドと型番が一致し、重複がない', () => {
    const stands = new Map(loadCatalog().stands.map(stand => [stand.id, stand.sku]));
    const rows = parseMallLinks(readFileSync('data/mall-links.csv', 'utf8'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(stands.get(row.stand_id), row.stand_id).toBe(row.sku);
  });

  it('商品ページを引ける。未登録は null', () => {
    expect(mallPagesFor('sanwa-cr-last1')).toMatchObject({
      amazon: 'https://www.amazon.co.jp/dp/B0013Z58I0/',
      rakuten: 'https://item.rakuten.co.jp/sanwadirect/cr-last1/',
      yahoo: 'https://store.shopping.yahoo.co.jp/sanwadirect/cr-last1.html',
    });
    expect(mallPagesFor('not-registered')).toBeNull();
  });

  it('形の違うURL・重複・見出し違いは読み込みで止める', () => {
    expect(() => parseMallLinks(`${header}\na,A,https://amzn.example/dp/B000000000/,,`)).toThrow('amazon');
    expect(() => parseMallLinks(`${header}\na,A,,http://item.rakuten.co.jp/x/y/,`)).toThrow('rakuten');
    expect(() => parseMallLinks(`${header}\na,A,,,\na,A,,,`)).toThrow('重複');
    expect(() => parseMallLinks('id,sku\na,A')).toThrow('ヘッダー');
    expect(parseMallLinks(`${header}\na,A,,,`)[0]).toMatchObject({ amazon: null, rakuten: null, yahoo: null });
  });
});
