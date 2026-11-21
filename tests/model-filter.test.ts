import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { load } from 'cheerio';
import { matchesModelFilter, modelFilterKey, screenSizeOptions } from '../src/lib/model-filter';
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
    expect(items.first().attr('data-model')).toBe(fixtures.televisions[0]!.model);
    expect($('[data-model-filter-empty]').attr('hidden')).toBeDefined();
  });
});
