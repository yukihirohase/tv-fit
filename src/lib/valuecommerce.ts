import type { Availability, Observation, ParsedOffer } from './offers';

/**
 * バリューコマースの商品API（アフィリエイトサイト向け）から、販売情報とアフィリエイトリンクを作る。
 * 仕様: https://pub-docs.valuecommerce.ne.jp/docs/as-63-item-api.html
 * トークンは Cloudflare のシークレット VC_API_TOKEN に置く（Git・チャットに書かない）。
 */
export const VC_SEARCH_URL = 'https://webservice.valuecommerce.ne.jp/productdb/search';

/**
 * 販売サイトのホスト → バリューコマースの広告主サイトコード（ecCode）。
 * キーワード検索は商品名・説明文だけが対象で、型番が商品名に無い商品は見つからないため、
 * ecCode が分かっている販売サイトは「ecCode＋商品コード（product_id）」の完全一致で探す。
 * サンワダイレクトの j22up は、商品APIの検索結果（2026-11-26）で確認した値。
 */
export const VC_EC_CODES: Readonly<Record<string, string>> = { 'direct.sanwa.co.jp': 'j22up' };

const CLICK_HOST = 'ck.jp.ap.valuecommerce.com';
const PV_HOST = 'ad.jp.ap.valuecommerce.com';

interface VcImage { url?: unknown }
export interface VcItem {
  link?: unknown;
  guid?: unknown;
  pvImg?: unknown;
  description?: unknown;
  modelCode?: unknown;
  productCode?: unknown;
  price?: unknown;
  stock?: unknown;
  imageFree?: VcImage;
  imageLarge?: VcImage;
  imageSmall?: VcImage;
}

/**
 * http の URL を https にし、許可したホストかどうかを確かめる（host 未指定なら https なら何でもよい）。
 * 商品APIはリンク・計測タグを「//ck.jp.ap.valuecommerce.com/...」の形（スキーム省略）で返すので https を補う。
 */
function secureUrl(value: unknown, host?: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const text = value.trim();
    const url = new URL(text.startsWith('//') ? `https:${text}` : text);
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (host && url.hostname !== host) return null;
    return url.href;
  } catch { return null; }
}

/** 照合用：大文字小文字・記号の違いを無視する。 */
const normalizeCode = (value: unknown) => typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]/gu, '') : '';

