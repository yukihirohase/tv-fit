/** 販売情報チェックの内部経路。公開リクエストでは 404 にする。 */
export const OFFER_CHECK_PATH = '/internal/offer-check';

export function isOfferCheckRequest(request: Request): boolean {
  try {
    return new URL(request.url).pathname.replace(/\/+$/u, '') === OFFER_CHECK_PATH;
  } catch {
    return false;
  }
}

/** scheduled() から Astro のハンドラーへ直接渡すリクエスト（ネットワークを通らない）。 */
export function offerCheckRequest(env: Record<string, unknown>): Request {
  const origin = typeof env.EMDASH_SITE_URL === 'string' ? env.EMDASH_SITE_URL : 'https://tv-fit.com';
  return new Request(new URL(OFFER_CHECK_PATH, origin), { method: 'POST' });
}
