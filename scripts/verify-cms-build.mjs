import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const workerPath = resolve('dist/server/index.js');
const source = await readFile(workerPath, 'utf8');
const fixtureSecret = `emdash_enc_v1_${'A'.repeat(43)}`;
assert(source.startsWith('// TV FIT Sites Worker:'), 'Sites Worker marker is missing');
assert(!source.includes(fixtureSecret), 'verification secret leaked into the Worker');
assert((await stat(workerPath)).size < 25 * 1024 * 1024, 'Worker exceeds the 25 MiB package budget');

const miniflare = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  scriptPath: workerPath,
  compatibilityDate: '2026-11-08',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: { DB: 'tv-fit-build-verification' },
  r2Buckets: ['MEDIA'],
  bindings: {
    EMDASH_ENCRYPTION_KEY: fixtureSecret,
    EMDASH_SITE_URL: 'https://tv-fit.com',
    PUBLIC_SITE_URL: 'https://tv-fit.com',
    PUBLIC_INDEXING_ENABLED: 'false',
  },
}));

try {
  const request = path => miniflare.dispatchFetch(`https://tv-fit.com${path}`);

  const home = await request('/');
  assert.equal(home.status, 200);
  const homeHtml = await home.text();
  for (const manufacturer of ['SONY', 'Panasonic', 'SHARP', 'TVS REGZA', 'LG', 'Hisense', 'TCL']) {
    assert(homeHtml.includes(manufacturer), `homepage is missing ${manufacturer}`);
  }
  assert(!homeHtml.includes('<form'), 'homepage should guide visitors through manufacturer buttons');

  const manufacturer = await request('/sony/');
  assert.equal(manufacturer.status, 200);
  assert((await manufacturer.text()).includes('型番データを準備中です'));

  const missing = await request('/sony/not-a-real-model/');
  assert.equal(missing.status, 404);

  const setup = await request('/_emdash/api/setup/status/');
  assert.equal(setup.status, 200);
  const setupText = await setup.text();
  assert(/setup|admin|complete|required/i.test(setupText), 'EmDash setup status response is missing');
  const adminCandidates = await Promise.all(
    ['/_emdash/admin/', '/_emdash/admin/setup/', '/_emdash/admin/login/'].map(async path => {
      const response = await request(path);
      return { path, status: response.status, text: await response.text() };
    }),
  );
  assert(
    adminCandidates.some(result => [200, 302, 303, 307, 308].includes(result.status) && /emdash|setup|admin/i.test(result.text)),
    `EmDash admin entrypoints were unavailable: ${adminCandidates.map(result => `${result.path}=${result.status}`).join(', ')}`,
  );

  const privateObject = await request('/_emdash/api/media/file/__tvfit_private_sessions__/example/');
  assert.equal(privateObject.status, 404);
  assert.equal(privateObject.headers.get('cache-control'), 'no-store');

  const database = await miniflare.getD1Database('DB');
  const collections = await database.prepare('SELECT slug FROM _emdash_collections ORDER BY slug').all();
  assert.deepEqual(collections.results.map(row => row.slug), ['compatibility', 'stands', 'televisions']);
  const contentTables = await database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('ec_televisions', 'ec_stands', 'ec_compatibility') ORDER BY name")
    .all();
  assert.deepEqual(contentTables.results.map(row => row.name), ['ec_compatibility', 'ec_stands', 'ec_televisions']);
  for (const table of ['ec_televisions', 'ec_stands', 'ec_compatibility']) {
    const content = await database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first();
    assert.equal(Number(content?.count ?? -1), 0, `production seed must not contain sample ${table}`);
  }

  console.log('EmDash Worker verification passed: public UI, CMS setup, empty seed, and private sessions.');
} finally {
  await miniflare.dispose();
}
