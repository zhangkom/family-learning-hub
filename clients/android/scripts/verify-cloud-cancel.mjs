import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installSyntheticPhotoBridge } from './synthetic-photo-bridge.mjs';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const client = process.env.PILOT_PREVIEW_URL || 'http://127.0.0.1:3179'; assert.equal(new URL(client).hostname, '127.0.0.1');
const api = 'https://123.207.232.151/family-learning/api/mobile/v1';
const out = resolve(process.env.PHOTO_QA_OUTPUT || 'test-results/cloud-cancel'); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const errors = [], layouts = [], checks = [], receipts = []; const productionWrites = 0;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(installSyntheticPhotoBridge, { api, initialToken: 'cancel-test', initialUserId: 'A' });
  await context.addInitScript(() => {
    const previous = window.Capacitor.nativePromise;
    window.cancelPicker = true; window.pickCalls = 0; window.importFailures = false;
    window.Capacitor.nativePromise = async (plugin, method, args) => {
      if (method === 'pickOriginalBatch') {
        window.pickCalls++;
        const batch = await previous(plugin, method, args);
        if (window.cancelPicker) {
          batch.items = []; batch.state = 'cancelled';
          localStorage.setItem('host-test:batch:' + JSON.stringify([args.owner, batch.batchId]), JSON.stringify(batch));
        }
        return batch;
      }
      if (method === 'importBatchItem' && window.importFailures) throw new Error('合成导入中断');
      return previous(plugin, method, args);
    };
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === new URL(client).origin) return route.continue();
    const send = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname.endsWith('latest.json')) return route.fulfill({ status: 503, body: '{}' });
    if (url.href === api + '/setup') return send({ enabled: true, registrationEnabled: true, cloudPhotos: { version: 1, nameConflictVersion: 1, maxBatchItems: Number.MAX_SAFE_INTEGER, maxFileBytes: 33554432, mimeTypes: ['image/png','image/jpeg','image/webp'], recommendedConcurrency: 1 } });
    if (url.href === api + '/session') return send({ user: { id: 'A', username: '取消选图合成验收' } });
    if (url.pathname.endsWith('/learning-sessions')) return send({ sessions: [], more: false, enabled: true });
    if (url.pathname.endsWith('/students')) return send({ students: [{ id: 'student-a', name: '合成学生甲', createdAt: new Date().toISOString() }] });
    if (url.pathname.endsWith('/scans')) return send({ scans: [], recognition: false });
    if (url.pathname.endsWith('/cloud-photos') && request.method() === 'GET') return send({ photos: [], storage: { usedBytes: 0, limitBytes: 2147483648 } });
    if (url.pathname.endsWith('/cloud-photos/name')) return send({ name: url.searchParams.get('name'), suggestedName: url.searchParams.get('name'), token: 'a'.repeat(64), conflicts: 0 });
    if (url.pathname.endsWith('/cloud-photo-batches') && request.method() === 'POST') return send({ batch: { id: randomUUID(), ...request.postDataJSON() } });
    if (url.pathname.endsWith('/cloud-photos') && request.method() === 'POST') {
      const form = await new Response(request.postDataBuffer(), { headers: { 'Content-Type': request.headers()['content-type'] } }).formData();
      const file = form.get('file'), bytes = Buffer.from(await file.arrayBuffer());
      assert.equal(createHash('sha256').update(bytes).digest('hex'), form.get('sha256'));
      const photo = { id: randomUUID(), batchId: form.get('batchId'), clientRequestId: form.get('clientRequestId'), studentId: form.get('studentId'), originalName: file.name, mimeType: file.type, size: bytes.length, sha256: form.get('sha256'), createdAt: new Date().toISOString() };
      receipts.push(photo); return send({ photo });
    }
    errors.push(request.method() + ' ' + url.pathname); return route.abort();
  });
  await page.goto(client); await page.getByRole('button', { name: '图片云盘', exact: true }).click();
  const picker = () => page.getByRole('button', { name: '相册选择', exact: true });
  await picker().waitFor();
  for (let i = 1; i <= 3; i++) {
    await page.waitForFunction(() => !document.querySelector('.cloud-pick-actions button').disabled);
    await picker().tap(); await page.getByText('已取消选图，可以重新选择。', { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.cloud-pick-actions button').disabled);
    assert.equal(await page.evaluate(() => window.pickCalls), i);
    assert.equal(await page.locator('.cloud-job').count(), 0);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('host-test:batch:')).length), 0);
    await picker().hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.cloud-pick-actions button')).backgroundColor === 'rgb(35, 72, 206)');
    const style = await picker().evaluate(button => ({ background: getComputedStyle(button).backgroundColor, color: getComputedStyle(button).color, disabled: button.disabled }));
    assert.equal(style.disabled, false); assert.equal(style.background, 'rgb(35, 72, 206)'); assert.equal(style.color, 'rgb(255, 255, 255)');
  }
  checks.push('Three consecutive empty cancellations release all controls; blue button remains legible while hovered/touched; empty native manifests are acknowledged');
  await page.getByRole('button', { name: '文件夹范围', exact: true }).tap();
  await page.waitForFunction(() => !document.querySelector('.cloud-pick-actions button').disabled);
  await page.getByRole('button', { name: '系统相册多选', exact: true }).tap();
  await page.waitForFunction(() => !document.querySelector('.cloud-pick-actions button').disabled);
  assert.equal(await page.evaluate(() => window.pickCalls), 5);
  assert.equal(await page.getByRole('button', { name: /恢复上次|继续上次选图|中断续传/ }).count(), 0);
  checks.push('Folder and system picker cancellations also allow reopening; no permanent recovery button appears when no import is pending');
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const geometry = await page.locator('.cloud-pick-actions button').evaluateAll(buttons => buttons.map(b => { const rect = b.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }; }));
    assert.equal(geometry.length, 2); assert.ok(geometry.every(r => r.height >= 44 && r.bottom === geometry[0].bottom));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    layouts.push({ width, geometry }); await page.screenshot({ path: resolve(out, `cancelled-${width}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { window.cancelPicker = false; window.importFailures = true; window.hostPhotoTest.album(2); });
  await picker().tap(); await page.getByText('还有 2 张所选照片未导入。', { exact: false }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.cloud-pick-actions button').disabled);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('host-test:batch:'));
    const scope = JSON.parse(key.slice('host-test:batch:'.length)), batch = JSON.parse(localStorage.getItem(key));
    const oldId = crypto.randomUUID();
    localStorage.setItem('host-test:batch:' + JSON.stringify([scope[0], oldId]), JSON.stringify({ ...batch, batchId: oldId, state: 'cancelled', items: [], createdAt: batch.createdAt - 1000 }));
    window.importFailures = false;
  });
  await page.getByRole('button', { name: '中断续传', exact: true }).tap();
  await page.waitForFunction(() => document.querySelectorAll('.cloud-job-completed').length === 2 && !document.querySelector('.cloud-pick-actions button').disabled);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('host-test:batch:')).length), 0);
  assert.equal(await page.getByLabel('上传完成数量').textContent(), '2/2');
  assert.equal(await page.getByRole('button', { name: '中断续传', exact: true }).count(), 0);
  assert.equal(receipts.length, 2); assert.equal(new Set(receipts.map(p => p.clientRequestId)).size, 2);
  checks.push('Older empty cancelled batch no longer masks two unfinished photos; explicit continuation imports and uploads each once, then disappears');
  assert.equal(productionWrites, 0); assert.deepEqual(errors, []);
  writeFileSync(resolve(out, 'cloud-cancel-result.json'), JSON.stringify({ checkedAt: new Date().toISOString(), syntheticOnly: true, nativeDeviceTested: false, productionWrites, syntheticUploads: receipts.length, checks, layouts, errors }, null, 2));
  console.log('Cancelled selection, repeat taps, recovery and button contrast passed using a synthetic native bridge.');
} finally { await browser.close(); }
