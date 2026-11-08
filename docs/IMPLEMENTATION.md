# 工程別の実装と検証

実在データは未提供のため、本番 CSV はヘッダーのみです。架空データはテスト専用に隔離し、通常の本番ビルドの検索・生成 HTML・サイトマップには含めません。

## 今回の UI 変更

トップページの操作はメーカー選択に集約しました。メーカーのカードは `/sony/` などのメーカー別型番一覧ページへのリンクです。一覧から正式型番を選ぶと、従来の型番詳細ページへ移動します。ヘッダーやガイドからの案内も、トップのメーカー選択へ戻ります。

メーカー別一覧には、そのメーカーに属する登録済みのテレビだけを静的リンクとして表示します。JavaScript が無効でもメーカー選択・型番選択を利用できます。初期の 7 メーカーにはデータ未登録の案内を表示し、架空の型番は追加しません。空の一覧、またはインデックス可能な型番がない一覧は `noindex` としてサイトマップから除外します。

型番一覧からの選択は既存の `tv_result_click` イベントとして計測します。型番検索ライブラリと検索コンポーネントは残していますが、現在の画面には検索欄を配置していないため `tv_search` は通常の導線では発火しません。

| 工程 | 実装内容 | 主な変更ファイル | 検証対象・方法 |
| --- | --- | --- | --- |
| 1. プロジェクト構造 | Astro SSG、厳格な TypeScript、Tailwind Vite 統合、固定依存関係 | `package.json`, `package-lock.json`, `astro.config.mjs`, `tsconfig.json`, `src/styles/` | `npm run check` による Astro / TypeScript の検証 |
| 2. CSV スキーマと検証 | Zod、数値・URL・日付、ID・適合ペア・参照整合性、正規化とルートの衝突、confirmed 根拠検証、本番への架空データ混入防止 | `src/lib/data.ts`, `src/lib/normalize.ts`, `scripts/validate-data.ts`, `data/`, `fixtures/`, `tests/data.test.ts` | データ検証テストと `npm run validate:data`。本番 CSV はテレビ・スタンド・適合とも 0 件 |
| 3. メーカー選択と型番一覧 | トップのメーカー選択、メーカー別の静的型番一覧、正式型番へのリンク、データ未登録案内。既存 Fuse.js 検索処理は保持 | `src/pages/index.astro`, `src/lib/manufacturers.ts`, `src/pages/[manufacturer]/index.astro`, `src/components/ModelList.astro`, `tests/manufacturers.test.ts`, `tests/navigation.test.ts` | トップに型番入力欄がないこと、メーカーリンク先の生成、メーカー別の掲載範囲、空一覧・noindex、型番詳細への導線を検証 |
| 4. 型番別ページ | `getStaticPaths()` による静的 HTML、仕様・根拠・確認日・注意事項、適合区分を別表示 | `src/pages/[manufacturer]/[model].astro`, `src/components/`, `tests/components.test.ts` | テスト専用の架空データを使用したページ描画・XSS・noindex テスト。本番に架空の型番ルートがないことを生成物検証 |
| 5. 商品比較 | 商品・メーカー・タイプ・耐荷重・VESA・適合区分・公式情報・購入先を比較、最大 4 商品の選択、モバイルの横スクロール対応 | `src/components/`, `src/lib/comparison.ts`, `src/styles/`, `tests/comparison.test.ts`, `tests/components.test.ts` | 比較の選択上限・描画・リンク属性をテスト |
| 6. SEO | 固有メタ、canonical、パンくず、実表示に合う JSON-LD、XML、robots、空一覧・情報不足・未設定環境の noindex、重複ページの手動除外 | `src/lib/seo.ts`, `src/lib/manufacturers.ts`, `src/config/indexing.ts`, `src/layouts/`, `src/pages/sitemap.xml.ts`, `src/pages/robots.txt.ts`, `tests/seo.test.ts` | SEO 単体テストと生成 HTML/XML/robots 検証。空のメーカー一覧がインデックス・サイトマップ対象外であることを確認 |
| 7. GA4 | 任意の測定 ID、同意後の読み込み、DNT、型番選択・購入クリック・適合閲覧イベント。既存の検索イベント処理を保持 | `src/lib/analytics.ts`, `src/scripts/analytics.ts`, `src/components/ModelList.astro`, `tests/analytics.test.ts` | ID・同意・DNT・イベント送信等のモックテスト。未設定時もサイトの動作に影響しないことを確認 |
| 8. 自動テスト | 品質に関わる境界値と不正入力、Astro のページ・コンポーネント描画、GitHub CI | `tests/`, `.github/workflows/ci.yml` | `npm test`。GitHub 上での CI 実行は未実施 |
| 9. 本番ビルド | CSV 検証後に静的 HTML とアセットを生成し、生成物を検査 | `package.json`, `scripts/verify-build.ts`, `dist/`（生成物） | `npm run build` と `npm run verify:build`。メーカー別ページ・リンク先・canonical・robots・JSON-LD・rel・headers・架空データ混入を検証 |
| 10. 公開手順 | Sites の本人限定配信と、所有する GitHub / Cloudflare Pages への公開手順、環境変数、データ追加運用 | `.openai/hosting.json`, `README.md`, `.env.example` | 既存の配信先と公開範囲を保ち、同じ URL に更新。GitHub / Cloudflare Pages の一般公開は未実施 |

