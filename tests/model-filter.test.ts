import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { load } from 'cheerio';
import { compareModels, isModelSortOrder, matchesModelFilter, modelFilterKey, releaseSortKey, screenSizeOptions, type ModelSortOrder } from '../src/lib/model-filter';
import { loadCatalog } from '../src/lib/csv';

const item = (model: string, size = '55') => ({ key: modelFilterKey(model), size });

describe('model list filter', () => {
  it('ignores symbols, letter case and full-width/half-width differences', () => {
    const tv = item('KJ-55X80L');
    for (const query of ['55x80', 'ＫＪ－５５Ｘ８０Ｌ', 'kj 55/x80l', 'X80L', 'kj‐55', '55-X-80']) {
      expect(matchesModelFilter(tv, query, '')).toBe(true);
    }
    expect(matchesModelFilter(item('43A400 Pro'), '43a400pro', '')).toBe(true);
    expect(matchesModelFilter(tv, '65X80', '')).toBe(false);
  });

  it('combines the partial model match with the selected screen size', () => {
    expect(matchesModelFilter(item('KJ-55X80L', '55'), '', '55')).toBe(true);
    expect(matchesModelFilter(item('KJ-55X80L', '55'), 'x80', '65')).toBe(false);
    expect(matchesModelFilter(item('KJ-55X80L', '55'), '   ', '')).toBe(true);
  });

  it('lists each screen size once, smallest first', () => {
    expect(screenSizeOptions([65, 43, null, 55, 65, 50.5])).toEqual([43, 50.5, 55, 65]);
  });

  it('renders the filter controls and the data each item is matched on', async () => {
    const fixtures = loadCatalog('fixtures/catalog', { allowFixtures: true, now: new Date('2026-11-09T00:00:00Z') });
    const { default: ModelList } = await import('../src/components/ModelList.astro');
    const container = await AstroContainer.create();
    const $ = load(await container.renderToString(ModelList, { props: { televisions: fixtures.televisions, manufacturerName: '架空メーカー' } }));
    expect($('label[for="model-filter-query"]').text()).toContain('型番');
    const options = $('[data-model-filter-size] option').map((_, node) => $(node).attr('value')).get();
    expect(options[0]).toBe('');
    expect(options.slice(1)).toEqual(screenSizeOptions(fixtures.televisions.map(tv => tv.screen_inches)).map(String));
    const items = $('[data-model-item]');
    expect(items.length).toBe(fixtures.televisions.length);
    const expected = [...fixtures.televisions].sort((a, b) => compareModels(
      { model: a.model, size: a.screen_inches, release: releaseSortKey(a.release_date) },
      { model: b.model, size: b.screen_inches, release: releaseSortKey(b.release_date) },
    )).map(tv => tv.model);
    expect(items.map((_, node) => $(node).attr('data-model')).get()).toEqual(expected);
    expect($('[data-model-filter-sort] option[selected]').attr('value')).toBe('release-desc');
    expect($('[data-model-filter-sort] option').length).toBe(4);
    expect($('[data-model-filter-empty]').attr('hidden')).toBeDefined();
  });
});

describe('model list sorting', () => {
  const item = (model: string, size: number | null, release: string | null) => ({ model, size, release: releaseSortKey(release) });
  const items = [
    item('A-55', 55, '2025-06-07'),
    item('B-65', 65, '2026-05'),
    item('C-75', 75, '2026-05-下旬'),
    item('D-43', 43, null),
    item('E-85', 85, '2026-05-21'),
    item('F-65', 65, '2026-05-21'),
    item('G', null, '2024-01-10'),
  ];
  const sorted = (order?: ModelSortOrder) => [...items].sort((a, b) => compareModels(a, b, order)).map(x => x.model);

  it('reads days, 旬 and months into comparable keys', () => {
    expect(releaseSortKey('2025-06-07')).toBe(20250607);
    expect(releaseSortKey('2025-06-上旬')).toBe(20250605);
    expect(releaseSortKey('2025-06-中旬')).toBe(20250615);
    expect(releaseSortKey('2025-06-下旬')).toBe(20250625);
    expect(releaseSortKey('2025-06')).toBe(20250615);
    expect(releaseSortKey('')).toBeNull();
    expect(releaseSortKey(null)).toBeNull();
  });
  it('defaults to newest release first, then the larger screen', () => {
    expect(sorted()).toEqual(['C-75', 'E-85', 'F-65', 'B-65', 'A-55', 'G', 'D-43']);
  });
  it('sorts by oldest release, keeping unknown dates last', () => {
    expect(sorted('release-asc')).toEqual(['G', 'A-55', 'B-65', 'E-85', 'F-65', 'C-75', 'D-43']);
  });
  it('sorts by screen size both ways, newest first within a size, unknown sizes last', () => {
    expect(sorted('size-desc')).toEqual(['E-85', 'C-75', 'F-65', 'B-65', 'A-55', 'D-43', 'G']);
    expect(sorted('size-asc')).toEqual(['D-43', 'A-55', 'F-65', 'B-65', 'C-75', 'E-85', 'G']);
  });
  it('accepts only known sort orders', () => {
    expect(isModelSortOrder('size-asc')).toBe(true);
    expect(isModelSortOrder('price')).toBe(false);
  });
});
