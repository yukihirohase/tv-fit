# TV FIT｜テレビスタンド対応検索

EmDash 1.4.0 の管理画面とデータベースを備えた、Astro・TypeScript 製のサイトです。テレビ・スタンド・適合情報を CMS で編集し、公開した内容をページ表示時に読み込みます。画面は「メーカーを選ぶ → 型番一覧から選ぶ → 対応情報・商品比較を見る」の順です。

実在する製品データは提供されていないため、初期カタログは空です。メーカーの一覧には SONY、Panasonic、SHARP、TVS REGZA、LG、Hisense、TCL を表示しますが、架空の型番で一覧を埋めません。`fixtures/` は自動テスト専用です。

## サイトと管理画面

- 本番サイト（独自ドメイン）： https://tv-fit.com/
- EmDash 管理画面： https://tv-fit.com/_emdash/admin/
- Sites の予備 URL： https://tv-fit-stand-search-mvp.workspace-240263.chatgpt.site/

`tv-fit.com` は 2026-11-10 に DNS・SSL・Sites の検証が完了しています。パスキーはホスト名に結び付くため、初回の管理者作成とパスキー登録には独自ドメインの管理画面を使用します。管理者や実在製品のデータを自動作成する処理はありません。

詳しい導入・編集・CSV 取込・バックアップ・直接 Cloudflare 配信の手順は [EmDash 運用ガイド](docs/EMDASH.md) にまとめています。

## 開発環境

- Node.js 24 推奨（最低 22.23.4）
- Astro 7.4.7、EmDash / `@emdash-cms/cloudflare` 1.4.0
- TypeScript、Tailwind CSS 4、Zod、Fuse.js（既存検索処理を保持）
- Cloudflare Workers、D1（CMS）、R2（メディア等）

EmDash の管理画面には React を使用します。公開画面の Astro コンポーネントとデザインは引き継ぎます。静的 HTML だけを配置する Cloudflare Pages 構成から、サーバー処理を実行する Workers 構成に変更しています。

```sh
npm ci
cp .env.example .env
npm run dev
```

