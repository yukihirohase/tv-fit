import { describe, expect, it, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { load } from 'cheerio';
import { displayOffer, isAutoCheckedShop, nextOffer, type Offer } from '../src/lib/offers';
import { matchVcItem, observeValueCommerce, vcItemOffer, VC_SEARCH_URL, type VcItem } from '../src/lib/valuecommerce';
import { runOfferCheck } from '../src/lib/offer-check';
import type { OfferDatabase } from '../src/lib/offer-store';
import ProductCard from '../src/components/ProductCard.astro';
import type { Stand, Television } from '../src/lib/data';

const pageUrl = 'https://direct.sanwa.co.jp/ItemPage/CR-LAST1';
// 公式リファレンスの項目名どおりの、商品API（format=json）の1件。
const item = (overrides: Partial<VcItem> = {}): VcItem => ({
  link: `http://ck.jp.ap.valuecommerce.com/servlet/referral?vs=111&vp=222&va=333&vc_url=${encodeURIComponent(pageUrl)}`,
  guid: pageUrl,
  pvImg: '<img src="http://ad.jp.ap.valuecommerce.com/servlet/gifbanner?vs=111&amp;vp=222" height="1" width="1" Border="0">',
  modelCode: 'CR-LAST1',
  productCode: '100-CR-LAST1',
  price: 32800,
  stock: '在庫有り',
  imageFree: { url: 'http://img.example.jp/free/CR-LAST1.jpg' },
  imageLarge: { url: 'http://img.example.jp/large/CR-LAST1.jpg' },
  ...overrides,
});
const json = (body: unknown, status = 200) => vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('バリューコマース商品API', () => {
  it('価格・在庫・画像・リンク・計測タグを https で取り出す', () => {
    expect(vcItemOffer(item())).toEqual({
      price_jpy: 32800,
      availability: 'in_stock',
      image_url: 'https://img.example.jp/free/CR-LAST1.jpg',
      mpn: 'CR-LAST1',
      affiliate_url: `https://ck.jp.ap.valuecommerce.com/servlet/referral?vs=111&vp=222&va=333&vc_url=${encodeURIComponent(pageUrl)}`,
      pv_img_url: 'https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?vs=111&vp=222',
      description: null,
    });
  });

  it('商品APIが返すスキーム省略（//）のリンクと計測タグも https にする', () => {
    // 2026-11-26 に実際の商品API（サンワダイレクト CR-LAST1）が返した形。
    const real = item({
      link: '//ck.jp.ap.valuecommerce.com/servlet/referral?vs=3789293&vp=892757190&va=2765078&vc_url=https%3A%2F%2Fdirect.sanwa.co.jp%2FItemPage%2FCR-LAST1',
      pvImg: '<img src="//ad.jp.ap.valuecommerce.com/servlet/gifbanner?vs=3789293&vp=892757190" height="1" width="1" border="0">',
      imageFree: { url: '' },
      imageLarge: { url: 'https://direct.sanwa.co.jp/images/goods/CR-LAST1_MA.JPG' },
    });
    expect(vcItemOffer(real)).toMatchObject({
      affiliate_url: 'https://ck.jp.ap.valuecommerce.com/servlet/referral?vs=3789293&vp=892757190&va=2765078&vc_url=https%3A%2F%2Fdirect.sanwa.co.jp%2FItemPage%2FCR-LAST1',
      pv_img_url: 'https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?vs=3789293&vp=892757190',
      image_url: 'https://direct.sanwa.co.jp/images/goods/CR-LAST1_MA.JPG',
    });
  });

  it('商品説明の引用符と文字化け（〜→?）を直し、【WEB限定商品】を外す', () => {
    expect(vcItemOffer(item({ description: '"液晶モニタを取り付ける移動に便利なキャスター付きスタンド。高さ110?170cm可変。"' })).description)
      .toBe('液晶モニタを取り付ける移動に便利なキャスター付きスタンド。高さ110〜170cm可変。');
    // 2026-11-27 に本番の商品説明で見つかった、単位を挟む形。
    expect(vcItemOffer(item({ description: '"52型?86型程度まで対応。本当?ではない"' })).description)
      .toBe('52型〜86型程度まで対応。本当?ではない');
    expect(vcItemOffer(item({ description: '"最大65インチ対応。【WEB限定商品】【WEB限定商品】"' })).description).toBe('最大65インチ対応。');
    expect(vcItemOffer(item({ description: '""' })).description).toBeNull();
    expect(vcItemOffer(item()).description).toBeNull();
  });

  it('在庫の表記を区分に変換し、他ホストのリンクは使わない', () => {
    expect(vcItemOffer(item({ stock: 'お取り寄せ' })).availability).toBe('backorder');
    expect(vcItemOffer(item({ stock: 'なし' })).availability).toBe('out_of_stock');
    expect(vcItemOffer(item({ stock: '' })).availability).toBe('unknown');
    expect(vcItemOffer(item({ link: 'https://evil.example/r', pvImg: '' }))).toMatchObject({ affiliate_url: null, pv_img_url: null });
    expect(vcItemOffer(item({ price: '0' })).price_jpy).toBeNull();
  });

  it('販売ページURLが一致する商品を優先し、なければ同じ販売サイトの同じ型番を選ぶ', () => {
    const other = item({ guid: 'https://direct.sanwa.co.jp/ItemPage/CR-LAST10', link: '', modelCode: 'CR-LAST10' });
    const exact = item();
    expect(matchVcItem([other, exact], `${pageUrl}/`, 'CR-LAST1')).toBe(exact);
    const byCode = item({ guid: 'https://direct.sanwa.co.jp/ItemPage/100-XYZ?x=1', link: '' });
    expect(matchVcItem([other, byCode], pageUrl, 'cr-last1')).toBe(byCode);
    const elsewhere = item({ guid: 'https://store.example/CR-LAST1', link: '' });
    expect(matchVcItem([other, elsewhere], pageUrl, 'CR-LAST1')).toBeNull();
  });

  it('型番で検索し、結果を分類する。見つからない・トークン誤りは一時的なエラー', async () => {
    const found = json({ status: 'OK', items: [item()] });
    expect(await observeValueCommerce(pageUrl, 'CR-LAST1', 'TOKEN', found)).toMatchObject({ kind: 'found', offer: { price_jpy: 32800 } });
    const requested = new URL(found.mock.calls[0]![0] as string);
    expect(`${requested.origin}${requested.pathname}`).toBe(VC_SEARCH_URL);
    // サンワダイレクトは広告主コード＋商品コードの完全一致で探す（キーワードは商品名・説明文しか見ないため）。
    expect(Object.fromEntries(requested.searchParams)).toMatchObject({ token: 'TOKEN', ecCode: 'j22up', product_id: 'CR-LAST1', format: 'json' });
    expect(requested.searchParams.has('keyword')).toBe(false);
    const other = json({ status: 'OK', items: [] });
    await observeValueCommerce('https://shop.example.jp/item/X-1', 'X-1', 'T', other);
    expect(Object.fromEntries(new URL(other.mock.calls[0]![0] as string).searchParams)).toMatchObject({ keyword: 'X-1' });
    expect(await observeValueCommerce(pageUrl, 'CR-LAST1', 'T', json({ status: 'OK', items: [] }))).toEqual({ kind: 'error', detail: 'VC API: 該当商品なし（検索結果 0件）' });
    expect(await observeValueCommerce(pageUrl, 'CR-LAST1', 'T', json({ status: 'INVALID_TOKEN' }))).toEqual({ kind: 'error', detail: 'VC API status INVALID_TOKEN' });
    expect(await observeValueCommerce(pageUrl, 'CR-LAST1', 'T', json({}, 503))).toEqual({ kind: 'error', detail: 'VC API HTTP 503' });
  });

  it('商品APIの販売店はトークンがあるときだけ確認する', () => {
    expect(isAutoCheckedShop('sanwa_direct')).toBe(false);
    expect(isAutoCheckedShop('sanwa_direct', { vcToken: 'T' })).toBe(true);
    expect(isAutoCheckedShop('unknown', { vcToken: 'T' })).toBe(false);
  });

  it('定期チェックはトークンがあれば商品APIを使い、販売ページは読まない', async () => {
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
    const fetcher = json({ status: 'OK', items: [item()] });
    const result = await runOfferCheck({ db, stands: [{ id: 'sanwa-cr-last1', sku: 'CR-LAST1', product_url: pageUrl }], vcToken: 'TOKEN', fetcher });
    expect(result).toMatchObject({ checked: 1, found: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]![0])).toContain('webservice.valuecommerce.ne.jp');
    // 末尾3列が affiliate_url・pv_img_url・description
    expect(saved[0]!.slice(-3, -1)).toEqual([expect.stringContaining('https://ck.jp.ap.valuecommerce.com/'), expect.stringContaining('https://ad.jp.ap.valuecommerce.com/')]);
  });
});

