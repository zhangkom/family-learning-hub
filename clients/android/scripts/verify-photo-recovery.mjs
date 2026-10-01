import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { installSyntheticPhotoBridge } from './synthetic-photo-bridge.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
if (!process.env.PHOTO_QA_OUTPUT) throw new Error('Set PHOTO_QA_OUTPUT to project artifacts/qa');
const out = path.resolve(process.env.PHOTO_QA_OUTPUT); await mkdir(out, { recursive: true });
const origin = 'http://127.0.0.1:3294', api = origin + '/test-api';
const server = await createServer({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), server: { host: '127.0.0.1', port: 3294, strictPort: true } }); await server.listen();
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(installSyntheticPhotoBridge, { api, missingSourceUris: ['/synthetic/missing.png'] });
await context.addInitScript(({ api }) => {
  const records = [
    { id: '33333333-3333-3333-3333-333333333333', owner: api + '|A', studentId: 'a', source: 'camera', uri: '/synthetic/missing.png' },
    { id: '44444444-4444-4444-4444-444444444444', owner: api + '|A', studentId: 'a', source: 'camera', uri: '/synthetic/healthy.png' },
    { id: '55555555-5555-5555-5555-555555555555', owner: api + '|other', studentId: 'a', source: 'camera', uri: '/synthetic/foreign.png' },
  ];
  for (const record of records) localStorage.setItem('family-learning:camera-result-v1:' + record.id, JSON.stringify(record));
}, { api });
const page = await context.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', route => {
  const request = route.request(), url = new URL(request.url());
  if (url.href.includes('/downloads/android/latest.json')) return route.fulfill({ status: 503, body: '{}' });
  assert.equal(url.origin, origin);
  if (!url.pathname.startsWith('/test-api/')) return route.continue();
  assert.equal(request.method(), 'GET');
  const data = url.pathname.endsWith('/session') ? { user: { id: 'A', username: '合成家庭A' } }
    : url.pathname.endsWith('/students') ? { students: [{ id: 'a', name: '合成学生A', createdAt: '2026-10-01T12:00:00Z' }] }
    : { scans: [], recognition: true };
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
});
const originalCount = () => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('host-test:original:')).length);
try {
  await page.goto(origin);
  await page.getByRole('heading', { name: '把题目拍清楚' }).waitFor();
  assert.equal(await originalCount(), 1);
  await page.getByRole('button', { name: '取消，保留原片', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '相机缓存文件已丢失' }).waitFor();
  await page.getByRole('button', { name: '重试读取', exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '重试读取')?.disabled);
  assert.equal(await originalCount(), 1);
  await page.screenshot({ path: path.join(out, 'camera-partial-recovery.png'), fullPage: true });
  await page.getByRole('button', { name: '移除这条相机引用，保留原片', exact: true }).click();
  assert.equal(await page.getByRole('alert').filter({ hasText: '相机缓存文件已丢失' }).count(), 0);
  const remaining = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('family-learning:camera-result-v1:')).map(k => JSON.parse(localStorage.getItem(k))));
  assert.equal(remaining.length, 1); assert.equal(remaining[0].owner, api + '|other');
  assert.equal(await originalCount(), 1);
  await page.getByRole('button', { name: '本机原片', exact: true }).click(); await page.locator('.photo-library-card').waitFor();
  assert.equal(await page.locator('.photo-library-card').count(), 1); assert.deepEqual(errors, []);
  const report = { syntheticBridgeOnly: true, nativeRuntimeTested: false, checks: ['坏第一项不阻止好第二项导入', '失败项显式提示并可重试', '重试不重复导入已成功原片', '显式移除只删失败相机引用，原片与其他账号引用保留'], errors };
  await writeFile(path.join(out, 'camera-recovery-result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch(e) { console.error((await page.locator('body').innerText()).slice(0, 3000)); throw e; }
finally { await browser.close(); await server.close(); }
