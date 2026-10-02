import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { installSyntheticPhotoBridge } from './synthetic-photo-bridge.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.env.PHOTO_QA_OUTPUT || resolve(root, 'test-results/cloud-recovery'));
mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const api = 'https://cloud-recovery.invalid/api', port = Number(process.env.FAMILY_CLOUD_RECOVERY_PORT || 3320), client = `http://127.0.0.1:${port}`;
const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const errors = [], checks = [], layouts = [], receipts = [];
let failSetup = false, failList = false, holdSetup, releaseSetup, holdUpload, releaseUpload, setupCalls = 0, uploadAttempts = 0;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(installSyntheticPhotoBridge, { api, initialToken: 'recovery-test', initialUserId: 'A' });
  await context.addInitScript(() => {
    const native = window.Capacitor.nativePromise, open = indexedDB.open.bind(indexedDB);
    window.failPendingRead = false; window.failQueueRead = false;
    window.Capacitor.nativePromise = async (plugin, method, args) => {
      if (method === 'listOriginalBatches' && window.failPendingRead) throw new Error('合成本机导入记录暂不可读');
      return native(plugin, method, args);
    };
    IDBFactory.prototype.open = function (...args) {
      if (args[0] === 'family-learning-cloud-drive' && window.failQueueRead) throw new Error('合成本机上传记录暂不可读');
      return open(...args);
    };
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === new URL(client).origin) return route.continue();
    const send = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname.endsWith('latest.json')) return route.fulfill({ status: 503, body: '{}' });
    if (url.href === api + '/setup') {
      setupCalls++;
      if (failSetup) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '合成网络暂不可用' }) });
      if (holdSetup) await holdSetup;
      return send({ enabled: true, registrationEnabled: true, cloudPhotos: { version: 1, nameConflictVersion: 1, maxBatchItems: 2147483647, maxFileBytes: 33554432, mimeTypes: ['image/png', 'image/jpeg', 'image/webp'], recommendedConcurrency: 1 } });
    }
    if (url.href === api + '/session') return send({ user: { id: 'A', username: '断网恢复合成验收' } });
    if (url.pathname.endsWith('/learning-sessions')) return send({ sessions: [], more: false, enabled: true });
    if (url.pathname.endsWith('/students')) return send({ students: [{ id: 'student-a', name: '合成学生甲', createdAt: new Date().toISOString() }] });
    if (url.pathname.endsWith('/scans')) return send({ scans: [], recognition: false });
    if (url.pathname.endsWith('/cloud-photos') && request.method() === 'GET') {
      if (failList) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '合成云图列表暂不可用' }) });
      return send({ photos: [], storage: { usedBytes: 0, limitBytes: 2147483648 } });
    }
    if (url.pathname.endsWith('/cloud-photos/name')) return send({ name: url.searchParams.get('name'), suggestedName: url.searchParams.get('name'), token: 'a'.repeat(64), conflicts: 0 });
    if (url.pathname.endsWith('/cloud-photo-batches') && request.method() === 'POST') return send({ batch: { id: randomUUID(), ...request.postDataJSON() } });
    if (url.pathname.endsWith('/cloud-photos') && request.method() === 'POST') {
      uploadAttempts++;
      if (holdUpload) await holdUpload;
      const form = await new Response(request.postDataBuffer(), { headers: { 'Content-Type': request.headers()['content-type'] } }).formData();
      const file = form.get('file'), bytes = Buffer.from(await file.arrayBuffer());
      assert.equal(createHash('sha256').update(bytes).digest('hex'), form.get('sha256'));
      const photo = { id: randomUUID(), batchId: form.get('batchId'), clientRequestId: form.get('clientRequestId'), studentId: form.get('studentId'), originalName: file.name, mimeType: file.type, size: bytes.length, sha256: form.get('sha256'), createdAt: new Date().toISOString() };
      receipts.push(photo); return send({ photo });
    }
    errors.push(request.method() + ' ' + url.pathname); return route.abort();
  });
  const picker = () => page.getByRole('button', { name: '相册选择', exact: true });
  const ready = () => page.waitForFunction(() => !document.querySelector('.cloud-pick-actions button')?.disabled);
  const jobs = () => page.locator('.cloud-job-text strong').allTextContents();
  const unavailable = () => page.getByText('图片云盘暂未就绪', { exact: true }).waitFor();
  const assertLocked = async () => {
    assert.equal(await picker().isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '文件夹范围', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '系统相册多选', exact: true }).isDisabled(), true);
    for (const button of await page.locator('.cloud-job-actions button').all()) assert.equal(await button.isDisabled(), true);
  };
  await page.goto(client);
  await page.getByRole('button', { name: '图片云盘', exact: true }).click(); await ready();
  await page.evaluate(() => window.hostPhotoTest.album(2)); await picker().click();
  await page.waitForFunction(() => document.querySelectorAll('.cloud-job').length === 2 && !document.querySelector('.cloud-pick-actions button').disabled);
  const savedNames = await jobs(); assert.equal(await page.getByLabel('上传完成数量').textContent(), '0/2');
  await page.getByRole('button', { name: '返回上一页', exact: true }).click();
  failSetup = true;
  await page.getByRole('button', { name: '图片云盘', exact: true }).click(); await unavailable();
  await page.waitForFunction(() => document.querySelectorAll('.cloud-job').length === 2);
  await assertLocked(); assert.deepEqual(await jobs(), savedNames);
  assert.equal(await page.getByText('还没有云图。上传完成后会出现在这里。', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '重新加载', exact: true }).isEnabled(), true);
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const rect = await page.getByRole('button', { name: '重新加载', exact: true }).boundingBox();
    assert.ok(rect && rect.height >= 44 && rect.x >= 0 && rect.x + rect.width <= width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    layouts.push({ width, retry: rect, noOverflow: true }); await page.screenshot({ path: resolve(out, `initialization-failed-${width}.png`) });
  }
  checks.push('An unavailable setup preserves two queued originals, exposes an enabled retry, and does not label unread cloud data as empty. Failure controls fit 320/390/768 px.');
  await page.setViewportSize({ width: 390, height: 844 });
  failSetup = false; failList = true; holdSetup = new Promise(resolve => { releaseSetup = resolve; });
  const beforeRetry = setupCalls;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await page.getByText('正在读取云盘与本机上传记录…', { exact: true }).waitFor();
  await assertLocked(); assert.equal(await page.getByRole('button', { name: '重新加载', exact: true }).count(), 0);
  assert.deepEqual(await jobs(), savedNames); assert.equal(uploadAttempts, 0);
  releaseSetup(); holdSetup = undefined; await ready();
  assert.equal(setupCalls, beforeRetry + 1);
  await page.getByText(/云图读取未完成：/).waitFor();
  assert.equal(await page.getByText('还没有云图。上传完成后会出现在这里。', { exact: true }).count(), 0);
  failList = false; await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByText('还没有云图。上传完成后会出现在这里。', { exact: true }).waitFor();
  assert.equal(await page.getByText(/云图读取未完成：/).count(), 0);
  checks.push('An explicit retry stays locked while the network response is pending, issues one initialization request, and restores the same jobs. A separate list read failure has accurate state and recovers through Refresh.');
  holdUpload = new Promise(resolve => { releaseUpload = resolve; });
  await page.getByRole('button', { name: '开始上传', exact: true }).click();
  await page.getByRole('button', { name: '停止继续上传', exact: true }).waitFor(); await assertLocked();
  assert.equal(await page.getByRole('button', { name: '重新加载', exact: true }).count(), 0);
  releaseUpload(); holdUpload = undefined;
  await page.waitForFunction(() => document.querySelectorAll('.cloud-job-completed').length === 2 && !document.querySelector('.cloud-pick-actions button').disabled);
  assert.equal(await page.getByLabel('上传完成数量').textContent(), '2/2');
  assert.equal(uploadAttempts, 2); assert.equal(new Set(receipts.map(photo => photo.clientRequestId)).size, 2);
  checks.push('Upload after recovery sends each retained original once with matching SHA; the normal upload lock is still enforced and initialization retry cannot interrupt it.');
  for (const flag of ['failPendingRead', 'failQueueRead']) {
    await page.getByRole('button', { name: '返回上一页', exact: true }).click();
    await page.evaluate(flag => { window[flag] = true; }, flag);
    await page.getByRole('button', { name: '图片云盘', exact: true }).click(); await unavailable(); await assertLocked();
    await page.evaluate(flag => { window[flag] = false; }, flag);
    await page.getByRole('button', { name: '重新加载', exact: true }).click(); await ready();
    assert.deepEqual(await jobs(), savedNames);
    assert.equal(await page.getByLabel('上传完成数量').textContent(), '2/2'); assert.equal(uploadAttempts, 2);
  }
  checks.push('Transient native pending-import and IndexedDB reads both recover through the same retry without clearing completed receipts or uploading them again.');
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, 'cloud-recovery-result.json'), JSON.stringify({ checkedAt: new Date().toISOString(), syntheticOnly: true, nativeDeviceTested: false, productionWrites: 0, uploadAttempts, checks, layouts, errors }, null, 2));
  console.log('Cloud initialization, durable records, explicit retry, upload locks and truthful failure states passed.');
} finally { releaseSetup?.(); releaseUpload?.(); await browser.close(); await server.close(); }
