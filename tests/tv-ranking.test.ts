import { describe, expect, it, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { load } from 'cheerio';
import { fetchRakutenRanking, matchRanking, parseRakutenRanking, rankingLabel, RAKUTEN_RANKING_URL, RAKUTEN_TV_GENRE_ID, updateRankingIfDue, type RankingDatabase } from '../src/lib/tv-ranking';
import { compareModels } from '../src/lib/model-filter';
import ModelList from '../src/components/ModelList.astro';
import type { Television } from '../src/lib/data';

const tv = (id: string, model: string, overrides: Partial<Television> = {}): Television => ({ id, manufacturer: 'TVS REGZA', model, screen_inches: 55, weight_kg: 15, vesa_width_mm: 300, vesa_height_mm: 300, source_url: null, release_date: '2025-06', ...overrides });
const page = (items: { rank: number; itemName: string }[], pageCount = 1) => ({ Items: items.map(Item => ({ Item })), pageCount });
const json = (...bodies: { body: unknown; status?: number }[]) => {
  let call = 0;
  return vi.fn(async (_url: string, _init?: RequestInit) => { const { body, status = 200 } = bodies[Math.min(call++, bodies.length - 1)]!; return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
};

describe('楽天市場ランキングとの照合', () => {
  it('formatVersion 1 と 2 の両方を読む', () => {
    expect(parseRakutenRanking(page([{ rank: 1, itemName: 'A' }]))).toEqual([{ rank: 1, name: 'A' }]);
    expect(parseRakutenRanking({ Items: [{ rank: 2, itemName: 'B' }] })).toEqual([{ rank: 2, name: 'B' }]);
    expect(parseRakutenRanking({})).toEqual([]);
  });

  it('商品名の型番で照合し、当サイト内で1位から振り直す', () => {
    const televisions = [tv('a', '55E350R'), tv('b', '43A400'), tv('c', '43A400 Pro'), tv('d', 'K-65XR80M2'), tv('e', '65E350R')];
    const ranks = matchRanking([
      { rank: 3, name: 'REGZA レグザ 液晶テレビ ５５Ｅ３５０Ｒ [55V型 /4K対応]' },
      { rank: 7, name: 'TCL 43A400PRO 43型' },
      { rank: 9, name: 'ソニー BRAVIA K65XR80M2 65V型' },
      { rank: 12, name: 'REGZA 55E350R 再掲' },
      { rank: 20, name: 'TCL 43A4000 43型' }, // 似た別型番には一致しない
    ], televisions);
    expect(Object.fromEntries([...ranks].map(([id, value]) => [id, value.rank]))).toEqual({ a: 1, c: 2, d: 3 });
    expect(ranks.get('a')?.sourceRank).toBe(3);
    expect(ranks.has('b')).toBe(false); // 「43A400」だけの商品は無い（43A400PRO には一致しない）
  });

  it('複数サイズをまとめた商品は、各型番に同じ元順位を当てる', () => {
    const ranks = matchRanking([{ rank: 5, name: 'REGZA 55E350R / 65E350R 4K液晶' }], [tv('a', '55E350R'), tv('e', '65E350R')]);
    expect([...ranks.values()].map(value => value.sourceRank)).toEqual([5, 5]);
    expect([...ranks.values()].map(value => value.rank)).toEqual([1, 2]);
  });
});

describe('楽天市場ランキングAPIの取得', () => {
  it('テレビのジャンルを全ページ取り、認証情報と Referer を付ける', async () => {
    const fetcher = json({ body: page([{ rank: 1, itemName: 'A' }], 2) }, { body: page([{ rank: 31, itemName: 'B' }], 2) });
    const result = await fetchRakutenRanking({ appId: 'APP', accessKey: 'KEY' }, { fetcher, sleep: async () => {} });
    expect(result).toEqual({ ok: true, items: [{ rank: 1, name: 'A' }, { rank: 31, name: 'B' }] });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const url = new URL(fetcher.mock.calls[0]![0] as string);
    expect(`${url.origin}${url.pathname}`).toBe(RAKUTEN_RANKING_URL);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ applicationId: 'APP', accessKey: 'KEY', genreId: RAKUTEN_TV_GENRE_ID, page: '1' });
    expect((fetcher.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ Referer: 'https://tv-fit.com/' });
  });

  it('最終ページを越えた 404 は正常終了、最初からの失敗はエラー', async () => {
    const ended = await fetchRakutenRanking({ appId: 'A', accessKey: 'K' }, { fetcher: json({ body: page([{ rank: 1, itemName: 'A' }], 0) }, { body: { error: 'not_found' }, status: 404 }), sleep: async () => {}, maxPages: 5 });
    expect(ended).toEqual({ ok: true, items: [{ rank: 1, name: 'A' }] });
    const denied = await fetchRakutenRanking({ appId: 'A', accessKey: 'K' }, { fetcher: json({ body: { errors: { errorCode: 403, errorMessage: 'REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING' } }, status: 403 }), sleep: async () => {} });
    expect(denied).toEqual({ ok: false, detail: '楽天API HTTP 403 REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING' });
  });
});

describe('週1回の更新', () => {
  function memoryDb() {
    const ranking: Record<string, unknown>[] = [];
    let run: Record<string, unknown> | null = null;
    const db: RankingDatabase = {
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async run() {
                if (query.startsWith('DELETE')) ranking.length = 0;
                else if (query.startsWith('INSERT INTO tvfit_tv_ranking')) ranking.push({ television_id: values[0], rank: values[1], source_rank: values[2], as_of: values[3] });
                else if (query.startsWith('INSERT INTO tvfit_ranking_runs')) run = { attempted_at: values[1], succeeded_at: values[2] ?? (run?.succeeded_at ?? null), source_items: values[3], matched: values[4], last_error: values[5] };
                return undefined;
              },
              async all<T>() {
                if (query.includes('FROM tvfit_ranking_runs')) return { results: (run ? [run] : []) as T[] };
                return { results: [...ranking].sort((a, b) => Number(a.rank) - Number(b.rank)) as T[] };
              },
            };
          },
        };
      },
    };
    return { db, ranking, getRun: () => run };
  }

  it('認証情報が無ければ何もしない。7日以内は取り直さない。失敗しても前回の順位を残す', async () => {
    const { db, ranking, getRun } = memoryDb();
    const televisions = [tv('a', '55E350R')];
    expect(await updateRankingIfDue({ db, televisions, credentials: null })).toMatchObject({ status: 'skipped' });
    const t0 = new Date('2026-11-25T00:00:00Z');
    const ok = json({ body: page([{ rank: 4, itemName: 'REGZA 55E350R' }]) });
    expect(await updateRankingIfDue({ db, televisions, credentials: { appId: 'A', accessKey: 'K' }, fetcher: ok, sleep: async () => {}, now: () => t0 })).toEqual({ status: 'updated', sourceItems: 1, matched: 1 });
    expect(ranking).toEqual([{ television_id: 'a', rank: 1, source_rank: 4, as_of: t0.toISOString() }]);
    expect(await updateRankingIfDue({ db, televisions, credentials: { appId: 'A', accessKey: 'K' }, fetcher: ok, now: () => new Date('2026-11-28T00:00:00Z') })).toMatchObject({ status: 'skipped' });
    const fail = json({ body: {}, status: 500 });
    expect(await updateRankingIfDue({ db, televisions, credentials: { appId: 'A', accessKey: 'K' }, fetcher: fail, sleep: async () => {}, now: () => new Date('2026-12-02T00:00:00Z') })).toMatchObject({ status: 'error' });
    expect(ranking).toHaveLength(1);
    expect(getRun()).toMatchObject({ last_error: '楽天API HTTP 500', succeeded_at: t0.toISOString() });
  });
});

