import { availabilities, type Offer } from './offers';

/** D1 の最小限のインターフェース（テストで差し替えるため）。 */
export interface OfferDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): { run(): Promise<unknown> };
    all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  };
  batch?(statements: unknown[]): Promise<unknown>;
}

/**
 * EmDash の表とは別の、TV FIT 専用の表。名前の接頭辞 tvfit_ で区別する。
 * 列を足すときは ALTER TABLE を追加する（既存の列は消さない）。
 */
export const OFFERS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS tvfit_stand_offers (
  stand_id TEXT NOT NULL,
  shop TEXT NOT NULL,
  url TEXT NOT NULL,
  price_jpy INTEGER,
  availability TEXT NOT NULL,
  image_url TEXT,
  mpn TEXT,
  checked_at TEXT NOT NULL,
  last_success_at TEXT,
  missing_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  PRIMARY KEY (stand_id, shop)
)`;

/** 後から足した列。既にあれば ALTER は失敗するので無視する。 */
const ADDED_COLUMNS = ['affiliate_url TEXT', 'pv_img_url TEXT', 'description TEXT'] as const;

export async function ensureOffersTable(db: OfferDatabase): Promise<void> {
  await db.prepare(OFFERS_TABLE_SQL).bind().run();
  for (const column of ADDED_COLUMNS) {
    try {
      await db.prepare(`ALTER TABLE tvfit_stand_offers ADD COLUMN ${column}`).bind().run();
    } catch (error) {
      if (!(error instanceof Error && /duplicate column/iu.test(error.message))) throw error;
    }
  }
}

function toOffer(row: Record<string, unknown>): Offer | null {
  const availability = availabilities.find(value => value === row.availability);
  if (typeof row.stand_id !== 'string' || typeof row.shop !== 'string' || typeof row.url !== 'string'
    || typeof row.checked_at !== 'string' || !availability) return null;
  const text = (value: unknown) => typeof value === 'string' ? value : null;
  const int = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  return {
    stand_id: row.stand_id, shop: row.shop, url: row.url,
    price_jpy: int(row.price_jpy), availability,
    image_url: text(row.image_url), mpn: text(row.mpn),
    checked_at: row.checked_at, last_success_at: text(row.last_success_at),
    missing_count: int(row.missing_count) ?? 0, error_count: int(row.error_count) ?? 0,
    last_error: text(row.last_error),
    affiliate_url: text(row.affiliate_url), pv_img_url: text(row.pv_img_url),
    description: text(row.description),
  };
}

/** 全販売情報を読む。表がまだ無ければ空（初回チェック前の状態）。 */
export async function readOffers(db: OfferDatabase): Promise<Offer[]> {
  try {
    const { results } = await db.prepare('SELECT * FROM tvfit_stand_offers').all();
    return results.flatMap(row => toOffer(row) ?? []);
  } catch (error) {
    if (error instanceof Error && /no such table/iu.test(error.message)) return [];
    throw error;
  }
}

export async function saveOffer(db: OfferDatabase, offer: Offer): Promise<void> {
  await db.prepare(`INSERT INTO tvfit_stand_offers
    (stand_id, shop, url, price_jpy, availability, image_url, mpn, checked_at, last_success_at, missing_count, error_count, last_error, affiliate_url, pv_img_url, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (stand_id, shop) DO UPDATE SET
      url = excluded.url, price_jpy = excluded.price_jpy, availability = excluded.availability,
      image_url = excluded.image_url, mpn = excluded.mpn, checked_at = excluded.checked_at,
      last_success_at = excluded.last_success_at, missing_count = excluded.missing_count,
      error_count = excluded.error_count, last_error = excluded.last_error,
      affiliate_url = excluded.affiliate_url, pv_img_url = excluded.pv_img_url, description = excluded.description`)
    .bind(offer.stand_id, offer.shop, offer.url, offer.price_jpy, offer.availability, offer.image_url, offer.mpn,
      offer.checked_at, offer.last_success_at, offer.missing_count, offer.error_count, offer.last_error,
      offer.affiliate_url, offer.pv_img_url, offer.description ?? null)
    .run();
}

/** スタンドから外れた・販売店が変わった古い記録を消す。 */
export async function deleteOffer(db: OfferDatabase, standId: string, shop: string): Promise<void> {
  await db.prepare('DELETE FROM tvfit_stand_offers WHERE stand_id = ? AND shop = ?').bind(standId, shop).run();
}
