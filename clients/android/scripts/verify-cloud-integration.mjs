import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { installSyntheticPhotoBridge } from './synthetic-photo-bridge.mjs';
const config = JSON.parse(await readFile(process.env.FAMILY_DEV_CONNECTION_PATH, 'utf8'));
assert.equal(config.syntheticOnly, true); assert.equal(config.aiEnabled, false);
assert.equal(new URL(config.apiBase).hostname, '127.0.0.1');
const port = Number(process.env.FAMILY_CLOUD_QA_PORT || 3300);
const api = config.apiBase, origin = `http://127.0.0.1:${port}`;
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.env.PHOTO_QA_OUTPUT); await mkdir(out, { recursive: true });
const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
const loginResponse = await fetch(api + '/session/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: config.username, password: config.password }) });
assert.equal(loginResponse.status, 200); const login = await loginResponse.json();
const headers = { Authorization: 'Bearer ' + login.token };
const studentResponse = await fetch(api + '/students', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '云盘500图整批合成验收' }) });
assert.equal(studentResponse.status, 201); const student = (await studentResponse.json()).student;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
await context.addInitScript(api => { if (/^https?:$/.test(location.protocol)) localStorage.setItem('family-learning:server', api); }, api);
const page = await context.newPage(); page.setDefaultTimeout(30000);
const errors = [], receipts = [], batches = []; let attempts = 0, modelCalls = 0, external = 0, lostReceipt;
let releaseFive, releaseTwoHundred;
const atFive = new Promise(resolve => { releaseFive = resolve; }), atTwoHundred = new Promise(resolve => { releaseTwoHundred = resolve; });
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
    attempts++; if (attempts === 6) await atFive; if (attempts === 201) await atTwoHundred; const response = await route.fetch();
    const result = await response.json();
    if (response.ok()) receipts.push(result.photo);
    if (attempts === 300) { assert.equal(response.status(), 201); lostReceipt = result.photo; return route.abort('connectionreset'); }
    return route.fulfill({ response });
  }
  return route.continue();
});
const button = name => page.getByRole('button', { name, exact: true });
const logIn = async () => {
  await button('登录').click(); await page.getByLabel('账号', { exact: true }).fill(config.username); await page.getByLabel('密码', { exact: true }).fill(config.password);
  await page.locator('form').getByRole('button', { name: '登录', exact: true }).click(); await page.getByLabel('当前学生').selectOption(student.id);
};
const openDrive = async () => { await page.getByRole('button', { name: '图片云盘', exact: true }).click(); await button('选择图片').waitFor({ state: 'visible' }); };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const sha256 = createHash('sha256').update(png).digest('hex');
try {
  await page.goto(origin); await logIn(); await openDrive();
  const chooser = page.waitForEvent('filechooser'); await button('选择图片').click();
  await (await chooser).setFiles(Array.from({ length: 500 }, (_, n) => ({ name: `原图合成-${n + 1}.png`, mimeType: 'image/png', buffer: png })));
  await page.waitForFunction(() => document.querySelectorAll('.cloud-job').length === 500); assert.equal(attempts, 0);
  await button('开始上传').click();
  await page.waitForFunction(() => document.querySelector('[aria-label="上传完成数量"]')?.textContent === '5/500');
  await page.screenshot({ path: path.join(out, 'cloud-5-of-500.png') }); releaseFive();
  await page.waitForFunction(() => document.querySelector('[aria-label="上传完成数量"]')?.textContent === '200/500', null, { timeout: 120000 });
  await page.screenshot({ path: path.join(out, 'cloud-200-of-500.png') }); releaseTwoHundred();
  await page.waitForFunction(() => document.querySelectorAll('.cloud-job-completed').length === 499 && document.querySelectorAll('.cloud-job-failed').length === 1, null, { timeout: 180000 });
  assert.equal(attempts, 500); assert.equal(receipts.length, 500);
  const uniqueBatches = [...new Map(batches.map(batch => [batch.clientBatchId, batch])).values()];
  assert.deepEqual(uniqueBatches.map(batch => batch.expectedCount), [500]);
  await page.reload(); await logIn(); await openDrive();
  await page.waitForFunction(() => document.querySelectorAll('.cloud-job-completed').length === 499 && document.querySelectorAll('.cloud-job-failed').length === 1);
  await button('中断续传').click();
  await page.waitForFunction(() => document.querySelectorAll('.cloud-job-completed').length === 500);
  assert.equal(attempts, 501); assert.equal(receipts.at(-1).id, lostReceipt.id);
  const photos = []; let cursor;
  do {
    const response = await fetch(`${api}/cloud-photos?studentId=${student.id}&limit=30${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, { headers });
    assert.equal(response.status, 200); const result = await response.json(); photos.push(...result.photos); cursor = result.nextCursor;
  } while (cursor);
  assert.equal(photos.length, 500); assert.equal(new Set(photos.map(photo => photo.id)).size, 500);
  assert.deepEqual([...new Set(photos.map(photo => photo.batchId))].map(id => photos.filter(photo => photo.batchId === id).length).sort((a,b) => b-a), [500]);
  assert.ok(photos.every(photo => photo.studentId === student.id && photo.sha256 === sha256 && photo.size === png.length));
  assert.deepEqual(photos.map(photo => photo.originalName).sort((a, b) => a.localeCompare(b)), Array.from({ length: 500 }, (_, n) => `原图合成-${n + 1}.png`).sort((a, b) => a.localeCompare(b)));
  const scans = await (await fetch(`${api}/scans?studentId=${student.id}`, { headers })).json(); assert.equal(scans.scans.length, 0);
  await page.locator('.cloud-photo').first().scrollIntoViewIfNeeded(); await page.locator('.cloud-photo').first().locator('img').waitFor();
  const downloaded = page.waitForEvent('download'); await button('下载原图').first().click(); const download = await downloaded;
  assert.ok(photos.some(photo => photo.originalName === download.suggestedFilename()));
  assert.equal(createHash('sha256').update(await readFile(await download.path())).digest('hex'), sha256);
  const photo = photos[0];
  const thumbnail = await fetch(`${api}/cloud-photos/${photo.id}/thumbnail`, { headers }); assert.equal(thumbnail.status, 200); assert.match(thumbnail.headers.get('content-type'), /image\/jpeg/);
  const unauth = await fetch(`${api}/cloud-photos/${photo.id}/file`); assert.equal(unauth.status, 401);
  const original = await fetch(`${api}/cloud-photos/${photo.id}/file`, { headers }); assert.equal(original.status, 200);
  assert.equal(createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex'), sha256); assert.match(original.headers.get('cache-control'), /no-store/);
  await page.setViewportSize({ width: 320, height: 740 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(out, 'cloud-real-api-320.png') });
  // Fresh selection does not include the 500 completed records in its denominator.
  const duplicates = page.waitForEvent('filechooser'); await button('选择图片').click();
  await (await duplicates).setFiles(Array.from({ length: 3 }, () => ({ name: '原图合成-1.png', mimeType: 'image/png', buffer: png })));
  await page.waitForFunction(() => document.querySelector('[aria-label="上传完成数量"]')?.textContent === '0/3');
  await button('开始上传').click(); const nameDialog = page.getByRole('dialog', { name: '发现同名图片' }); await nameDialog.waitFor();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 740 });
    assert.equal(await nameDialog.evaluate(node => node.scrollWidth <= node.clientWidth), true);
    await page.screenshot({ path: path.join(out, `duplicate-name-${width}.png`) });
  }
  await nameDialog.getByRole('button', { name: /^自动加后缀/ }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="上传完成数量"]')?.textContent === '1/3');
  await nameDialog.getByRole('button', { name: '自己编辑名称', exact: true }).click();
  await page.getByLabel('新文件名', { exact: true }).fill('手动编辑作业'); await nameDialog.getByRole('button', { name: '确认名称', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="上传完成数量"]')?.textContent === '2/3');
  await nameDialog.getByRole('button', { name: '覆盖', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.cloud-job-completed').length === 3);
  assert.deepEqual(receipts.slice(-3).map(p => p.originalName), ['原图合成-1_1.png', '手动编辑作业.png', '原图合成-1.png']);
  const oldOne = photos.find(p => p.originalName === '原图合成-1.png'); assert.notEqual(receipts.at(-1).id, oldOne.id);
  const oldBytes = await fetch(`${api}/cloud-photos/${oldOne.id}/file`, { headers }); assert.equal(oldBytes.status, 200);
  assert.equal(createHash('sha256').update(Buffer.from(await oldBytes.arrayBuffer())).digest('hex'), sha256);
  await page.screenshot({ path: path.join(out, 'duplicate-completed.png') });
  assert.equal(modelCalls, 0); assert.equal(external, 0); assert.deepEqual(errors, []);
  const nativeStudentResponse = await fetch(api + '/students', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '相册范围布局合成验收' }) });
  assert.equal(nativeStudentResponse.status, 201); const nativeStudent = (await nativeStudentResponse.json()).student;
  const nativeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await nativeContext.addInitScript(installSyntheticPhotoBridge, { api, initialToken: login.token, initialUserId: login.user.id });
  const nativePage = await nativeContext.newPage(); nativePage.setDefaultTimeout(30000); nativePage.on('pageerror', e => errors.push(e.message));
  const nativeReceipts = [];
  await nativePage.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.href.endsWith('/downloads/android/latest.json')) return route.fulfill({ status: 503, body: '{}' });
    if (![origin, new URL(api).origin].includes(url.origin)) { external++; return route.abort(); }
    if (request.url() === api + '/cloud-photos' && request.method() === 'POST') {
      const response = await route.fetch(); assert.equal(response.status(), 201); nativeReceipts.push((await response.json()).photo); return route.fulfill({ response });
    }
    return route.continue();
  });
  await nativePage.goto(origin); await nativePage.getByLabel('当前学生').selectOption(nativeStudent.id);
  const layoutChecks = [];
  for (const width of [320, 390, 768]) {
    await nativePage.setViewportSize({ width, height: 844 });
    for (const tab of ['首页', '题目', '我的']) {
      await nativePage.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: tab, exact: true }).click();
      assert.equal(await nativePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${tab} ${width} overflow`);
      await nativePage.screenshot({ path: path.join(out, `layout-${tab}-${width}.png`), fullPage: true });
    }
    await nativePage.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '首页', exact: true }).click();
  }
  await nativePage.getByRole('button', { name: '图片云盘', exact: true }).click();
  for (const width of [320, 390, 768]) {
    await nativePage.setViewportSize({ width, height: 740 });
    const boxes = await nativePage.locator('.cloud-pick-actions button').evaluateAll(buttons => buttons.map(button => { const r = button.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, width: r.width }; }));
    assert.equal(boxes.length, 2); assert.ok(boxes.every(b => b.height >= 44 && b.bottom <= 740));
    assert.ok(Math.max(...boxes.map(b => b.top)) - Math.min(...boxes.map(b => b.top)) < 1, 'Two picker buttons must share one row');
    assert.equal(await nativePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1), true, `Empty cloud page should fit ${width}`);
    layoutChecks.push({ width, pickerButtonsSameRow: true, emptyDriveFitsOneScreen: true });
    await nativePage.screenshot({ path: path.join(out, `cloud-compact-${width}.png`), fullPage: true });
  }
  await nativePage.getByRole('button', { name: '相册选择', exact: true }).click();
  await nativePage.waitForFunction(() => document.querySelectorAll('.cloud-job').length === 2);
  assert.equal(await nativePage.evaluate(() => JSON.parse(localStorage.getItem('host-test:lastPicker')).albumRange), true);
  await nativePage.getByRole('button', { name: '文件夹范围', exact: true }).click();
  await nativePage.waitForFunction(() => document.querySelectorAll('.cloud-job').length === 4);
  assert.equal(await nativePage.evaluate(() => JSON.parse(localStorage.getItem('host-test:lastPicker')).folderRange), true);
  await nativePage.getByRole('button', { name: '系统相册多选', exact: true }).click();
  await nativePage.waitForFunction(() => document.querySelectorAll('.cloud-job').length === 6);
  assert.equal(await nativePage.evaluate(() => !!JSON.parse(localStorage.getItem('host-test:lastPicker')).albumRange), false);
  assert.equal(nativeReceipts.length, 0, 'Selection must not upload automatically');
  const names = await nativePage.locator('.cloud-job strong').allTextContents();
  assert.ok(names.every(name => name.startsWith('IMG_') && name.endsWith('.png')));
  await nativePage.reload(); await nativePage.getByLabel('当前学生').waitFor(); await nativePage.getByRole('button', { name: '图片云盘', exact: true }).click();
  await nativePage.getByRole('button', { name: '开始上传', exact: true }).click();
  await nativePage.waitForFunction(() => document.querySelectorAll('.cloud-job-completed').length === 6);
  assert.deepEqual(nativeReceipts.map(photo => photo.originalName).sort((a, b) => a.localeCompare(b)), [...names].sort((a, b) => a.localeCompare(b)));
  await nativePage.screenshot({ path: path.join(out, 'native-original-names.png') });
  // One failed native import must remain counted and resumable after upload.
  await nativePage.evaluate(() => {
    window.hostPhotoTest.album(5); const previous = window.Capacitor.nativePromise;
    let once = true;
    window.Capacitor.nativePromise = async (...args) => {
      if (once && args[0] === 'PhotoProcessing' && args[1] === 'importBatchItem' && args[2].index === 2) { once = false; throw new Error('合成导入暂时失败'); }
      return previous(...args);
    };
  });
  await nativePage.getByRole('button', { name: '相册选择', exact: true }).click();
  await nativePage.waitForFunction(() => document.querySelector('[aria-label="上传完成数量"]')?.textContent === '0/5');
  assert.equal(await nativePage.locator('.cloud-job').count(), 4);
  await nativePage.getByRole('button', { name: '上传已导入照片', exact: true }).click();
  await nativePage.waitForFunction(() => document.querySelector('[aria-label="上传完成数量"]')?.textContent === '4/5');
  await nativePage.getByRole('button', { name: '中断续传', exact: true }).click();
  await nativePage.waitForFunction(() => document.querySelectorAll('.cloud-job').length === 5);
  await nativePage.waitForFunction(() => document.querySelector('[aria-label="上传完成数量"]')?.textContent === '5/5' && !document.querySelector('.cloud-actions'));
  assert.equal(nativeReceipts.length, 11); assert.equal(new Set(nativeReceipts.map(p => p.id)).size, 11);
  // Insets injected by Capacitor protect the top controls on Android.
  await nativePage.evaluate(() => { document.documentElement.style.setProperty('--safe-area-inset-top', '32px'); document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px'); window.scrollTo(0, 0); });
  const top = await nativePage.locator('.cloud-header').boundingBox(); assert.ok(top.y >= 32);
  await nativePage.screenshot({ path: path.join(out, 'cloud-safe-area.png') });
  await nativeContext.close(); assert.equal(external, 0); assert.deepEqual(errors, []);
  const result = { checkedAt: new Date().toISOString(), syntheticOnly: true, realLocalBackend: true, nativeDeviceTested: false, count: photos.length, uploadAttempts: attempts,
    batchSizes: uniqueBatches.map(batch => batch.expectedCount), totalProgressVerified: ["5/500", "200/500", "500/500"], duplicateChoicesVerified: ["suffix", "manual", "replace"], partialImportRecoveryVerified: true, freshSelectionResetsCompletedTotal: true, layoutChecks, originalNamesPreserved: true, nativeNamesSurviveRestartAndUpload: true, nativeAlbumModeWired: true, nativeSystemModeWired: true, nativeAlbumDialogTested: false, nativeFolderModeWired: true, nativeFolderDialogTested: false, originalHashVerified: true, downloadHashVerified: true, durableQueueRecovery: true, lostReceiptRecoveredWithoutDuplicate: true, noScansCreated: true, modelCalls, external, errors };
  await writeFile(path.join(out, 'cloud-real-api-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { await page.screenshot({ path: path.join(out, 'cloud-real-api-failure.png') }); console.error((await page.locator('body').innerText()).slice(0, 1800)); throw error; }
finally { await browser.close(); await server.close(); }
