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
| `release_date` |  | 発売日。日まで公表されていれば `YYYY-MM-DD`、月までなら `YYYY-MM`（「6月中旬」など日が決まらないものは月まで）。発表日・予約開始日ではなく**発売日**。未来日も可。出典（メーカー公式のニュースリリースなど）は CMS には持たず、`docs/release-date-sources.csv` に記録する | `2025-06-07` / `2025-06` |

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

## 守ること

- 架空の型番・推測の数値を入れない。わからない仕様は空欄。
- 出典はメーカー公式を優先する。
- CSV をローカルで確認するには `npm run cms:import`（検証のみ）。
