import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ContentSaveRejectedError, type PluginContext } from 'emdash';
import { validateSeed } from 'emdash/seed';
import { loadCatalog } from '../src/lib/csv';
import { toCmsRecord } from '../src/lib/cms-mapping';
import {
  createPlugin, tvFitValidation, validateCmsMutation, validateCmsRemoval,
  type ValidationEntry, type ValidationSnapshot,
} from '../plugins/tv-fit-validation';

const options = { allowFixtures: true, now: new Date('2026-11-09T00:00:00Z') };
const catalog = loadCatalog('fixtures/catalog', options);
function snapshot(): ValidationSnapshot {
  return {
    televisions: catalog.televisions.map((item, index) => ({ id: `cms-tv-${index}`, status: 'published', data: toCmsRecord('televisions', item) })),
    stands: catalog.stands.map((item, index) => ({ id: `cms-stand-${index}`, status: 'published', data: toCmsRecord('stands', item) })),
    compatibility: catalog.compatibility.map((item, index) => ({ id: `cms-pair-${index}`, status: 'published', data: toCmsRecord('compatibility', item) })),
  };
}
const empty = (): ValidationSnapshot => ({ televisions: [], stands: [], compatibility: [] });
function context(rows: ValidationSnapshot): PluginContext {
  return {
    content: {
      list: vi.fn(async (collection: keyof ValidationSnapshot) => ({ items: rows[collection], hasMore: false })),
      get: vi.fn(async (collection: keyof ValidationSnapshot, id: string) => rows[collection].find(item => item.id === id) ?? null),
      getRevision: vi.fn(async () => null),
    },
  } as unknown as PluginContext;
}
// Fictional in-memory record only. No source URL or specifications are supplied.
const thinTestTelevision = {
  external_id: 'test-television-not-real', manufacturer: 'テスト専用（実在しないメーカー）',
  model: 'NOT-A-REAL-TELEVISION',
};

describe('EmDash seed and native validation registration', () => {
  it('declares only three empty Japanese catalog collections without default sample products', () => {
    const seed = JSON.parse(readFileSync('seed/seed.json', 'utf8'));
    const result = validateSeed(seed);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(seed.defaultLocale).toBe('ja');
    expect(seed.collections.map((item: {slug: string}) => item.slug)).toEqual(['televisions', 'stands', 'compatibility']);
    expect(seed.content).toEqual({});
    for (const collection of seed.collections) {
      expect(collection.supports).toContain('no-scheduling');
      expect(collection.routable).toBe(false);
      expect(collection.fields.some((field: {slug: string}) => ['id', 'slug', 'status'].includes(field.slug))).toBe(false);
    }
    const compatibility = seed.collections.find((item: {slug: string}) => item.slug === 'compatibility');
    expect(compatibility.fields.find((item: {slug: string}) => item.slug === 'checked_at').type).toBe('string');
    expect(compatibility.fields.find((item: {slug: string}) => item.slug === 'compatibility_status').defaultValue).toBe('unknown');
  });

  it('registers real write and publication policy hooks with the required capabilities', () => {
    expect(tvFitValidation()).toMatchObject({ format: 'native', entrypoint: '@tv-fit/validation' });
    const plugin = createPlugin();
    expect(plugin.capabilities).toEqual(expect.arrayContaining(['content:write', 'content:read', 'content:revisions:read', 'hooks.content-policy:register']));
    expect(plugin.hooks['content:beforeSave']).toBeDefined();
    expect(plugin.hooks['content:beforePublish']).toBeDefined();
    expect(plugin.hooks['content:beforeDelete']).toBeDefined();
    expect(plugin.hooks['content:beforeUnpublish']).toBeDefined();
  });
});

