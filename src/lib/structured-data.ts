/**
 * 構造化データ（JSON-LD）。1ページにつき1つの @graph にまとめ、安定した @id で関連付ける。
 *
 * 方針
 * - 画面に表示している内容だけを書く。表示と同じデータ・同じ関数（displayOffer など）から作る。
 * - 不明な値は書かない（価格が無ければ price を出さない、在庫が不明なら availability を出さない）。
 * - URL は正規URL（canonical）の絶対URL。
 */
import { televisionPath, type Stand, type Television } from './data';
import { displayOffer, shopForUrl, shops, YAHOO_SHOP, type Availability, type Offer } from './offers';
import { canonicalUrl, getSeoConfig } from './seo';

type Node = Record<string, unknown>;

export const SITE_NAME = 'TV FIT';
export const SITE_ALTERNATE_NAME = 'テレビスタンド対応検索';

const websiteId = (siteUrl: string) => `${canonicalUrl('/', siteUrl)}#website`;
export const pageId = (url: string) => `${url}#webpage`;
export const breadcrumbId = (url: string) => `${url}#breadcrumb`;

/** パンくずの1項目。path が無いものは現在のページ（正規URLを使う）。 */
export interface Crumb { name: string; path?: string }

export function websiteNode(siteUrl = getSeoConfig().siteUrl): Node {
  return {
    '@type': 'WebSite', '@id': websiteId(siteUrl),
    name: SITE_NAME, alternateName: SITE_ALTERNATE_NAME,
    url: canonicalUrl('/', siteUrl), inLanguage: 'ja',
    description: 'テレビのメーカー・型番から、テレビスタンドと壁掛け金具の適合情報を確認するサイト。',
  };
}

/**
 * 画面のパンくず（components/Breadcrumbs.astro）と同じ並び。先頭に「ホーム」を足し、最後は現在のページ。
 */
export function breadcrumbNode(crumbs: readonly Crumb[], url: string, siteUrl = getSeoConfig().siteUrl): Node {
  const items = [{ name: 'ホーム', path: '/' }, ...crumbs];
  return {
    '@type': 'BreadcrumbList', '@id': breadcrumbId(url),
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem', position: index + 1, name: item.name,
      item: item.path ? canonicalUrl(item.path, siteUrl) : url,
    })),
  };
}

export type PageType = 'WebPage' | 'CollectionPage' | 'AboutPage' | 'ItemPage';

export interface PageGraphInput {
  url: string;
  name: string;
  description: string;
  type?: PageType;
  crumbs?: readonly Crumb[];
  /** ページの主題（型番ページのテレビ、メーカーページの型番一覧）。 */
  mainEntity?: Node;
  /** WebPage に dateModified として付ける日付（画面に表示している最終確認日）。 */
  dateModified?: string;
  /** ページ内のその他の一覧など。 */
  nodes?: readonly Node[];
  siteUrl?: string;
}

export function pageGraph(input: PageGraphInput): Node {
  const siteUrl = input.siteUrl ?? getSeoConfig().siteUrl;
  const crumbs = input.crumbs && input.crumbs.length > 0 ? breadcrumbNode(input.crumbs, input.url, siteUrl) : null;
  const page: Node = {
    '@type': input.type ?? 'WebPage', '@id': pageId(input.url),
    url: input.url, name: input.name, description: input.description, inLanguage: 'ja',
    isPartOf: { '@id': websiteId(siteUrl) },
    ...(crumbs ? { breadcrumb: { '@id': crumbs['@id'] } } : {}),
    ...(input.mainEntity ? { mainEntity: { '@id': input.mainEntity['@id'] } } : {}),
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
  };
  return {
    '@context': 'https://schema.org',
    '@graph': [websiteNode(siteUrl), page, ...(crumbs ? [crumbs] : []), ...(input.mainEntity ? [input.mainEntity] : []), ...(input.nodes ?? [])],
  };
}

