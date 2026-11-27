import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadCatalog } from '../src/lib/csv';
import type { Offer } from '../src/lib/offers';
import { breadcrumbNode, offerNode, pageGraph, shownOffers, standProductNode, standListNode, televisionNode } from '../src/lib/structured-data';

const site = 'https://tvstand.jp';
const fixtures = loadCatalog(resolve('fixtures/catalog'), { allowFixtures: true });
const stand = { ...fixtures.stands[0]!, manufacturer: 'サンワサプライ', sku: '100-TEST1', product_url: 'https://direct.sanwa.co.jp/ItemPage/100-TEST1' };
const now = new Date('2026-11-27T12:00:00Z');
const offer = (overrides: Partial<Offer> = {}): Offer => ({
  stand_id: stand.id, shop: 'sanwa_direct', url: 'https://direct.sanwa.co.jp/ItemPage/100-TEST1', price_jpy: 12800, availability: 'in_stock',
  image_url: 'https://cdn.example.jp/a.jpg', mpn: null, checked_at: '2026-11-27T06:00:00Z', last_success_at: '2026-11-27T06:00:00Z',
  missing_count: 0, error_count: 0, last_error: null, affiliate_url: null, pv_img_url: null, description: '高さ調整できるスタンド', ...overrides,
});

describe('breadcrumbs', () => {
  it('starts with home, numbers positions from 1 and ends at the canonical page URL', () => {
    const node = breadcrumbNode([{ name: 'SONY', path: '/sony/' }, { name: 'SONY TEST-55' }], `${site}/sony/test-55/`, site);
    expect(node).toEqual({
      '@type': 'BreadcrumbList', '@id': `${site}/sony/test-55/#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'ホーム', item: `${site}/` },
        { '@type': 'ListItem', position: 2, name: 'SONY', item: `${site}/sony/` },
        { '@type': 'ListItem', position: 3, name: 'SONY TEST-55', item: `${site}/sony/test-55/` },
      ],
    });
  });
});

describe('page graph', () => {
  it('links the website, page, breadcrumb and main entity by stable @id', () => {
    const url = `${site}/sony/test-55/`;
    const tv = televisionNode({ ...fixtures.televisions[0]!, manufacturer: 'SONY', model: 'TEST-55' }, url, null);
    const graph = pageGraph({ url, name: 't', description: 'd', type: 'ItemPage', crumbs: [{ name: 'x' }], mainEntity: tv, siteUrl: site }) as { '@graph': Record<string, unknown>[] };
    const page = graph['@graph'].find(node => node['@type'] === 'ItemPage')!;
    expect(page).toMatchObject({ '@id': `${url}#webpage`, isPartOf: { '@id': `${site}/#website` }, breadcrumb: { '@id': `${url}#breadcrumb` }, mainEntity: { '@id': `${url}#television` } });
    const ids = graph['@graph'].map(node => node['@id']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(JSON.parse(JSON.stringify(graph))).toEqual(graph);
  });

  it('describes the television without a price and without guessed values', () => {
    const tv = televisionNode({ ...fixtures.televisions[0]!, manufacturer: 'SONY', model: 'TEST-55', screen_inches: 55, weight_kg: null, release_date: '2025-06-下旬' }, `${site}/x/`, null);
    expect(tv).not.toHaveProperty('offers');
    expect(tv).not.toHaveProperty('image');
    expect(tv).not.toHaveProperty('releaseDate');
    expect(JSON.stringify(tv)).not.toContain('重量');
    expect(tv).toMatchObject({ '@type': 'Product', name: 'SONY TEST-55', model: 'TEST-55', brand: { '@type': 'Brand', name: 'SONY' } });
  });
});

describe('product offers', () => {
  it('writes the displayed tax-included price, currency, stock and seller page', () => {
    const [shown] = shownOffers(offer(), [offer()], now);
    expect(offerNode(shown!)).toEqual({
      '@type': 'Offer', url: 'https://direct.sanwa.co.jp/ItemPage/100-TEST1', seller: { '@type': 'Organization', name: 'サンワダイレクト' },
      price: 12800, priceCurrency: 'JPY',
      priceSpecification: { '@type': 'PriceSpecification', price: 12800, priceCurrency: 'JPY', valueAddedTaxIncluded: true },
      availability: 'https://schema.org/InStock',
    });
  });

  it('never fills in an unknown price or stock', () => {
    // 48時間より古い価格は画面に出さないので、構造化データにも出さない。
    const stale = offer({ last_success_at: '2026-11-20T00:00:00Z' });
    const [shown] = shownOffers(stale, [stale], now);
    expect(shown).toMatchObject({ price_jpy: null, availability: 'unknown' });
    expect(offerNode(shown!)).toBeNull();
    const noPrice = offer({ price_jpy: null, availability: 'out_of_stock' });
    expect(offerNode(shownOffers(noPrice, [noPrice], now)[0]!)).toEqual({
      '@type': 'Offer', url: noPrice.url, seller: { '@type': 'Organization', name: 'サンワダイレクト' }, availability: 'https://schema.org/OutOfStock',
    });
  });

  it('keeps a separate offer for each shop shown on the card', () => {
    const yahoo = offer({ shop: 'yahoo_sanwa', url: 'https://store.shopping.yahoo.co.jp/sanwadirect/100-test1.html', price_jpy: 13200, availability: 'backorder' });
    const product = standProductNode({ stand, offer: offer(), offers: [offer(), yahoo] }, `${site}/sony/test-55/`, now) as { offers: Record<string, unknown>[] };
    expect(product.offers.map(item => [item.price, item.availability, (item.seller as { name: string }).name])).toEqual([
      [12800, 'https://schema.org/InStock', 'サンワダイレクト'],
      [13200, 'https://schema.org/BackOrder', 'Yahoo!ショッピング'],
    ]);
    expect(product).toMatchObject({ name: 'サンワサプライ 100-TEST1', sku: '100-TEST1', brand: { name: 'サンワサプライ' }, image: 'https://cdn.example.jp/a.jpg', description: '高さ調整できるスタンド' });
  });

  it('omits offers entirely when the card shows no sale information', () => {
    const product = standProductNode({ stand, offer: null, offers: [] }, `${site}/x/`, now);
    expect(product).not.toHaveProperty('offers');
    expect(product).not.toHaveProperty('image');
  });

  it('numbers list items in the given display order', () => {
    const list = standListNode('stands', '一覧', [{ stand, offer: null, offers: [] }, { stand: { ...stand, id: 'other', sku: '100-TEST2' }, offer: null, offers: [] }], `${site}/x/`, now) as { itemListElement: { position: number; item: { sku: string } }[] };
    expect(list.itemListElement.map(item => [item.position, item.item.sku])).toEqual([[1, '100-TEST1'], [2, '100-TEST2']]);
  });
});
