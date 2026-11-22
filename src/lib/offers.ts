/**
 * 販売店ごとの販売情報（価格・在庫・画像）。適合情報（CMS）とは別に、定期チェックで自動更新する。
 * 1スタンド × 1販売店 = 1件。販売店が増えても同じ形で保存する。
 */
export const availabilities = ['in_stock', 'out_of_stock', 'backorder', 'discontinued', 'unknown'] as const;
export type Availability = typeof availabilities[number];

export interface Offer {
  stand_id: string;
  shop: string;
  /** 実際に確認した販売ページ（アフィリエイトリンクを外したURL）。 */
  url: string;
  price_jpy: number | null;
  availability: Availability;
  image_url: string | null;
  /** 販売ページが示す商品型番。登録済みの型番と違えばリンク先の取り違えを疑う。 */
  mpn: string | null;
  /** 最後にチェックを試みた日時（ISO 8601）。 */
  checked_at: string;
  /** 最後に価格・在庫を読み取れた日時。 */
  last_success_at: string | null;
  /** 商品ページが見つからない状態が続いた回数。 */
  missing_count: number;
  /** 通信エラー等が続いた回数。 */
  error_count: number;
  last_error: string | null;
}

/** 販売店の識別子と表示名。新しい販売店はここに足す。 */
/**
 * autoCheck: 販売ページを定期的に読みに行くか。
 * サンワダイレクトは Cloudflare からのアクセスを HTTP 403 で拒否するため止めている（2026-11-22）。
 * 価格・在庫は ASP（バリューコマースなど）の商品データから取る方針。
 */
export const shops: Record<string, { name: string; hosts: readonly string[]; autoCheck: boolean }> = {
  sanwa_direct: { name: 'サンワダイレクト', hosts: ['direct.sanwa.co.jp'], autoCheck: false },
};

export const isAutoCheckedShop = (shop: string): boolean => shops[shop]?.autoCheck === true;

/** 何回続けて「ページがない」と確認されたら販売終了とみなすか。一時的な障害で誤って隠さないため。 */
export const DISCONTINUED_AFTER_MISSES = 3;
/** これより古い価格は表示しない（購入先で確認してもらう）。 */
export const PRICE_FRESH_MS = 48 * 60 * 60 * 1000;

/**
 * アフィリエイトリンク（バリューコマース等）なら、包まれている販売ページのURLを取り出す。
 * それ以外はそのまま返す。
 */
const affiliateRedirectors: Record<string, string> = {
  'ck.jp.ap.valuecommerce.com': 'vc_url',
  'af.moshimo.com': 'url',
  'px.a8.net': 'a8ejpredirect',
};

