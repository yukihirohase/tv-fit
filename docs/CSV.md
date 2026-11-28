# CSV で一括登録する

`data/` の3つの CSV を編集して `main` にマージすると、GitHub Actions（`.github/workflows/cms-import.yml`）が EmDash（https://tv-fit.com）へ **下書き** として自動登録します。公開はしません。管理画面で内容と出典を確認してから「公開」してください。

| ファイル | 内容 |
| --- | --- |
| `data/televisions.csv` | テレビ |
| `data/stands.csv` | スタンド・壁掛け金具 |
| `data/compatibility.csv` | テレビ × スタンドの適合情報 |

## 流れ

1. CSV に行を追加する（Claude Code に依頼するか、GitHub 上で直接編集）。
2. PR を作ると CI が CSV を検証する（形式・参照・重複・適合根拠のルール）。
3. `main` にマージすると「CMS import」ワークフローが下書きを登録する。
4. 管理画面 https://tv-fit.com/_emdash/admin/ で、テレビ → スタンド → 適合情報の順に確認して公開する。

手動で再実行したいときは GitHub の **Actions → CMS import → Run workflow**。

### 登録のルール

- 同じ ID（適合情報はテレビID＋スタンドIDの組）で **同じ内容** の行は、2回目以降スキップされる。何度実行しても重複しない。
- 同じ ID で **内容が違う** 行があると、書き込む前に全体を中止する。既に登録済みのデータの修正は管理画面で行い、CSV 側も同じ内容に直しておく。
- 下書きが既に CMS にある行も「登録済み」とみなす。
- 例外：適合情報を `candidate` から `confirmed`（根拠が `manufacturer_individual` / `official_individual`）に上げた行は、中止せずに CMS の該当項目を更新する。公開済みなら公開のまま反映される。格下げや他の変更は従来どおり中止する。

## 初回だけ必要な設定（API トークン）

1. 管理画面で **API トークン** を作成する。スコープは `content:read` と `content:write`。
2. GitHub のリポジトリ → **Settings → Secrets and variables → Actions → New repository secret** で、名前 `EMDASH_API_TOKEN`、値にトークンを登録する。
3. トークンはチャット・Git・README に書かない。

未設定の間は、ワークフローは CSV の検証だけ行い、警告を出して終了します。

## 列の説明

文字コードは UTF-8（Excel の「CSV UTF-8」で保存可）。1行目の見出しは変更しない。空欄可の列は空のままでよい。URL はすべて `https://`。

### televisions.csv

| 列 | 必須 | 内容 | 例 |
| --- | --- | --- | --- |
| `id` | ○ | 固定の管理ID。小文字英数字とハイフン。後から変えない（メーカー＋型番を小文字にするのが目安） | `sony-（型番を小文字で）` |
| `manufacturer` | ○ | メーカー名。サイトのメーカー一覧と表記を合わせる（SONY / Panasonic / SHARP / TVS REGZA / LG / Hisense / TCL） | `SONY` |
| `model` | ○ | 正式型番（公式表記のまま） | — |
| `screen_inches` |  | 画面サイズ（インチ） | `55` の形式 |
| `weight_kg` |  | **テレビ本体のみ**の質量（スタンド込みではない）。小数可 | `12.5` の形式 |
| `vesa_width_mm` |  | VESA 横（mm、整数）。高さと両方入れるか両方空欄 | `300` の形式 |
| `vesa_height_mm` |  | VESA 縦（mm、整数） | `200` の形式 |
| `source_url` |  | メーカー公式の仕様ページ | `https://…` |
| `release_date` |  | 発売日。日まで公表されていれば `YYYY-MM-DD`、旬までなら `YYYY-MM-上旬`／`YYYY-MM-中旬`／`YYYY-MM-下旬`、月までなら `YYYY-MM`。発表日・予約開始日ではなく**発売日**。未来日も可。出典はメーカー公式（ニュースリリースなど）を優先する。公式に日までの発売日が無いときは価格.comの商品ページの「発売日」を使う。公式と価格.comが食い違うときは公式の値にする。出典は CMS には持たず、`docs/release-date-sources.csv` に記録する。CMSに入っている発売日を直すときは「CMS import」を `fill_blanks`・`include_published`・`overwrite_release_date` をオンにして手動実行する | `2025-06-07` / `2025-06-下旬` / `2025-06` |

