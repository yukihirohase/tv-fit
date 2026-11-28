"""サンワサプライ公式（www.sanwa.co.jp）とサンワダイレクト（direct.sanwa.co.jp）の商品ページから、
スタンド・壁掛け金具の仕様を取り出す。公式に明記された値だけを使い、読めない・食い違う値は空欄にする。
使い方: python3 -I extract_stand_specs.py <pages_dir> <stands.csv> <out.csv> <evidence.txt>
"""
import csv, html, re, sys
from pathlib import Path

pages, stands_csv, out_csv, evidence_txt = map(Path, sys.argv[1:5])
CHECKED_AT = '2026-11-28'

# 角度は表記がまちまちで、符号や向きの解釈を誤りやすいため、公式の文言を短く書き写す（出典の文言を併記）。
ANGLES = {
    'CR-LAST30': ('0〜8°', '', '角度調整も0度～8度の範囲で可能'),
    'CR-LAST36': ('上下45°', '左右60°', '角度（左右：60度、上下：45度、回転：360度）'),
    'CR-LAW117': ('上15°・下15°', '左右90°', 'チルト（画面上下）/上15度、下15度、パン（画面左右）/左90度、右90度'),
    'CR-PL35BK': ('±10°', '', '±10°のチルト機能付き'),
    'CR-PL59BK': ('45〜70°（6段階）', '', '45°～70°で6段階で角度調整'),
    'CR-PL60BK': ('±10°', '', '±10°のチルト機能'),
    'CR-PL61BK': ('±10°', '', '±10°のチルト機能'),
    'CR-PL62BK': ('＋5°〜−10°', '', '＋5°～－10°のチルト機能'),
    'CR-PL66': ('0〜2°', '', '0〜2°の範囲で画面の傾きを微調整'),
    'CR-PLD001': ('', '左右35°', '左右35度の角度調節'),
    'CR-PLD002': ('', '左右35°', '左右35度の角度調節'),
    'CR-PLKG10': ('±15°', '', 'チルト角度は±15°'),
    'CR-PLKG13': ('上8°・下10°', '', 'チルト角度は上向きに8°、下向きに10°'),
    'CR-PLKG14': ('上8°・下12°', '', 'チルト角度は上向きに8°、下向きに12°'),
    '100-LAD001': ('', '左右各45°', '左右へ各45度の角度調節'),
    '100-LASM007': ('−5°〜15°', '', 'チルト角度は-5°～15°'),
    '100-PL002': ('上5°・下15°', '', '角度は下向きに15°、上向きに5°'),
    '100-PL005': ('上8°・下12°', '左右各44°', '角度は左右に各44°、上下に下向き12°、上向きに8°'),
    '100-PL006': ('上2°・下10°', '左右各45°', '角度は左右に各45°、上下に下向き10°、上向きに2°'),
    '100-PL028BK': ('手前10°・後ろ5°', '', 'テレビブラケットは手前に10度、後ろに5度の角度調節'),
    '100-PL034M': ('＋5°〜−10°', '', '画面の角度は+5°から-10°まで調整できるチルト機能'),
    '100-PL039': ('', '左右各35°', '左右に35度ずつ首振り'),
    '100-PL041': ('＋5°〜−10°', '', 'チルト角度＋5°～－10°'),
    '100-PLD001': ('', '左右45°', '左右45度の角度調節'),
    '100-PLW001': ('上9°・下13°', '左右各45°', 'テレビの角度は上方向9度、下方向13度、左右各45度の調整'),
}


def text(fragment: str) -> str:
    fragment = re.sub(r'<br\s*/?>', '\n', fragment, flags=re.I)
    return html.unescape(re.sub(r'<[^>]+>', '', fragment)).replace('\r', '').strip()


def fmt(value):
    if value is None:
        return ''
    value = round(value, 2)
    return str(int(value)) if float(value).is_integer() else str(value)


def table_after(page: str, start: int) -> dict:
    end = page.find('</table>', start)
    rows = re.findall(r'<th[^>]*>(.*?)</th>\s*<td[^>]*>(.*?)</td>', page[start:end], re.S)
    return {re.sub(r'\s', '', text(th)): text(td) for th, td in rows}


