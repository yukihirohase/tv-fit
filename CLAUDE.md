# TV FIT（tv-fit.com）— Claude Code 向けメモ

テレビのメーカー・型番からスタンド／壁掛け金具の適合情報を探すサイト。Astro 7 + EmDash 1.4（CMS）を Cloudflare Workers で配信する。

## 配信の流れ

- 正本は GitHub `yukihirohase/tv-fit` の `main`。
- `main` に push すると Cloudflare Workers Builds が `npm run build:cloudflare` → `npm run deploy:cloudflare` を実行し、本番（https://tv-fit.com）に反映される。**main への push = 本番公開**。
- `deploy:cloudflare` は ① `emdash migrate`（D1 のコアマイグレーションをデプロイ前に適用）→ ② `wrangler@4.162.0 deploy`。無料プランは1リクエストのCPU時間が短く、初回アクセス時の自動マイグレーションが途中で打ち切られるため、必ずデプロイ側で適用する。
- `--expected-target-fingerprint` は D1（アカウント＋DB UUID）の識別値。DB を作り直したら `npm run migrate:status` の出力で更新する。
- マイグレーションロックが残った場合（`The migration lock has been held since ...`）は `docs/EMDASH.md` と EmDash 公式の「Release a stuck migration lock」を参照（`--take-over-lock <id>`）。
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
- `data/*.csv` は一括登録用。`main` にマージすると GitHub Actions（`cms-import.yml`）が CMS に**下書き**として登録する（要 GitHub シークレット `EMDASH_API_TOKEN`）。公開は管理画面で人が行う。既存行の内容変更は取込が中止されるので、修正は管理画面で行い CSV も合わせる。列の仕様は `docs/CSV.md`。
- 架空の型番・製品データを作らない。適合区分を推測で `confirmed` にしない。
- 詳細は `docs/EMDASH.md`。

## 注意

- D1 のマイグレーションは前進のみ。EmDash の更新前にバックアップを取る。
- SEO：`.env.production` の `PUBLIC_INDEXING_ENABLED=true` で本番をインデックス許可している。
