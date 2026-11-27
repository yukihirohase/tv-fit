import { describe, expect, it, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { load } from 'cheerio';
import { displayTvOffer, nextTvOffer, observeTvOffer, pickTvHit, readTvOffers, TV_OFFER_INTERVAL_MS, TV_OFFER_STALE_MS, updateTvOffers, type TvOffer, type TvOfferDatabase } from '../src/lib/tv-offers';
import { YAHOO_SEARCH_URL } from '../src/lib/yahoo-shopping';
import { YAHOO_TV_CATEGORY_ID } from '../src/lib/tv-ranking';
import TvVisual from '../src/components/TvVisual.astro';
import type { Television } from '../src/lib/data';

const hit = (name: string, overrides: Record<string, unknown> = {}) => ({
  name, url: 'https://store.shopping.yahoo.co.jp/shop/item-1.html', price: 198000, inStock: true,
  exImage: { url: 'https://item-shopping.c.yimg.jp/i/n/shop_item-1' }, ...overrides,
});
const json = (body: unknown, status = 200) => vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('テレビ本体の商品の選び方', () => {
  it('商品名に型番がそのまま含まれる本体だけを選び、在庫ありを優先する', () => {
    const hits = [
      hit('パナソニック TV-65W90BX 65V型', { url: 'https://store.shopping.yahoo.co.jp/a/x.html' }), // 別型番
      hit('【中古】Panasonic TV-65W90B', { url: 'https://store.shopping.yahoo.co.jp/a/used.html' }),
      hit('TV-65W90B 対応 壁掛け金具', { url: 'https://store.shopping.yahoo.co.jp/a/mount.html' }),
      hit('TV-65W90B 純正リモコン 部品のみ', { url: 'https://store.shopping.yahoo.co.jp/a/part.html', price: 3000 }),
      hit('Panasonic TV-65W90B 65V型 4K液晶', { url: 'https://store.shopping.yahoo.co.jp/a/out.html', inStock: false }),
      hit('パナソニック ＴＶ－６５Ｗ９０Ｂ 65V型', { url: 'https://store.shopping.yahoo.co.jp/a/ok.html' }),
    ];
    expect(pickTvHit(hits, 'TV-65W90B')).toEqual({ item_url: 'https://store.shopping.yahoo.co.jp/a/ok.html', image_url: 'https://item-shopping.c.yimg.jp/i/n/shop_item-1' });
  });

  it('Yahoo!ショッピング以外の URL・画像の無い商品は使わない', () => {
    expect(pickTvHit([hit('TV-65W90B', { url: 'https://example.com/x' })], 'TV-65W90B')).toBeNull();
    expect(pickTvHit([hit('TV-65W90B', { exImage: undefined })], 'TV-65W90B')).toBeNull();
    expect(pickTvHit([hit('TV-65W90B', { exImage: undefined, image: { medium: 'https://item-shopping.c.yimg.jp/i/g/m' } })], 'TV-65W90B')?.image_url).toBe('https://item-shopping.c.yimg.jp/i/g/m');
  });

  it('テレビのカテゴリで新品を型番検索する', async () => {
    const fetcher = json({ hits: [hit('Panasonic TV-65W90B')] });
    expect((await observeTvOffer('TV-65W90B', 'APP', fetcher)).kind).toBe('found');
    const url = new URL(fetcher.mock.calls[0]![0] as string);
    expect(`${url.origin}${url.pathname}`).toBe(YAHOO_SEARCH_URL);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ appid: 'APP', query: 'TV-65W90B', genre_category_id: YAHOO_TV_CATEGORY_ID, condition: 'new' });
    expect(await observeTvOffer('TV-65W90B', 'APP', json({ hits: [] }))).toMatchObject({ kind: 'missing' });
    expect(await observeTvOffer('TV-65W90B', 'APP', json({ Error: { Message: 'limit' } }, 403))).toEqual({ kind: 'error', detail: 'Yahoo API HTTP 403 limit' });
  });
});

