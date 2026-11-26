import { vcAffiliate } from './yahoo-shopping';

/**
 * 直販サイト（サンワダイレクト）のアフィリエイトリンク（バリューコマースの MyLink と同じ形）。
 * 商品APIに商品が載っていない（価格・在庫が取れない）ときも、提携済みならアフィリエイトリンクにする。
 *
 * - sid（サイトID）はシークレット SANWA_VC_SID、無ければ YAHOO_VC_SID（どちらも同じサイトのID）。
 * - pid（広告ID）はシークレット SANWA_VC_PID（MyLink のコードの pid=）。
 * - 未設定なら null（直販ボタンは商品ページへ直接リンクする）。
 */
export const SANWA_DIRECT_HOST = 'direct.sanwa.co.jp';

export interface VcIds { sid: string; pid: string }

export function directAffiliateIds(env: Record<string, unknown>): VcIds | null {
  const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
  const sid = text(env.SANWA_VC_SID) ?? text(env.YAHOO_VC_SID);
  const pid = text(env.SANWA_VC_PID);
  return sid && pid ? { sid, pid } : null;
}

/** サンワダイレクトの商品ページなら、アフィリエイトリンクと表示数計測タグを返す。 */
export function directMyLink(productUrl: string | null | undefined, ids: VcIds | null | undefined): { affiliate_url: string; pv_img_url: string } | null {
  if (!productUrl || !ids) return null;
  try {
    const url = new URL(productUrl);
    if (url.protocol !== 'https:' || url.hostname !== SANWA_DIRECT_HOST) return null;
  } catch { return null; }
  return vcAffiliate(productUrl, ids.sid, ids.pid);
}

let cache: VcIds | null | undefined;

/** 公開ページ用。読めなければ null（直販ボタンは商品ページへ直接リンクする）。 */
export async function getDirectAffiliateIds(): Promise<VcIds | null> {
  if (cache !== undefined) return cache;
  try {
    // @ts-expect-error cloudflare:workers is resolved by the Cloudflare adapter.
    const { env } = await import('cloudflare:workers');
    cache = directAffiliateIds(env as Record<string, unknown>);
  } catch {
    cache = null;
  }
  return cache;
}