開発用シークレットの用意は [運用ガイド](docs/EMDASH.md#開発環境の準備) に従ってください。ホームディレクトリが読み取り専用の環境では、Astro・Wrangler の設定・ログ・キャッシュを、書き込み可能な作業ディレクトリへ向ける必要があります。

`localhost:4321` は起動した環境のアドレスです。クラウド上の開発サーバーへ、自分のパソコンの `localhost` で接続することはできません。普段のブラウザーで確認する場合は、上の Sites 配信 URL を使用してください。

## GitHub とデプロイ

ソースコードの正本は [yukihirohase/tv-fit](https://github.com/yukihirohase/tv-fit) の `main` ブランチです。本番は自分の Cloudflare アカウントの Worker `tv-fit` で配信し、Cloudflare Workers Builds が `main` への push ごとに自動でビルド・デプロイします（**main への push = 本番公開**）。

| 項目 | 値 |
| --- | --- |
| ビルドコマンド | `npm run build:cloudflare` |
| デプロイコマンド | `npm run deploy:cloudflare`（`emdash migrate` → `wrangler deploy`） |
| シークレット | `EMDASH_ENCRYPTION_KEY`（Cloudflare ダッシュボードの Worker 設定にのみ保存） |
| D1 / R2 | `tv-fit-emdash`（`DB`）/ `tv-fit-emdash-media`（`MEDIA`） |

変更はブランチで行い、PR の CI（`Verify`）が通ってから `main` にマージします。

```sh
git checkout -b my-change
npm ci
npm run verify
git push -u origin my-change   # PR を作成 → CI 確認 → main にマージで本番反映
```

`npm run build`（`scripts/build-sites-worker.mjs`）は旧 ChatGPT Sites 向けの単一ファイル Worker を作るビルドで、Cloudflare 配信には使いません。

## CSV 一括登録

`data/*.csv` を更新して `main` にマージすると、GitHub Actions が EmDash に下書きとして登録します。列の仕様と初回設定（API トークン）は [CSV 一括登録ガイド](docs/CSV.md) を参照してください。

## 主なコマンド

```sh
npm run check          # Astro / TypeScript 型チェック
npm test               # CMS・データ・メーカー導線・SEO・計測等のテスト
npm run validate:data  # 取込用の本番 CSV を検証
npm run cms:import     # CSV の検証だけ（通信・書込なし）
npm run cms:import -- --directory data --apply  # 認証済み CMS へ下書き取込
npm run cms:export -- --out work/cms-export     # 公開済み CMS を3つの CSV に書出し
npm run build          # EmDash を含む Worker と公開アセットをビルド
npm run verify         # プロジェクトで定義した型・テスト・ビルド・生成物検証
```

取込の `--apply` と書出しには `EMDASH_BASE_URL`・`EMDASH_API_TOKEN` が必要です。API トークンは環境変数へ設定し、チャット・Git・コマンド引数へ記載しないでください。本人限定 Sites の外側の ChatGPT ログインと、EmDash の API トークン認証は別です。この CLI は、直接配信する Cloudflare ドメイン、または信頼できるローカル開発環境で使用します。Sites の本人限定版はブラウザーの管理画面から編集できます。

## コンテンツと CSV の対応

EmDash の公開済みコンテンツを表示の正本とします。`data/*.csv` は検証・取込・交換用です。CSV を編集しただけでは CMS の表示は更新されません。CMS の保存と「公開」を行うと、公開ページの次の読込に反映されます。

| CMS コレクション | CSV | CMS 固有の対応 |
| --- | --- | --- |
| `televisions` | `televisions.csv` | CSV の `id` → `external_id` |
| `stands` | `stands.csv` | CSV の `id` → `external_id` |
| `compatibility` | `compatibility.csv` | CSV の `status` → `compatibility_status` |

EmDash 自身の `id` と `status` は、CMS の識別子・下書き／公開状態です。商品の適合判定には使用しません。適合情報の `television_id` と `stand_id` は、元の CSV と同じ外部 ID を入力する文字列項目です。保存・公開時に参照関係を検証します。

```csv
id,manufacturer,model,screen_inches,weight_kg,vesa_width_mm,vesa_height_mm,source_url,release_date,release_source_url
```

```csv
id,manufacturer,sku,stand_type,max_weight_kg,vesa_patterns,source_url,product_url
```

```csv
television_id,stand_id,status,evidence_type,evidence_url,checked_at,notes
```

UTF-8・上記の列順を使用します。`stand_type` は `floor` / `tabletop` / `wall`、VESA は `200x200;400x400` のような確認済みパターンの列挙です。テレビの不明な仕様は空欄にします。重量は、取り付け対象となる本体重量かどうかを出典で確認してください。

## 適合情報の品質

| 適合区分 | 表示・運用 |
| --- | --- |
| `confirmed` | メーカー等による個別適合確認。根拠 URL・確認日・注記が必須 |
| `candidate` | 仕様上の候補。個別の取付適合は未確認 |
| `incompatible` | 明確な非対応。購入候補から除外 |
| `unknown` | 判断材料不足。非対応とは区別 |

VESA・重量の一致だけで `confirmed` に変更する機能はありません。`evidence_type` は `manufacturer_individual` / `official_individual` / `specification` / `insufficient`。前二者だけが `confirmed` の根拠種別になります。`checked_at` は適合情報を確認した `YYYY-MM-DD` で、テレビ仕様の更新日ではありません。

独自の CMS 検証プラグインと公開データの検証により、不正値・参照切れ・正規化や URL の衝突・根拠不足を拒否します。出典が実際に公式であるか、対象型番の適合が記載されているかは、運営者が原文を確認します。スキーマで出典の真偽を認証するものではありません。

## SEO・広告・計測

- メーカー一覧・型番詳細は、公開済みの CMS データから HTML を生成します。下書きは公開ページへ表示しません。
- 固有の title・description・canonical、パンくず、実表示に合う構造化データ、XML サイトマップを提供します。価格・評価を創作しません。
- 空の一覧、情報不足、架空データ、手動除外対象は noindex とし、サイトマップに含めません。重複ページの除外は `src/config/indexing.ts` で管理します。
- `PUBLIC_SITE_URL` と `PUBLIC_INDEXING_ENABLED=true` がそろうまで全ページを noindex にします。初期の本人限定版ではインデックスを許可しません。
- 購入リンクに広告表示と `sponsored nofollow noopener noreferrer` を付与します。背面形状・ネジ・スペーサー・配線・設置面も確認するよう案内します。
- GA4 は `PUBLIC_GA4_MEASUREMENT_ID` が有効で、利用者が同意した後に読み込みます。DNT を尊重し、生の検索文字列や購入先の完全 URL を送信しません。

| GA4 イベント | 発生箇所 |
| --- | --- |
| `tv_result_click` | 型番一覧からの選択 |
| `compatibility_view` | 同意後、表示中の適合情報ごとに1回 |
| `affiliate_click` | 購入先リンクの選択 |
| `tv_search` | 保持している検索コンポーネントを利用した場合。現在のメーカー選択導線では未使用 |

`PUBLIC_` 変数は公開情報です。シークレットを設定しないでください。CMS の暗号化キーと API トークンは別の非公開設定として管理します。

## ソース構成

```text
seed/seed.json                 空のCMSコレクション定義（製品データなし）
plugins/tv-fit-validation/      適合根拠・参照・衝突等の保存検証
src/lib/data.ts                純粋なカタログスキーマ・検証・URL生成
src/lib/csv.ts                 オフラインCSV読込
src/lib/cms-mapping.ts         CMSとCSVの明示的な項目対応
src/lib/cms-catalog.ts         公開済みCMSカタログの取得・検証
src/live.config.ts             EmDash Live Collection
src/pages/                    既存のメーカー選択・型番一覧・詳細・ガイド
scripts/cms-import.ts          検証後の下書き取込
scripts/cms-export.ts          公開済みデータのCSV書出し
wrangler.jsonc                 直接Cloudflareへ配信する設定
.openai/hosting.json            SitesのWorker・D1・R2配信設定
```

## 参考資料

- [EmDash を既存 Astro プロジェクトへ追加](https://docs.emdashcms.com/existing-project/)
- [EmDash の Cloudflare Workers 配信](https://docs.emdashcms.com/deployment/cloudflare/)
- [EmDash のフィールド型](https://docs.emdashcms.com/reference/field-types/)
- [EmDash の REST API](https://docs.emdashcms.com/reference/rest-api/)

最終確認では型チェック 0 エラー、テスト 146 件、本番 Worker 検証、`tv-fit.com` のトップ・EmDash 認証 API・管理画面の HTTP 200 を確認しました。既存の工程別記録は [IMPLEMENTATION.md](docs/IMPLEMENTATION.md) に残しています。
