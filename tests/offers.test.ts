import { describe, expect, it, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { load } from 'cheerio';
import {
  DISCONTINUED_AFTER_MISSES, displayOffer, nextOffer, observeOffer, offerTargetUrl, parseJsonLdOffer,
  primaryOffer, shopForUrl, sortByAvailability, type Offer,
} from '../src/lib/offers';
import { runOfferCheck } from '../src/lib/offer-check';
import type { OfferDatabase } from '../src/lib/offer-store';
import { isOfferCheckRequest, offerCheckRequest } from '../src/lib/offer-schedule';
import ProductCard from '../src/components/ProductCard.astro';
import type { Stand, Television } from '../src/lib/data';

// サンワダイレクトの商品ページと同じ形（壊れた JSON-LD の後に Product がある）。
const productPage = (availability = 'http://schema.org/InStock', price = '32800') => `<!doctype html><html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
<script type="application/ld+json">{ "@type": "FAQPage", "mainEntity": [ { "text":"改行
を含む壊れたJSON" } ] }</script>
<script type="application/ld+json">{"@context":"http://schema.org/","@type":"Product","name":"stand","image":"https://cdn.sanwadirect.jp/images/goods/CR-LAST1_MX.JPG","mpn":"CR-LAST1","offers":{"@type":"Offer","priceCurrency":"JPY","price":"${price}","availability":"${availability}"}}</script>
</head><body></body></html>`;

const base = { stand_id: 'sanwa-cr-last1', shop: 'sanwa_direct', url: 'https://direct.sanwa.co.jp/ItemPage/CR-LAST1' };
const t0 = new Date('2026-11-22T00:00:00Z');

describe('JSON-LD の販売情報を読む', () => {
  it('Product の価格・在庫・画像・型番を読み取り、壊れた JSON-LD は飛ばす', () => {
    expect(parseJsonLdOffer(productPage())).toEqual({
      price_jpy: 32800, availability: 'in_stock', image_url: 'https://cdn.sanwadirect.jp/images/goods/CR-LAST1_MX.JPG', mpn: 'CR-LAST1',
    });
  });

  it('在庫状態を区分に変換する', () => {
    expect(parseJsonLdOffer(productPage('https://schema.org/OutOfStock'))?.availability).toBe('out_of_stock');
    expect(parseJsonLdOffer(productPage('PreOrder'))?.availability).toBe('backorder');
    expect(parseJsonLdOffer(productPage('http://schema.org/Discontinued'))?.availability).toBe('discontinued');
    expect(parseJsonLdOffer(productPage('somethingElse'))?.availability).toBe('unknown');
  });

  it('@graph の中の Product と、カンマ付きの価格も読む', () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":["Product"],"sku":"X-1","image":[{"url":"https://img.example.jp/a.jpg"}],"offers":[{"priceCurrency":"JPY","price":"1,980","availability":"InStock"}]}]}</script>`;
    expect(parseJsonLdOffer(html)).toEqual({ price_jpy: 1980, availability: 'in_stock', image_url: 'https://img.example.jp/a.jpg', mpn: 'X-1' });
  });

  it('円以外・不正な価格・http の画像は採用しない。Product が無ければ null', () => {
    const usd = `<script type="application/ld+json">{"@type":"Product","image":"http://insecure.example/a.jpg","offers":{"priceCurrency":"USD","price":"10"}}</script>`;
    expect(parseJsonLdOffer(usd)).toMatchObject({ price_jpy: null, image_url: null });
    expect(parseJsonLdOffer('<html>no data</html>')).toBeNull();
  });
});

describe('販売店とURL', () => {
  it('アフィリエイトリンクから販売ページのURLを取り出す', () => {
    const vc = `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=1&pid=2&vc_url=${encodeURIComponent(base.url)}`;
    expect(offerTargetUrl(vc)).toBe(base.url);
    expect(offerTargetUrl(base.url)).toBe(base.url);
    expect(shopForUrl(vc)).toBe('sanwa_direct');
    expect(shopForUrl('https://www.amazon.co.jp/dp/B000')).toBeNull();
  });
});

