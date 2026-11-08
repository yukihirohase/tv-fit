import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = process.env.SMOKE_ORIGIN ?? 'http://127.0.0.1:4321';
const outputDirectory = resolve(process.env.SMOKE_OUTPUT_DIR ?? 'work/browser');
await mkdir(outputDirectory, { recursive: true });
const profile = await mkdtemp(resolve(outputDirectory, 'tvfit-browser-'));
const configDirectory = resolve(profile, 'config');
const cacheDirectory = resolve(profile, 'cache');
await Promise.all([mkdir(configDirectory), mkdir(cacheDirectory)]);
let stderr = '';
let socket;
let browser;
let sequence = 0;
let timedOut = false;
const pending = new Map();
const exceptions = [];
const consoleErrors = [];
const failedResponses = [];
const requestUrls = [];
const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));

function send(method, params = {}, sessionId) {
  return new Promise((resolveCommand, rejectCommand) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {
      pending.delete(id);
      rejectCommand(new Error(`CDP timeout: ${method}`));
    }, 5000);
    pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timeout });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

const watchdog = setTimeout(() => {
  timedOut = true;
  browser?.kill('SIGKILL');
  socket?.close();
}, 30000);

try {
  browser = spawn(process.env.CHROMIUM_BIN ?? '/usr/bin/chromium', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--disable-breakpad',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-default-apps', '--metrics-recording-only', '--password-store=basic',
    '--use-mock-keychain', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank',
  ], {
    env: { ...process.env, XDG_CONFIG_HOME: configDirectory, XDG_CACHE_HOME: cacheDirectory },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const debuggerUrl = await new Promise((resolveUrl, rejectUrl) => {
    const timeout = setTimeout(() => rejectUrl(new Error('Chromium startup timed out')), 10000);
    browser.on('error', error => { clearTimeout(timeout); rejectUrl(error); });
    browser.on('exit', code => { clearTimeout(timeout); rejectUrl(new Error(`Chromium exited before ready (${code})`)); });
    browser.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-8000);
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolveUrl(match[1]); }
    });
  });
  socket = new WebSocket(debuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });
  socket.addEventListener('close', () => {
    for (const command of pending.values()) {
      clearTimeout(command.timeout);
      command.reject(new Error(timedOut ? 'Browser smoke test exceeded 30 seconds' : 'CDP closed'));
    }
    pending.clear();
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const command = pending.get(message.id);
      if (!command) return;
      clearTimeout(command.timeout);
      pending.delete(message.id);
      if (message.error) command.reject(new Error(message.error.message));
      else command.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map(item => item.value ?? item.description ?? '').join(' '));
    }
    if (message.method === 'Network.requestWillBeSent') requestUrls.push(message.params.request.url);
    if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
      failedResponses.push(`${message.params.response.status}: ${message.params.response.url}`);
    }
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await Promise.all(['Page.enable', 'Runtime.enable', 'Network.enable'].map(method => send(method, {}, sessionId)));
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}\nExpression: ${expression}`);
    return result.result.value;
  };
  const waitFor = async expression => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await delay(80);
    }
    throw new Error(`Browser assertion timed out: ${expression}`);
  };
  const navigate = async path => {
    await send('Page.navigate', { url: new URL(path, origin).href }, sessionId);
    await waitFor(`location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete'`);
    await delay(100);
  };
  const screenshots = [];
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.name === 'mobile',
    }, sessionId);
    await navigate('/');
    const dimensions = await evaluate('({ viewport: innerWidth, content: document.documentElement.scrollWidth })');
    assert(dimensions.content <= dimensions.viewport + 1, `${viewport.name}: horizontal overflow ${JSON.stringify(dimensions)}`);
    assert.equal(await evaluate('document.querySelector("[data-search-model]") !== null'), true);
    assert.equal(await evaluate('document.querySelector("meta[name=ga4-measurement-id]").content'), '');
    assert.equal(await evaluate('[...document.scripts].some(script => /googletagmanager|google-analytics/.test(script.src))'), false);
    assert.equal(await evaluate('typeof window.dataLayer'), 'undefined');
    await evaluate('scrollTo(0, 0)');
    const metrics = await send('Page.getLayoutMetrics', {}, sessionId);
    const screenshot = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: viewport.width, height: Math.ceil(metrics.cssContentSize.height), scale: 1 },
    }, sessionId);
    const path = resolve(outputDirectory, `tvfit-${viewport.name}.png`);
    await writeFile(path, Buffer.from(screenshot.data, 'base64'));
    screenshots.push(path);
    await evaluate('document.querySelector("[data-manufacturer-pick]").click()');
    assert.equal(await evaluate('document.querySelector("[data-search-manufacturer]").value === document.querySelector("[data-manufacturer-pick]").dataset.manufacturerPick'), true);
    assert.equal(await evaluate('document.activeElement === document.querySelector("[data-search-model]")'), true);
    await evaluate('document.querySelector("[data-search-model]").value = "FICTIONAL-NOT-REGISTERED"; document.querySelector("[data-search-form]").requestSubmit()');
    await waitFor('document.querySelector("[data-search-status]").textContent.includes("まだ登録されていません")');
    await evaluate('[...document.querySelectorAll(".header-nav a")].find(link => link.pathname === "/guides/vesa/").click()');
    await waitFor('location.pathname === "/guides/vesa/" && document.readyState === "complete"');
    assert((await evaluate('document.querySelector("h1").textContent')).includes('VESA'));
    const guideDimensions = await evaluate('({ viewport: innerWidth, content: document.documentElement.scrollWidth })');
    assert(guideDimensions.content <= guideDimensions.viewport + 1, `${viewport.name}: guide horizontal overflow`);
  }
  assert.equal(requestUrls.some(url => /googletagmanager|google-analytics/.test(url)), false, 'GA must make no network requests without an ID');
  assert.deepEqual(exceptions, [], 'Unexpected JavaScript exceptions');
  assert.deepEqual(consoleErrors, [], 'Unexpected console errors');
  assert.deepEqual(failedResponses, [], 'Unexpected failed HTTP responses');
  console.log(JSON.stringify({ passed: true, viewports: ['1440x1000', '390x844'], checks: ['responsive overflow', 'manufacturer selection and focus', 'empty search submit', 'guide navigation', 'GA unset isolation', 'JavaScript console and HTTP errors'], screenshots }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (stderr) console.error(`Chromium stderr (tail):\n${stderr.slice(-1600)}`);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  try { if (socket?.readyState === WebSocket.OPEN) await send('Browser.close'); } catch { /* browser may already be closed */ }
  socket?.close();
  if (browser && browser.exitCode === null) browser.kill('SIGTERM');
  await delay(200);
  if (browser && browser.exitCode === null) browser.kill('SIGKILL');
  await rm(profile, { recursive: true, force: true, maxRetries: 2 }).catch(() => {});
}
