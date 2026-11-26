import { describe, expect, it, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { load } from 'cheerio';
import { isAutoCheckedShop, nextOffer, type Offer } from '../src/lib/offers';
import { matchYahooHit, observeYahooShopping, vcAffiliate, yahooHitOffer, yahooItemUrl, YAHOO_SEARCH_URL, type YahooHit } from '../src/lib/yahoo-shopping';
import { runOfferCheck } from '../src/lib/offer-check';
import type { OfferDatabase } from '../src/lib/offer-store';
import ProductCard from '../src/components/ProductCard.astro';
import type { Stand, Television } from '../src/lib/data';

const itemUrl = 'https://store.shopping.yahoo.co.jp/sanwadirect/cr-last1.html';
// 公式リファレンスの項目名どおりの、商品検索API（v3）の1件。
const hit = (overrides: Partial<YahooHit> = {}): YahooHit => ({
  code: 'sanwadirect_cr-last1',
  url: itemUrl,
  price: 12800,
  inStock: true,
  image: { small: 'https://item-shopping.c.yimg.jp/i/c/sanwadirect_cr-last1', medium: 'https://item-shopping.c.yimg.jp/i/g/sanwadirect_cr-last1' },
  exImage: { url: 'https://item-shopping.c.yimg.jp/i/n/sanwadirect_cr-last1' },
  seller: { sellerId: 'sanwadirect' },
  ...overrides,
});
const json = (body: unknown, status = 200) => vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('Yahoo!ショッピング商品検索API', () => {
  it('公式ストアの商品ページURLは型番の小文字', () => {
    expect(yahooItemUrl('CR-LAST37BK')).toBe('https://store.shopping.yahoo.co.jp/sanwadirect/cr-last37bk.html');
  });

  it('バリューコマースのリンクと計測タグは sid・pid が数字のときだけ作る', () => {
    expect(vcAffiliate(itemUrl, '123', '456')).toEqual({
      affiliate_url: `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=123&pid=456&vc_url=${encodeURIComponent(itemUrl)}`,
      pv_img_url: 'https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?sid=123&pid=456',
    });
    expect(vcAffiliate(itemUrl, '123', null)).toBeNull();
    expect(vcAffiliate(itemUrl, '123', '45&x=1')).toBeNull();
  });

  it('公式ストアの同じ型番だけを選ぶ（似た型番・他のストアは使わない）', () => {
    const similar = hit({ code: 'sanwadirect_cr-last10' });
    const otherStore = hit({ code: 'otherstore_cr-last1', seller: { sellerId: 'otherstore' } });
    const exact = hit();
    expect(matchYahooHit([similar, otherStore, exact], 'CR-LAST1')).toBe(exact);
    expect(matchYahooHit([similar, otherStore], 'CR-LAST1')).toBeNull();
  });

  it('価格・在庫・画像・アフィリエイトリンクを取り出す', () => {
    expect(yahooHitOffer(hit(), { vcSid: '1', vcPid: '2' })).toMatchObject({
      price_jpy: 12800, availability: 'in_stock', mpn: 'CR-LAST1',
      image_url: 'https://item-shopping.c.yimg.jp/i/n/sanwadirect_cr-last1',
      affiliate_url: expect.stringContaining('https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=1&pid=2&vc_url='),
      pv_img_url: 'https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?sid=1&pid=2',
    });
    expect(yahooHitOffer(hit({ inStock: false })).availability).toBe('out_of_stock');
    expect(yahooHitOffer(hit())).toMatchObject({ affiliate_url: null, pv_img_url: null });
    // 別ホストの商品URLはリンクに使わない
    expect(yahooHitOffer(hit({ url: 'https://evil.example/x' }), { vcSid: '1', vcPid: '2' })).toMatchObject({ affiliate_url: null, pv_img_url: null });
  });

  it('公式ストアに絞って型番で検索し、見つからない・失敗は一時的なエラー', async () => {
    const found = json({ hits: [hit()] });
    expect(await observeYahooShopping('CR-LAST1', { appId: 'APP' }, found)).toMatchObject({ kind: 'found', offer: { price_jpy: 12800 } });
    const requested = new URL(found.mock.calls[0]![0] as string);
    expect(`${requested.origin}${requested.pathname}`).toBe(YAHOO_SEARCH_URL);
    expect(Object.fromEntries(requested.searchParams)).toMatchObject({ appid: 'APP', query: 'CR-LAST1', seller_id: 'sanwadirect' });
    expect(await observeYahooShopping('CR-LAST1', { appId: 'APP' }, json({ hits: [] }))).toEqual({ kind: 'error', detail: 'Yahoo API: 公式ストアに該当商品なし（検索結果 0件）' });
    expect(await observeYahooShopping('CR-LAST1', { appId: 'APP' }, json({}, 403))).toEqual({ kind: 'error', detail: 'Yahoo API HTTP 403' });
  });

  it('アプリケーションIDがあるときだけ確認する', () => {
    expect(isAutoCheckedShop('yahoo_sanwa')).toBe(false);
    expect(isAutoCheckedShop('yahoo_sanwa', { yahooAppId: 'APP' })).toBe(true);
  });

  it('定期チェックは直販サイトの商品について公式ストアも確認する', async () => {
    const saved: unknown[][] = [];
    const db: OfferDatabase = {
      prepare(query: string) {
        const statement = {
          bind(...values: unknown[]) { if (query.startsWith('INSERT')) saved.push(values); return statement; },
          async run() { return undefined; },
          async all<T>() { return { results: [] as T[] }; },
        };
        return statement;
      },
    };
    const fetcher = json({ hits: [hit()] });
    const stands = [{ id: 'sanwa-cr-last1', sku: 'CR-LAST1', product_url: 'https://direct.sanwa.co.jp/ItemPage/CR-LAST1' }];
    // VC のトークンは無し → 直販サイトは確認せず、Yahoo!ショッピングだけ確認する
    const result = await runOfferCheck({ db, stands, yahoo: { appId: 'APP', vcSid: '1', vcPid: '2' }, fetcher, sleep: async () => {} });
    expect(result).toMatchObject({ checked: 1, found: 1 });
    expect(String(fetcher.mock.calls[0]![0])).toContain('shopping.yahooapis.jp');
    expect(saved[0]!.slice(0, 3)).toEqual(['sanwa-cr-last1', 'yahoo_sanwa', itemUrl]);
    // アプリケーションIDが無ければ確認しない
    const none = await runOfferCheck({ db, stands, fetcher, sleep: async () => {} });
    expect(none.checked).toBe(0);
  });
});

describe('商品カード（モールのボタン）', () => {
  const television: Television = { id: 'tv', manufacturer: 'SONY', model: 'KJ-1', screen_inches: 50, weight_kg: 12, vesa_width_mm: 300, vesa_height_mm: 300, source_url: null, release_date: null };
  const stand: Stand = { id: 'sanwa-cr-last1', manufacturer: 'サンワサプライ', sku: 'CR-LAST1', stand_type: 'floor', max_weight_kg: 30, vesa_patterns: [{ width: 300, height: 300 }], source_url: 'https://www.sanwa.co.jp/product/syohin?code=CR-LAST1', product_url: 'https://direct.sanwa.co.jp/ItemPage/CR-LAST1' };
  const yahooOffer: Offer = nextOffer(null, { stand_id: stand.id, shop: 'yahoo_sanwa', url: itemUrl }, { kind: 'found', offer: yahooHitOffer(hit(), { vcSid: '1', vcPid: '2' }) }, new Date());
  const render = async (props: Record<string, unknown>) => load(await (await AstroContainer.create()).renderToString(ProductCard, { props: { television, stand, compatibility: null, ...props } }));

  it('商品ページが未登録なら、Amazon・楽天・Yahoo!は型番の検索結果へリンクし、PRは付けない', async () => {
    const $ = await render({ stand: { ...stand, id: 'not-registered' } });
    expect($('[data-mall-link]').map((_, a) => $(a).attr('data-mall-link')).get()).toEqual(['amazon', 'rakuten', 'yahoo']);
    const q = encodeURIComponent('サンワサプライ CR-LAST1');
    expect($('[data-mall-link="amazon"]').attr('href')).toBe(`https://www.amazon.co.jp/s?k=${q}`);
    expect($('[data-mall-link="rakuten"]').attr('href')).toBe(`https://search.rakuten.co.jp/search/mall/${q}/`);
    expect($('[data-mall-link="yahoo"]').attr('href')).toBe(`https://shopping.yahoo.co.jp/search?p=${q}`);
    expect($('[data-mall-link="amazon"]').attr('rel')).not.toContain('sponsored');
    expect($('.pr-label').length).toBe(0);
    expect($('[data-affiliate-link]').attr('href')).toBe(stand.product_url);
  });

  it('登録済みの商品ページへリンクする（PRなし）', async () => {
    const $ = await render({});
    expect($('[data-mall-link="amazon"]').attr('href')).toBe('https://www.amazon.co.jp/dp/B0013Z58I0/');
    expect($('[data-mall-link="rakuten"]').attr('href')).toBe('https://item.rakuten.co.jp/sanwadirect/cr-last1/');
    expect($('[data-mall-link="yahoo"]').attr('href')).toBe(itemUrl);
    expect($('.mall-button small').length).toBe(0);
    expect($('.pr-label').length).toBe(0);
  });

  it('公式ストアの商品が取れていれば、Yahoo!はアフィリエイトリンク・PR・計測タグ・価格を出す', async () => {
    const $ = await render({ offer: yahooOffer, offers: [yahooOffer] });
    const yahoo = $('[data-mall-link="yahoo"]');
    expect(yahoo.attr('href')).toMatch(/^https:\/\/ck\.jp\.ap\.valuecommerce\.com\/servlet\/referral\?sid=1&pid=2&vc_url=/);
    expect(yahoo.attr('rel')).toContain('sponsored');
    expect(yahoo.text()).toContain('¥12,800');
    expect(yahoo.text()).toContain('在庫あり');
    // 「PR」はモールのボタンの下ではなく、直販サイトのボタンの右に1つだけ出す
    expect($('.mall-links .pr-label').length).toBe(0);
    expect($('.pr-label').length).toBe(1);
    expect($('.mall-item img.ad-pixel').attr('src')).toBe('https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?sid=1&pid=2');
    // 直販サイトのボタンは、Yahoo!のアフィリエイトリンクを使わない
    expect($('[data-affiliate-link]').attr('href')).toBe(stand.product_url);
    expect($('.purchase-row .pr-label').length).toBe(1);
    expect($('[data-mall-link="yahoo"]').text()).toContain('Yahoo!');
    expect($('[data-mall-link="yahoo"]').text()).not.toContain('ショッピング');
  });

  it('直販サイトのボタンが出ないときは、モールのボタンの下に「PR」を出す', async () => {
    const $ = await render({ offer: yahooOffer, offers: [yahooOffer], stand: { ...stand, product_url: null } });
    expect($('.purchase-row').length).toBe(0);
    expect($('.mall-links .pr-label').length).toBe(1);
  });

  it('商品画像は直販サイトの商品フィードを優先し、無ければ Yahoo!の画像', async () => {
    const directOffer: Offer = nextOffer(null, { stand_id: stand.id, shop: 'sanwa_direct', url: stand.product_url! }, { kind: 'found', offer: { price_jpy: 13800, availability: 'out_of_stock', image_url: 'https://img.example.jp/sanwa/CR-LAST1.jpg', mpn: 'CR-LAST1' } }, new Date());
    // 代表（在庫あり・安い）は Yahoo!でも、画像は直販サイトのもの
    const both = await render({ offer: yahooOffer, offers: [directOffer, yahooOffer] });
    expect(both('.product-image img').attr('src')).toBe('https://img.example.jp/sanwa/CR-LAST1.jpg');
    const yahooOnly = await render({ offer: yahooOffer, offers: [{ ...directOffer, image_url: null }, yahooOffer] });
    expect(yahooOnly('.product-image img').attr('src')).toBe('https://item-shopping.c.yimg.jp/i/n/sanwadirect_cr-last1');
  });

  it('非対応の組み合わせにはモールのボタンも出さない', async () => {
    const $ = await render({ compatibility: { television_id: 'tv', stand_id: stand.id, status: 'incompatible', evidence_type: 'specification', evidence_url: 'https://example.org/', checked_at: '2026-11-25', notes: 'x' } });
    expect($('[data-mall-link]').length).toBe(0);
  });
});