/* ---------- 型番一覧（メーカーページ） ---------- */

/** 画面の並び（components/ModelList.astro が描く順）と同じ順で渡す。 */
export function modelListNode(manufacturerName: string, televisions: readonly Television[], url: string, siteUrl = getSeoConfig().siteUrl): Node {
  return {
    '@type': 'ItemList', '@id': `${url}#models`,
    name: `${manufacturerName}のテレビ型番一覧`, numberOfItems: televisions.length,
    itemListElement: televisions.map((tv, index) => ({
      '@type': 'ListItem', position: index + 1, name: tv.model, url: canonicalUrl(televisionPath(tv), siteUrl),
    })),
  };
}

/* ---------- テレビ本体（型番ページの主題） ---------- */

const isoDate = /^\d{4}-\d{2}(?:-\d{2})?$/u;

/**
 * 型番ページのテレビ。価格はページに表示していないため offers は付けない。
 * image は見出し横に表示している商品画像があるときだけ。
 */
export function televisionNode(tv: Television, url: string, image: string | null): Node {
  const properties: Node[] = [];
  if (tv.screen_inches !== null) properties.push({ '@type': 'PropertyValue', name: '画面サイズ', value: tv.screen_inches, unitText: 'インチ' });
  if (tv.weight_kg !== null) properties.push({ '@type': 'PropertyValue', name: 'テレビ本体の重量', value: tv.weight_kg, unitCode: 'KGM', unitText: 'kg' });
  if (tv.vesa_width_mm !== null && tv.vesa_height_mm !== null) {
    properties.push({ '@type': 'PropertyValue', name: 'VESA取付穴（横 × 縦）', value: `${tv.vesa_width_mm} × ${tv.vesa_height_mm}`, unitCode: 'MMT', unitText: 'mm' });
  }
  return {
    '@type': 'Product', '@id': `${url}#television`,
    name: `${tv.manufacturer} ${tv.model}`, model: tv.model, category: 'テレビ',
    brand: { '@type': 'Brand', name: tv.manufacturer },
    ...(image ? { image } : {}),
    ...(tv.release_date && isoDate.test(tv.release_date) ? { releaseDate: tv.release_date } : {}),
    ...(properties.length ? { additionalProperty: properties } : {}),
    ...(tv.source_url ? { subjectOf: { '@type': 'WebPage', name: `${tv.manufacturer} ${tv.model} の仕様（メーカー公式）`, url: tv.source_url } } : {}),
  };
}

/* ---------- スタンド・壁掛け金具（型番ページの商品一覧） ---------- */

const schemaAvailability: Partial<Record<Availability, string>> = {
  in_stock: 'https://schema.org/InStock',
  out_of_stock: 'https://schema.org/OutOfStock',
  // 画面では「取り寄せ・予約」。販売店の BackOrder・PreOrder・MadeToOrder をまとめて記録しているため BackOrder とする。
  backorder: 'https://schema.org/BackOrder',
  discontinued: 'https://schema.org/Discontinued',
  // unknown は書かない（在庫ありとして補わない）。
};

export interface ShownOffer {
  shop: string;
  shopName: string;
  url: string;
  price_jpy: number | null;
  availability: Availability;
}

/**
 * 商品カード（components/ProductCard.astro）に価格・在庫として表示している販売店。
 * - カード下部の価格・在庫欄：代表の1件（primaryOffer で選んだもの）
 * - 「Yahoo!」ボタン：Yahoo!ショッピングの記録があり、読み取れたことがあるとき
 * どちらも displayOffer を通した値（古い価格は出さない）を使う。
 */
export function shownOffers(primary: Offer | null, offers: readonly Offer[], now: Date): ShownOffer[] {
  const shown: ShownOffer[] = [];
  const add = (offer: Offer | null | undefined) => {
    const view = displayOffer(offer, now);
    if (!offer || !view || shown.some(item => item.shop === offer.shop)) return;
    shown.push({ shop: offer.shop, shopName: shops[offer.shop]?.name ?? offer.shop, url: offer.url, price_jpy: view.price_jpy, availability: view.availability });
  };
  add(primary);
  add(offers.find(item => item.shop === YAHOO_SHOP && item.last_success_at));
  return shown;
}