describe('記録の更新', () => {
  const at = new Date('2026-11-27T00:00:00Z');
  const found = { kind: 'found' as const, item_url: 'https://store.shopping.yahoo.co.jp/a/ok.html', image_url: 'https://item-shopping.c.yimg.jp/i/n/a' };

  it('sid / pid があればバリューコマースのリンクにし、無ければ商品ページへ直接', () => {
    const ad = nextTvOffer(null, 'tv', found, at, { vcSid: '123', vcPid: '456' });
    expect(ad.affiliate_url).toContain('sid=123&pid=456&vc_url=https%3A%2F%2Fstore.shopping.yahoo.co.jp');
    expect(ad.pv_img_url).toContain('gifbanner?sid=123&pid=456');
    expect(nextTvOffer(null, 'tv', found, at, {}).affiliate_url).toBeNull();
  });

  it('一時的なエラーでは前回の画像を残し、見つからなければ消す', () => {
    const previous = nextTvOffer(null, 'tv', found, at, {});
    const later = new Date(at.getTime() + 1000);
    expect(nextTvOffer(previous, 'tv', { kind: 'error', detail: 'x' }, later, {})).toMatchObject({ image_url: found.image_url, last_success_at: at.toISOString(), last_error: 'x' });
    expect(nextTvOffer(previous, 'tv', { kind: 'missing', detail: 'y' }, later, {})).toMatchObject({ image_url: null, item_url: null, last_error: 'y' });
  });

  it('最後に取れてから30日を過ぎた画像は出さない', () => {
    const offer = nextTvOffer(null, 'tv', found, at, {});
    expect(displayTvOffer(offer, new Date(at.getTime() + TV_OFFER_STALE_MS - 1))).not.toBeNull();
    expect(displayTvOffer(offer, new Date(at.getTime() + TV_OFFER_STALE_MS + 1))).toBeNull();
  });

  function memoryDb(): TvOfferDatabase & { rows: Map<string, TvOffer> } {
    const rows = new Map<string, TvOffer>();
    return {
      rows,
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async run() {
                if (query.startsWith('INSERT')) {
                  const [television_id, item_url, image_url, affiliate_url, pv_img_url, checked_at, last_success_at, last_error] = values as string[];
                  rows.set(television_id!, { television_id: television_id!, item_url: item_url ?? null, image_url: image_url ?? null, affiliate_url: affiliate_url ?? null, pv_img_url: pv_img_url ?? null, checked_at: checked_at!, last_success_at: last_success_at ?? null, last_error: last_error ?? null });
                }
                return {};
              },
              async all<T>() {
                const list = [...rows.values()].filter(row => !query.includes('WHERE') || row.television_id === values[0]);
                return { results: list as unknown as T[] };
              },
            };
          },
        };
      },
    };
  }

  it('未取得と古いものから、1回に batch 件だけ取り直す', async () => {
    const db = memoryDb();
    const televisions = ['a', 'b', 'c'].map(id => ({ id, model: `TV-65W90${id.toUpperCase()}` }));
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify({ hits: [hit(`Panasonic ${new URL(url).searchParams.get('query')}`)] }))) as unknown as typeof fetch;
    const credentials = { appId: 'APP', vcSid: '1', vcPid: '2' };
    expect(await updateTvOffers({ db, televisions, credentials: null })).toMatchObject({ status: 'skipped' });
    const first = await updateTvOffers({ db, televisions, credentials, fetcher, sleep: async () => {}, now: () => at, batch: 2 });
    expect(first).toEqual({ status: 'updated', checked: 2, found: 2, missing: 0, errors: 0, remaining: 1 });
    const second = await updateTvOffers({ db, televisions, credentials, fetcher, sleep: async () => {}, now: () => at, batch: 2 });
    expect(second).toMatchObject({ checked: 1, remaining: 0 });
    expect((await readTvOffers(db)).map(row => row.television_id).sort()).toEqual(['a', 'b', 'c']);
    // 7日たつまでは取り直さない
    const soon = new Date(at.getTime() + TV_OFFER_INTERVAL_MS - 1);
    expect(await updateTvOffers({ db, televisions, credentials, fetcher, sleep: async () => {}, now: () => soon })).toMatchObject({ checked: 0 });
  });
});

describe('見出し横の画像', () => {
  const tv: Television = { id: 'fixture-tv', manufacturer: 'Panasonic', model: 'TV-65W90B', screen_inches: 65, weight_kg: 21, vesa_width_mm: 400, vesa_height_mm: 300, source_url: null, release_date: null };
  const offer: TvOffer = { television_id: 'fixture-tv', item_url: 'https://store.shopping.yahoo.co.jp/a/ok.html', image_url: 'https://item-shopping.c.yimg.jp/i/n/a', affiliate_url: 'https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=1&pid=2&vc_url=x', pv_img_url: 'https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?sid=1&pid=2', checked_at: '2026-11-27T00:00:00Z', last_success_at: '2026-11-27T00:00:00Z', last_error: null };
  const render = async (props: { television: Television; offer: TvOffer | null }) => load(await (await AstroContainer.create()).renderToString(TvVisual, { props }));

  it('商品画像は広告リンクにして PR と表示数計測タグを付ける', async () => {
    const $ = await render({ television: tv, offer });
    expect($('.tv-visual-image img').attr('src')).toBe(offer.image_url);
    expect($('.tv-visual-image img').attr('alt')).toContain('TV-65W90B');
    expect($('a[data-mall-link="yahoo-tv"]').map((_, node) => $(node).attr('href')).get()).toEqual([offer.affiliate_url, offer.affiliate_url]);
    expect($('a[data-mall-link="yahoo-tv"]').first().attr('rel')).toContain('sponsored');
    expect($('.pr-label').text()).toBe('PR');
    expect($('.ad-pixel').attr('src')).toBe(offer.pv_img_url);
  });

  it('アフィリエイトでないリンクには PR を付けない', async () => {
    const $ = await render({ television: tv, offer: { ...offer, affiliate_url: null, pv_img_url: null } });
    expect($('a[data-mall-link="yahoo-tv"]').first().attr('href')).toBe(offer.item_url);
    expect($('a[data-mall-link="yahoo-tv"]').first().attr('rel')).not.toContain('sponsored');
    expect($('.pr-label, .ad-pixel').length).toBe(0);
  });

  it('画像が無ければ VESA の概略図、VESA も無ければ何も出さない', async () => {
    const $ = await render({ television: tv, offer: null });
    expect($('.tv-visual-vesa svg title').text()).toContain('横 400mm × 縦 300mm');
    expect($('.tv-visual-hole').length).toBe(4);
    expect($('img').length).toBe(0);
    const none = await render({ television: { ...tv, vesa_width_mm: null }, offer: null });
    expect(none('.tv-visual').length).toBe(0);
  });
});
