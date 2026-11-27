import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadCatalog } from '../src/lib/csv';
import { canonicalHostRedirect } from '../src/lib/trailing-slash';
import { homeDescription, manufacturerDescription, televisionDescription } from '../src/lib/page-descriptions';

const fixtures = loadCatalog(resolve('fixtures/catalog'), { allowFixtures: true });
const tv = { ...fixtures.televisions[0]!, manufacturer: 'SONY', model: 'TEST-55', screen_inches: 55, weight_kg: 17.6, vesa_width_mm: 300, vesa_height_mm: 300 };

describe('canonical host', () => {
  const redirect = (url: string, method = 'GET') => canonicalHostRedirect({ method, url }, 'https://tv-fit.com')?.href ?? null;

  it('sends workers.dev and www hosts to the canonical domain with a trailing slash', () => {
    expect(redirect('https://tv-fit.example.workers.dev/sony/kj-55x85l?ref=a')).toBe('https://tv-fit.com/sony/kj-55x85l/?ref=a');
    expect(redirect('https://www.tv-fit.com/')).toBe('https://tv-fit.com/');
    expect(redirect('https://www.tv-fit.com/sitemap.xml')).toBe('https://tv-fit.com/sitemap.xml');
  });

  it('leaves the canonical host, admin routes, other hosts and non-GET requests alone', () => {
    expect(redirect('https://tv-fit.com/about')).toBeNull();
    expect(redirect('https://tv-fit.example.workers.dev/_emdash/admin/')).toBeNull();
    expect(redirect('http://localhost:4321/about/')).toBeNull();
    expect(redirect('https://tv-fit.example.workers.dev/about/', 'POST')).toBeNull();
    expect(canonicalHostRedirect({ method: 'GET', url: 'https://www.tv-fit.com/' }, undefined)).toBeNull();
  });
});

describe('meta descriptions', () => {
  it('describes a television page with its specifications and the listed counts only', () => {
    const text = televisionDescription(tv, { stands: 12, wall: 5 });
    expect(text).toBe('SONY TEST-55（55型・17.6kg・VESA 300×300mm）に対応するテレビスタンド12件・壁掛け金具5件。メーカー確認済みと仕様上適合を区別し、出典と確認日を掲載しています。');
    expect(text).not.toMatch(/非対応|判断材料不足/);
  });

  it('does not invent specifications or products that are missing', () => {
    const text = televisionDescription({ ...tv, weight_kg: null, vesa_width_mm: null }, { stands: 0, wall: 0 });
    expect(text).toBe('SONY TEST-55（55型）の画面サイズ・本体重量・VESA取付穴間隔。対応するテレビスタンド・壁掛け金具は確認中です。');
  });

  it('keeps descriptions short enough for search results', () => {
    for (const text of [homeDescription, manufacturerDescription('TVS REGZA', 108), manufacturerDescription('TCL', 0), televisionDescription(tv, { stands: 30, wall: 20 })]) {
      expect(text.length).toBeLessThanOrEqual(130);
    }
    expect(manufacturerDescription('TCL', 59)).toContain('TCLのテレビ59機種');
  });
});
