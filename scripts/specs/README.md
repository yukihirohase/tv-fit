# 仕様データの下書きを作る道具

`data/stand-specs.csv` と `data/tv-details.csv` の下書きを、メーカー公式ページから作るための Python スクリプト。CI では使わない。出力は必ず人が確認し、`npm run validate:data` を通してから `data/` に置く。

## 1. 公式ページを保存する（1ページずつ、間隔を空けて）

```sh
mkdir -p tmp/sanwa tmp/tv
# スタンド：stands.csv の source_url を sku 名で保存
awk -F, 'NR>1{print $3" "$7}' data/stands.csv | while read sku url; do
  curl -sS -A "Mozilla/5.0 (compatible; TVFIT-spec-check)" -o "tmp/sanwa/$sku.html" "$url"; sleep 1; done
# テレビ：televisions.csv の source_url を URL の SHA-1 先頭16文字で保存
awk -F, 'NR>1{print $8}' data/televisions.csv | sort -u | while read url; do
  curl -sSL -A "Mozilla/5.0 (compatible; TVFIT-spec-check)" -o "tmp/tv/$(printf '%s' "$url" | sha1sum | cut -c1-16)" "$url"; sleep 1; done
```

## 2. 下書きを作る

```sh
python3 -I scripts/specs/extract_stand_specs.py tmp/sanwa data/stands.csv tmp/stand-specs.csv tmp/stand-evidence.txt
python3 -I scripts/specs/extract_tv_details.py tmp/tv data/televisions.csv tmp/tv-details.csv tmp/tv-evidence.txt
```

`*-evidence.txt` に、各値をどの記載から取ったか（空欄の理由）が出る。確認してから `data/` へコピーする。

## 方針

- 公式に明記された値だけを使う。読めない・食い違う値は空欄（`spec_note`／`detail_note` に理由）。
- スタンドの角度（`tilt`・`swivel`）は表記がまちまちなので、`extract_stand_specs.py` の `ANGLES` に公式の文言を書き写して管理する。
- テレビは、ページの各サイズの記録のうち「本体のみの質量」が `televisions.csv` の `weight_kg` と一致したものだけを使う（列ずれ防止）。同じ質量が複数あるときは画面サイズに合う幅で絞り、決まらなければ空欄。
- TCL は仕様がページ読み込み後に別サーバーから表示されるため取得できない（空欄）。
- Panasonic の仕様書PDFは `pdftotext`（poppler-utils）で読む。
