import { describe, expect, it, vi } from 'vitest';
import { readStandRankingProbe, runStandRankingProbe, saveStandRankingProbe } from '../src/lib/stand-ranking-probe';
import type { RankingDatabase } from '../src/lib/tv-ranking';

const item = (code: string) => ({ modelCode: code, productCode: `100-${code}`, guid: `https://direct.sanwa.co.jp/ItemPage/${code}` });
const page = (codes: string[], extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ status: 'OK', resultCount: codes.length, ...extra, items: codes.map(item) }), { status: 200 });

describe('スタンドの売れ筋順（商品APIの rank=monthly）の試験', () => {
  const stands = [
    { id: 'sanwa-cr-last1', sku: 'CR-LAST1', product_url: 'https://direct.sanwa.co.jp/ItemPage/CR-LAST1' },
    { id: 'sanwa-100-pl012', sku: '100-PL012', product_url: 'https://direct.sanwa.co.jp/ItemPage/100-PL012' },
    { id: 'other', sku: 'X-1', product_url: 'https://shop.example.jp/X-1' },
  ];

  it('rank=monthly 付きと無しを比べ、登録済みスタンドの位置を記録する。トークンは記録しない', async () => {
    const fetcher = vi.fn(async (url: string) => new URL(url).searchParams.get('rank') === 'monthly'
      ? page(['ABC-1', '100-PL012', 'CR-LAST1'], { token: 'SECRET' })
      : page(['CR-LAST1', 'ABC-1', '100-PL012'])) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    const probe = await runStandRankingProbe({ token: 'SECRET', stands, fetcher, sleep: async () => {}, now: () => new Date('2026-11-27T00:00:00Z') });
    const monthlyUrl = new URL(fetcher.mock.calls[0]![0] as string);
    expect(Object.fromEntries(monthlyUrl.searchParams)).toMatchObject({ ecCode: 'j22up', rank: 'monthly', page: '1', format: 'json' });
    expect(new URL(fetcher.mock.calls[1]![0] as string).searchParams.has('rank')).toBe(false);
    expect(probe.monthly).toMatchObject({ status: 'OK', items: 3, pages: 1, top: ['ABC-1', '100-PL012', 'CR-LAST1'], meta: { resultCount: 3 } });
    expect(probe.monthly.item_fields).toEqual(['guid', 'modelCode', 'productCode']);
    expect(probe.same_order_as_score).toBe(false);
    expect(probe.stand_positions).toEqual({ 'sanwa-100-pl012': 2, 'sanwa-cr-last1': 3 });
    expect(JSON.stringify(probe)).not.toContain('SECRET');
  });

  it('API のエラーは記録し、例外にしない', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: 'INVALID_PARAMETER' }), { status: 200 })) as unknown as typeof fetch;
    const probe = await runStandRankingProbe({ token: 'T', stands, fetcher, sleep: async () => {} });
    expect(probe.monthly).toMatchObject({ status: 'INVALID_PARAMETER', error: 'status INVALID_PARAMETER', items: 0 });
    expect(probe.same_order_as_score).toBeNull();
  });

  it('結果を保存して読み戻す', async () => {
    const rows = new Map<string, string>();
    const db: RankingDatabase = {
      prepare(query: string) {
        let values: unknown[] = [];
        const statement = {
          bind(...args: unknown[]) { values = args; return statement; },
          async run() { if (query.startsWith('INSERT')) rows.set(String(values[0]), String(values[2])); return undefined; },
          async all<T>() { const body = rows.get(String(values[0])); return { results: (body ? [{ body }] : []) as T[] }; },
        };
        return statement;
      },
    };
    expect(await readStandRankingProbe(db)).toBeNull();
    const probe = await runStandRankingProbe({ token: 'T', stands, fetcher: vi.fn(async () => page(['CR-LAST1'])) as unknown as typeof fetch, sleep: async () => {} });
    await saveStandRankingProbe(db, probe);
    expect(await readStandRankingProbe(db)).toEqual(probe);
  });
});
