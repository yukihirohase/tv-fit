import { loadCatalog } from '../src/lib/csv';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { load } from 'cheerio';
import { televisionPath, type Catalog } from '../src/lib/data';
import { getManufacturers } from '../src/lib/manufacturers';
import { getSeoConfig } from '../src/lib/seo';

const fixtures = loadCatalog('fixtures/catalog', { allowFixtures: true });
afterEach(() => vi.unstubAllEnvs());

describe('manufacturer-first navigation', () => {
  it('offers real manufacturer-page links on the homepage without model inputs', async () => {
    const { default: HomePage } = await import('../src/pages/index.astro');
    const container = await AstroContainer.create();
    const $ = load(await container.renderToString(HomePage, { props: { catalog: loadCatalog() }, request: new Request('https://example.invalid/') }));
    const manufacturers = getManufacturers(loadCatalog().televisions);
    expect($('#main form, #main input, #main select, [data-search-catalog]').length).toBe(0);
    expect($('button[data-manufacturer-pick]').length).toBe(0);
    const links = $('a.manufacturer-card').map((_, node) => $(node).attr('href')).get();
    expect(links.sort()).toEqual(manufacturers.map(item => item.url).sort());
    expect(links).toContain('/sony/');
    expect(links).toContain('/panasonic/');
    $('a.manufacturer-card').each((_, node) => {
      expect($(node).text()).toContain('型番');
      expect($(node).attr('href')).not.toContain('#');
    });
  });

  it('shows an honest empty maker page and keeps it noindex even on an indexable deployment', async () => {
    vi.stubEnv('PUBLIC_SITE_URL', 'https://tvfit-navigation.jp');
    vi.stubEnv('PUBLIC_INDEXING_ENABLED', 'true');
    expect(getSeoConfig().indexingEnabled).toBe(true);
    const { default: ManufacturerPage } = await import('../src/pages/[manufacturer]/index.astro');
    const container = await AstroContainer.create();
    const catalog: Catalog = { televisions: [], stands: [], compatibility: [] };
    const manufacturer = getManufacturers(catalog.televisions).find(item => item.name === 'SONY')!;
    const $ = load(await container.renderToString(ManufacturerPage, {
      props: { manufacturer, catalog },
      request: new Request(`https://tvfit-navigation.jp${manufacturer.url}`),
    }));
    expect($('h1').text()).toContain('SONY');
    expect($('.model-list-empty').text()).toContain('準備中');
    expect($('[data-model-link]').length).toBe(0);
    expect($('#main a[href="/#manufacturers"]').length).toBeGreaterThan(0);
    expect($('meta[name="robots"]').attr('content')).toBe('noindex, follow');
    expect($('link[rel="canonical"]').attr('href')).toBe('https://tvfit-navigation.jp/sony/');
    const schemas = $('script[type="application/ld+json"]').map((_, node) => JSON.parse($(node).text())).get().flatMap(schema => schema['@graph'] ?? [schema]);
    expect(schemas.some(schema => schema['@type'] === 'ItemList')).toBe(false);
  });

  it('lists only the selected maker’s formal models as directly navigable detail links', async () => {
    const { default: ManufacturerPage } = await import('../src/pages/[manufacturer]/index.astro');
    const other = { ...fixtures.televisions[0]!, id: 'fixture-tv-other-maker', manufacturer: '架空第二メーカー', model: 'FICTION-OTHER-MAKER' };
    const catalog = { ...fixtures, televisions: [...fixtures.televisions, other] };
    const manufacturer = getManufacturers(catalog.televisions).find(item => item.name === '架空メーカー')!;
    const container = await AstroContainer.create();
    const $ = load(await container.renderToString(ManufacturerPage, {
      props: { manufacturer, catalog },
      request: new Request(`https://example.invalid${manufacturer.url}`),
    }));
    const links = $('[data-model-list] a[data-model-link]');
    expect(links.length).toBe(fixtures.televisions.length);
    expect(links.map((_, node) => $(node).attr('href')).get().sort()).toEqual(fixtures.televisions.map(televisionPath).sort());
    fixtures.televisions.forEach(tv => expect(links.text()).toContain(tv.model));
    expect(links.text()).not.toContain(other.model);
    expect($('.breadcrumbs [aria-current="page"]').text()).toContain(manufacturer.name);
    expect($('meta[name="robots"]').attr('content')).toBe('noindex, follow');
    const graph = $('script[type="application/ld+json"]').map((_, node) => JSON.parse($(node).text())).get().flatMap(schema => schema['@graph'] ?? [schema]);
    const itemList = graph.find(schema => schema['@type'] === 'ItemList');
    expect(itemList?.numberOfItems ?? itemList?.itemListElement?.length).toBe(fixtures.televisions.length);
    expect(JSON.stringify(itemList)).not.toContain(other.model);
    // 構造化データの一覧は、画面の型番一覧と同じ順・同じリンク先。
    const shown = $('[data-model-list] a[data-model-link]').map((_, node) => $(node).attr('href')).get();
    expect(itemList.itemListElement.map((item: { url: string }) => new URL(item.url).pathname)).toEqual(shown);
    expect(itemList.itemListElement.map((item: { position: number }) => item.position)).toEqual(shown.map((_, index) => index + 1));
  });

  it('escapes model text in the selectable list without changing the formal label', async () => {
    const { default: ModelList } = await import('../src/components/ModelList.astro');
    const hostile = '<img src=x onerror=alert(1)> FICTION';
    const television = { ...fixtures.televisions[0]!, model: hostile };
    const container = await AstroContainer.create();
    const $ = load(await container.renderToString(ModelList, {
      props: { televisions: [television], manufacturerName: '架空メーカー' },
    }));
    expect($('[data-model-link]').text()).toContain(hostile);
    expect($('img, [onerror]').length).toBe(0);
    expect($('[data-model-link]').attr('href')).toBe(televisionPath(television));
  });
});
