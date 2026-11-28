"""テレビメーカー公式の仕様ページから、外形寸法などを取り出して data/tv-details.csv のテンプレートを作る。

列ずれを防ぐため、ページから取り出した各サイズの記録は「本体のみの質量」が televisions.csv の weight_kg と
一致したテレビにだけ使う（一致する記録が1つに決まらなければ空欄）。公式に無い値・読めない値は空欄。
寸法図にしか無い値（VESAの位置・背面の形・ネジ）は空欄のまま。
使い方: python3 -I extract_tv_details.py <pages_dir> <televisions.csv> <out.csv> <evidence.txt>
"""
import csv, hashlib, html, re, subprocess, sys
from pathlib import Path

pages, tv_csv, out_csv, evidence_txt = map(Path, sys.argv[1:5])
CHECKED_AT = '2026-11-28'
COLUMNS = ['television_id', 'model', 'width_mm', 'height_mm', 'depth_mm', 'height_with_stand_mm', 'depth_with_stand_mm',
           'stand_width_mm', 'tabletop_min_width_mm', 'tabletop_min_depth_mm',
           'vesa_center_from_bottom_mm', 'back_shape', 'screw', 'detail_note', 'source_url', 'checked_at']


def page_file(url: str) -> Path:
    return pages / hashlib.sha1(url.encode()).hexdigest()[:16]


def plain(raw: bytes) -> str:
    t = raw.decode('utf-8', errors='replace')
    t = re.sub(r'<script.*?</script>|<style.*?</style>', '', t, flags=re.S)
    t = html.unescape(re.sub(r'<[^>]+>', '\n', t))
    t = re.sub(r'[ \t　]+', ' ', t)
    return re.sub(r'\n\s*\n+', '\n', t)


def mm(value: str, unit: str = 'cm') -> float:
    v = float(value.replace(',', ''))
    return round(v * 10, 1) if unit == 'cm' else v


def fmt(v):
    if v is None:
        return ''
    return str(int(v)) if float(v).is_integer() else str(round(v, 1))


def triple(s: str):
    m = re.search(r'([\d.,]+)\s*[x×]\s*([\d.,]+)\s*[x×]\s*([\d.,]+)', s)
    return tuple(m.groups()) if m else None


# ---------- メーカーごとに、ページから「サイズごとの記録」を取り出す ----------

def sony(text: str):
    """【型番】幅 x 高さ x 奥行[スタンド込み（標準スタイル）]（cm）と、【型番】本体質量[スタンド込み]。"""
    recs = {}
    dims = text[text.find('外形寸法（幅×高さ×奥行）'):text.find('質量［スタンド含む］')]
    for model, body, rest in re.findall(r'【([^】]+)】\s*([\d.]+\s*x\s*[\d.]+\s*x\s*[\d.]+)((?:\[[^\]]*\])*)', dims):
        w, h, d = triple(body)
        styles = re.findall(r'\[([^\]]*)\]', rest)
        std = next((s for s in styles if '標準' in s), styles[0] if styles else '')
        r = {'model': model, 'width': mm(w), 'height': mm(h), 'depth': mm(d), 'note': []}
        t3 = triple(std)
        if t3:
            r['height_with_stand'], r['depth_with_stand'] = mm(t3[1]), mm(t3[2])
            if len(styles) > 1:
                r['note'].append('スタンド込みの寸法は標準スタイル')
        recs[model] = r
    wsec = text[text.find('質量［スタンド含む］'):text.find('質量［スタンド含む］') + 4000]
    for model, body in re.findall(r'【([^】]+)】\s*([\d.]+)\s*\[', wsec):
        if model in recs and 'weight' not in recs[model]:  # 後ろの別の表（消費電力など）で上書きしない
            recs[model]['weight'] = float(body)
    return list(recs.values())


def sharp(text: str):
    """型番ごとのブロック：外形寸法（幅×奥行×高さ）①ディスプレイ部＋スタンド部 / スタンド幅 ②ディスプレイ部。"""
    recs = []
    start = text.find('寸法・質量\n')
    block_text = text[start:]
    for m in re.finditer(r'外形寸法（幅×奥行×高さ）(.*?)本体質量(.*?)梱包', block_text, re.S):
        dims, weights = m.group(1), m.group(2)
        one = re.search(r'①\s*([\d.]+)×([\d.]+)×([\d.]+)\s*cm', dims)
        two = re.search(r'②\s*([\d.]+)×([\d.]+)×([\d.]+)\s*cm', dims)
        sw = re.search(r'スタンド幅[：:]\s*([\d.]+)\s*cm', dims)
        wt = re.search(r'②\s*約?([\d.]+)\s*kg', weights)
        if not (two and wt):
            continue
        r = {'width': mm(two.group(1)), 'depth': mm(two.group(2)), 'height': mm(two.group(3)), 'weight': float(wt.group(1)), 'note': []}
        if one:
            r['depth_with_stand'], r['height_with_stand'] = mm(one.group(2)), mm(one.group(3))
        if sw:
            r['stand_width'] = mm(sw.group(1))
        recs.append(r)
    return recs


