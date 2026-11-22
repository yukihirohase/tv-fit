import type { Stand } from './data';
import { isAutoCheckedShop, nextOffer, observeOffer, offerTargetUrl, shopForUrl, type Observation, type Offer } from './offers';
import { deleteOffer, ensureOffersTable, readOffers, saveOffer, type OfferDatabase } from './offer-store';

export interface OfferCheckOptions {
  db: OfferDatabase;
  stands: readonly Pick<Stand, 'id' | 'product_url'>[];
  fetcher?: typeof fetch;
  now?: () => Date;
  /** 販売サイトに負荷をかけないよう、1件ごとに空ける時間。 */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** 確認する販売店。既定は shops の autoCheck が true のもの。 */
  isChecked?: (shop: string) => boolean;
}

export interface OfferCheckResult { checked: number; found: number; missing: number; errors: number; removed: number }

/**
 * 登録済みスタンドの販売ページを1件ずつ確認し、販売情報の表を更新する。
 * 対応していない販売店のリンクは飛ばす。
 */
export async function runOfferCheck(options: OfferCheckOptions): Promise<OfferCheckResult> {
  const { db, stands, fetcher = fetch, now = () => new Date(), delayMs = 1000, isChecked = isAutoCheckedShop } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  await ensureOffersTable(db);
  const previous = new Map((await readOffers(db)).map(offer => [`${offer.stand_id}:${offer.shop}`, offer]));
  const result: OfferCheckResult = { checked: 0, found: 0, missing: 0, errors: 0, removed: 0 };
  const current = new Set<string>();
  const observed: { key: string; base: Pick<Offer, 'stand_id' | 'shop' | 'url'>; observation: Observation; at: Date }[] = [];
  for (const stand of stands) {
    if (!stand.product_url) continue;
    const shop = shopForUrl(stand.product_url);
    if (!shop || !isChecked(shop)) continue;
    const url = offerTargetUrl(stand.product_url);
    const key = `${stand.id}:${shop}`;
    current.add(key);
    if (observed.length > 0) await sleep(delayMs);
    observed.push({ key, base: { stand_id: stand.id, shop, url }, observation: await observeOffer(url, fetcher), at: now() });
  }
  // 1件も商品情報を読めなかった回は、販売店側の障害やアクセス制限とみなす。
  // 「見つからない」を数えると全商品が販売終了扱いになってしまうため、一時的なエラーとして記録する。
  const anyFound = observed.some(item => item.observation.kind === 'found');
  for (const item of observed) {
    const observation: Observation = !anyFound && observed.length > 1 && item.observation.kind === 'missing'
      ? { kind: 'error', detail: `全件で取得できず保留: ${item.observation.detail}`.slice(0, 300) }
      : item.observation;
    await saveOffer(db, nextOffer(previous.get(item.key) ?? null, item.base, observation, item.at));
    result.checked += 1;
    if (observation.kind === 'found') result.found += 1;
    else if (observation.kind === 'missing') result.missing += 1;
    else result.errors += 1;
  }
  // スタンドが1件も読めなかったときは、読み込みの失敗とみなして何も消さない。
  for (const [key, offer] of stands.length > 0 ? previous : []) {
    if (current.has(key)) continue;
    await deleteOffer(db, offer.stand_id, offer.shop);
    result.removed += 1;
  }
  return result;
}