def nums(s: str):
    return [float(x) for x in re.findall(r'\d+(?:\.\d+)?', s)]


def parse_dims(value: str):
    """外形寸法 → (幅, 奥行min, 奥行max, 高さmin, 高さmax)。mm に揃える。読めない項目は None。"""
    v = value.split('\n')[0].replace(',', '').replace('，', '').replace('〜', '～').replace('~', '～')
    scale = 10 if re.search(r'cm', v) and not re.search(r'mm', v) else 1
    v = v.replace('幅', 'W').replace('奥行', 'D').replace('高さ', 'H')

    def part(key):
        m = re.search(rf'(最大)?{key}\s*(-?[\d.]+(?:\s*[～/・]\s*-?[\d.]+)*)', v)
        if not m:
            return None, None
        values = [float(x) * scale for x in re.findall(r'-?[\d.]+', m.group(2))]
        if any(x <= 0 for x in values):
            return None, None
        if m.group(1):  # 「最大H2333」：最大値だけ
            return None, max(values)
        return min(values), max(values)

    if '直径' in v and 'W' not in v:
        width = None
    else:
        width = part('W')[1]
    dmin, dmax = part('D')
    hmin, hmax = part('H')
    return width, dmin, dmax, hmin, hmax


def size_range(title: str, spec: dict, compat: str, features: str):
    """対応テレビサイズ（型）。公式の対応情報 → 仕様表 → 商品名 → 本文（商品名の最大値と一致するときだけ）。"""
    m = re.search(r'対応ディスプレイサイズ\s*(\d+)\s*[～〜~]\s*(\d+)\s*インチ', compat)
    if m:
        return int(m.group(1)), int(m.group(2)), f'対応情報 {m.group(0)}'
    m_max = re.search(r'最大\s*(\d+)\s*インチ', compat)
    if m_max:
        m_min = re.search(r'最小\s*(\d+)\s*インチ', compat)
        return (int(m_min.group(1)) if m_min else None), int(m_max.group(1)), f'対応情報 {m_max.group(0)} {m_min.group(0) if m_min else ""}'.strip()
    lo = next((spec[k] for k in spec if re.match(r'対応ディスプレイサイズ_最小', k)), None)
    hi = next((spec[k] for k in spec if re.match(r'対応ディスプレイサイズ_最大', k)), None)
    if hi:
        return (int(nums(lo)[0]) if lo else None), int(nums(hi)[0]), f'仕様 最大{hi} 最小{lo}'
    for key in ('対応モニタサイズ', '対応ディスプレイサイズ'):
        if key in spec:
            m = re.search(r'(\d+)\s*(?:型|インチ)?\s*[～〜~\-ー]\s*(\d+)', spec[key])
            if m:
                return int(m.group(1)), int(m.group(2)), f'仕様 {key} {spec[key]}'
            m = re.search(r'最大\s*(\d+)', spec[key])
            if m:
                return None, int(m.group(1)), f'仕様 {key} {spec[key]}'
    name = title.split('｜')[0].split('|')[0]
    run = re.search(r'\d+\s*インチ(?:\s*/\s*\d+\s*インチ)+', name)
    if run:
        listed = [int(x) for x in re.findall(r'(\d+)\s*インチ', run.group(0))]
        return min(listed), max(listed), f'商品名 {run.group(0)}'
    m = re.search(r'(\d+)\s*(?:型|インチ)?\s*(?:[～〜~\-]|から)\s*(\d+)\s*(?:型|インチ)', name)
    if m:
        lo, hi = int(m.group(1)), int(m.group(2))
        extra = [int(x) for x in re.findall(r'(\d+)\s*(?:型|インチ)', name[m.end():m.end() + 12])]
        if extra and max(extra) > hi:
            hi = max(extra)
        return lo, hi, f'商品名 {name[m.start():m.end() + 8]}'
    run = re.search(r'\d+\s*インチ(?:\s*/\s*\d+\s*インチ)+', name)
    listed = [int(x) for x in re.findall(r'(\d+)\s*インチ', run.group(0))] if run else []
    if len(listed) >= 2:
        return min(listed), max(listed), f'商品名 {"/".join(map(str, listed))}インチ'
    m = re.search(r'(\d+)\s*(?:型|インチ)以上', name)
    lo = int(m.group(1)) if m else None
    m = re.search(r'(\d+)\s*(?:型|インチ)\s*(?:まで)?(?:対応)?', name.replace(f'{lo}インチ以上', '') if lo else name)
    hi = int(m.group(1)) if m else None
    if hi is not None:
        if lo is None:
            f = re.search(rf'(\d+)\s*[～〜~]\s*{hi}\s*(?:型|インチ)', features)
            if f:
                return int(f.group(1)), hi, f'商品名 最大{hi}型 / 特長 {f.group(0)}'
        return lo, hi, f'商品名 {m.group(0)}'
    return None, None, ''