## 今回の最終検証結果

Node.js 24.22.1 / npm 11.9.0 で検証しました。

- 型チェック：44 ファイル、エラー・警告・ヒントすべて 0 件。
- 自動テスト：8 ファイル、86 件すべて成功。
- 本番 CSV 検証：テレビ・スタンド・適合とも 0 件、実在データや架空データの追加なし。
- 本番ビルド：12 ページを生成。既存 5 ページと、7 メーカーの型番一覧。
- 生成物検査：メーカー選択だけのトップ、7 つの遷移先、型番一覧の掲載範囲、内部リンクとフラグメント、canonical、noindex、JSON-LD、rel、ヘッダー、架空データ混入の検査に成功。
- 初期設定のサイトマップは 0 URL。空のメーカー一覧はインデックス許可の環境でも noindex を維持。
- 任意ブラウザーテストのスクリプトは新導線へ更新し、JavaScript 構文検証済み。ブラウザーでは未実行。

今回のブラウザー操作による検証は未実施です。管理されたプレビューの中継機能が利用できず、ブラウザー操作ツールも提供されていないため、静的 HTML の生成とコンポーネント描画テストで導線を検証します。初回版のブラウザーテストや旧画面画像を、今回変更した UI の確認結果としては扱いません。

## 初回構築時の検証記録

Node.js **24.22.1** / npm **11.9.0** で固定バージョン指定の `npm install` と、lockfile からの `npm ci` が成功しています。初回版では型チェックと 70 件の自動テスト、5 ページの本番ビルド、生成物検証に成功しました。

初回版では別途、隔離したビルド試験で Unicode 型番の架空データから静的ルートを生成できることを確認しました。`.invalid` を使用したテストデータは本番ディレクトリに登録していません。初回版の Chromium 確認は 1440 × 1000 と 390 × 844 で行いました。この記録はメーカー選択方式への変更前のものです。

## 現時点の運用上の前提

- 本番データが空のため、メーカー別ページは準備中の案内となり、実在する型番詳細・商品比較対象はありません。確認済みデータ投入後、同じビルド処理で一覧と詳細を生成します。
- 公式 URL の内容・個別適合・引用条件・アフィリエイト契約は運営者が確認します。スキーマだけでその真偽は判定しません。
- `confirmed` は登録された個別適合確認情報のみを表示します。VESA と耐荷重による自動昇格はありません。
- CSV にテレビ仕様の確認日列はありません。画面の適合最終確認日は `compatibility.checked_at` の値です。
- 重複・別名・確認中の型番は `src/config/indexing.ts` に ID と理由を登録して noindex とし、サイトマップから除外します。内容重複の意味判定は運営者が行います。
- GA4 の実測 ID は設定されていないため、実サービスへのイベント着信は未検証です。計測ロジックはモックで検証します。実在製品のデータ確認と、実際の適合判定・購入先リンクの検証は確認済みデータの提供後に行います。
- 利用者所有の GitHub リポジトリと Cloudflare Pages への一般公開は未実施です。本人限定の閲覧版は Sites の配信設定 `.openai/hosting.json` で管理します。GitHub Actions は未実行です。