describe('チェック結果から記録を更新する', () => {
  it('見つからない状態が続いたら販売終了にする。一時的なエラーでは変えない', () => {
    let offer = nextOffer(null, base, { kind: 'found', offer: parseJsonLdOffer(productPage())! }, t0);
    expect(offer).toMatchObject({ availability: 'in_stock', price_jpy: 32800, missing_count: 0, last_success_at: t0.toISOString() });
    offer = nextOffer(offer, base, { kind: 'error', detail: 'HTTP 503' }, t0);
    expect(offer).toMatchObject({ availability: 'in_stock', error_count: 1, missing_count: 0 });
    for (let i = 1; i < DISCONTINUED_AFTER_MISSES; i++) {
      offer = nextOffer(offer, base, { kind: 'missing', detail: 'HTTP 404' }, t0);
      expect(offer.availability).toBe('in_stock');
    }
    offer = nextOffer(offer, base, { kind: 'missing', detail: 'HTTP 404' }, t0);
    expect(offer).toMatchObject({ availability: 'discontinued', missing_count: DISCONTINUED_AFTER_MISSES, price_jpy: 32800 });
    offer = nextOffer(offer, base, { kind: 'found', offer: parseJsonLdOffer(productPage())! }, t0);
    expect(offer).toMatchObject({ availability: 'in_stock', missing_count: 0, error_count: 0, last_error: null });
  });

  it('HTTP の結果を分類する', async () => {
    const respond = (body: string, status = 200) => vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
    expect(await observeOffer(base.url, respond(productPage()))).toMatchObject({ kind: 'found' });
    expect(await observeOffer(base.url, respond('', 404))).toEqual({ kind: 'missing', detail: 'HTTP 404' });
    expect(await observeOffer(base.url, respond('<html><title>Access Check</title>top page</html>'))).toEqual({ kind: 'missing', detail: expect.stringMatching(/^no Product data \(HTTP 200, .*title: Access Check\)$/) });
    expect(await observeOffer(base.url, respond('', 503))).toEqual({ kind: 'error', detail: 'HTTP 503' });
    const broken = vi.fn(async () => { throw new TypeError('network'); }) as unknown as typeof fetch;
    expect(await observeOffer(base.url, broken)).toEqual({ kind: 'error', detail: 'TypeError: network' });
  });
});

describe('表示', () => {
  const offer = nextOffer(null, base, { kind: 'found', offer: parseJsonLdOffer(productPage())! }, t0);

  it('新しい価格は確認日時つきで出し、48時間を過ぎたら価格も在庫も出さない', () => {
    expect(displayOffer(offer, new Date('2026-11-22T06:00:00Z'))).toEqual({
      shopName: 'サンワダイレクト', availability: 'in_stock', price_jpy: 32800, priceAt: '11/22 9:00時点', purchasable: true,
    });
    expect(displayOffer(offer, new Date('2026-11-25T00:00:00Z'))).toMatchObject({ availability: 'unknown', price_jpy: null, priceAt: null, purchasable: true });
  });

  it('販売終了は古くても販売終了のまま、購入不可', () => {
    const ended: Offer = { ...offer, availability: 'discontinued' };
    expect(displayOffer(ended, new Date('2027-01-01T00:00:00Z'))).toMatchObject({ availability: 'discontinued', price_jpy: null, purchasable: false });
  });

  it('在庫あり・安い順に代表の販売店を選び、在庫のある商品を先に並べる', () => {
    const cheap: Offer = { ...offer, shop: 'b', price_jpy: 30000, availability: 'out_of_stock' };
    const stocked: Offer = { ...offer, shop: 'c', price_jpy: 35000 };
    expect(primaryOffer([cheap, stocked], t0)?.shop).toBe('c');
    expect(primaryOffer([], t0)).toBeNull();
    const sorted = sortByAvailability(['out', 'in', 'none'], value => ({ out: 'out_of_stock', in: 'in_stock' } as const)[value as 'out' | 'in']);
    expect(sorted).toEqual(['in', 'none', 'out']);
  });
});

/** SQL の形だけを見て動く、テスト用の小さな D1。 */
function memoryDb(initial: Offer[] = []) {
  const rows = new Map(initial.map(row => [`${row.stand_id}:${row.shop}`, row]));
  const columns = ['stand_id', 'shop', 'url', 'price_jpy', 'availability', 'image_url', 'mpn', 'checked_at', 'last_success_at', 'missing_count', 'error_count', 'last_error'] as const;
  const db: OfferDatabase = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...bound: unknown[]) { values = bound; return statement; },
        async run() {
          if (query.startsWith('INSERT')) {
            const row = Object.fromEntries(columns.map((column, index) => [column, values[index]])) as unknown as Offer;
            rows.set(`${row.stand_id}:${row.shop}`, row);
          } else if (query.startsWith('DELETE')) rows.delete(`${values[0]}:${values[1]}`);
          return undefined;
        },
        async all<T>() { return { results: [...rows.values()] as unknown as T[] }; },
      };
      return statement;
    },
  };
  return { db, rows };
}