def regza(text: str):
    """外形寸法（スタンド付き）幅・高さ・奥行（cm）と 質量（スタンド含む／本体のみ）。"""
    recs = []
    for m in re.finditer(r'外形寸法[（(]スタンド付き[）)]\s*\n?(.*?)\n.*?質量[（(]スタンド含む[／/]本体のみ[）)]\s*\n?(.*?)\n', text, re.S):
        dims, weights = m.group(1), m.group(2)
        w = re.search(r'幅\s*([\d.]+)\s*cm', dims)
        hs = re.findall(r'([\d.]+)\s*cm', re.search(r'高さ(.*?)(?:，|,)\s*奥行', dims).group(1)) if re.search(r'高さ(.*?)(?:，|,)\s*奥行', dims) else []
        d = re.search(r'奥行\s*([\d.]+)\s*cm', dims)
        body = re.search(r'[／/]\s*([\d.]+)\s*[kK]g', weights)
        if not (w and body):
            continue
        r = {'width': mm(w.group(1)), 'weight': float(body.group(1)), 'note': []}
        if hs:
            r['height_with_stand'] = min(mm(h) for h in hs)
            if len(hs) > 1:
                r['note'].append('スタンドの高さは2段階（低い方）')
        if d:
            r['depth_with_stand'] = mm(d.group(1))
        recs.append(r)
    return recs


