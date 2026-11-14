# TV FIT（tv-fit.com）— Claude Code 向けメモ

テレビのメーカー・型番からスタンド／壁掛け金具の適合情報を探すサイト。Astro 7 + EmDash 1.4（CMS）を Cloudflare Workers で配信する。

## 配信の流れ

- 正本は GitHub `yukihirohase/tv-fit` の `main`。
- `main` に push すると Cloudflare Workers Builds が `npm run build:cloudflare` → `npx --yes wrangler@4.162.0 deploy` を実行し、本番（https://tv-fit.com）に反映される。**main への push = 本番公開**。
- Wrangler は新しいサイズ上限（非圧縮64MiB）に対応した版を使うため、デプロイだけ `wrangler@4.162.0` を明示している（package.json の wrangler は 4.125.0 のまま）。
- 作業はブランチ → PR → CI（`.github/workflows/ci.yml`）が緑になってから `main` にマージする。
- Worker 名 `tv-fit`、D1 `tv-fit-emdash`（binding `DB`）、R2 `tv-fit-emdash-media`（binding `MEDIA`）。名前を変えると別のDB・バケットが作られてデータが見えなくなるので変更しない。
- シークレット `EMDASH_ENCRYPTION_KEY` は Cloudflare ダッシュボード側にだけ置く。Git・README・チャットに書かない。

## コマンド

```sh
npm ci
npm run check          # 型チェック
npm test               # テスト
npm run build:cloudflare  # Cloudflare 用ビルド
npm run verify         # 型・テスト・ビルド・生成物検証（CI と同じ）
```

`npm run build` / `scripts/build-sites-worker.mjs` は旧 ChatGPT Sites 向けの単一ファイル Worker を作るもの。Cloudflare 配信には使わない。

## コンテンツ

- 表示の正本は EmDash（D1）の公開済みコンテンツ。管理画面は https://tv-fit.com/_emdash/admin/ 。
- `data/*.csv` は検証・取込用。CSV を直しても表示は変わらない（`npm run cms:import` で下書き取込 → 管理画面で公開）。
- 架空の型番・製品データを作らない。適合区分を推測で `confirmed` にしない。
- 詳細は `docs/EMDASH.md`。

## 注意

- D1 のマイグレーションは前進のみ。EmDash の更新前にバックアップを取る。
- SEO：`.env.production` の `PUBLIC_INDEXING_ENABLED=true` で本番をインデックス許可している。
