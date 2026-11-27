/**
 * 構造化データ（JSON-LD）。1ページにつき1つの @graph にまとめ、安定した @id で関連付ける。
 *
 * 方針
 * - 画面に表示している内容だけを書く。表示と同じデータ・同じ関数（displayOffer など）から作る。
 * - 不明な値は書かない（価格が無ければ price を出さない、在庫が不明なら availability を出さない）。
 * - URL は正規URL（canonical）の絶対URL。
 */
import { formatReleaseDate, televisionPath, type Stand, type Television } from './data';
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

/**
 * 型番ページのテレビ。Google は Product に offers・review・aggregateRating のどれかを必須とするが、
 * このページはテレビの価格・レビューを表示していないため、Product ではなく Thing として、
 * 画面の仕様欄と同じ内容（型番・画面サイズ・重量・VESA・発売日）を書く。
 * image は見出し横に商品画像を表示しているときだけ。
 */
export function televisionNode(tv: Television, url: string, image: string | null): Node {
  const specs = [
    tv.screen_inches !== null ? `画面サイズ ${tv.screen_inches}インチ` : null,
    tv.weight_kg !== null ? `テレビ本体の重量 ${tv.weight_kg}kg` : null,
    tv.vesa_width_mm !== null && tv.vesa_height_mm !== null ? `VESA取付穴（横 × 縦） ${tv.vesa_width_mm} × ${tv.vesa_height_mm}mm` : null,
    tv.release_date ? `発売日 ${formatReleaseDate(tv.release_date)}` : null,
  ].filter((value): value is string => value !== null);
  return {
    '@type': 'Thing', '@id': `${url}#television`,
    name: `${tv.manufacturer} ${tv.model}`,
    identifier: { '@type': 'PropertyValue', name: '型番', value: tv.model },
    ...(specs.length ? { description: `${tv.manufacturer}のテレビ。${specs.join('、')}。` } : {}),
    ...(image ? { image } : {}),
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

/**
 * 価格を表示している販売店だけ Offer にする（Google は Offer に price を必須とする）。
 * 在庫だけ分かっている販売店は書かない。在庫が不明なら availability を書かない（在庫ありで補わない）。
 */
export function offerNode(offer: ShownOffer): Node | null {
  if (offer.price_jpy === null) return null;
  const availability = schemaAvailability[offer.availability];
  return {
    '@type': 'Offer', url: offer.url,
    seller: { '@type': 'Organization', name: offer.shopName },
    price: offer.price_jpy, priceCurrency: 'JPY',
    priceSpecification: { '@type': 'PriceSpecification', price: offer.price_jpy, priceCurrency: 'JPY', valueAddedTaxIncluded: true },
    ...(availability ? { availability } : {}),
  };
}


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

const standKind: Record<Stand['stand_type'], string> = { floor: 'テレビスタンド', tabletop: 'テレビスタンド（卓上）', wall: 'テレビ壁掛け金具' };

/**
 * 一覧の1商品。価格を表示している販売店があれば Product＋Offer。
 * 価格を表示していない商品は、Google の商品の必須項目（offers・review・aggregateRating のどれか）を
 * 満たせないため Thing とし、名前・型番・画像・仕様だけを書く（価格・在庫を補わない）。
 */
export function standProductNode(entry: StandEntry, pageUrl: string, now: Date): Node {
  const { stand } = entry;
  const media = cardMedia(stand, entry.offer, entry.offers, now);
  const offers = shownOffers(entry.offer, entry.offers, now).map(offerNode).filter((node): node is Node => node !== null);
  const id = `${pageUrl}#product-${encodeURIComponent(stand.id)}`;
  const name = `${stand.manufacturer} ${stand.sku}`;
  const vesa = stand.vesa_patterns.map(p => `${p.width} × ${p.height}`).join(' / ');
  if (offers.length === 0) {
    return {
      '@type': 'Thing', '@id': id, name,
      identifier: { '@type': 'PropertyValue', name: '型番', value: stand.sku },
      url: stand.source_url,
      ...(media.image ? { image: media.image } : {}),
      description: `${stand.manufacturer}の${standKind[stand.stand_type]}。耐荷重 ${stand.max_weight_kg}kg、対応VESA ${vesa}mm。${media.description ?? ''}`.trim(),
    };
  }
  return {
    '@type': 'Product', '@id': id, name, sku: stand.sku,
    brand: { '@type': 'Brand', name: stand.manufacturer },
    url: stand.source_url,
    ...(media.image ? { image: media.image } : {}),
    ...(media.description ? { description: media.description } : {}),
    additionalProperty: [
      { '@type': 'PropertyValue', name: '耐荷重', value: stand.max_weight_kg, unitCode: 'KGM', unitText: 'kg' },
      { '@type': 'PropertyValue', name: '対応VESA', value: vesa, unitCode: 'MMT', unitText: 'mm' },
    ],
    offers: offers.length === 1 ? offers[0] : offers,
  };
}

/**
 * 型番ページの商品一覧。Google は1ページに ItemList を1つまでとするため、画面の「対応するテレビスタンド」と
 * 「対応する壁掛け金具」を、ページ上の並び（スタンド → 壁掛け金具）のまま1つの一覧にする。
 */
export function productListNode(name: string, entries: readonly StandEntry[], pageUrl: string, now: Date): Node {
  return {
    '@type': 'ItemList', '@id': `${pageUrl}#products`, name, numberOfItems: entries.length,
    itemListElement: entries.map((entry, index) => ({
      '@type': 'ListItem', position: index + 1, item: standProductNode(entry, pageUrl, now),
    })),
  };
}