def hisense(raw: bytes):
    """横に型番が並ぶ表。各行の末尾 N 列が各型番の値。"""
    t = raw.decode('utf-8', errors='replace')
    recs = []
    for table in re.findall(r'<table.*?</table>', t, re.S):
        rows = []
        for tr in re.findall(r'<tr.*?</tr>', table, re.S):
            cells = [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', c))).strip() for c in re.findall(r'<t[hd][^>]*>.*?</t[hd]>', tr, re.S)]
            rows.append(cells)
        models = next((r for r in rows if r and r[0] == '型番'), None)
        if not models:
            continue
        n = len(models) - 1
        cols = [{'note': []} for _ in range(n)]
        def values(label_re):
            for r in rows:
                if len(r) > n and re.search(label_re, ' '.join(r[:-n])):
                    return r[-n:]
            return None
        with_stand = values(r'スタンド含む \(cm\)')
        without = values(r'スタンド含まない \(cm\)')
        body_weight = values(r'スタンド含まない\s*\(kg\)')
        tabletop = values(r'最小テレビ台天板サイズ')
        for i in range(n):
            c = cols[i]
            if without and triple(without[i]):
                w, h, d = triple(without[i]); c.update(width=mm(w), height=mm(h), depth=mm(d))
            if with_stand:
                ts = re.findall(r'([\d.]+)×([\d.]+)×([\d.]+)', with_stand[i])
                if ts:
                    c['height_with_stand'] = min(mm(x[1]) for x in ts); c['depth_with_stand'] = mm(ts[0][2])
                    if len(ts) > 1: c['note'].append('スタンドの高さは2段階（低い方）')
            if body_weight and re.fullmatch(r'[\d.]+', body_weight[i]):
                c['weight'] = float(body_weight[i])
            if tabletop:
                tt = re.findall(r'([\d.]+)×([\d.]+)', tabletop[i])
                if len(tt) == 1:
                    c['tabletop_min_width'], c['tabletop_min_depth'] = mm(tt[0][0]), mm(tt[0][1])
                elif len(tt) > 1:
                    c['note'].append('最小テレビ台天板サイズは複数の記載があるため空欄')
        recs.extend(c for c in cols if 'weight' in c)
    return recs


def panasonic(raw: bytes):
    """仕様書PDF：外形寸法 幅・高さ・奥行（スタンド含む、mm）と 質量（本体のみ）。"""
    text = subprocess.run(['pdftotext', '-layout', '-', '-'], input=raw, capture_output=True).stdout.decode('utf-8', 'replace')
    text = re.sub(r'[ \t　]+', ' ', text)
    m = re.search(r'外 ?形 ?寸 ?法\s*幅\s*([\d,]+)\s*mm\s*高さ\s*([\d,]+)\s*mm\s*奥行\s*([\d,]+)\s*mm（スタンド含む）', text)
    wt = re.search(r'約\s*([\d.]+)\s*kg（本体のみ）', text)
    if not (m and wt):
        return []
    return [{'width': mm(m.group(1), 'mm'), 'height_with_stand': mm(m.group(2), 'mm'), 'depth_with_stand': mm(m.group(3), 'mm'), 'weight': float(wt.group(1)), 'note': []}]


def lg(raw: bytes):
    """製品ページに埋め込まれた仕様（techSpecs）。寸法・質量があれば使う。"""
    t = raw.decode('utf-8', errors='replace')
    pairs = dict(re.findall(r'name\\+":\\+"(.*?)\\+",\\+"value\\+":\\+"(.*?)\\+"', t))
    r = {'note': []}
    for name, value in pairs.items():
        if re.search(r'本体質量.*含まず|質量.*スタンド含まず|スタンドなし.*質量', name):
            m = re.search(r'([\d.]+)', value); r['weight'] = float(m.group(1)) if m else None
        if re.search(r'寸法.*スタンド含まず|スタンドなし.*寸法', name) and triple(value):
            w, h, d = triple(value); unit = 'mm' if 'mm' in value or float(w.replace(',', '')) > 400 else 'cm'
            r.update(width=mm(w, unit), height=mm(h, unit), depth=mm(d, unit))
        if re.search(r'寸法.*スタンド含む|スタンドあり.*寸法', name) and triple(value):
            w, h, d = triple(value); unit = 'mm' if 'mm' in value or float(w.replace(',', '')) > 400 else 'cm'
            r.update(height_with_stand=mm(h, unit), depth_with_stand=mm(d, unit))
    return [r] if r.get('weight') else []


# ---------- テレビごとに、質量が一致する記録を選ぶ ----------

tvs = list(csv.DictReader(tv_csv.open(encoding='utf-8-sig')))
cache, rows, evidence = {}, [], []
counts = {}
for tv in tvs:
    url, maker = tv['source_url'], tv['manufacturer']
    row = {c: '' for c in COLUMNS}
    row.update(television_id=tv['id'], model=tv['model'])
    f = page_file(url)
    status = ''
    if not f.exists():
        status = '未取得'
    elif maker == 'TCL':
        status = '仕様がページ読み込み後に表示されるため未取得'
    else:
        if url not in cache:
            raw = f.read_bytes()
            try:
                if maker == 'SONY': cache[url] = sony(plain(raw))
                elif maker == 'SHARP': cache[url] = sharp(plain(raw))
                elif maker == 'TVS REGZA': cache[url] = regza(plain(raw))
                elif maker == 'Hisense': cache[url] = hisense(raw)
                elif maker == 'Panasonic': cache[url] = panasonic(raw)
                elif maker == 'LG': cache[url] = lg(raw)
            except Exception as error:  # noqa: BLE001 - 1ページの失敗で全体を止めない
                cache[url] = []; evidence.append(f'!! {url} {error}')
        recs = cache.get(url, [])
        weight = float(tv['weight_kg']) if tv['weight_kg'] else None
        matched = [r for r in recs if weight is not None and r.get('weight') is not None and abs(r['weight'] - weight) < 0.051]
        named = [r for r in matched if r.get('model') == tv['model']]
        if named:  # 型番が書かれた記録（SONY）は型番で決める（質量も一致していること）
            matched = named
        if len(matched) > 1 and tv['screen_inches']:
            # 同じ質量のサイズ違いが並ぶときは、画面サイズに合う幅の記録に絞る
            screen_w = float(tv['screen_inches']) * 25.4 * 16 / (16 ** 2 + 9 ** 2) ** 0.5
            matched = [r for r in matched if r.get('width') and screen_w * 0.97 <= r['width'] <= screen_w * 1.15]
        if weight is None:
            status = 'televisions.csv の質量が空欄のため照合できず'
        elif not recs:
            status = 'ページに寸法の記載なし'
        elif len(matched) != 1:
            status = f'質量 {weight}kg に一致する記録が{len(matched)}件のため空欄'
        else:
            r = matched[0]
            for key, column in [('width', 'width_mm'), ('height', 'height_mm'), ('depth', 'depth_mm'),
                                ('height_with_stand', 'height_with_stand_mm'), ('depth_with_stand', 'depth_with_stand_mm'),
                                ('stand_width', 'stand_width_mm'), ('tabletop_min_width', 'tabletop_min_width_mm'),
                                ('tabletop_min_depth', 'tabletop_min_depth_mm')]:
                row[column] = fmt(r.get(key))
            row['detail_note'] = '。'.join(r.get('note', []))
            status = 'OK'
    if any(row[c] for c in COLUMNS[2:10]):
        row['source_url'], row['checked_at'] = url, CHECKED_AT
    counts[(maker, status)] = counts.get((maker, status), 0) + 1
    evidence.append(f'{maker}\t{tv["model"]}\t{status}\t' + ' '.join(f'{c}={row[c]}' for c in COLUMNS[2:10] if row[c]))
    rows.append(row)

with out_csv.open('w', encoding='utf-8', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=COLUMNS, lineterminator='\n'); w.writeheader(); w.writerows(rows)
evidence_txt.write_text('\n'.join(evidence) + '\n', encoding='utf-8')
for (maker, status), n in sorted(counts.items()):
    print(f'{maker}\t{status}\t{n}')
