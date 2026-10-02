import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
const config = JSON.parse(await readFile(process.env.FAMILY_DEV_CONNECTION_PATH, 'utf8'));
assert.equal(config.syntheticOnly, true); assert.equal(config.aiEnabled, false);
assert.equal(new URL(config.apiBase).hostname, '127.0.0.1');
const api = config.apiBase, origin = 'http://127.0.0.1:3300';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.env.PHOTO_QA_OUTPUT); await mkdir(out, { recursive: true });
const server = await createServer({ root, server: { host: '127.0.0.1', port: 3300, strictPort: true } }); await server.listen();
const loginResponse = await fetch(api + '/session/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: config.username, password: config.password }) });
assert.equal(loginResponse.status, 200); const login = await loginResponse.json();
const headers = { Authorization: 'Bearer ' + login.token };
const studentResponse = await fetch(api + '/students', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '云盘450图分组合成验收' }) });
assert.equal(studentResponse.status, 201); const student = (await studentResponse.json()).student;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
await context.addInitScript(api => { if (/^https?:$/.test(location.protocol)) localStorage.setItem('family-learning:server', api); }, api);
const page = await context.newPage(); page.setDefaultTimeout(30000);
const errors = [], receipts = [], batches = []; let attempts = 0, modelCalls = 0, external = 0, lostReceipt;
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.href.endsWith('/downloads/android/latest.json')) return route.fulfill({ status: 503, body: '{}' });
  if (![origin, new URL(api).origin].includes(url.origin)) { external++; return route.abort(); }
  if (/\/(recognize|explain)$/.test(url.pathname)) { modelCalls++; return route.abort(); }
  if (request.url() === api + '/cloud-photo-batches' && request.method() === 'POST') {
    batches.push(request.postDataJSON());
  }
  if (request.url() === api + '/cloud-photos' && request.method() === 'POST') {
    attempts++; const response = await route.fetch();
    const result = await response.json();
    if (response.ok()) receipts.push(result.photo);
    if (attempts === 1) { assert.equal(response.status(), 201); lostReceipt = result.photo; return route.abort('connectionreset'); }
    return route.fulfill({ response });
  }
  return route.continue();
});
const button = name => page.getByRole('button', { name, exact: true });
const logIn = async () => {
  await button('登录').click(); await page.getByLabel('账号', { exact: true }).fill(config.username); await page.getByLabel('密码', { exact: true }).fill(config.password);
  await page.locator('form').getByRole('button', { name: '登录', exact: true }).click(); await page.getByLabel('当前学生').selectOption(student.id);
};
const openDrive = async () => { await page.getByRole('button', { name: /^批量上传图片/ }).click(); await button('选择图片').waitFor({ state: 'visible' }); };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const sha256 = createHash('sha256').update(png).digest('hex');
try {
  await page.goto(origin); await logIn(); await openDrive();
  const chooser = page.waitForEvent('filechooser'); await button('选择图片').click();
  await (await chooser).setFiles(Array.from({ length: 450 }, (_, n) => ({ name: `原图合成-${n + 1}.png`, mimeType: 'image/png', buffer: png })));
  await page.waitForFunction(() => document.querySelectorAll('.cloud-job').length === 450); assert.equal(attempts, 0);
  await button('开始上传').click();
  await page.waitForFunction(() => document.querySelectorAll('.cloud-job-completed').length === 449 && document.querySelectorAll('.cloud-job-failed').length === 1, null, { timeout: 180000 });
  assert.equal(attempts, 450); assert.equal(receipts.length, 450);
  const uniqueBatches = [...new Map(batches.map(batch => [batch.clientBatchId, batch])).values()];
  assert.deepEqual(uniqueBatches.map(batch => batch.expectedCount), [200, 200, 50]);
  await page.reload(); await logIn(); await openDrive();
  await page.waitForFunction(() => document.querySelectorAll('.cloud-job-completed').length === 449 && document.querySelectorAll('.cloud-job-failed').length === 1);
  await button('继续上传 / 重试').click();
  await page.waitForFunction(() => document.querySelectorAll('.cloud-job-completed').length === 450);
  assert.equal(attempts, 451); assert.equal(receipts.at(-1).id, lostReceipt.id);
  const photos = []; let cursor;
  do {
    const response = await fetch(`${api}/cloud-photos?studentId=${student.id}&limit=30${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, { headers });
    assert.equal(response.status, 200); const result = await response.json(); photos.push(...result.photos); cursor = result.nextCursor;
  } while (cursor);
  assert.equal(photos.length, 450); assert.equal(new Set(photos.map(photo => photo.id)).size, 450);
  assert.deepEqual([...new Set(photos.map(photo => photo.batchId))].map(id => photos.filter(photo => photo.batchId === id).length).sort((a,b) => b-a), [200, 200, 50]);
  assert.ok(photos.every(photo => photo.studentId === student.id && photo.sha256 === sha256 && photo.size === png.length));
  const scans = await (await fetch(`${api}/scans?studentId=${student.id}`, { headers })).json(); assert.equal(scans.scans.length, 0);
  await page.locator('.cloud-photo').first().scrollIntoViewIfNeeded(); await page.locator('.cloud-photo').first().locator('img').waitFor();
  const downloaded = page.waitForEvent('download'); await button('下载原图').first().click(); const download = await downloaded;
  assert.equal(createHash('sha256').update(await readFile(await download.path())).digest('hex'), sha256);
  const photo = photos[0];
  const thumbnail = await fetch(`${api}/cloud-photos/${photo.id}/thumbnail`, { headers }); assert.equal(thumbnail.status, 200); assert.match(thumbnail.headers.get('content-type'), /image\/jpeg/);
  const unauth = await fetch(`${api}/cloud-photos/${photo.id}/file`); assert.equal(unauth.status, 401);
  const original = await fetch(`${api}/cloud-photos/${photo.id}/file`, { headers }); assert.equal(original.status, 200);
  assert.equal(createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex'), sha256); assert.match(original.headers.get('cache-control'), /no-store/);
  await page.setViewportSize({ width: 320, height: 740 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(out, 'cloud-real-api-320.png') });
  assert.equal(modelCalls, 0); assert.equal(external, 0); assert.deepEqual(errors, []);
  const result = { checkedAt: new Date().toISOString(), syntheticOnly: true, realLocalBackend: true, nativeDeviceTested: false, count: photos.length, uploadAttempts: attempts,
    batchSizes: uniqueBatches.map(batch => batch.expectedCount), originalHashVerified: true, downloadHashVerified: true, durableQueueRecovery: true, lostReceiptRecoveredWithoutDuplicate: true, noScansCreated: true, modelCalls, external, errors };
  await writeFile(path.join(out, 'cloud-real-api-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { await page.screenshot({ path: path.join(out, 'cloud-real-api-failure.png') }); console.error((await page.locator('body').innerText()).slice(0, 1800)); throw error; }
finally { await browser.close(); await server.close(); }
