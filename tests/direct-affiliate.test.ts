import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { load } from 'cheerio';
import ProductCard from '../src/components/ProductCard.astro';
import { directAffiliateIds, directMyLink } from '../src/lib/direct-affiliate';
import type { Stand, Television } from '../src/lib/data';
import type { Offer } from '../src/lib/offers';

const ids = { sid: '3789293', pid: '892758843' };
const productUrl = 'https://direct.sanwa.co.jp/ItemPage/CR-LAST1';

describe('直販サイトの MyLink 形式のアフィリエイトリンク', () => {
  it('サンワダイレクトの商品ページだけを、MyLink と同じ形で包む', () => {
    expect(directMyLink(productUrl, ids)).toEqual({
      affiliate_url: 'https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=3789293&pid=892758843&vc_url=https%3A%2F%2Fdirect.sanwa.co.jp%2FItemPage%2FCR-LAST1',
      pv_img_url: 'https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?sid=3789293&pid=892758843',
    });
    expect(directMyLink('https://example.com/item', ids)).toBeNull();
    expect(directMyLink(productUrl, null)).toBeNull();
    expect(directMyLink(productUrl, { sid: '3789293', pid: 'abc' })).toBeNull();
  });

  it('sid は SANWA_VC_SID、無ければ YAHOO_VC_SID。pid が無ければ使わない', () => {
    expect(directAffiliateIds({ YAHOO_VC_SID: '1', SANWA_VC_PID: '2' })).toEqual({ sid: '1', pid: '2' });
    expect(directAffiliateIds({ SANWA_VC_SID: '3', YAHOO_VC_SID: '1', SANWA_VC_PID: '2' })).toEqual({ sid: '3', pid: '2' });
    expect(directAffiliateIds({ YAHOO_VC_SID: '1' })).toBeNull();
  });

  const television: Television = { id: 'tv', manufacturer: 'SONY', model: 'KJ-1', screen_inches: 50, weight_kg: 12, vesa_width_mm: 300, vesa_height_mm: 300, source_url: null, release_date: null };
  const stand: Stand = { id: 'sanwa-cr-last1', manufacturer: 'サンワサプライ', sku: 'CR-LAST1', stand_type: 'floor', max_weight_kg: 30, vesa_patterns: [{ width: 300, height: 300 }], source_url: 'https://www.sanwa.co.jp/product/syohin?code=CR-LAST1', product_url: productUrl };

  it('商品APIで取れていなくても、直販ボタンをアフィリエイトリンクにして PR と計測タグを出す', async () => {
    const container = await AstroContainer.create();
    const $ = load(await container.renderToString(ProductCard, { props: { television, stand, compatibility: null, directIds: ids } }));
    expect($('[data-affiliate-link]').attr('href')).toBe(directMyLink(productUrl, ids)!.affiliate_url);
    expect($('.purchase-row .pr-label').length).toBe(1);
    expect($('.purchase-row .ad-pixel').attr('src')).toBe(directMyLink(productUrl, ids)!.pv_img_url);
    const plain = load(await container.renderToString(ProductCard, { props: { television, stand, compatibility: null } }));
    expect(plain('[data-affiliate-link]').attr('href')).toBe(productUrl);
    expect(plain('.purchase-row .pr-label').length).toBe(0);
  });

  it('商品APIのアフィリエイトリンクがあればそちらを優先する', async () => {
    const at = new Date().toISOString();
    const offer: Offer = { stand_id: stand.id, shop: 'sanwa_direct', url: productUrl, price_jpy: 5000, availability: 'in_stock', image_url: null, mpn: null, checked_at: at, last_success_at: at, missing_count: 0, error_count: 0, last_error: null, affiliate_url: 'https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=1&pid=9&vc_url=x', pv_img_url: 'https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?sid=1&pid=9' };
    const container = await AstroContainer.create();
    const $ = load(await container.renderToString(ProductCard, { props: { television, stand, compatibility: null, offer, offers: [offer], directIds: ids } }));
    expect($('[data-affiliate-link]').attr('href')).toBe(offer.affiliate_url);
  });
});
