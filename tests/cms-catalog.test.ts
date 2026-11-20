import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../src/lib/csv';
import { CMSCatalogUnavailableError, getPublishedCatalog, type CmsCollectionReader, type CmsCollectionPage } from '../src/lib/cms-catalog';
import {
  catalogCollections, cmsCatalogFromRows, toCatalogRecord, toCmsRecord,
  type CmsCatalogRows, type CmsCollection,
} from '../src/lib/cms-mapping';

const validation = { allowFixtures: true, now: new Date('2026-11-09T00:00:00Z') };
const fixture = () => loadCatalog('fixtures/catalog', validation);
function fixtureRows(): CmsCatalogRows {
  const catalog = fixture();
  const wrap = (collection: CmsCollection) => catalog[collection].map((row, index) => ({
    id: `${collection}-${index}`, data: { ...toCmsRecord(collection, row), status: 'published', title: 'テスト専用の編集表示名' },
  }));
  return { televisions: wrap('televisions'), stands: wrap('stands'), compatibility: wrap('compatibility') };
}
const source = (rows: CmsCatalogRows): CmsCollectionReader => async collection => ({ entries: rows[collection], hasMore: false });

describe('EmDash catalog field mapping', () => {
  it('round-trips all validated CSV fields without mixing CMS lifecycle metadata into compatibility', () => {
    const catalog = fixture();
    const rows = fixtureRows();
    expect(cmsCatalogFromRows(rows, validation)).toEqual(catalog);
    expect(toCmsRecord('televisions', catalog.televisions[0]!)).toHaveProperty('external_id', catalog.televisions[0]!.id);
    expect(toCmsRecord('televisions', catalog.televisions[0]!)).not.toHaveProperty('id');
    expect(toCmsRecord('stands', catalog.stands[0]!)).toHaveProperty('vesa_patterns', '200x200;300x200');
    expect(toCmsRecord('compatibility', catalog.compatibility[0]!)).toHaveProperty('compatibility_status', 'confirmed');
    expect(toCmsRecord('compatibility', catalog.compatibility[0]!)).not.toHaveProperty('status');
    expect(catalog).toEqual(fixture());
  });

  it('does not let a CMS internal ID replace a missing external catalog ID', () => {
    const rows = fixtureRows();
    const fields = { ...rows.televisions[0]!.data as Record<string, unknown> };
    delete fields.external_id;
    const changed = { ...rows, televisions: [{ id: 'cms-internal-id', data: { ...fields, id: 'fixture-tv-one' } }] };
    expect(() => cmsCatalogFromRows(changed, validation)).toThrow(/id/u);
  });

  it('never reads a compatibility decision from the CMS draft/published field', () => {
    const fields = { television_id: 'fixture-tv-one', stand_id: 'fixture-stand-confirmed', status: 'published' };
    expect(toCatalogRecord('compatibility', fields).status).toBeUndefined();
    expect(toCatalogRecord('compatibility', { ...fields, compatibility_status: 'unknown' }).status).toBe('unknown');
  });

  it('normalizes optional empty fields while retaining unknown rather than inferring confirmed', () => {
    const rows = fixtureRows();
    const fields = { ...rows.televisions[0]!.data as Record<string, unknown>, screen_inches: '', weight_kg: null, vesa_width_mm: '', vesa_height_mm: '', source_url: '' };
    const compatibility = { television_id: 'fixture-tv-one', stand_id: 'fixture-stand-confirmed', compatibility_status: 'unknown', evidence_type: 'insufficient', evidence_url: '', checked_at: '', notes: null };
    const catalog = cmsCatalogFromRows({ ...rows, televisions: [{ data: fields }], compatibility: [{ data: compatibility }] }, validation);
    expect(catalog.televisions[0]).toMatchObject({ screen_inches: null, weight_kg: null, vesa_width_mm: null, vesa_height_mm: null, source_url: null });
    expect(catalog.compatibility[0]).toMatchObject({ status: 'unknown', evidence_url: null, checked_at: null, notes: '' });
  });

  it('rejects unsupported CMS payload shapes and preserves required evidence checks', () => {
    expect(() => toCatalogRecord('televisions', [])).toThrow(/オブジェクト/u);
    const rows = fixtureRows();
    const fields = { ...rows.compatibility[0]!.data as Record<string, unknown>, evidence_type: 'specification' };
    expect(() => cmsCatalogFromRows({ ...rows, compatibility: [{ data: fields }] }, validation)).toThrow(/個別適合/u);
  });
});

