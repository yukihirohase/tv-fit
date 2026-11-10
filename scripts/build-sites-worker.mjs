import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const MARKER = '// TV FIT Sites Worker: generated from the Astro Cloudflare build.\n';
const MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
const ASSET_PREFIXES = ['_astro/', '_emdash/', 'assets/', 'images/', 'fonts/'];
const ROOT_ASSETS = new Set(['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'site.webmanifest', 'robots.txt', '404.html']);

/** Package only emitted browser assets, never the server tree or source data. */
export async function collectClientAssets(clientDirectory) {
  const root = resolve(clientDirectory);
  const assets = Object.create(null);
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      if (name.startsWith('.')) continue;
      const filename = resolve(directory, name);
      const details = await lstat(filename);
      if (details.isSymbolicLink()) continue;
      const path = relative(root, filename).split(sep).join('/');
      if (path.split('/').some(part => ['src', 'server', 'private', 'data', 'fixtures', 'tests', 'scripts', 'node_modules'].includes(part))) continue;
      if (details.isDirectory()) {
        // Only these namespaces contain application browser bundles or public media.
        if (ASSET_PREFIXES.some(prefix => `${path}/`.startsWith(prefix) || prefix.startsWith(`${path}/`))) await visit(filename);
        continue;
      }
      const type = MIME[extname(name).toLowerCase()];
      if (!type || (!ROOT_ASSETS.has(path) && !ASSET_PREFIXES.some(prefix => path.startsWith(prefix)))) continue;
      const bytes = await readFile(filename);
      const packed = {
        body: gzipSync(bytes, { level: 9, mtime: 0 }).toString('base64'),
        type,
        etag: `W/"${createHash('sha256').update(bytes).digest('hex')}"`,
        size: bytes.byteLength,
      };
      assets[`/${path}`] = packed;
      if (path === '404.html') {
        assets['/404'] = packed;
        assets['/404/'] = packed;
      }
    }
  }
  await visit(root);
  return assets;
}

/** This function is self-contained because its source is embedded in the Worker. */
export function createAssetFetch(assets, decompress) {
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(assets, key);
  const decode = (body) => Uint8Array.from(atob(body), character => character.charCodeAt(0));
  return async function fetchAsset(request) {
    const pathname = new URL(request.url).pathname;
    if (!hasOwn(pathname)) return new Response('Not found', { status: 404 });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const asset = assets[pathname];
    const headers = new Headers({
      'Content-Type': asset.type,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': pathname.startsWith('/_astro/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      ETag: asset.etag,
    });
    const match = request.headers.get('If-None-Match');
    if (match && (match.trim() === '*' || match.split(',').some(value => value.trim() === asset.etag))) {
      return new Response(null, { status: 304, headers });
    }
    const body = decompress(decode(asset.body));
    headers.set('Content-Length', String(body.byteLength));
    if (request.method === 'HEAD') return new Response(null, { headers });
    return new Response(body, { headers });
  };
}