describe('定期チェック', () => {
  it('対応する販売店だけを1件ずつ確認し、外れたスタンドの記録を消す', async () => {
    const stale: Offer = { ...nextOffer(null, { ...base, stand_id: 'removed-stand' }, { kind: 'error', detail: 'x' }, t0) };
    const { db, rows } = memoryDb([stale]);
    const fetcher = vi.fn(async (url: string) => url.endsWith('CR-LAST1') ? new Response(productPage()) : new Response('', { status: 404 })) as unknown as typeof fetch;
    const sleep = vi.fn(async () => undefined);
    const stands: Pick<Stand, 'id' | 'product_url'>[] = [
      { id: 'sanwa-cr-last1', product_url: base.url },
      { id: 'sanwa-gone', product_url: 'https://direct.sanwa.co.jp/ItemPage/GONE' },
      { id: 'amazon-only', product_url: 'https://www.amazon.co.jp/dp/B000' },
      { id: 'no-link', product_url: null },
    ];
    const result = await runOfferCheck({ db, stands, fetcher, sleep, now: () => t0, isChecked: () => true });
    expect(result).toEqual({ checked: 2, found: 1, missing: 1, errors: 0, removed: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(rows.get('sanwa-cr-last1:sanwa_direct')).toMatchObject({ price_jpy: 32800, availability: 'in_stock' });
    expect(rows.get('sanwa-gone:sanwa_direct')).toMatchObject({ missing_count: 1, availability: 'unknown' });
    expect(rows.has('removed-stand:sanwa_direct')).toBe(false);
  });

  it('1件も商品情報を読めなかった回は、見つからないと数えず一時的なエラーにする', async () => {
    const { db, rows } = memoryDb([]);
    const fetcher = vi.fn(async () => new Response('<html><title>Just a moment</title></html>')) as unknown as typeof fetch;
    const stands = [{ id: 'a', product_url: base.url }, { id: 'b', product_url: 'https://direct.sanwa.co.jp/ItemPage/B' }];
    const result = await runOfferCheck({ db, stands, fetcher, sleep: async () => undefined, now: () => t0, isChecked: () => true });
    expect(result).toMatchObject({ checked: 2, found: 0, missing: 0, errors: 2 });
    expect(rows.get('a:sanwa_direct')).toMatchObject({ missing_count: 0, error_count: 1, last_error: expect.stringContaining('全件で取得できず保留') });
  });

  it('自動チェックを止めている販売店は読みに行かず、残っていた記録を消す', async () => {
    const { db, rows } = memoryDb([nextOffer(null, { ...base, stand_id: 'sanwa-cr-last1' }, { kind: 'error', detail: 'HTTP 403' }, t0)]);
    const fetcher = vi.fn() as unknown as typeof fetch;
    const result = await runOfferCheck({ db, stands: [{ id: 'sanwa-cr-last1', product_url: base.url }], fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, found: 0, missing: 0, errors: 0, removed: 1 });
    expect(rows.size).toBe(0);
  });

  it('スタンドが読めなかったときは記録を消さない', async () => {
    const { db, rows } = memoryDb([nextOffer(null, base, { kind: 'error', detail: 'x' }, t0)]);
    await runOfferCheck({ db, stands: [], fetcher: vi.fn() as unknown as typeof fetch });
    expect(rows.size).toBe(1);
  });

  it('内部の経路は外部から届かない', () => {
    expect(isOfferCheckRequest(new Request('https://tv-fit.com/internal/offer-check'))).toBe(true);
    expect(isOfferCheckRequest(new Request('https://tv-fit.com/internal/offer-check/'))).toBe(true);
    expect(isOfferCheckRequest(new Request('https://tv-fit.com/sony/'))).toBe(false);
    expect(offerCheckRequest({ EMDASH_SITE_URL: 'https://tv-fit.com' }).url).toBe('https://tv-fit.com/internal/offer-check');
  });
});

describe('商品カード', () => {
  const television: Television = { id: 'tv', manufacturer: 'SONY', model: 'KJ-1', screen_inches: 50, weight_kg: 12, vesa_width_mm: 300, vesa_height_mm: 300, source_url: null, release_date: null };
  const stand: Stand = { id: base.stand_id, manufacturer: 'サンワサプライ', sku: 'CR-LAST1', stand_type: 'floor', max_weight_kg: 30, vesa_patterns: [{ width: 300, height: 300 }], source_url: 'https://www.sanwa.co.jp/product/syohin?code=CR-LAST1', product_url: base.url };
  const now = new Date();
  const fresh = nextOffer(null, base, { kind: 'found', offer: parseJsonLdOffer(productPage())! }, now);

  it('価格・在庫・確認日時を表示する', async () => {
    const container = await AstroContainer.create();
    const $ = load(await container.renderToString(ProductCard, { props: { television, stand, compatibility: null, offer: fresh } }));
    expect($('.offer-availability').text()).toBe('在庫あり');
    expect($('.offer-price').text()).toContain('¥32,800');
    expect($('.offer-meta').first().text()).toContain('サンワダイレクト');
    expect($('[data-affiliate-link]').length).toBe(1);
  });

  it('販売終了なら購入ボタンを出さない。販売情報が無ければ従来どおり', async () => {
    const container = await AstroContainer.create();
    const ended = load(await container.renderToString(ProductCard, { props: { television, stand, compatibility: null, offer: { ...fresh, availability: 'discontinued' } } }));
    expect(ended('.offer-availability').text()).toBe('販売終了');
    expect(ended('[data-affiliate-link]').length).toBe(0);
    const none = load(await container.renderToString(ProductCard, { props: { television, stand, compatibility: null } }));
    expect(none('.offer-info').length).toBe(0);
    expect(none('[data-affiliate-link]').length).toBe(1);
  });
});
