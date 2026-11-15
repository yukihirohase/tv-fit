import { describe, expect, it, vi } from 'vitest';
import { parse } from 'csv-parse/sync';
import { catalogCsvFiles } from '../scripts/cms-export';
import { loadCatalog } from '../src/lib/csv';
import { catalogCollections, toCmsRecord, type CmsCatalogRows } from '../src/lib/cms-mapping';
import { applyFillPlan, applyImportPlan, buildImportPlan, listExistingCmsRows, validateCmsOrigin } from '../scripts/cms-import';
const fixtures = loadCatalog('fixtures/catalog', { allowFixtures: true });
const empty = (): CmsCatalogRows => ({ televisions: [], stands: [], compatibility: [] });

describe('validated CSV import into EmDash', () => {
  it('plans televisions and stands before compatibility while preserving the declared product status', () => {
    const plan = buildImportPlan(fixtures);
    const collections = plan.create.map(item => item.collection);
    expect(collections.indexOf('compatibility')).toBeGreaterThan(collections.lastIndexOf('stands'));
    expect(plan.create.find(item => item.collection === 'compatibility')?.data).toMatchObject({ compatibility_status: fixtures.compatibility[0]!.status });
    expect(plan.create.find(item => item.collection === 'televisions')?.data).toHaveProperty('external_id', fixtures.televisions[0]!.id);
    expect(plan.create.every(item => !('status' in item.data) && !('id' in item.data))).toBe(true);
  });
  it('is idempotent for identical external IDs but rejects differing existing content before any writes', () => {
    const rows = Object.fromEntries(catalogCollections.map(collection => [collection, fixtures[collection].map(row => ({ data: toCmsRecord(collection, row) }))])) as unknown as CmsCatalogRows;
    expect(buildImportPlan(fixtures, rows)).toEqual({ create: [], fill: [], skipped: fixtures.televisions.length + fixtures.stands.length + fixtures.compatibility.length });
    const changed = { ...rows, televisions: [{ data: { ...toCmsRecord('televisions', fixtures.televisions[0]!), model: 'FICTION-CHANGED' } }] };
    expect(() => buildImportPlan(fixtures, changed)).toThrow('既存データと異なる');
  });
  it('accepts HTTPS origins and loopback development, and rejects credentials, paths and nonlocal HTTP', () => {
    expect(validateCmsOrigin('https://cms.example.org/')).toBe('https://cms.example.org');
    expect(validateCmsOrigin('http://localhost:4321')).toBe('http://localhost:4321');
    for (const url of ['http://cms.example.org', 'https://a:b@cms.example.org', 'https://cms.example.org/sub/', 'https://cms.example.org/?token=x']) expect(() => validateCmsOrigin(url)).toThrow();
  });
  it('creates only drafts, sends the token only in an HTTP header, and refuses redirects', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return Response.json({ success: true, data: { item: { id: 'cms-id' } } }, { status: 201 });
    }) as unknown as typeof globalThis.fetch;
    const plan = { create: buildImportPlan(fixtures).create.slice(0, 1), skipped: 0, fill: [] };
    expect(await applyImportPlan(plan, { origin: 'https://cms.example.org', token: 'private-test-token', fetch })).toBe(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://cms.example.org/_emdash/api/content/televisions');
    expect(call.init.redirect).toBe('error');
    expect(call.init.headers).toMatchObject({ Authorization: 'Bearer private-test-token' });
    const body = JSON.parse(String(call.init.body));
    expect(body.status).toBe('draft');
    expect(body.locale).toBe('ja');
    expect(JSON.stringify(body)).not.toContain('private-test-token');
  });
  it('preflights every page and collection before deciding what can be created', async () => {
    const calls: URL[] = [];
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input)); calls.push(url);
      return Response.json({ success: true, data: { items: [], ...(url.pathname.endsWith('/televisions') && !url.searchParams.has('cursor') ? { nextCursor: 'next' } : {}) } });
    }) as unknown as typeof globalThis.fetch;
    expect(await listExistingCmsRows({ origin: 'https://cms.example.org', token: 'test-token', fetch })).toEqual(empty());
    expect(calls.map(url => url.pathname)).toEqual(['/_emdash/api/content/televisions', '/_emdash/api/content/televisions', '/_emdash/api/content/stands', '/_emdash/api/content/compatibility']);
    expect(calls[1]!.searchParams.get('cursor')).toBe('next');
    expect(calls.every(url => url.searchParams.get('status') === 'all')).toBe(true);
  });
  it('exports the original CSV columns with VESA patterns and quoted notes intact', () => {
    const notes = '架空の注記, \"引用\"\n次の行';
    const catalog = { ...fixtures, compatibility: [{ ...fixtures.compatibility[0]!, notes }] };
    const files = catalogCsvFiles(catalog);
    const television = parse(files['televisions.csv']!, { columns: true })[0] as Record<string, string>;
    expect(television.id).toBe(fixtures.televisions[0]!.id);
    expect(television).not.toHaveProperty('external_id');
    const compatibility = parse(files['compatibility.csv']!, { columns: true })[0] as Record<string, string>;
    expect(compatibility.notes).toBe(notes);
    expect(compatibility.status).toBe(fixtures.compatibility[0]!.status);
    const stand = parse(files['stands.csv']!, { columns: true })[0] as Record<string, string>;
    expect(stand.vesa_patterns).toBe(fixtures.stands[0]!.vesa_patterns.map(p => `${p.width}x${p.height}`).join(';'));
  });
  it('does not treat authentication failure or an HTML login page as an empty CMS', async () => {
    const unauthorized = vi.fn(async () => new Response('denied', { status: 401 })) as unknown as typeof globalThis.fetch;
    await expect(listExistingCmsRows({ origin: 'https://cms.example.org', token: 'test-token', fetch: unauthorized })).rejects.toThrow('HTTP 401');
    const html = vi.fn(async () => new Response('<html>sign in</html>')) as unknown as typeof globalThis.fetch;
    await expect(listExistingCmsRows({ origin: 'https://cms.example.org', token: 'test-token', fetch: html })).rejects.toThrow('JSON以外');
  });
  it('retries transient 503 responses on reads but never retries writes', async () => {
    let reads = 0;
    const flaky = vi.fn(async () => (reads += 1) <= 2
      ? new Response('busy', { status: 503 })
      : Response.json({ success: true, data: { items: [] } })) as unknown as typeof globalThis.fetch;
    expect(await listExistingCmsRows({ origin: 'https://cms.example.org', token: 'test-token', fetch: flaky, retryDelayMs: 1 })).toEqual(empty());
    const busy = vi.fn(async () => new Response('busy', { status: 503 })) as unknown as typeof globalThis.fetch;
    const plan = buildImportPlan(fixtures);
    await expect(applyImportPlan(plan, { origin: 'https://cms.example.org', token: 'test-token', fetch: busy, retryDelayMs: 1, writeIntervalMs: 0 })).rejects.toThrow('HTTP 503');
    expect(busy).toHaveBeenCalledTimes(1);
  });
  it('fills only CMS fields that are blank, and only with --fill-blanks', () => {
    const rows = Object.fromEntries(catalogCollections.map(collection => [collection, fixtures[collection].map((row, i) => ({ id: `${collection}-${i}`, data: toCmsRecord(collection, row) }))])) as unknown as CmsCatalogRows;
    const tv = toCmsRecord('televisions', fixtures.televisions[0]!);
    const blank = { ...rows, televisions: [{ id: 'cms-tv', data: { ...tv, vesa_width_mm: null, vesa_height_mm: null } }, ...rows.televisions.slice(1)] };
    expect(() => buildImportPlan(fixtures, blank)).toThrow('既存データと異なる');
    const plan = buildImportPlan(fixtures, blank, { fillBlanks: true });
    expect(plan.create).toEqual([]);
    expect(plan.fill).toEqual([{ collection: 'televisions', key: fixtures.televisions[0]!.id, id: 'cms-tv', fields: { vesa_width_mm: tv.vesa_width_mm, vesa_height_mm: tv.vesa_height_mm } }]);
    const overwritten = { ...rows, televisions: [{ id: 'cms-tv', data: { ...tv, model: 'FICTION-CHANGED', vesa_width_mm: null, vesa_height_mm: null } }, ...rows.televisions.slice(1)] };
    expect(() => buildImportPlan(fixtures, overwritten, { fillBlanks: true })).toThrow('既存データと異なる');
  });
  it('keeps drafts as drafts, skips published entries, and verifies every fill', async () => {
    const stored: Record<string, { status: string; data: Record<string, unknown> }> = {
      a: { status: 'draft', data: { external_id: 'a', vesa_width_mm: null, vesa_height_mm: null, model: 'A' } },
      b: { status: 'published', data: { external_id: 'b', vesa_width_mm: null, vesa_height_mm: null, model: 'B' } },
    };
    const puts: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const id = String(input).split('/').pop()!;
      if (init?.method === 'PUT') { const body = JSON.parse(String(init.body)); puts.push(body); stored[id] = { status: body.status, data: body.data }; }
      return Response.json({ success: true, data: { item: { id, ...stored[id] } } });
    }) as unknown as typeof globalThis.fetch;
    const fields = { vesa_width_mm: 300, vesa_height_mm: 300 };
    const plan = { create: [], skipped: 0, fill: [
      { collection: 'televisions' as const, key: 'a', id: 'a', fields },
      { collection: 'televisions' as const, key: 'b', id: 'b', fields },
    ] };
    expect(await applyFillPlan(plan, { origin: 'https://cms.example.org', token: 'test-token', fetch, writeIntervalMs: 0 })).toEqual({ filled: 1, published: ['b'] });
    expect(puts).toEqual([{ data: { external_id: 'a', vesa_width_mm: 300, vesa_height_mm: 300, model: 'A' }, status: 'draft' }]);
    expect(stored.b!.data.vesa_width_mm).toBeNull();
    let call = 0;
    const publishing = vi.fn(async () => {
      call += 1;
      const after = call > 1;
      return Response.json({ success: true, data: { item: { status: call > 2 ? 'published' : 'draft', data: { external_id: 'c', vesa_width_mm: after ? 300 : null, vesa_height_mm: after ? 300 : null } } } });
    }) as unknown as typeof globalThis.fetch;
    await expect(applyFillPlan({ create: [], skipped: 0, fill: [{ collection: 'televisions', key: 'c', id: 'c', fields }] }, { origin: 'https://cms.example.org', token: 'test-token', fetch: publishing, writeIntervalMs: 0 })).rejects.toThrow('下書き以外');
  });
});