### stands.csv

| 列 | 必須 | 内容 | 例 |
| --- | --- | --- | --- |
| `id` | ○ | 固定の管理ID（メーカー＋商品型番を小文字で） | — |
| `manufacturer` | ○ | メーカー名 | — |
| `sku` | ○ | 商品型番（公式表記のまま） | — |
| `stand_type` | ○ | `floor`（床置き）／`tabletop`（卓上）／`wall`（壁掛け金具） | `wall` |
| `max_weight_kg` | ○ | 耐荷重（kg） | `40` の形式 |
| `vesa_patterns` | ○ | 対応 VESA を `横x縦` で、複数は `;` 区切り。確認できたものだけ | `200x200;300x300` の形式 |
| `source_url` | ○ | メーカー公式の商品・仕様ページ | `https://…` |
| `product_url` |  | 購入先ページ | `https://…` |

### compatibility.csv

| 列 | 必須 | 内容 |
| --- | --- | --- |
| `television_id` | ○ | televisions.csv の `id` |
| `stand_id` | ○ | stands.csv の `id` |
| `status` | ○ | 下表の適合区分 |
| `evidence_type` | ○ | 下表の根拠の種類 |
| `evidence_url` | ※ | 根拠の出典 URL（`unknown` 以外は必須） |
| `checked_at` | ※ | 確認日 `YYYY-MM-DD`（`unknown` 以外は必須。未来日不可） |
| `notes` | ※ | 根拠の説明・注意事項（`unknown` 以外は必須）。ネジ径、スペーサー、背面の段差、端子干渉など |

`status` と `evidence_type` の組み合わせ：

| status | 意味 | 使える evidence_type |
| --- | --- | --- |
| `confirmed` | 個別に適合確認済み | `manufacturer_individual`（メーカーの適合表）／`official_individual`（公式の個別確認） |
| `candidate` | 仕様（VESA・重量）上は適合しそう | `specification` |
| `incompatible` | 適合しない | `manufacturer_individual`／`official_individual`／`specification` |
| `unknown` | 判断できない | `insufficient` など |

VESA と重量が合っているだけでは `confirmed` にしない（`candidate`）。

### 候補を確認済みにする（定期調査）

`node scripts/find-confirmable.mjs > hits.json` で、全 `candidate` をサンワサプライ公式の対応表（sanwa.co.jp の「対応表」タブ、サンワダイレクトの `taiou` ページ）と照合する（読み取りのみ）。

- `confirmable`：対応表で「◯（対応）」または対応機種一覧に掲載。対応表を開いて型番・VESA を確かめてから `confirmed` / `manufacturer_individual` に直し、`evidence_url` を対応表の URL、`checked_at` を確認日にする。
- `incompatible`：対応表で「×」。`incompatible` に直す候補（要確認）。
- `conditional`：「◯※（条件付き）」。条件の内容を確かめるまで `candidate` のままにする。

## 仕様データ（比較表・結論ブロック・機種ごとの独自情報用）

`data/stand-specs.csv` と `data/tv-details.csv` は、型番ページの比較表・おすすめ・取付メモに使う仕様の一覧です。**CMS には登録しません**（CMS import の対象外）。CI の `npm run validate:data` が検証し、エラーがあるとデプロイも止まります。

- 値は **メーカー公式の仕様表・寸法図** から取る。販売店の説明文やレビューは使わない。
- **分からない値は空欄**。推測で埋めない（表では「—」と表示する）。
- 数字の列は単位を列名で固定し、セルには数字だけを書く（`mm`・`kg`・型）。範囲は `_min` と `_max` の2列に分ける。
- 値を入れた行は、出典URL（`https://`）と確認日（`YYYY-MM-DD`、未来日は不可）が必要。