describe('prospective catalog validation', () => {
  it('merges a partial edit while retaining the original specification and evidence', () => {
    const result = validateCmsMutation(snapshot(), {
      collection: 'compatibility', id: 'cms-pair-0', data: { notes: '架空データの取り付け条件を追記したテスト。' },
    }, options);
    const entry = result.compatibility.find(item => item.stand_id === catalog.compatibility[0]!.stand_id)!;
    expect(entry.status).toBe('confirmed');
    expect(entry.evidence_url).toBe(catalog.compatibility[0]!.evidence_url);
    expect(entry.notes).toContain('追記');
  });

  it('rejects a confirmed record that only has matching-specification evidence', () => {
    expect(() => validateCmsMutation(snapshot(), {
      collection: 'compatibility', id: 'cms-pair-0', data: { evidence_type: 'specification' },
    }, options)).toThrow(/個別適合/u);
  });

  it('requires a real evidence URL, calendar check date and explanatory notes for confirmed', () => {
    for (const data of [{ evidence_url: '' }, { checked_at: '' }, { notes: '' }, { checked_at: '2026-02-30' }, { checked_at: '2099-01-01' }]) {
      expect(() => validateCmsMutation(snapshot(), { collection: 'compatibility', id: 'cms-pair-0', data }, options)).toThrow();
    }
  });

  it('never upgrades unknown or candidate records to confirmed when specifications match', () => {
    const rows = snapshot();
    const result = validateCmsMutation(rows, {
      collection: 'compatibility', id: 'cms-pair-0',
      data: { compatibility_status: 'unknown', evidence_type: 'insufficient' },
    }, options);
    expect(result.compatibility.find(item => item.stand_id === catalog.compatibility[0]!.stand_id)?.status).toBe('unknown');
    const candidate = validateCmsMutation(rows, {
      collection: 'compatibility', id: 'cms-pair-0',
      data: { compatibility_status: 'candidate', evidence_type: 'specification' },
    }, options);
    expect(candidate.compatibility.find(item => item.stand_id === catalog.compatibility[0]!.stand_id)?.status).toBe('candidate');
  });

  it('rejects missing foreign keys and duplicate television/stand pairs', () => {
    expect(() => validateCmsMutation(snapshot(), {
      collection: 'compatibility', id: 'cms-pair-0', data: { television_id: 'fixture-tv-missing' },
    }, options)).toThrow(/存在しません/u);
    expect(() => validateCmsMutation(snapshot(), {
      collection: 'compatibility', data: { ...snapshot().compatibility[0]!.data },
    }, options)).toThrow(/適合ペア/u);
  });

  it('detects normalized model and reserved manufacturer URL collisions', () => {
    expect(() => validateCmsMutation(snapshot(), {
      collection: 'televisions', data: { ...snapshot().televisions[0]!.data, external_id: 'fixture-new-model', model: 'ｆｉｃｔｉｏｎ４３ａ' },
    }, options)).toThrow(/正規化/u);
    expect(() => validateCmsMutation(empty(), {
      collection: 'televisions', data: { ...thinTestTelevision, manufacturer: 'about' },
    })).toThrow(/固定ページ/u);
  });

  it('keeps external IDs immutable so existing references cannot silently change targets', () => {
    expect(() => validateCmsMutation(snapshot(), {
      collection: 'televisions', id: 'cms-tv-0', data: { external_id: 'fixture-new-identity' },
    }, options)).toThrow(/管理ID/u);
  });

  it('rejects unsafe source URLs and a specification edit that invalidates a recorded candidate', () => {
    expect(() => validateCmsMutation(snapshot(), {
      collection: 'televisions', id: 'cms-tv-0', data: { source_url: 'javascript:alert(1)' },
    }, options)).toThrow(/URL|HTTPS/u);
    expect(() => validateCmsMutation(snapshot(), {
      collection: 'televisions', id: 'cms-tv-0', data: { weight_kg: 1999 },
    }, options)).toThrow(/candidate/u);
  });

  it('rejects test fixtures by default instead of allowing a runtime test-mode bypass', () => {
    expect(() => validateCmsMutation(snapshot(), {
      collection: 'compatibility', id: 'cms-pair-0', data: {},
    })).toThrow(/架空データ|テストURL/u);
  });

  it('prevents removing referenced televisions and permits removing an explanation itself', () => {
    expect(() => validateCmsRemoval(snapshot(), 'televisions', 'cms-tv-0', options)).toThrow(/存在しません/u);
    expect(() => validateCmsRemoval(snapshot(), 'stands', 'cms-stand-0', options)).toThrow(/存在しません/u);
    expect(validateCmsRemoval(snapshot(), 'compatibility', 'cms-pair-0', options).compatibility).toHaveLength(catalog.compatibility.length - 1);
  });
});