export function offerTargetUrl(productUrl: string): string {
  try {
    const url = new URL(productUrl);
    const key = affiliateRedirectors[url.hostname];
    const inner = key ? url.searchParams.get(key) : null;
    if (inner && /^https:\/\//u.test(inner)) return offerTargetUrl(inner);
    return url.href;
  } catch {
    return productUrl;
  }
}

/** 販売ページのURLから販売店を判定する。未対応の販売店は null。 */
export function shopForUrl(productUrl: string): string | null {
  let host: string;
  try { host = new URL(offerTargetUrl(productUrl)).hostname; } catch { return null; }
  for (const [shop, { hosts }] of Object.entries(shops)) if (hosts.includes(host)) return shop;
  return null;
}

export interface ParsedOffer {
  price_jpy: number | null;
  availability: Availability;
  image_url: string | null;
  mpn: string | null;
}

const schemaAvailability: Record<string, Availability> = {
  instock: 'in_stock',
  instoreonly: 'in_stock',
  onlineonly: 'in_stock',
  limitedavailability: 'in_stock',
  outofstock: 'out_of_stock',
  soldout: 'out_of_stock',
  backorder: 'backorder',
  preorder: 'backorder',
  presale: 'backorder',
  madetoorder: 'backorder',
  discontinued: 'discontinued',
};

function mapAvailability(value: unknown): Availability {
  if (typeof value !== 'string') return 'unknown';
  const key = value.replace(/^https?:\/\/schema\.org\//iu, '').toLowerCase();
  return schemaAvailability[key] ?? 'unknown';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function isType(node: Record<string, unknown>, type: string): boolean {
  return asArray(node['@type']).some(value => typeof value === 'string' && value.toLowerCase() === type.toLowerCase());
}

function findProducts(value: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  for (const item of asArray(value)) {
    if (item === null || typeof item !== 'object') continue;
    const node = item as Record<string, unknown>;
    if (isType(node, 'Product')) found.push(node);
    if (node['@graph']) findProducts(node['@graph'], found);
  }
  return found;
}

function httpsUrl(value: unknown): string | null {
  const candidate = asArray(value).map(item => typeof item === 'object' && item !== null ? (item as Record<string, unknown>).url : item)[0];
  if (typeof candidate !== 'string') return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function priceOf(offer: Record<string, unknown>): number | null {
  const currency = offer.priceCurrency;
  if (typeof currency === 'string' && currency.toUpperCase() !== 'JPY') return null;
  const raw = offer.price ?? offer.lowPrice;
  const number = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+(?:\.\d+)?$/u.test(raw.replace(/,/gu, '')) ? Number(raw.replace(/,/gu, '')) : Number.NaN;
  return Number.isFinite(number) && number > 0 && number < 10_000_000 ? Math.round(number) : null;
}

/**
 * 商品ページに埋め込まれた schema.org の Product（JSON-LD）から価格・在庫・画像を読み取る。
 * Google 向けの共通形式なので、多くの販売サイトで同じ読み方ができる。見つからなければ null。
 */
export function parseJsonLdOffer(html: string): ParsedOffer | null {
  const scripts = html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/giu);
  for (const [, body] of scripts) {
    let data: unknown;
    try { data = JSON.parse((body ?? "").trim()); } catch { continue; }
    for (const product of findProducts(data)) {
      const offers = asArray(product.offers).filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object');
      const offer = offers.find(item => priceOf(item) !== null) ?? offers[0];
      if (!offer) continue;
      const mpn = typeof product.mpn === 'string' ? product.mpn.trim() : typeof product.sku === 'string' ? product.sku.trim() : null;
      return {
        price_jpy: priceOf(offer),
        availability: mapAvailability(offer.availability),
        image_url: httpsUrl(product.image),
        mpn: mpn || null,
      };
    }
  }
  return null;
}

/** 1回のチェック結果。 */
export type Observation =
  | { kind: 'found'; offer: ParsedOffer }
  /** 404/410、または商品情報のないページ（トップや一覧への転送など）。 */
  | { kind: 'missing'; detail: string }
  /** 5xx・通信エラーなど、商品の状態とは無関係かもしれない失敗。 */
  | { kind: 'error'; detail: string };

/** 前回の記録と今回の結果から、新しい記録を作る。 */
export function nextOffer(previous: Offer | null, base: Pick<Offer, 'stand_id' | 'shop' | 'url'>, observation: Observation, now: Date): Offer {
  const checked_at = now.toISOString();
  const kept = {
    price_jpy: previous?.price_jpy ?? null,
    availability: previous?.availability ?? 'unknown' as Availability,
    image_url: previous?.image_url ?? null,
    mpn: previous?.mpn ?? null,
    last_success_at: previous?.last_success_at ?? null,
  };
  if (observation.kind === 'found') {
    return { ...base, ...observation.offer, checked_at, last_success_at: checked_at, missing_count: 0, error_count: 0, last_error: null };
  }
  if (observation.kind === 'missing') {
    const missing_count = (previous?.missing_count ?? 0) + 1;
    return {
      ...base, ...kept, checked_at, missing_count, error_count: 0, last_error: observation.detail,
      availability: missing_count >= DISCONTINUED_AFTER_MISSES ? 'discontinued' : kept.availability,
    };
  }
  return { ...base, ...kept, checked_at, missing_count: previous?.missing_count ?? 0, error_count: (previous?.error_count ?? 0) + 1, last_error: observation.detail };
}

/** 販売ページを取得して結果を分類する。 */
function bytesToLatin1(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return text;
}

export async function observeOffer(url: string, fetcher: typeof fetch = fetch): Promise<Observation> {
  let response: Response;
  try {
    response = await fetcher(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'TVFIT-OfferCheck/1.0 (+https://tv-fit.com/about/)', Accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    return { kind: 'error', detail: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : 'fetch failed' };
  }
  if (response.status === 404 || response.status === 410) return { kind: 'missing', detail: `HTTP ${response.status}` };
  if (!response.ok) return { kind: 'error', detail: `HTTP ${response.status}` };
  // Shift_JIS のページでも、JSON-LD の価格・在庫・URL は ASCII なので1バイト1文字で読めば十分。
  // （Workers の TextDecoder が対応する文字コードに依存しないよう、自前で変換する）
  const html = bytesToLatin1(new Uint8Array(await response.arrayBuffer()));
  const offer = parseJsonLdOffer(html);
  if (offer) return { kind: 'found', offer };
  // 確認ページ（ボット対策）などに置き換えられた場合の手がかりとして、種類とタイトルを残す。
  const title = /<title[^>]*>([^<]{0,200})/i.exec(html)?.[1]?.replace(/[^ -~]/g, '?').trim().slice(0, 80) ?? '';
  return { kind: 'missing', detail: `no Product data (HTTP ${response.status}, ${response.headers.get('content-type') ?? '-'}, ${html.length} bytes${title ? `, title: ${title}` : ''})` };
}

export interface OfferDisplay {
  shopName: string;
  availability: Availability;
  /** 新しい価格だけを表示する。古い・不明なら null。 */
  price_jpy: number | null;
  /** 価格を確認した日時（表示用）。 */
  priceAt: string | null;
  /** 販売終了なら購入ボタンを出さない。 */
  purchasable: boolean;
}

const jstFormat = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function displayOffer(offer: Offer | null | undefined, now: Date = new Date()): OfferDisplay | null {
  if (!offer) return null;
  const successAt = offer.last_success_at ? new Date(offer.last_success_at) : null;
  const fresh = successAt !== null && now.getTime() - successAt.getTime() <= PRICE_FRESH_MS;
  const availability = offer.availability === 'discontinued' ? 'discontinued' : fresh ? offer.availability : 'unknown';
  return {
    shopName: shops[offer.shop]?.name ?? offer.shop,
    availability,
    price_jpy: fresh && availability !== 'discontinued' ? offer.price_jpy : null,
    priceAt: fresh && successAt ? `${jstFormat.format(successAt)}時点` : null,
    purchasable: availability !== 'discontinued',
  };
}

/**
 * 複数の販売店があるとき、カードに出す1件を選ぶ：在庫あり → 取り寄せ → 不明 → 在庫なし → 販売終了、
 * 同じ状態なら安い順。すべての販売店で販売終了のときだけ販売終了になる。
 */
export function primaryOffer(offers: readonly Offer[] | undefined, now: Date = new Date()): Offer | null {
  if (!offers || offers.length === 0) return null;
  return [...offers].sort((a, b) => {
    const da = displayOffer(a, now)!, db = displayOffer(b, now)!;
    return availabilityOrder[da.availability] - availabilityOrder[db.availability]
      || (da.price_jpy ?? Number.MAX_SAFE_INTEGER) - (db.price_jpy ?? Number.MAX_SAFE_INTEGER);
  })[0] ?? null;
}

export const availabilityLabels: Record<Availability, string> = {
  in_stock: '在庫あり',
  out_of_stock: '在庫なし',
  backorder: '取り寄せ・予約',
  discontinued: '販売終了',
  unknown: '在庫は購入先で確認',
};

const availabilityOrder: Record<Availability, number> = { in_stock: 0, backorder: 1, unknown: 2, out_of_stock: 3, discontinued: 4 };

/** 同じ区分の中で、在庫ありを先、在庫なしを後ろに並べる（元の順は保つ）。 */
export function sortByAvailability<T>(entries: readonly T[], availabilityOf: (entry: T) => Availability | undefined): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => availabilityOrder[availabilityOf(a.entry) ?? 'unknown'] - availabilityOrder[availabilityOf(b.entry) ?? 'unknown'] || a.index - b.index)
    .map(({ entry }) => entry);
}
