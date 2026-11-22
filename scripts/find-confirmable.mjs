// 「仕様上の候補（candidate）」の適合情報を、サンワサプライの公式対応表と照合する（読み取りのみ・CSVは書き換えない）。
//
//   node scripts/find-confirmable.mjs > hits.json
//
// 照合先
// - サンワサプライ公式（https://www.sanwa.co.jp/product/syohin?code=<品番>）の「対応表」タブにある対応機種一覧
// - サンワダイレクト（https://direct.sanwa.co.jp/taiou/<品番>.<メーカー>）の対応表（◯／◯※／×）
// 1リクエストごとに1秒あける。結果は「確認済みにできる候補」「非対応とされた候補」「条件付き（◯※）」に分けて出す。
// 確認済みにするかどうかは、出力を見て人（または作業者）が対応表を開いて確かめてから CSV を直す。
import fs from 'node:fs';
import { parse } from 'csv-parse/sync';

const read = file => parse(fs.readFileSync(new URL(`../data/${file}`, import.meta.url)), { columns: true, skip_empty_lines: true });
const televisions = new Map(read('televisions.csv').map(row => [row.id, row]));
const stands = read('stands.csv');
const candidates = read('compatibility.csv').filter(row => row.status === 'candidate');

const makerKey = { SONY: 'sony', Panasonic: 'panasonic', SHARP: 'sharp', 'TVS REGZA': 'toshiba', LG: 'lg', Hisense: 'hisense', TCL: 'tcl' };
const normalize = model => model.toUpperCase().replace(/[\s\-‐_/]/g, '');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const init = { headers: { 'User-Agent': 'TVFIT-CompatibilityCheck/1.0 (+https://tv-fit.com/about/)' } };

const makersByStand = new Map();
for (const row of candidates) {
  const maker = makerKey[televisions.get(row.television_id)?.manufacturer];
  if (!maker) continue;
  if (!makersByStand.has(row.stand_id)) makersByStand.set(row.stand_id, new Set());
  makersByStand.get(row.stand_id).add(maker);
}

const listed = new Map();   // `${standId}:${maker}` -> Set(normalized model)
const direct = new Map();   // `${standId}:${maker}` -> Map(normalized model -> row)
const failures = [];
for (const stand of stands) {
  const makers = makersByStand.get(stand.id);
  if (!makers) continue;
  if (!stand.sku.startsWith('100-')) {
    const url = `https://www.sanwa.co.jp/product/syohin?code=${encodeURIComponent(stand.sku)}`;
    try {
      const response = await fetch(url, init);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      for (const match of html.matchAll(/maker_name=([a-z_]+)&model_size=[^&"]*&model_name=([^"&]+)"/g)) {
        const key = `${stand.id}:${match[1]}`;
        if (!listed.has(key)) listed.set(key, new Set());
        listed.get(key).add(normalize(decodeURIComponent(match[2])));
      }
    } catch (error) { failures.push(`${url} ${error.message}`); }
    await sleep(1000);
  }
  for (const maker of makers) {
    const url = `https://direct.sanwa.co.jp/taiou/${encodeURIComponent(stand.sku)}.${maker}`;
    try {
      const response = await fetch(url, init);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = new TextDecoder('shift_jis').decode(await response.arrayBuffer());
      const rows = new Map();
      for (const match of html.matchAll(/<tr>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>(?:<a[^>]*>)?([^<]*)/g)) {
        rows.set(normalize(match[2].trim()), { inches: match[1].trim(), model: match[2].trim(), vesa_w: match[3].trim(), vesa_h: match[4].trim(), mark: match[5].trim(), url });
      }
      direct.set(`${stand.id}:${maker}`, rows);
    } catch (error) { failures.push(`${url} ${error.message}`); }
    await sleep(1000);
  }
}

const result = { checked_candidates: candidates.length, confirmable: [], incompatible: [], conditional: [], failures };
for (const row of candidates) {
  const tv = televisions.get(row.television_id);
  const stand = stands.find(item => item.id === row.stand_id);
  const maker = makerKey[tv?.manufacturer];
  if (!tv || !stand || !maker) continue;
  const key = `${stand.id}:${maker}`;
  const model = normalize(tv.model);
  const base = { television_id: tv.id, stand_id: stand.id, model: tv.model, sku: stand.sku, tv_vesa: `${tv.vesa_width_mm}x${tv.vesa_height_mm}`, tv_weight_kg: tv.weight_kg };
  const entry = direct.get(key)?.get(model);
  if (entry) {
    const item = { ...base, source: entry.url, mark: entry.mark, table_vesa: `${entry.vesa_w}x${entry.vesa_h}` };
    if (entry.mark === '◯') result.confirmable.push(item);
    else if (entry.mark.startsWith('×')) result.incompatible.push(item);
    else result.conditional.push(item);
  } else if (listed.get(key)?.has(model)) {
    result.confirmable.push({ ...base, source: `https://www.sanwa.co.jp/product/syohin?code=${stand.sku}`, mark: '対応表に掲載' });
  }
}
console.log(JSON.stringify(result, null, 1));
console.error(`候補 ${result.checked_candidates}件を照合: 確認済みにできる ${result.confirmable.length}件 / 非対応 ${result.incompatible.length}件 / 条件付き ${result.conditional.length}件 / 取得失敗 ${failures.length}件`);
