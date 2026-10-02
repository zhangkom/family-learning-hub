import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const client = process.env.PILOT_PREVIEW_URL || 'http://127.0.0.1:3179';
assert.equal(new URL(client).hostname, '127.0.0.1');
const { version, androidVersionCode } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const website = 'https://123.207.232.151/family-learning/';
const next = { version: '0.3.0', versionCode: androidVersionCode + 1, channel: 'release', bytes: 7000000,
  sha256: 'b'.repeat(64), downloadUrl: `${website}downloads/android/family-learning-0.3.0-release-1234567.apk`, changelog: '合成更新：改进多题校对和家庭学习。' };
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let mode = 'new', requests = 0;
// Every external request is intercepted. No production calls or APK installations.
await page.route('**/*', async (route) => {
  const request = route.request(), url = request.url();
  if (new URL(url).origin === new URL(client).origin) return route.continue();
  if (url === `${website}downloads/android/latest.json`) {
    requests++;
    assert.equal(request.headers().authorization, undefined);
    assert.equal(request.headers().cookie, undefined);
    if (mode === 'offline') return route.fulfill({ status: 503, body: 'Unavailable' });
    const data = mode === 'new' ? next : { ...next, version, versionCode: mode === 'same' ? androidVersionCode : androidVersionCode - 1 };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  }
  if (url.endsWith('/api/mobile/v1/setup')) return route.fulfill({ contentType: 'application/json', body: '{"enabled":true,"needsSetup":true}' });
  return route.abort('blockedbyclient');
});
try {
  await page.goto(client);
  await page.getByLabel('版本与更新', { exact: true }).click();
  assert.equal(await page.getByRole('link', { name: '下载更新' }).getAttribute('href'), next.downloadUrl);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('.update-actions').evaluate(el => { const a=el.children[0].getBoundingClientRect(), b=el.children[1].getBoundingClientRect(); return Math.abs(a.top-b.top)<5; }), true);
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/update-available.png', fullPage: true });
  mode = 'same'; await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await page.getByText('已是最新版本', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: '下载更新' }).count(), 0);
  mode = 'old'; await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await page.getByRole('button', { name: '检查更新', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: '下载更新' }).count(), 0);
  mode = 'offline'; await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await page.getByText('暂时无法检查更新，请稍后重试', { exact: true }).waitFor();
  assert.equal(await page.getByText('已是最新版本', { exact: true }).count(), 0);
  mode = 'new'; await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await page.getByRole('link', { name: '下载更新' }).waitFor();

  // Exercise the native UI state transitions with a simulated Capacitor bridge.
  // This verifies the UI contract, not Android system permission/installer behavior.
  await page.addInitScript(() => {
    window.androidBridge = {};
    window.updateCalls = [];
    window.updatePermission = false;
    window.updateListeners = {};
    window.Capacitor = {
      PluginHeaders: ['App', 'Camera', 'AppUpdater', 'SessionVault'].map((name) => ({ name, methods: [
        ...['get', 'download', 'install', 'openInstallSettings', 'removeListener'].map((name) => ({ name, rtype: 'promise' })),
        { name: 'addListener', rtype: 'callback' },
      ] })),
      nativeCallback(plugin, method, args, listener) { window.updateListeners[`${plugin}:${args.eventName}`] = listener; return 'synthetic-listener'; },
      async nativePromise(plugin, method, args) {
        if (plugin === 'SessionVault' && method === 'get') return { value: '' };
        if (plugin !== 'AppUpdater') return {};
        window.updateCalls.push(method);
        if (method === 'download') {
          window.downloadArguments = args;
          window.updateListeners['AppUpdater:downloadProgress']?.({ percent: 45 });
          await new Promise((resolve) => setTimeout(resolve, 150));
          if (window.failDownload) throw new Error('安装包校验未通过，请重新下载');
          if (window.simulateDelta) {
            if (window.simulateDelta === 'fallback') window.updateListeners['AppUpdater:downloadProgress']?.({ percent: 0, phase: 'fallback' });
            else window.updateListeners['AppUpdater:downloadProgress']?.({ percent: 100, phase: 'prepare' });
            await new Promise((resolve) => setTimeout(resolve, 150));
            return { mode: window.simulateDelta === 'fallback' ? 'full' : 'delta', fallback: window.simulateDelta === 'fallback' };
          }
          return { mode: 'full', fallback: false };
        }
        if (method === 'install') return { permissionRequired: !window.updatePermission };
        if (method === 'openInstallSettings') window.updatePermission = true;
        return {};
      },
    };
  });
  await page.reload();
  await page.getByLabel('版本与更新', { exact: true }).click();
  await page.evaluate(() => { window.failDownload = true; });
  await page.getByRole('button', { name: '下载更新', exact: true }).click();
  await page.getByText('安装包校验未通过，请重新下载', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.updateCalls.includes('install')), false);
  await page.evaluate(() => { window.failDownload = false; });
  await page.getByRole('button', { name: '下载更新', exact: true }).click();
  await page.getByRole('button', { name: '允许安装更新', exact: true }).click();
  await page.getByRole('button', { name: '继续安装', exact: true }).click();
  await page.getByText('已打开系统安装页面。如果取消了安装，可以再次点击“继续安装”。', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.updateCalls), ['download', 'download', 'install', 'openInstallSettings', 'install']);
  assert.equal(await page.evaluate(() => window.downloadArguments.sha256), next.sha256);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('.update-actions').evaluate(el => { const a=el.children[0].getBoundingClientRect(), b=el.children[1].getBoundingClientRect(); return Math.abs(a.top-b.top)<5; }), true);
  await page.screenshot({ path: 'test-results/update-native-simulation.png', fullPage: true });
  next.deltas = [{ format: 'zai-copy-v1', fromVersionCode: androidVersionCode, baseBytes: 6700000,
    baseSha256: 'a'.repeat(64), bytes: 150000, sha256: 'c'.repeat(64),
    downloadUrl: `${website}downloads/android/family-learning-${androidVersionCode}-to-${next.versionCode}-${'c'.repeat(16)}.zaidelta.gz` }];
  for (const outcome of ['success', 'fallback']) {
    await page.reload();
    await page.getByLabel('版本与更新', { exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.updateCalls), []);
    await page.evaluate((value) => { window.simulateDelta = value; window.updatePermission = true; }, outcome);
    await page.getByRole('button', { name: '下载更新', exact: true }).click();
    await page.getByText(/预计增量下载 0.15 MB/).waitFor();
    await page.getByText(outcome === 'success' ? '增量更新已合成并校验完成。' : '增量更新未能完成，已使用完整安装包。', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.updateCalls), ['download', 'install']);
    assert.deepEqual(await page.evaluate(() => window.downloadArguments.deltas), next.deltas);
  }
  assert.deepEqual(errors, []);
  writeFileSync('test-results/update-verification.json', JSON.stringify({ version, checkedAt: new Date().toISOString(), requests, mockedOnly: true, nativeDeviceTested: false,
    passed: ['automatic update dot and inline download', 'manual check', 'same/older version no downgrade', 'offline retry', 'immutable download URL', 'no credentials', '390px layout', 'simulated download failure stops install', 'simulated permission and install retry without redownload', 'compatible delta size shown during requested download', 'simulated delta success and full fallback'] }, null, 2));
  console.log('Update browser flow and simulated native bridge passed. No production calls or actual installation.');
} finally { await browser.close(); }
