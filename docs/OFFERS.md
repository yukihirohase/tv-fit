# 販売情報（価格・在庫）の自動チェック

適合情報（CMS）とは別に、スタンド・壁掛け金具の価格・在庫を販売店ごとに自動で確認して表示する。

## 仕組み

- Cloudflare の Cron Trigger（`wrangler.jsonc` の `triggers.crons`、6時間ごと）で `src/worker.ts` の `scheduled()` が動く。
- `scheduled()` は内部経路 `/internal/offer-check`（外部からは 404）を Astro のハンドラーへ直接渡し、`src/pages/internal/offer-check.ts` が公開済みスタンドを読んでチェックする。
- 各スタンドの `product_url`（アフィリエイトリンクなら中の販売ページ）を1秒間隔で取得し、商品ページの schema.org `Product`（JSON-LD）から価格・在庫・画像URL・型番を読む（`src/lib/offers.ts`）。
- 結果は D1 の専用表 `tvfit_stand_offers`（1スタンド × 1販売店で1行）に保存する（`src/lib/offer-store.ts`）。表は初回チェック時に `CREATE TABLE IF NOT EXISTS` で作る。EmDash の表には触れない。

## 判定

| 結果 | 記録 |
|---|---|
| Product データあり | 価格・在庫を更新 |
| 404/410、または Product データなし | `missing_count` を加算。3回続いたら `discontinued`（販売終了） |
| 5xx・通信エラー | 前回の値を維持し `error_count` を加算 |

## 表示

- 商品カードと比較表に、在庫・価格（税込）・販売店・確認日時を出す。
- 最後に読み取れてから48時間を過ぎた価格は出さない（「在庫は購入先で確認」）。
- 販売終了の商品は購入ボタンを出さず、型番ページ下部の「販売終了品」にまとめる（適合情報は残す）。
- 商品画像は URL を保存するだけで、販売店の規約を確認するまで表示しない。

## 販売店を追加するとき

1. `src/lib/offers.ts` の `shops` に販売店IDと表示名・ホスト名を足す（JSON-LD を持つ直販サイトはこれだけで動く）。
2. JSON-LD を持たない販売店（楽天・Yahoo!・Amazon など）は、各社の商品APIから同じ `Offer` 形式を作る取得部品を追加する。
3. アフィリエイトの転送URLは `affiliateRedirectors` に足すと、中の販売ページを確認する。
