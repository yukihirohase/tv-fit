import { emdashAdminSlashRedirect, isPrivateSessionRequest } from '../src/lib/private-session-guard';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

interface PackedAsset { body: string; type: string; etag: string; size: number }
interface AssetHelpers {
  collectClientAssets(directory: string): Record<string, PackedAsset> | Promise<Record<string, PackedAsset>>;
  createAssetFetch(assets: Record<string, PackedAsset>, decompress: (bytes: Uint8Array) => Uint8Array): (request: Request) => Promise<Response>;
}
let helpers: AssetHelpers;
const temporaryDirectories: string[] = [];
const scriptBody = 'console.log("fictional asset fixture");\n';
const createFetch = (assets: Record<string, PackedAsset>) => helpers.createAssetFetch(
  assets,
  bytes => new Uint8Array(gunzipSync(bytes)),
);

beforeAll(async () => {
  const moduleUrl = pathToFileURL(resolve('scripts/build-sites-worker.mjs')).href;
  helpers = await import(moduleUrl) as AssetHelpers;
});
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), 'tv-fit-worker-assets-'));
  temporaryDirectories.push(directory);
  const client = resolve(directory, 'client');
  await mkdir(resolve(client, '_astro'), { recursive: true });
  await mkdir(resolve(client, 'private'), { recursive: true });
  await mkdir(resolve(client, 'src'), { recursive: true });
  await Promise.all([
    writeFile(resolve(client, '_astro/app.js'), scriptBody),
    writeFile(resolve(client, '_astro/app.css'), 'body { color: blue; }\n'),
    writeFile(resolve(client, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>'),
    writeFile(resolve(client, 'robots.txt'), 'User-agent: *\nAllow: /\n'),
    writeFile(resolve(client, '.env'), 'FICTIONAL_SECRET=do-not-publish'),
    writeFile(resolve(client, '_astro/app.js.map'), '{"sourcesContent":["private source"]}'),
    writeFile(resolve(client, 'catalog.csv'), 'id,model\nfixture,FICTION\n'),
    writeFile(resolve(client, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n'),
    writeFile(resolve(client, 'private/backup.js'), 'console.log("private backup");'),
    writeFile(resolve(client, 'src/config.js'), 'export const privateConfig = true;'),
  ]);
  const outside = resolve(directory, 'outside.js');
  await writeFile(outside, 'console.log("outside allowed directory");');
  await symlink(outside, resolve(client, '_astro/outside.js'));
  return { directory, client };
}

describe('Sites Worker embedded public assets', () => {
  it('packs only approved client assets and keeps source, CSV, configuration and links private', async () => {
    const { client } = await fixture();
    const assets = await helpers.collectClientAssets(client);
    expect(Object.keys(assets).sort()).toEqual(['/_astro/app.css', '/_astro/app.js', '/favicon.svg', '/robots.txt']);
    const script = assets['/_astro/app.js'];
    expect(script).toBeDefined();
    expect(script?.type).toMatch(/javascript/);
    expect(script?.etag).toBeTruthy();
    expect(script?.size).toBe(Buffer.byteLength(scriptBody));
    expect(gunzipSync(Buffer.from(script!.body, 'base64')).toString()).toBe(scriptBody);
    expect(assets['/_astro/app.css']?.type).toMatch(/text\/css/);
    expect(assets['/favicon.svg']?.type).toMatch(/image\/svg\+xml/);
    expect(assets['/robots.txt']?.type).toBe('text/plain; charset=utf-8');
  });

  it('serves an exact public path with safe MIME headers and ignores only its query string', async () => {
    const { client } = await fixture();
    const assets = await helpers.collectClientAssets(client);
    const fetchAsset = createFetch(assets);
    const response = await fetchAsset(new Request('https://site.example.invalid/_astro/app.js?v=fixture'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/javascript/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(await response.text()).toBe(scriptBody);
    expect(response.headers.get('etag')).toBe(assets['/_astro/app.js']?.etag);
    expect((await fetchAsset(new Request('https://site.example.invalid/_astro/app.js/extra'))).status).toBe(404);
    expect((await fetchAsset(new Request('https://site.example.invalid/.env'))).status).toBe(404);
  });

  it('leaves transfer compression to the hosting edge and provides bodyless HEAD and cache validation responses', async () => {
    const { client } = await fixture();
    const assets = await helpers.collectClientAssets(client);
    const fetchAsset = createFetch(assets);
    const requestUrl = 'https://site.example.invalid/_astro/app.js';
    const response = await fetchAsset(new Request(requestUrl, { headers: { 'accept-encoding': 'gzip' } }));
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(await response.text()).toBe(scriptBody);
    const head = await fetchAsset(new Request(requestUrl, { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const cached = await fetchAsset(new Request(requestUrl, { headers: { 'if-none-match': assets['/_astro/app.js']!.etag } }));
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');
  });

  it('refuses writes and does not serve a directory as a missing HTML fallback', async () => {
    const { client } = await fixture();
    const fetchAsset = createFetch(await helpers.collectClientAssets(client));
    const writeResponse = await fetchAsset(new Request('https://site.example.invalid/_astro/app.js', { method: 'POST' }));
    expect(writeResponse.status).toBe(405);
    expect(writeResponse.headers.get('allow')).toMatch(/GET/);
    expect((await fetchAsset(new Request('https://site.example.invalid/'))).status).toBe(404);
    expect((await fetchAsset(new Request('https://site.example.invalid/_astro/'))).status).toBe(404);
    // Prove that the rejected file exists rather than testing a missing fixture.
    expect(await readFile(resolve(client, '.env'), 'utf8')).toContain('FICTIONAL_SECRET');
  });
});


describe('private R2 session URLs', () => {
  it('blocks session object names in media paths and query parameters', () => {
    expect(isPrivateSessionRequest('https://site.invalid/_emdash/api/media/file/__tvfit_private_sessions__:session')).toBe(true);
    expect(isPrivateSessionRequest('https://site.invalid/_emdash/api/media/file/__tvfit_private_sessions__/session')).toBe(true);
    expect(isPrivateSessionRequest('https://site.invalid/_emdash/api/media/file?key=__tvfit_private_sessions__%3Asession')).toBe(true);
  });
  it('blocks repeatedly encoded session prefixes and tolerantly decoded URL parameters', () => {
    const prefix = '__tvfit_private_sessions__';
    const encoded = prefix.replaceAll('_', '%5F');
    expect(isPrivateSessionRequest(`https://site.invalid/_emdash/api/media/file/${encoded}:session`)).toBe(true);
    expect(isPrivateSessionRequest(`https://site.invalid/_emdash/api/media/file/${encodeURIComponent(encoded)}:session`)).toBe(true);
    expect(isPrivateSessionRequest(`https://site.invalid/?key=${encoded}:session%`)).toBe(true);
  });
  it('permits normal pages and media, including harmless percent values', () => {
    expect(isPrivateSessionRequest('https://site.invalid/sony/')).toBe(false);
    expect(isPrivateSessionRequest('https://site.invalid/_emdash/api/media/file/uploads/example.png')).toBe(false);
    expect(isPrivateSessionRequest('https://site.invalid/_emdash/admin?search=50%25')).toBe(false);
    expect(isPrivateSessionRequest('https://site.invalid/%E3%83%86%E3%83%AC%E3%83%93/')).toBe(false);
  });
  it('fails closed for malformed input instead of throwing before routing', () => {
    expect(isPrivateSessionRequest('not a URL')).toBe(true);
  });
});

describe('EmDash admin routing', () => {
  it('normalizes setup redirects for trailing-slash routing', () => {
    expect(emdashAdminSlashRedirect('https://example.test/_emdash/admin/setup')?.pathname).toBe('/_emdash/admin/setup/');
    expect(emdashAdminSlashRedirect('https://example.test/_emdash/admin/setup/')).toBeNull();
    expect(emdashAdminSlashRedirect('https://example.test/_emdash/api/setup/status')).toBeNull();
  });
});