describe('published CMS catalog loading', () => {
  it('follows opaque cursors for every collection and explicitly requests only published content', async () => {
    const rows = fixtureRows();
    const calls: { collection: CmsCollection; cursor?: string }[] = [];
    const read: CmsCollectionReader = async (collection, filter) => {
      expect(filter.status).toBe('published');
      expect(filter.limit).toBeGreaterThan(0);
      expect(filter.orderBy).toEqual({ id: 'asc' });
      calls.push({ collection, ...(filter.cursor === undefined ? {} : { cursor: filter.cursor }) });
      return filter.cursor === undefined
        ? { entries: rows[collection].slice(0, 1), hasMore: true, nextCursor: `opaque:${collection}` }
        : { entries: rows[collection].slice(1), hasMore: false };
    };
    expect(await getPublishedCatalog({ read, validation })).toEqual(fixture());
    for (const collection of catalogCollections) {
      expect(calls.filter(call => call.collection === collection).map(call => call.cursor)).toEqual([undefined, `opaque:${collection}`]);
    }
  });

  it('reads only the compatibility rows a page needs', async () => {
    const rows = fixtureRows();
    const filters: { collection: CmsCollection; where?: Record<string, string> }[] = [];
    const read: CmsCollectionReader = async (collection, filter) => {
      filters.push({ collection, ...(filter.where ? { where: filter.where } : {}) });
      const entries = filter.where
        ? rows[collection].filter(row => (row.data as Record<string, unknown>).television_id === filter.where!.television_id)
        : rows[collection];
      return { entries, hasMore: false };
    };
    const none = await getPublishedCatalog({ read, validation, compatibility: 'none' });
    expect(none.compatibility).toEqual([]);
    expect(filters.map(item => item.collection)).not.toContain('compatibility');
    const tvId = fixture().compatibility[0]!.television_id;
    filters.length = 0;
    const one = await getPublishedCatalog({ read, validation, compatibility: { televisionId: tvId } });
    expect(one.compatibility).toEqual(fixture().compatibility.filter(entry => entry.television_id === tvId));
    expect(filters.find(item => item.collection === 'compatibility')?.where).toEqual({ television_id: tvId });
  });

  it('accepts the documented nextCursor when a provider omits hasMore', async () => {
    const rows = fixtureRows();
    const read: CmsCollectionReader = async (collection, filter) => filter.cursor === undefined
      ? { entries: rows[collection].slice(0, 1), nextCursor: `next-${collection}` }
      : { entries: rows[collection].slice(1) };
    expect(await getPublishedCatalog({ read, validation })).toEqual(fixture());
  });

  it('keeps explicitly missing collections empty before initial setup', async () => {
    const read: CmsCollectionReader = async () => ({ entries: [], error: { code: 'COLLECTION_NOT_FOUND' } });
    expect(await getPublishedCatalog({ read })).toEqual({ televisions: [], stands: [], compatibility: [] });
  });

  it.each(['permission denied', 'connection refused', 'no such table: unexpected', 'database not configured'])(
    'surfaces infrastructure failure instead of pretending the catalog is empty: %s', async message => {
      const read: CmsCollectionReader = async () => ({ entries: [], error: new Error(message) });
      await expect(getPublishedCatalog({ read })).rejects.toBeInstanceOf(CMSCatalogUnavailableError);
    },
  );

  it('wraps thrown query failures without returning a partial catalog', async () => {
    const read: CmsCollectionReader = async () => { throw new Error('connection lost'); };
    await expect(getPublishedCatalog({ read })).rejects.toMatchObject({ name: 'CMSCatalogUnavailableError', cause: new Error('connection lost') });
  });

  it('never permits fixtures in the normal runtime path', async () => {
    await expect(getPublishedCatalog({ read: source(fixtureRows()) })).rejects.toBeInstanceOf(CMSCatalogUnavailableError);
  });

  it('fails closed when a published compatibility record references an unpublished television', async () => {
    const rows = fixtureRows();
    await expect(getPublishedCatalog({ read: source({ ...rows, televisions: [] }), validation })).rejects.toBeInstanceOf(CMSCatalogUnavailableError);
  });

  it.each(['missing-cursor', 'repeating-cursor', 'empty-page', 'duplicate-row'] as const)(
    'rejects broken pagination instead of hanging or duplicating entries: %s', async mode => {
      const rows = fixtureRows();
      const read: CmsCollectionReader = async (collection, filter) => {
        if (collection !== 'televisions') return { entries: rows[collection] };
        const first = rows.televisions[0]!;
        if (mode === 'missing-cursor') return { entries: [first], hasMore: true };
        if (mode === 'empty-page') return { entries: [], hasMore: true, nextCursor: 'next' };
        if (mode === 'duplicate-row') return filter.cursor === undefined
          ? { entries: [first], hasMore: true, nextCursor: 'next' }
          : { entries: [first] };
        return filter.cursor === undefined
          ? { entries: [first], hasMore: true, nextCursor: 'same' }
          : { entries: [rows.televisions[1]!], hasMore: true, nextCursor: 'same' };
      };
      await expect(getPublishedCatalog({ read, validation })).rejects.toBeInstanceOf(CMSCatalogUnavailableError);
    },
  );

  it('rejects malformed collection result data', async () => {
    const read: CmsCollectionReader = async () => ({ entries: null } as unknown as CmsCollectionPage);
    await expect(getPublishedCatalog({ read })).rejects.toBeInstanceOf(CMSCatalogUnavailableError);
  });
});