export async function buildSitesWorker(projectDirectory = process.cwd()) {
  const project = resolve(projectDirectory);
  const serverDirectory = resolve(project, 'dist/server');
  const generatedConfigPath = resolve(serverDirectory, 'wrangler.json');
  if (!existsSync(generatedConfigPath)) throw new Error('Build Astro with the Cloudflare adapter before packaging the Sites Worker.');
  const generated = JSON.parse(await readFile(generatedConfigPath, 'utf8'));
  if (!generated.main) throw new Error('The Astro Cloudflare build has no Worker main entrypoint.');
  const originalMain = resolve(serverDirectory, generated.main);
  if (relative(serverDirectory, originalMain).startsWith('..')) throw new Error('The generated Worker entrypoint is outside dist/server.');
  const output = resolve(serverDirectory, 'index.js');
  let sourceMain = originalMain;
  // Vite sometimes calls its entry index.js. Preserve it before replacing that
  // filename with the single-module artifact expected by Sites. Repeated
  // packaging uses this original, never the previously wrapped Worker.
  if (originalMain === output) {
    const backup = resolve(serverDirectory, '__astro_entry.mjs');
    const original = await readFile(originalMain, 'utf8');
    if (!original.startsWith(MARKER)) await writeFile(backup, original);
    if (!existsSync(backup)) throw new Error('The original Astro Worker entrypoint is missing. Rebuild Astro.');
    sourceMain = backup;
  }
  const clientDirectory = generated.assets?.directory
    ? resolve(serverDirectory, generated.assets.directory)
    : resolve(project, 'dist/client');
  if (relative(resolve(project, 'dist'), clientDirectory).startsWith('..')) throw new Error('The generated asset directory must be inside dist.');
  const assets = await collectClientAssets(clientDirectory);
  const sessionGuard = fileURLToPath(new URL('../src/lib/private-session-guard.ts', import.meta.url));
  const source = `import application from ${JSON.stringify(sourceMain)};\n`
    + `import {ungzip as decompress} from 'pako';\n`
    + `import {isPrivateSessionRequest} from ${JSON.stringify(sessionGuard)};\n`
    + `const assets = ${JSON.stringify(assets)};\n`
    + `const fetchAsset = (${createAssetFetch.toString()})(assets, decompress);\n`
    + `const embeddedAssets = { fetch(input, init) { return fetchAsset(input instanceof Request ? input : new Request(input, init)); } };\n`
    + `export default { ...application, async fetch(request, env, context) {\n`
    + ` if (isPrivateSessionRequest(request)) return new Response('Not found', {status:404,headers:{'Cache-Control':'no-store'}});\n`
    + ` const asset = await fetchAsset(request);\n`
    + ` if (asset.status !== 404) return asset;\n`
    + ` return application.fetch(request, { ...env, ASSETS: env.ASSETS ?? embeddedAssets }, context);\n`
    + `} };\n`;
  const { build } = await import('esbuild');
  const result = await build({
    stdin: { contents: source, resolveDir: serverDirectory, sourcefile: 'sites-worker-entry.mjs', loader: 'js' },
    bundle: true,
    platform: 'neutral',
    format: 'esm',
    target: 'es2022',
    conditions: ['workerd', 'worker', 'browser', 'import', 'default'],
    // The Cloudflare build intentionally leaves Node compatibility modules for
    // workerd. Cover both explicit node: imports and dependencies that use the
    // legacy bare spelling (for example `stream`).
    external: ['node:*', 'cloudflare:*', ...builtinModules],
    write: false,
    minify: true,
    legalComments: 'none',
    sourcemap: false,
    logLevel: 'warning',
  });
  const emitted = result.outputFiles[0];
  if (!emitted) throw new Error('Worker packaging produced no output.');
  const code = MARKER + emitted.text;
  const temporary = resolve(dirname(output), '.sites-worker.tmp');
  await writeFile(temporary, code);
  await rename(temporary, output);

  // The final Worker contains the Astro server graph and gzip-compressed
  // browser assets. Keeping Vite's intermediate chunks beside it would make
  // Sites upload the same code and assets twice.
  const distDirectory = resolve(project, 'dist');
  for (const name of await readdir(distDirectory)) {
    const path = resolve(distDirectory, name);
    if (name !== 'server') {
      await rm(path, { recursive: true, force: true });
      continue;
    }
    for (const serverEntry of await readdir(path)) {
      if (serverEntry !== 'index.js') await rm(resolve(path, serverEntry), { recursive: true, force: true });
    }
  }
  const report = {
    entrypoint: relative(project, output),
    asset_count: Object.keys(assets).length,
    raw_asset_bytes: Object.values(assets).reduce((total, asset) => total + asset.size, 0),
    worker_bytes: Buffer.byteLength(code),
    worker_gzip_bytes: gzipSync(code, { level: 9 }).byteLength,
  };
  console.log(JSON.stringify(report));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildSitesWorker();
}