### stand-specs.csv（スタンド・壁掛け金具 1商品1行）

| 列 | 内容 | 値 |
| --- | --- | --- |
| `stand_id` / `sku` | stands.csv の `id` と `sku`（一致しないとエラー） | — |
| `style` | 設置タイプ | 床置き：`wall_close`（壁寄せ）・`floor_caster`（キャスター付き）・`floor`（据え置き）・`low`（ロータイプ）／卓上：`tabletop`／壁掛け：`wall_fixed`（角度固定）・`wall_tilt`（角度調整）・`wall_arm`（アーム） |
| `height_adjust` | 高さ調整（壁掛けは空欄） | `electric`（電動昇降）・`manual`（ハンドル等でテレビを付けたまま昇降）・`steps`（段階・無段階で設定） |
| `min_inches` / `max_inches` | 対応テレビサイズ（型） | 最大だけ公表なら `min_inches` は空欄 |
| `width_mm` / `depth_min_mm` / `depth_max_mm` / `height_min_mm` / `height_max_mm` | 公式の外形寸法 W・D・H。壁掛け金具の D は壁からの奥行 | 「最大H」だけなら `height_min_mm` は空欄 |
| `size_text` | 公式の外形寸法の表記そのまま（測り方の注記を含む） | — |
| `bracket_center_min_mm` / `bracket_center_max_mm` | 床からブラケット（取付部）中心までの高さ。公式に明記がある商品だけ | — |
| `product_weight_kg` | 商品自体の重量 | — |
| `tilt` / `swivel` | 上下の角度調整・左右の首振り。公式の表記を短く書き写す | `上8°・下12°`、`±10°`、`左右各45°` |
| `wall_distance_mm` | 壁面から取付面までの距離（公式に明記がある壁掛け金具だけ） | — |
| `casters` / `shelf` | キャスター・棚板 | `1`（あり）・`0`（なし）・空欄（不明） |
| `one_liner` | 一行コメント（**40字以内**）。公式の説明文を書き写さず、「誰に・どんな置き方に向くか」を自分の言葉で書く | — |
| `spec_note` | 空欄にした理由など（例：公式の記載が食い違う） | — |
| `spec_source_url` / `spec_checked_at` | 出典（サンワサプライ公式またはサンワダイレクトの商品ページ）と確認日 | — |

### tv-details.csv（テレビ 1機種1行）

| 列 | 内容 |
| --- | --- |
| `television_id` / `model` | televisions.csv の `id` と `model`（一致しないとエラー） |
| `width_mm` / `height_mm` / `depth_mm` | 本体のみ（スタンドなし）の外形寸法 |
| `height_with_stand_mm` / `depth_with_stand_mm` | 純正スタンド込みの高さ・奥行（高さが2段階なら低い方を入れ、`detail_note` に書く） |
| `stand_width_mm` | 純正スタンドの幅（公表しているメーカーだけ） |
| `tabletop_min_width_mm` / `tabletop_min_depth_mm` | メーカーが示す「設置に必要なテレビ台の天板の最小サイズ」 |
| `vesa_center_from_bottom_mm` | 本体下端から VESA 取付穴の中心までの高さ（寸法図から読む） |
| `back_shape` | 背面の形：`flat`（平ら）・`lower_bulge`（下部が厚い）・`center_bulge`（中央が厚い）・`upper_bulge`（上部が厚い） |
| `screw` | 取付ネジの径（`M6` など） |
| `detail_note` | 補足（スタンドの高さが2段階など） |
| `source_url` / `checked_at` | 出典（メーカー公式の仕様ページ・仕様書PDF・寸法図）と確認日 |

検証では、本体の幅が画面サイズから計算した画面の横幅に合うか（列ずれ・単位違いの検出）、スタンド込みの高さが本体より低くないか、VESA中心が本体の高さを超えないかも確かめます。

## 守ること

- 架空の型番・推測の数値を入れない。わからない仕様は空欄。
- 出典はメーカー公式を優先する。
- CSV をローカルで確認するには `npm run cms:import`（検証のみ）。
