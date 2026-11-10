import { loadCatalog } from '../src/lib/csv';
import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { load } from 'cheerio';
import Search from '../src/components/Search.astro';
import StatusBadge from '../src/components/StatusBadge.astro';
import Breadcrumbs from '../src/components/Breadcrumbs.astro';
import { televisionPath } from '../src/lib/data';

const fixtures = loadCatalog('fixtures/catalog', { allowFixtures: true });

describe('rendered accessible components', () => {
  it('renders empty production data honestly and supplies a no-JavaScript route', async () => {
    const container = await AstroContainer.create();
    const $ = load(await container.renderToString(Search, { props: { items: [] } }));
    expect($('[data-search-status]').text()).toContain('登録されていません');
    expect($('[data-search-catalog]').text()).toBe('[]');
    expect($('form[role="search"]').length).toBe(1);
    expect($('label[for="tv-model"]').text()).toBe('テレビの型番');
    expect($('noscript').html()).toContain('/#manufacturers');
    expect($('input[data-search-model]').attr('maxlength')).toBe('100');
  });

  it('escapes hostile official-model text without changing the search JSON value', async () => {
    const container = await AstroContainer.create();
    const hostile = '</script><img src=x onerror="alert(1)"><script>';
    const tv = fixtures.televisions[0]!;
    const items = [{ ...tv, model: hostile, url: televisionPath(tv) }];
    const html = await container.renderToString(Search, { props: { items, manufacturers: [hostile] } });
    const $ = load(html);
    expect($('img').length).toBe(0);
    expect($('[onerror]').length).toBe(0);
    expect($('option').last().text()).toBe(hostile);
    expect(JSON.parse($('[data-search-catalog]').text())[0].model).toBe(hostile);
    expect($('[data-search-catalog]').text()).not.toContain('</script>');
  });

  it('gives all four compatibility statuses distinct text and class names', async () => {
    const container = await AstroContainer.create();
    const labels = {
      confirmed: '個別適合確認済み', candidate: '仕様上の候補・未確認',
      incompatible: '非対応', unknown: '判断材料不足',
    } as const;
    for (const [status, label] of Object.entries(labels)) {
      const $ = load(await container.renderToString(StatusBadge, { props: { status } }));
      expect($(`.status-${status}`).length).toBe(1);
      expect($('.status-badge').text()).toContain(label);
    }
  });

  it('marks the current breadcrumb accessibly and escapes its text', async () => {
    const container = await AstroContainer.create();
    const hostile = '<img src=x onerror=alert(1)>';
    const $ = load(await container.renderToString(Breadcrumbs, {
      props: { items: [{ name: '架空メーカー', path: '/#manufacturers' }, { name: hostile }] },
    }));
    expect($('nav[aria-label="パンくずリスト"]').length).toBe(1);
    expect($('[aria-current="page"]').text()).toBe(hostile);
    expect($('img').length).toBe(0);
    expect($('a').first().attr('href')).toBe('/');
  });
});

