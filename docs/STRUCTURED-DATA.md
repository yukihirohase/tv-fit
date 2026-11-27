# 構造化データ（JSON-LD）

各ページの `<head>` に、`@graph` 1つの JSON-LD を出力する（`src/layouts/BaseLayout.astro`）。
組み立ては `src/lib/structured-data.ts`。画面と同じデータ・同じ関数から作るので、表示を変えれば構造化データも変わる。

## ページ別

| URL | 型 | 内容 |
|---|---|---|
| `/` | WebSite, WebPage | サイト名・説明。パンくずは画面に無いので出さない |
| `/about/` | WebSite, AboutPage, BreadcrumbList | |
| `/guides/vesa/` | WebSite, WebPage, BreadcrumbList | |
| `/privacy/` | WebSite, WebPage, BreadcrumbList | noindex |
| `/{メーカー}/` | WebSite, CollectionPage, BreadcrumbList, ItemList | 型番一覧。画面の初期表示（売れ筋順）と同じ順・同じ型番名・同じURL |
| `/{メーカー}/{型番}/` | WebSite, ItemPage, BreadcrumbList, Product（テレビ）, ItemList×2 | テレビ本体と、対応するスタンド・壁掛け金具の一覧（各 Product＋Offer） |
| 404 | なし | canonical も出さない |

`@id` は `{正規URL}#webpage`・`#breadcrumb`・`#television`・`#models`・`#stands`・`#wall-mounts`・`#product-{スタンドID}`、サイトは `https://tv-fit.com/#website`。

## ルール

- **パンくず**：画面の `<Breadcrumbs items={crumbs}/>` と同じ `crumbs` を `BaseLayout` に渡す（先頭の「ホーム」は自動）。
- **型番一覧の並び**：`sortModelsForDisplay`（`src/lib/model-filter.ts`）を画面と構造化データの両方で使う。
- **テレビ本体**：価格はページに出していないので `offers` を付けない。画像は見出し横に商品画像を表示しているときだけ。
- **スタンド・壁掛け金具**：一覧に表示している商品だけ（確認済み・仕様上適合）。「販売終了品」の折りたたみは対象外。
  - 画像・商品説明は `cardMedia`（`ProductCard.astro` と共通）。
  - `offers` はカードに価格・在庫を表示している販売店だけ（代表の1件と、Yahoo!ショッピング）。値は `displayOffer` を通したもの。
  - 48時間より古い価格・不明な価格は `price` を出さない。在庫が不明なら `availability` を出さない（在庫ありで補わない）。どちらも無ければ Offer 自体を出さない。
  - 在庫：在庫あり→`InStock`、在庫なし→`OutOfStock`、取り寄せ・予約→`BackOrder`、販売終了→`Discontinued`。
  - 価格は税込（画面表示と同じ）。`priceSpecification.valueAddedTaxIncluded: true`。
- **FAQPage**：ページに FAQ が無いので出さない。FAQ を本文に載せるときに追加する（本文に無い Q&A を構造化データだけに書かない）。

## 価格・在庫の更新

価格・在庫は D1 の `tvfit_stand_offers`。6時間ごとの定期チェック（`src/worker.ts` の `scheduled`）で更新され、
型番ページは表示のたびにこの表を読む（Worker 内で最大5分キャッシュ）。画面のカードと構造化データは同じ記録・同じ時刻（`now`）から作るので、別に更新する作業はない。

## Google の検索機能との関係

schema.org の型・プロパティは公式語彙（schema.org 30.1）で検証済み。以下の Google の扱いは、作成時（2026-11）に
Google 検索セントラルの最新ページを取得できなかったため未確認。変更前に公式ドキュメントとリッチリザルトテストで確認すること。

- BreadcrumbList：パンくずのリッチリザルトの対象。
- 型番ページの Product：このサイトは商品を販売しておらず、1ページに複数の商品を並べた一覧なので、Google の商品リッチリザルト（販売者リスティング・商品スニペット）の対象ページではない。schema.org としては有効で、内容の理解のために出している。Search Console の「商品スニペット」「販売者リスティング」に、価格の無い商品などが「無効」として出ることがあるが、検索順位への悪影響はない。
- ItemList：Google のカルーセル表示はレシピ・映画など特定の種類だけが対象のため、このサイトでは表示機能の対象外。
- FAQPage：Google の FAQ リッチリザルトは、政府・医療系の権威あるサイトに限って表示される。