describe('売れ筋の表示と並べ替え', () => {
  const asOf = '2026-11-25T03:00:00.000Z';
  it('「売れ筋ランキング 〇位（N件中）（M/D時点）」。古い順位は出さない', () => {
    expect(rankingLabel(3, 436, asOf, new Date('2026-11-26T00:00:00Z'))).toBe('売れ筋ランキング 3位（436件中）（11/25時点）');
    expect(rankingLabel(3, 436, asOf, new Date('2027-01-10T00:00:00Z'))).toBeNull();
    expect(rankingLabel(null, 436, asOf)).toBeNull();
  });

  it('売れ筋順は順位のある型番を上から、順位の無い型番は発売日の新しい順で後ろ', () => {
    const items = [
      { model: 'A', size: 55, release: 20250601, rank: null },
      { model: 'B', size: 55, release: 20240601, rank: 2 },
      { model: 'C', size: 55, release: 20260601, rank: null },
      { model: 'D', size: 55, release: 20230601, rank: 1 },
    ];
    expect([...items].sort((a, b) => compareModels(a, b, 'popular')).map(item => item.model)).toEqual(['D', 'B', 'C', 'A']);
    expect([...items].sort((a, b) => compareModels(a, b)).map(item => item.model)).toEqual(['D', 'B', 'C', 'A']);
  });

  it('型番一覧に順位を出し、売れ筋順を既定にする', async () => {
    const container = await AstroContainer.create();
    const televisions = [tv('a', '55E350R', { release_date: '2026-06' }), tv('b', '65E350R', { release_date: '2024-06' })];
    const html = await container.renderToString(ModelList, { props: { televisions, manufacturerName: 'TVS REGZA', ranking: { asOf: new Date().toISOString(), ranks: new Map([['b', 7]]) }, rankingTotal: 436 } });
    const $ = load(html);
    expect($('[data-model-item]').map((_, el) => $(el).attr('data-model')).get()).toEqual(['65E350R', '55E350R']);
    expect($('[data-model-item]').first().attr('data-rank')).toBe('7');
    expect($('.model-card-rank').text()).toMatch(/^売れ筋ランキング 7位（436件中）（\d+\/\d+時点）$/u);
    expect($('[data-model-filter-sort] option[selected]').text()).toBe('売れ筋順');
  });
});