/** 照合用：販売ページURLのホストとパス（クエリ・末尾スラッシュ・大文字小文字を無視）。 */
function pageKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/u, '').toLowerCase()}`;
  } catch { return null; }
}

/** アフィリエイトリンクに包まれた販売ページのURL。 */
function innerPage(link: unknown): string | null {
  if (typeof link !== 'string') return null;
  try { return new URL(link).searchParams.get('vc_url'); } catch { return null; }
}

const stockMap: Record<string, Availability> = {
  在庫有り: 'in_stock',
  在庫あり: 'in_stock',
  お取り寄せ: 'backorder',
  予約受付: 'backorder',
  なし: 'out_of_stock',
  在庫なし: 'out_of_stock',
};

function priceOf(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.replace(/,/gu, '')) : Number.NaN;
  return Number.isFinite(number) && number > 0 && number < 10_000_000 ? Math.round(number) : null;
}

/** 商品の表示数計測タグ（pvImg の img タグ）から画像URLを取り出す。 */
function pvImageUrl(pvImg: unknown): string | null {
  if (typeof pvImg !== 'string') return null;
  const src = /src\s*=\s*["']([^"']+)["']/iu.exec(pvImg)?.[1]?.replace(/&amp;/gu, '&');
  return secureUrl(src, PV_HOST);
}

/**
 * 検索結果から、登録済みの販売ページと同じ商品を選ぶ。
 * 販売ページのURLが一致するものを優先し、なければ同じ販売サイトで型番が一致するものを使う。
 */
export function matchVcItem(items: readonly VcItem[], productUrl: string, sku: string): VcItem | null {
  const target = pageKey(productUrl);
  const host = target?.split('/')[0];
  const pages = (item: VcItem) => [pageKey(item.guid), pageKey(innerPage(item.link))];
  const byPage = items.find(item => target !== null && pages(item).includes(target));
  if (byPage) return byPage;
  const code = normalizeCode(sku);
  if (!code) return null;
  return items.find(item => pages(item).some(key => key?.split('/')[0] === host)
    && (normalizeCode(item.modelCode) === code || normalizeCode(item.productCode) === code)) ?? null;
}

/**
 * 商品説明を表示用に整える。商品APIは値を「"…"」で囲んで返し、「〜」が「?」に化けている（例「110?170cm」「52型?86型」）。
 * 前後の引用符を外し、数字（単位付きを含む）と数字に挟まれた「?」を「〜」に戻し、空白をまとめる。「【WEB限定商品】」の表記は外す。
 */
export function vcDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/^"+|"+$/gu, '')
    .replace(/(\d(?:型|インチ|cm|mm|kg|V|W|%)?)\?(\d)/gu, '$1〜$2')
    .replace(/【WEB限定商品】/gu, '')
    .replace(/\s+/gu, ' ').trim();
  return text ? text.slice(0, 400) : null;
}

export function vcItemOffer(item: VcItem): ParsedOffer {
  const stock = typeof item.stock === 'string' ? item.stock.trim() : '';
  return {
    price_jpy: priceOf(item.price),
    availability: stockMap[stock] ?? 'unknown',
    image_url: secureUrl(item.imageFree?.url) ?? secureUrl(item.imageLarge?.url) ?? secureUrl(item.imageSmall?.url),
    mpn: typeof item.modelCode === 'string' && item.modelCode.trim() ? item.modelCode.trim() : null,
    affiliate_url: secureUrl(item.link, CLICK_HOST),
    pv_img_url: pvImageUrl(item.pvImg),
    description: vcDescription(item.description),
  };
}

/** 1スタンド分を商品APIで調べる。 */
export async function observeValueCommerce(productUrl: string, sku: string, token: string, fetcher: typeof fetch = fetch): Promise<Observation> {
  const url = new URL(VC_SEARCH_URL);
  url.searchParams.set('token', token);
  let ecCode: string | undefined;
  try { ecCode = VC_EC_CODES[new URL(productUrl).hostname.toLowerCase()]; } catch { /* キーワード検索にする */ }
  if (ecCode) {
    url.searchParams.set('ecCode', ecCode);
    url.searchParams.set('product_id', sku);
  } else {
    url.searchParams.set('keyword', sku);
  }
  url.searchParams.set('format', 'json');
  url.searchParams.set('results_per_page', '50');
  let response: Response;
  try {
    response = await fetcher(url.href, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    return { kind: 'error', detail: error instanceof Error ? `VC API ${error.name}: ${error.message}`.slice(0, 200) : 'VC API fetch failed' };
  }
  if (!response.ok) return { kind: 'error', detail: `VC API HTTP ${response.status}` };
  let data: { status?: unknown; items?: unknown };
  try { data = await response.json() as typeof data; } catch { return { kind: 'error', detail: 'VC API: JSON を読めませんでした' }; }
  // トークンの誤りやAPI側の障害は、商品の状態とは無関係なので「見つからない」と数えない。
  if (data.status !== 'OK') return { kind: 'error', detail: `VC API status ${String(data.status).slice(0, 60)}` };
  const items = Array.isArray(data.items) ? data.items.filter((item): item is VcItem => item !== null && typeof item === 'object') : [];
  const item = matchVcItem(items, productUrl, sku);
  // 商品APIに載っていないだけで販売中のこともあるので、「見つからない」（3回で販売終了）とは数えない。
  // 購入ボタンは登録済みの販売ページへ直接リンクしたまま残る。
  if (!item) return { kind: 'error', detail: `VC API: 該当商品なし（検索結果 ${items.length}件）` };
  return { kind: 'found', offer: vcItemOffer(item) };
}