export function offerNode(offer: ShownOffer): Node | null {
  const availability = schemaAvailability[offer.availability];
  if (offer.price_jpy === null && !availability) return null;
  return {
    '@type': 'Offer', url: offer.url,
    seller: { '@type': 'Organization', name: offer.shopName },
    ...(offer.price_jpy !== null ? {
      price: offer.price_jpy, priceCurrency: 'JPY',
      priceSpecification: { '@type': 'PriceSpecification', price: offer.price_jpy, priceCurrency: 'JPY', valueAddedTaxIncluded: true },
    } : {}),
    ...(availability ? { availability } : {}),
  };
}

const standCategory: Record<Stand['stand_type'], string> = { floor: 'テレビスタンド', tabletop: 'テレビスタンド（卓上）', wall: 'テレビ壁掛け金具' };

export interface StandEntry {
  stand: Stand;
  offer: Offer | null;
  offers: readonly Offer[];
}

/**
 * 商品カードに表示する商品画像と商品説明。ProductCard.astro と構造化データの両方がこれを使う。
 * 画像は直販サイト（サンワダイレクトの商品フィード）を優先し、無ければ他の販売店の画像。説明は直販サイトの商品API。
 */
export function cardMedia(stand: Stand, offer: Offer | null | undefined, offers: readonly Offer[], now: Date = new Date()): { image: string | null; description: string | null } {
  const directShop = stand.product_url ? shopForUrl(stand.product_url) : null;
  const direct = displayOffer(offers.find(item => item.shop === directShop && item.shop !== YAHOO_SHOP), now);
  const sale = displayOffer(offer, now);
  return {
    image: direct?.imageUrl ?? sale?.imageUrl ?? offers.map(item => item.image_url).find(Boolean) ?? null,
    description: direct?.description ?? null,
  };
}

export function standProductNode(entry: StandEntry, pageUrl: string, now: Date): Node {
  const { stand } = entry;
  const media = cardMedia(stand, entry.offer, entry.offers, now);
  const offers = shownOffers(entry.offer, entry.offers, now).map(offerNode).filter((node): node is Node => node !== null);
  return {
    '@type': 'Product', '@id': `${pageUrl}#product-${encodeURIComponent(stand.id)}`,
    name: `${stand.manufacturer} ${stand.sku}`, sku: stand.sku, category: standCategory[stand.stand_type],
    brand: { '@type': 'Brand', name: stand.manufacturer },
    url: stand.source_url,
    ...(media.image ? { image: media.image } : {}),
    ...(media.description ? { description: media.description } : {}),
    additionalProperty: [
      { '@type': 'PropertyValue', name: '耐荷重', value: stand.max_weight_kg, unitCode: 'KGM', unitText: 'kg' },
      { '@type': 'PropertyValue', name: '対応VESA', value: stand.vesa_patterns.map(p => `${p.width} × ${p.height}`).join(' / '), unitCode: 'MMT', unitText: 'mm' },
    ],
    ...(offers.length === 1 ? { offers: offers[0] } : offers.length > 1 ? { offers } : {}),
  };
}

/** 型番ページの「対応するテレビスタンド」「対応する壁掛け金具」の一覧。画面と同じ順で渡す。 */
export function standListNode(id: string, name: string, entries: readonly StandEntry[], pageUrl: string, now: Date): Node {
  return {
    '@type': 'ItemList', '@id': `${pageUrl}#${id}`, name, numberOfItems: entries.length,
    itemListElement: entries.map((entry, index) => ({
      '@type': 'ListItem', position: index + 1, item: standProductNode(entry, pageUrl, now),
    })),
  };
}
