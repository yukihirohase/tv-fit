# 工程別の実装と検証

実在データは未提供のため、初期の本番 CSV はヘッダーのみです。架空データはテスト専用に隔離し、通常の本番ビルドの検索・生成 HTML・サイトマップには含めません。

| 工程 | 実装内容 | 主な変更ファイル | 検証結果 |
| --- | --- | --- | --- |
| 1. プロジェクト構造 | Astro SSG、厳格な TypeScript、Tailwind Vite 統合、固定依存関係 | `package.json`, `package-lock.json`, `astro.config.mjs`, `tsconfig.json`, `src/styles/` | 固定バージョン指定の依存インストール成功。型チェック 39 ファイル、エラー・警告・ヒント 0 件 |
| 2. CSV スキーマと検証 | Zod、数値・URL・日付、ID・適合ペア・参照整合性、正規化とルートの衝突、confirmed 根拠検証、本番への架空データ混入防止 | `src/lib/data.ts`, `src/lib/normalize.ts`, `scripts/validate-data.ts`, `data/`, `fixtures/`, `tests/data.test.ts` | データ検証テスト成功。本番 CSV はテレビ・スタンド・適合とも 0 件として検証成功 |
| 3. 型番検索 | 正式表記保持、NFKC・大小文字・ハイフン吸収、完全一致 → 前方一致 → 部分一致 → Fuse.js 類似候補、メーカー絞り込み、未登録案内 | `src/lib/search.ts`, `src/components/Search.astro`, `src/scripts/search.ts`, `tests/search.test.ts` | 検索順位・正規化・絞り込み・不存在のテスト成功。ブラウザーでメーカー選択・フォーカス・未登録検索の案内を確認 |
| 4. 型番別ページ | `getStaticPaths()` による静的 HTML、仕様・根拠・確認日・注意事項、適合区分を別表示 | `src/pages/[manufacturer]/[model].astro`, `src/components/`, `tests/components.test.ts` | 明示的な架空データを使用したページ描画・XSS・noindex テスト成功。隔離した Unicode 型番のビルド試験も成功。本番に型番ルートなし |
| 5. 商品比較 | 商品・メーカー・タイプ・耐荷重・VESA・適合区分・公式情報・購入先を比較、最大 4 商品の選択、モバイルの横スクロール対応 | `src/components/`, `src/lib/comparison.ts`, `src/styles/`, `tests/comparison.test.ts`, `tests/components.test.ts` | 比較の選択上限・絞り込み・描画・リンク属性のテスト成功 |
| 6. SEO | 固有メタ、canonical、パンくず、実表示に合う JSON-LD、XML、robots、情報不足と未設定環境の noindex、重複ページの手動除外 | `src/lib/seo.ts`, `src/config/indexing.ts`, `src/layouts/`, `src/pages/sitemap.xml.ts`, `src/pages/robots.txt.ts`, `tests/seo.test.ts` | SEO 単体テスト・生成 HTML/XML/robots 検証成功。初期環境は全ページ noindex、サイトマップ 0 URL |
| 7. GA4 | 任意の測定 ID、同意後の読み込み、DNT、4 イベント、生の検索語と URL クエリを送信しない | `src/lib/analytics.ts`, `src/scripts/analytics.ts`, `tests/analytics.test.ts` | ID・同意・DNT・イベント送信等のモックテスト成功。ブラウザーで ID 未設定時の GA4 リクエスト・スクリプト・dataLayer がないことを確認 |
| 8. 自動テスト | 品質に関わる境界値と不正入力、Astro のページ・コンポーネント描画、GitHub CI | `tests/`, `.github/workflows/ci.yml` | Vitest 6 ファイル・70 テストすべて成功。CI ワークフローは作成済み、GitHub 上での実行は未実施 |
| 9. 本番ビルド | CSV 検証後に静的 HTML とアセットを生成し、生成物を検査 | `package.json`, `scripts/verify-build.ts`, `scripts/browser-smoke.mjs`, `dist/`（生成物） | ビルド成功。HTML 5 ページ、canonical・robots・JSON-LD・rel・headers・HTML/JS/CSS の架空データ混入検証成功。Chromium 2 画面サイズの確認成功 |
| 10. 公開手順 | GitHub / Cloudflare Pages、環境変数、本番とプレビューの indexing 分離、データ追加運用 | `README.md`, `.env.example` | コマンド・環境変数・データ/SEO/計測仕様と実装を照合済み。外部 push・公開は未実施 |

## 最終検証結果

Node.js **24.22.1** / npm **11.9.0** で、固定バージョンを指定した依存関係の `npm install` と、lockfile からの `npm ci` が成功しました。

`npm run verify` は以下を順に実行し、すべて成功しました。

1. `npm run check`：39 ファイルを確認。エラー・警告・ヒントすべて 0 件。
2. `npm test`：6 ファイル、70 テストすべて成功。
3. `npm run build`：本番 CSV のテレビ・スタンド・適合がそれぞれ 0 件であることを検証し、トップ・サイト説明・VESA ガイド・プライバシー・404 の HTML 5 ページと静的アセットを生成。
4. `npm run verify:build`：canonical、robots、構造化データ、外部リンク属性、セキュリティヘッダー、HTML/JS/CSS にテスト専用データが含まれないことを確認。初期の noindex 設定でサイトマップは 0 URL。

別途、隔離したビルド試験で Unicode 型番の架空データから静的ルートを生成できることを確認しました。`.invalid` を使用したテストデータは本番ディレクトリに登録せず、最終の本番生成物に型番ルートはありません。

Chromium のブラウザーテストは **1440 × 1000** と **390 × 844** で成功しました。トップと VESA ガイドの全ページ画像を保存し、横方向のはみ出しがないこと、メーカー選択・入力へのフォーカス・未登録検索・ガイドへの遷移を確認しました。測定 ID 未設定時の GA4 通信・スクリプト・dataLayer はなく、JavaScript エラーと HTTP エラーも検出されませんでした。

GA4 の実測 ID は設定されていないため、実サービスへのイベント着信は未検証です。計測ロジックはモックで、未設定時の通信停止はブラウザーで検証しています。実在製品のデータ確認と、実際の適合判定・購入先リンクの検証は、確認済みデータの提供後に行います。

## 現時点の運用上の前提

- 本番データが空のため、実在する型番ページ・商品比較対象はありません。確認済みデータ投入後、同じビルド処理で生成します。
- 公式 URL の内容・個別適合・引用条件・アフィリエイト契約は運営者が確認します。スキーマだけでその真偽は判定しません。
- `confirmed` は登録された個別適合確認情報のみを表示します。VESA と耐荷重による自動昇格はありません。
- CSV にテレビ仕様の確認日列はありません。画面の適合最終確認日は `compatibility.checked_at` の値です。
- 重複・別名・確認中の型番は `src/config/indexing.ts` に ID と理由を登録して noindex とし、サイトマップから除外します。内容重複の意味判定は運営者が行います。
- 利用者所有の GitHub リポジトリと Cloudflare Pages への一般公開は未実施です。本人限定の閲覧版は Sites の配信設定 `.openai/hosting.json` で管理します。GitHub Actions は未実行です。