describe('registered hook behavior', () => {
  it('accepts a thin explicitly fictional in-memory test without inventing missing specifications', async () => {
    const hook = createPlugin().hooks['content:beforeSave']!;
    await expect(hook.handler({ collection: 'televisions', isNew: true, content: thinTestTelevision }, context(empty()))).resolves.toBeUndefined();
    expect(thinTestTelevision).not.toHaveProperty('weight_kg');
  });

  it('ignores unrelated collections and uses the existing pending revision for partial edits', async () => {
    const hook = createPlugin().hooks['content:beforeSave']!;
    const unused = context(empty());
    await hook.handler({ collection: 'unrelated', isNew: true, content: {} }, unused);
    expect(unused.content!.list).not.toHaveBeenCalled();
    const stored: ValidationEntry = { id: 'cms-test-row', status: 'draft', data: thinTestTelevision, draftRevisionId: 'revision-test' };
    const ctx = context({ ...empty(), televisions: [stored] });
    ctx.content!.getRevision = vi.fn(async () => ({ id: 'revision-test', collection: 'televisions', entryId: stored.id, createdAt: '2026-01-01', data: { model: 'NOT-A-REAL-TELEVISION-DRAFT' } }));
    await expect(hook.handler({ collection: 'televisions', id: stored.id, isNew: false, content: { manufacturer: thinTestTelevision.manufacturer } }, ctx)).resolves.toBeUndefined();
    expect(ctx.content!.getRevision).toHaveBeenCalledWith('televisions', stored.id, 'revision-test');
  });

  it('does not read compatibility draft revisions one by one, so large catalogs stay within the hook time limit', async () => {
    const hook = createPlugin().hooks['content:beforeSave']!;
    const pair: ValidationEntry = { id: 'cms-test-pair', status: 'draft', draftRevisionId: 'revision-pair', data: { television_id: 'test-television-not-real', stand_id: 'test-stand-not-real' } };
    const ctx = context({ ...empty(), compatibility: [pair] });
    await hook.handler({ collection: 'televisions', isNew: true, content: thinTestTelevision }, ctx).catch(() => undefined);
    expect(ctx.content!.getRevision).not.toHaveBeenCalled();
  });

  it('rejects a malformed partial update with a human-readable EmDash save rejection', async () => {
    const hook = createPlugin().hooks['content:beforeSave']!;
    const ctx = context({ ...empty(), televisions: [{ id: 'cms-test-row', status: 'draft', data: thinTestTelevision }] });
    await expect(hook.handler({ collection: 'televisions', id: 'cms-test-row', isNew: false, content: { source_url: 'http://source.test/' } }, ctx)).rejects.toBeInstanceOf(ContentSaveRejectedError);
  });

  it('rejects incomplete pagination instead of treating an unread second page as an empty catalog', async () => {
    const hook = createPlugin().hooks['content:beforeSave']!;
    const ctx = context(empty());
    ctx.content!.list = vi.fn(async () => ({ items: [], hasMore: true }));
    await expect(hook.handler({ collection: 'televisions', isNew: true, content: thinTestTelevision }, ctx)).rejects.toThrow(/一覧を最後まで/u);
  });

  it('keeps a compatibility explanation private until its referenced products are published', async () => {
    const hook = createPlugin().hooks['content:beforePublish']!;
    const ctx = context(empty());
    const decision = await hook.handler({ collection: 'compatibility', origin: { source: 'api' }, content: {
      id: 'cms-unpublished-pair', data: { television_id: 'test-tv-unpublished', stand_id: 'test-stand-unpublished', compatibility_status: 'unknown', evidence_type: 'insufficient', notes: '' },
    } }, ctx);
    expect(decision).toMatchObject({ cancel: true });
    expect(decision && decision.reason).toContain('存在しません');
  });

  it('validates a compatibility save against products without listing every compatibility row', async () => {
    const hook = createPlugin().hooks['content:beforeSave']!;
    const rows = snapshot();
    const ctx = context(rows);
    const pair = rows.compatibility[0]!;
    await hook.handler({ collection: 'compatibility', id: pair.id, isNew: false, content: { notes: '取り付け条件の追記テスト。' } }, ctx).catch(() => undefined);
    expect(ctx.content!.list).not.toHaveBeenCalledWith('compatibility', expect.anything());
    expect(ctx.content!.get).toHaveBeenCalledWith('compatibility', pair.id);
    await expect(hook.handler({ collection: 'compatibility', isNew: true, content: { ...pair.data, television_id: 'fixture-tv-missing' } }, ctx)).rejects.toBeInstanceOf(ContentSaveRejectedError);
  });

  it('reads multiple catalog pages before checking the prospective write', async () => {
    const hook = createPlugin().hooks['content:beforeSave']!;
    const ctx = context(empty());
    ctx.content!.list = vi.fn(async (collection, opts) => {
      if (collection === 'televisions' && !opts?.cursor) return { items: [], hasMore: true, cursor: 'second-page' };
      return { items: [], hasMore: false };
    });
    await hook.handler({ collection: 'televisions', isNew: true, content: thinTestTelevision }, ctx);
    expect(ctx.content!.list).toHaveBeenCalledWith('televisions', { limit: 100, cursor: 'second-page' });
  });
});