describe('商品カード（アフィリエイト）', () => {
  const television: Television = { id: 'tv', manufacturer: 'SONY', model: 'KJ-1', screen_inches: 50, weight_kg: 12, vesa_width_mm: 300, vesa_height_mm: 300, source_url: null, release_date: null };
  const stand: Stand = { id: 'sanwa-cr-last1', manufacturer: 'サンワサプライ', sku: 'CR-LAST1', stand_type: 'floor', max_weight_kg: 30, vesa_patterns: [{ width: 300, height: 300 }], source_url: 'https://www.sanwa.co.jp/product/syohin?code=CR-LAST1', product_url: pageUrl };
  const base = { stand_id: stand.id, shop: 'sanwa_direct', url: pageUrl };
  const offer: Offer = nextOffer(null, base, { kind: 'found', offer: vcItemOffer(item()) }, new Date());

  it('アフィリエイトリンク・PR表記・計測タグ・商品画像を出す', async () => {
    const container = await AstroContainer.create();
    const $ = load(await container.renderToString(ProductCard, { props: { television, stand, compatibility: null, offer } }));
    expect($('[data-affiliate-link]').attr('href')).toMatch(/^https:\/\/ck\.jp\.ap\.valuecommerce\.com\//);
    expect($('[data-affiliate-link]').attr('rel')).toContain('sponsored');
    expect($('.pr-label').text()).toBe('PR');
    expect($('img.ad-pixel').attr('src')).toBe('https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?vs=111&vp=222');
    expect($('.product-image img').attr('src')).toBe('https://img.example.jp/free/CR-LAST1.jpg');
    expect($('.offer-price').text()).toContain('¥32,800');
  });

  it('計測タグが無ければアフィリエイトリンクを使わず、PRも出さない', async () => {
    const container = await AstroContainer.create();
    const noPixel = load(await container.renderToString(ProductCard, { props: { television, stand, compatibility: null, offer: { ...offer, pv_img_url: null } } }));
    expect(noPixel('[data-affiliate-link]').attr('href')).toBe(pageUrl);
    expect(noPixel('.pr-label').length).toBe(0);
    expect(noPixel('img.ad-pixel').length).toBe(0);
    expect(displayOffer({ ...offer, pv_img_url: null })?.affiliateUrl).toBeNull();
  });
});