stands = list(csv.DictReader(stands_csv.open(encoding='utf-8-sig')))
rows, evidence = [], []
for stand in stands:
    sku = stand['sku']
    raw = (pages / f'{sku}.html').read_bytes()
    direct = 'direct.sanwa.co.jp' in stand['source_url']
    page = raw.decode('cp932' if direct else 'utf-8', errors='replace')
    title = text(re.search(r'<title>(.*?)</title>', page, re.S).group(1))
    if direct:
        anchor = page.find('id=inc_spec')
        spec = table_after(page, anchor) if anchor >= 0 else {}
        fs = page.find('id=inc_fetr')
        features = text(page[fs:page.find('<!-- ******* include', fs + 20)]) if fs >= 0 else ''
        compat = ''
    else:
        anchor = page.find('>仕様</span></h2>')
        spec = table_after(page, anchor) if anchor >= 0 else {}
        features = text(page[max(0, anchor - 12000):anchor])
        # 「対応情報」の欄（対応ディスプレイサイズ・対応VESA など）。比較表など他の商品の記載は含めない。
        info = max(page.rfind('対応情報', 0, page.find('対応VESA</th>')), 0) if page.find('対応VESA</th>') >= 0 else -1
        compat = re.sub(r'\s+', ' ', text(page[info:info + 4000])) if info >= 0 else ''
    ev = [f'== {sku}（{stand["stand_type"]}）{title.split("｜")[0][:100]}']
    notes = []

    lo, hi, why = size_range(title, spec, compat, features)
    if why: ev.append(f'  対応サイズ: {why}')

    dims_key = next((k for k in spec if re.match(r'(製品)?サイズ(（外寸）|\(外寸\))?$', k)), None)
    size_text = spec.get(dims_key, '').replace('\n', ' / ') if dims_key else ''
    width, dmin, dmax, hmin, hmax = parse_dims(spec[dims_key]) if dims_key else (None,) * 5
    if size_text: ev.append(f'  外形寸法: {size_text[:140]}')

    bc_min = bc_max = None
    candidates = []
    if spec.get('ブラケット中心位置'):
        candidates.append(('仕様', spec['ブラケット中心位置']))
    for label, src in (('商品名', title), ('本文', text(page)), ('外形寸法', size_text)):
        for m in re.finditer(r'(?:ブラケット|ディスプレイ)中心(?:位置)?(?:の高さ)?[^\d約]{0,4}約?([\d.]+\s*(?:[～〜~・]\s*約?[\d.]+)?\s*(?:cm|mm))', src):
            candidates.append((label, m.group(1)))
    candidates = list(dict.fromkeys(candidates))
    parsed = set()
    for label, value in candidates:
        values = nums(value)
        k = 10 if 'cm' in value else 1
        if values:
            parsed.add((min(values) * k, max(values) * k))
    if len(parsed) == 1:
        bc_min, bc_max = parsed.pop()
        ev.append(f'  ブラケット中心: {"; ".join(f"{l} {v}" for l, v in candidates)}')
    elif len(parsed) > 1:
        notes.append('ブラケット中心の高さは公式の記載が食い違うため空欄（' + '／'.join(f'{l}: {v}' for l, v in candidates) + '）')
        ev.append('  ブラケット中心: 食い違い → 空欄 ' + '; '.join(f'{l} {v}' for l, v in candidates))

    weight = None
    wkey = next((k for k in ('重量', '製品重量') if k in spec), None)
    wsrc = spec[wkey] if wkey else (size_text if re.search(r'[\d.]+\s*(kg|㎏)', size_text) else '')
    if wsrc:
        m = re.search(r'([\d.]+)\s*(kg|㎏|g)\b', wsrc.replace('㎏', 'kg'))
        if m: weight = float(m.group(1)) / (1000 if m.group(2) == 'g' else 1)

    tilt, swivel, quote = ANGLES.get(sku, ('', '', ''))
    if quote: ev.append(f'  角度: {quote}')

    wall_distance = None
    if spec.get('壁面からブラケット前面までの距離'):
        m = re.search(r'([\d.]+)\s*mm', spec['壁面からブラケット前面までの距離'])
        if m: wall_distance = float(m.group(1)); ev.append(f'  壁からの距離: {spec["壁面からブラケット前面までの距離"]}')

    casters = None
    caster_value = next((spec[k] for k in spec if k.startswith('キャスターの有無') or k == 'キャスター'), '')
    if caster_value.startswith('あり') or 'キャスター径' in spec:
        casters = 1; ev.append(f'  キャスター: 仕様 {caster_value or "キャスター径あり"}')
    elif caster_value.startswith('なし'):
        casters = 0; ev.append('  キャスター: 仕様 なし')
    elif re.search(r'キャスター', title.split('｜')[0]):
        casters = 1; ev.append('  キャスター: 商品名')
    elif re.search(r'キャスター(?:付|を装備|を搭載)', features):
        casters = 1; ev.append('  キャスター: 特長')

    shelf = None
    if re.search(r'棚', title.split('｜')[0]) or any(re.match(r'(上|下)?棚(板)?(サイズ|耐荷重)', k) for k in spec):
        shelf = 1; ev.append('  棚: あり')

    st = stand['stand_type']
    name = title.split('｜')[0]
    height_adjust = ''
    if st != 'wall':
        if re.search(r'電動', name): height_adjust = 'electric'
        elif re.search(r'手動(上下)?昇降|ハンドル', name + features[:3000]): height_adjust = 'manual'
        elif re.search(r'段階|高さ(調整|調節|可変|変更)|無段階|\d+～\d+cm可変', name + features[:3000]): height_adjust = 'steps'
    style = ''
    if st == 'tabletop':
        style = 'tabletop'
    elif st == 'wall':
        if re.search(r'アーム|関節', name): style = 'wall_arm'
        elif re.search(r'角度固定|固定式|薄型|スリム', name): style = 'wall_fixed'
        elif tilt or re.search(r'角度調[整節]', name): style = 'wall_tilt'
    else:
        if re.search(r'壁寄せ', name): style = 'wall_close'
        elif re.search(r'ロータイプ', name): style = 'low'
        elif casters == 1: style = 'floor_caster'
        elif casters == 0: style = 'floor'
    ev.append(f'  → style={style or "空欄"} 昇降={height_adjust or "空欄"} 対応={lo}-{hi}型 W={fmt(width)} D={fmt(dmin)}-{fmt(dmax)} H={fmt(hmin)}-{fmt(hmax)} 重量={fmt(weight)} チルト={tilt} 首振り={swivel}')

    rows.append({
        'stand_id': stand['id'], 'sku': sku, 'style': style, 'height_adjust': height_adjust,
        'min_inches': fmt(lo), 'max_inches': fmt(hi),
        'width_mm': fmt(width), 'depth_min_mm': fmt(dmin), 'depth_max_mm': fmt(dmax),
        'height_min_mm': fmt(hmin), 'height_max_mm': fmt(hmax), 'size_text': size_text,
        'bracket_center_min_mm': fmt(bc_min), 'bracket_center_max_mm': fmt(bc_max),
        'product_weight_kg': fmt(weight), 'tilt': tilt, 'swivel': swivel,
        'wall_distance_mm': fmt(wall_distance), 'casters': fmt(casters), 'shelf': fmt(shelf),
        'one_liner': '', 'spec_note': ' '.join(notes),
        'spec_source_url': stand['source_url'], 'spec_checked_at': CHECKED_AT,
    })
    evidence.extend(ev)

with out_csv.open('w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator='\n')
    writer.writeheader(); writer.writerows(rows)
evidence_txt.write_text('\n'.join(evidence) + '\n', encoding='utf-8')
print(f'{len(rows)} rows')