// Fictional data is injected only into the component renderer, never the production build.
describe('rendered compatibility and product comparison', () => {
  it('keeps confirmed, candidate, incompatible, and missing records distinct in the comparison table', async () => {
    const { default: ComparisonTable } = await import('../src/components/ComparisonTable.astro');
    const container = await AstroContainer.create();
    const television = fixtures.televisions[0]!;
    const entries = fixtures.stands.map(stand => ({
      stand, compatibility: fixtures.compatibility.find(item => item.television_id === television.id && item.stand_id === stand.id) ?? null,
    }));
    const $ = load(await container.renderToString(ComparisonTable, { props: { television, entries } }));
    expect($('tbody tr').length).toBe(5);
    expect($('.status-confirmed').length).toBe(1);
    expect($('.status-candidate').length).toBe(2);
    expect($('.status-incompatible').length).toBe(1);
    expect($('.status-unknown').length).toBe(1);
    expect($('[data-compare-check]').length).toBe(5);
    expect($('[data-compare-selected]').attr('disabled')).toBeDefined();
    expect($('.table-scroll[tabindex="0"]').length).toBe(1);
    expect($('caption').text()).toContain(television.model);
    expect($('thead th[scope="col"]').length).toBe(7);
    expect($('tbody th[scope="row"]').length).toBe(5);
    expect($('[data-compare-row="fixture-stand-incompatible"] [data-affiliate-link]').length).toBe(0);
    $('a[target="_blank"]').each((_, node) => {
      expect($(node).attr('rel')).toContain('noopener');
      expect($(node).attr('rel')).toContain('noreferrer');
    });
    $('[data-affiliate-link]').each((_, node) => {
      expect($(node).attr('rel')).toContain('sponsored');
      expect($(node).text()).toContain('広告');
    });
  });

  it('never treats absent compatibility as confirmed, even when weight and VESA match', async () => {
    const { default: ProductCard } = await import('../src/components/ProductCard.astro');
    const container = await AstroContainer.create();
    const $ = load(await container.renderToString(ProductCard, {
      props: { television: fixtures.televisions[0]!, stand: fixtures.stands[0]!, compatibility: null },
    }));
    expect($('.status-unknown').length).toBe(1);
    expect($('.status-confirmed').length).toBe(0);
    expect($('.candidate-warning').text()).toContain('不足');
    expect($('[data-compatibility-view]').attr('data-status')).toBe('unknown');
  });

  it('warns about unverified candidate details and preserves escaped notes', async () => {
    const { default: ProductCard } = await import('../src/components/ProductCard.astro');
    const container = await AstroContainer.create();
    const compatibility = fixtures.compatibility.find(item => item.status === 'candidate')!;
    const stand = fixtures.stands.find(item => item.id === compatibility.stand_id)!;
    const notes = '<img src=x onerror=alert(1)> ネジ・背面は未確認';
    const $ = load(await container.renderToString(ProductCard, {
      props: { television: fixtures.televisions[0]!, stand, compatibility: { ...compatibility, notes } },
    }));
    expect($('.status-candidate').length).toBe(1);
    expect($('.candidate-warning').text()).toContain('スペーサー');
    expect($('.product-notes').text()).toBe(notes);
    expect($('img').length).toBe(0);
    expect($('time').attr('datetime')).toBe(compatibility.checked_at);
    expect($('[data-affiliate-link]').attr('data-status')).toBe('candidate');
  });

  it('renders an honest empty comparison without selection controls', async () => {
    const { default: ComparisonTable } = await import('../src/components/ComparisonTable.astro');
    const container = await AstroContainer.create();
    const $ = load(await container.renderToString(ComparisonTable, { props: { television: fixtures.televisions[0]!, entries: [] } }));
    expect($('.empty-state').text()).toContain('登録されていません');
    expect($('table').length).toBe(0);
    expect($('[data-compare-selected]').length).toBe(0);
  });
});

describe('rendered television detail page', () => {
  it('renders sourced fictional records into separated status sections without indexing them', async () => {
    const { default: TelevisionPage } = await import('../src/pages/[manufacturer]/[model].astro');
    const container = await AstroContainer.create();
    const television = fixtures.televisions[0]!;
    const $ = load(await container.renderToString(TelevisionPage, {
      props: { television, catalog: fixtures },
      request: new Request(`https://example.invalid${televisionPath(television)}`),
    }));
    expect($('h1').text()).toBe(television.model);
    expect($('title').text()).toContain(television.model);
    expect($('meta[name="robots"]').attr('content')).toBe('noindex, follow');
    expect($('#confirmed .product-confirmed').length).toBe(1);
    expect($('#confirmed .product-candidate').length).toBe(0);
    expect($('#candidates .product-candidate').length).toBe(1);
    expect($('#wall .product-candidate').length).toBe(1);
    expect($('.other-products .product-incompatible').length).toBe(1);
    expect($('.other-products .product-unknown').length).toBe(1);
    expect($('.tv-specifications').text()).toContain('200 × 200');
    expect($('.detail-meta').text()).toContain('2026-01-01');
    expect($('.installation-notes').text()).toContain('ネジ');
    expect($('.installation-notes').text()).toContain('下地');
    expect($('tbody tr').length).toBe(5);
    expect($('.advertising-notice').text()).toContain('広告');
    $('script[type="application/ld+json"]').each((_, node) => {
      const json = JSON.parse($(node).text());
      expect(JSON.stringify(json)).not.toContain('aggregateRating');
      expect(JSON.stringify(json)).not.toContain('price');
    });
  });

  it('shows unknown specifications and compatibility honestly for a thin television record', async () => {
    const { default: TelevisionPage } = await import('../src/pages/[manufacturer]/[model].astro');
    const container = await AstroContainer.create();
    const television = fixtures.televisions.find(item => item.id === 'fixture-tv-thin')!;
    const $ = load(await container.renderToString(TelevisionPage, {
      props: { television, catalog: fixtures },
      request: new Request(`https://example.invalid${televisionPath(television)}`),
    }));
    expect($('meta[name="robots"]').attr('content')).toBe('noindex, follow');
    expect($('.tv-specifications').text()).toContain('未確認');
    expect($('#confirmed .empty-state').text()).toContain('登録されていません');
    expect($('.product-confirmed').length).toBe(0);
    expect($('.product-candidate').length).toBe(0);
    expect($('.other-products .product-unknown').length).toBe(fixtures.stands.length);
    expect($('.detail-meta').text()).toContain('未確認');
  });
});
