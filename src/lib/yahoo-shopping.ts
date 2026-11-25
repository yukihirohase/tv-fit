import type { Observation, ParsedOffer } from './offers';

/**
 * Yahoo!ショッピング商品検索API（v3）から、サンワダイレクトの Yahoo!店（ストアID sanwadirect）の
 * 価格・在庫・画像を取り、バリューコマース経由のアフィリエイトリンクを作る。
 * 仕様: https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html
 *
 * - アプリケーションID（Client ID）は Cloudflare のシークレット YAHOO_APP_ID に置く。
 * - アフィリエイトは、バリューコマースの Yahoo!ショッピングのプログラムで発行した sid / pid
 *   （シークレット YAHOO_VC_SID / YAHOO_VC_PID）で、商品ページへのリンクを包んで作る。
 * - 検索結果の表示には「Web Services by Yahoo! JAPAN」のクレジット表示が必要（フッターに表示）。
 */
export const YAHOO_SEARCH_URL = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';
/** サンワダイレクトの Yahoo!店のストアID。商品コードは `sanwadirect_<型番の小文字>`。 */
export const YAHOO_SANWA_SELLER = 'sanwadirect';

const ITEM_HOST = 'store.shopping.yahoo.co.jp';

export interface YahooCredentials {
  appId: string;
  /** バリューコマースのサイトID・プログラムID。無ければアフィリエイトにしない。 */
  vcSid?: string | null;
  vcPid?: string | null;
}

interface YahooImage { small?: unknown; medium?: unknown }
export interface YahooHit {
  code?: unknown;
  url?: unknown;
  price?: unknown;
  inStock?: unknown;
  image?: YahooImage;
  exImage?: { url?: unknown };
  seller?: { sellerId?: unknown };
}

/** その商品の Yahoo!店での商品ページ（型番から決まる）。 */
export function yahooItemUrl(sku: string, seller = YAHOO_SANWA_SELLER): string {
  return `https://${ITEM_HOST}/${seller}/${encodeURIComponent(sku.trim().toLowerCase())}.html`;
}

function httpsUrl(value: unknown, host?: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (host && url.hostname !== host) return null;
    return url.href;
  } catch { return null; }
}

/** sid / pid は数字だけ（それ以外はリンクに使わない）。 */
const vcId = (value: string | null | undefined) => typeof value === 'string' && /^\d{1,12}$/u.test(value.trim()) ? value.trim() : null;

/** バリューコマースのリンク（クリック計測）と表示数計測タグ。必ず対で使う。 */
export function vcAffiliate(pageUrl: string, sid: string | null | undefined, pid: string | null | undefined): { affiliate_url: string; pv_img_url: string } | null {
  const s = vcId(sid), p = vcId(pid);
  if (!s || !p) return null;
  return {
    affiliate_url: `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=${s}&pid=${p}&vc_url=${encodeURIComponent(pageUrl)}`,
    pv_img_url: `https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?sid=${s}&pid=${p}`,
  };
}

/** 検索結果から、そのストアのその型番の商品を選ぶ（商品コードの完全一致だけ。似た型番を拾わない）。 */
export function matchYahooHit(hits: readonly YahooHit[], sku: string, seller = YAHOO_SANWA_SELLER): YahooHit | null {
  const code = `${seller}_${sku.trim().toLowerCase()}`;
  return hits.find(hit => typeof hit.code === 'string' && hit.code.toLowerCase() === code
    && (hit.seller?.sellerId === undefined || hit.seller.sellerId === seller)) ?? null;
}

/** 1件の検索結果を、保存する販売情報の形にする。価格は税込。 */
export function yahooHitOffer(hit: YahooHit, credentials: Pick<YahooCredentials, 'vcSid' | 'vcPid'> = {}): ParsedOffer & { url: string | null } {
  const raw = typeof hit.price === 'number' ? hit.price : typeof hit.price === 'string' ? Number(hit.price) : Number.NaN;
  const price_jpy = Number.isFinite(raw) && raw > 0 && raw < 10_000_000 ? Math.round(raw) : null;
  const url = httpsUrl(hit.url, ITEM_HOST);
  const affiliate = url ? vcAffiliate(url, credentials.vcSid, credentials.vcPid) : null;
  return {
    url,
    price_jpy,
    availability: hit.inStock === true ? 'in_stock' : hit.inStock === false ? 'out_of_stock' : 'unknown',
    image_url: httpsUrl(hit.exImage?.url) ?? httpsUrl(hit.image?.medium) ?? httpsUrl(hit.image?.small),
    mpn: typeof hit.code === 'string' ? hit.code.replace(/^[^_]+_/u, '').toUpperCase() : null,
    affiliate_url: affiliate?.affiliate_url ?? null,
    pv_img_url: affiliate?.pv_img_url ?? null,
  };
}

/**
 * 型番で公式ストアを検索し、結果を分類する。
 * 公式ストアに無い・API の不調は「一時的なエラー」とし、販売終了とは数えない
 * （Yahoo!ショッピングのボタンは検索結果へのリンクになるだけ）。
 */
export async function observeYahooShopping(sku: string, credentials: YahooCredentials, fetcher: typeof fetch = fetch): Promise<Observation> {
  const url = new URL(YAHOO_SEARCH_URL);
  url.searchParams.set('appid', credentials.appId);
  url.searchParams.set('query', sku);
  url.searchParams.set('seller_id', YAHOO_SANWA_SELLER);
  url.searchParams.set('results', '20');
  url.searchParams.set('image_size', '600');
  let response: Response;
  try {
    response = await fetcher(url.href, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    return { kind: 'error', detail: error instanceof Error ? `Yahoo API ${error.name}: ${error.message}`.slice(0, 200) : 'Yahoo API fetch failed' };
  }
  if (!response.ok) return { kind: 'error', detail: `Yahoo API HTTP ${response.status}` };
  let data: { hits?: unknown };
  try { data = await response.json() as typeof data; } catch { return { kind: 'error', detail: 'Yahoo API: JSON を読めませんでした' }; }
  const hits = Array.isArray(data.hits) ? data.hits.filter((hit): hit is YahooHit => hit !== null && typeof hit === 'object') : [];
  const hit = matchYahooHit(hits, sku);
  if (!hit) return { kind: 'error', detail: `Yahoo API: 公式ストアに該当商品なし（検索結果 ${hits.length}件）` };
  const { url: _itemUrl, ...offer } = yahooHitOffer(hit, credentials);
  return { kind: 'found', offer };
}
