import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'vite';
import { installSyntheticPhotoBridge } from './synthetic-photo-bridge.mjs';

const config = JSON.parse(readFileSync(process.env.FAMILY_DEV_CONNECTION_PATH, 'utf8'));
assert.equal(config.syntheticOnly, true); assert.equal(config.aiEnabled, false); assert.equal(config.questionModelStub, true);
assert.equal(new URL(config.apiBase).hostname, '127.0.0.1');
const api = config.apiBase, client = 'http://127.0.0.1:3304';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const vite = await createServer({ server: { host: '127.0.0.1', port: 3304, strictPort: true } });
await vite.listen();
const loginResponse = await fetch(api + '/session/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: config.username, password: config.password }) });
assert.equal(loginResponse.status, 200);
const login = await loginResponse.json(), headers = { Authorization: 'Bearer ' + login.token };
const studentResponse = await fetch(api + '/students', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '分析核对合成学生' }) });
assert.equal(studentResponse.status, 201); const student = (await studentResponse.json()).student;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await context.addInitScript(installSyntheticPhotoBridge, { api, initialToken: login.token, initialUserId: login.user.id });
await context.addInitScript(() => {
  const original = window.fetch.bind(window); window.localImageReads = 0;
  window.fetch = (input, init) => { if (typeof input === 'string' && input.startsWith('data:image/')) window.localImageReads++; return original(input, init); };
});
const page = await context.newPage(), cdp = await context.newCDPSession(page);
page.setDefaultTimeout(30000);
const errors = []; let analysisCalls = 0, serverPhotoDownloads = 0, externalRequests = 0;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.url().endsWith('/explain') && request.method() === 'POST') analysisCalls++; });
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.href === 'https://123.207.232.151/family-learning/downloads/android/latest.json') return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ channel: 'release', version: '0.3.2', versionCode: 14, bytes: 1, sha256: 'a'.repeat(64), downloadUrl: 'https://123.207.232.151/family-learning/downloads/android/test.apk' }) });
  if (![new URL(client).origin, new URL(api).origin].includes(url.origin)) { externalRequests++; return route.abort(); }
  if (/\/scans\/[^/]+\/file$/.test(url.pathname)) { serverPhotoDownloads++; return route.abort(); }
  return route.continue();
});
const button = name => page.getByRole('button', { name, exact: true });
const readScan = async id => { const response = await fetch(api + '/scans/' + id, { headers }); assert.equal(response.status, 200); return (await response.json()).scan; };
const output = process.env.FAMILY_ANALYSIS_QA_DIR || 'test-results/analysis-review'; mkdirSync(output, { recursive: true });
try {
  await page.goto(client); await page.getByLabel('当前学生').selectOption(student.id);
  await button('录错题').click(); await button('完成选择，逐张调整').click();
  await button('生成预览').click(); await button('确认使用处理图').click();
  const upload = page.waitForResponse(r => r.url() === api + '/scans' && r.request().method() === 'POST');
  await button('上传处理图').click(); const scan = (await (await upload).json()).scan;
  await button('继续学习').click();
  await page.locator('.paper-surface img').waitFor();
  const readsOnOpen = await page.evaluate(() => window.localImageReads);
  await button('框选一道题').click(); await page.locator('.paper-scroll').scrollIntoViewIfNeeded();
  const bounds = await page.locator('.paper-scroll').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + 25, y: bounds.y + 25, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bounds.x + 270, y: bounds.y + 150, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.getByLabel('这道题的科目').selectOption('物理'); await button('保存并分析这道题').click();
  await page.locator('.analysis-progress').waitFor(); await page.getByText('6 m', { exact: true }).waitFor();
  assert.equal(analysisCalls, 1);
  const original = (await readScan(scan.id)).questions[0].tutoring.result;
  await button('核对无误').click(); await page.getByText(/AI 生成 · 用户已核对/).waitFor();
  assert.equal(analysisCalls, 1); assert.equal((await readScan(scan.id)).questions[0].tutoring.review.status, 'confirmed');
  await button('纠正／报告问题').click();
  await page.getByLabel('核对后的完整题干').fill('合成测试题：物体以 2 m/s 匀速运动 4 s，求路程。');
  await page.getByLabel('补充说明（选填）').fill('时间应为4秒，请依据修正题干重新计算。');
  await button('保存核对意见').click(); await page.getByText('已保存核对意见', { exact: true }).waitFor();
  let saved = await readScan(scan.id); assert.equal(saved.questions[0].tutoring.status, 'stale');
  assert.deepEqual(saved.questions[0].tutoring.result, original); assert.match(saved.questions[0].prompt, /4 s/); assert.equal(analysisCalls, 1);
  assert.equal(await page.evaluate(() => window.localImageReads), readsOnOpen);
  await page.reload(); await page.getByLabel('当前学生').waitFor();
  await page.getByRole('navigation', { name: '资料管理' }).getByRole('button', { name: /^原题照片/ }).click();
  await page.getByRole('button', { name: new RegExp(scan.originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  await page.getByText('已保存核对意见', { exact: true }).waitFor(); await page.locator('.paper-surface img').waitFor();
  const readsAfterReopen = await page.evaluate(() => window.localImageReads);
  await button('按校对内容重新分析').click(); await page.locator('.analysis-progress').waitFor();
  await page.getByText('6 m', { exact: true }).waitFor(); await button('核对无误').isDisabled().then(value => assert.equal(value, true));
  // A fast worker may finish between polling ticks; queued is a valid observed
  // phase. Do not require the transient processing label to remain on screen.
  assert.match(await page.locator('.analysis-progress output').textContent(), /已加入队列|模型正在分析|等待.*尝试/);
  await page.screenshot({ path: output + '/analysis-in-progress.png', fullPage: true });
  await page.getByText('8 m', { exact: true }).waitFor(); saved = await readScan(scan.id);
  assert.equal(saved.questions[0].tutoring.review, undefined); assert.equal(saved.analysis, undefined); assert.equal(analysisCalls, 2);
  assert.equal(await page.evaluate(() => window.localImageReads), readsAfterReopen);
  await button('核对无误').click(); await page.getByText(/AI 生成 · 用户已核对/).waitFor();
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: output + '/analysis-reviewed-320.png', fullPage: true });
  assert.equal(serverPhotoDownloads, 0); assert.equal(externalRequests, 0); assert.deepEqual(errors, []);
  const report = { syntheticOnly: true, syntheticNativeBridge: true, actualIsolatedBackend: true, realModelCalls: 0, nativeDeviceTested: false,
    reviewDoesNotCallModel: true, correctionPersistsAcrossReload: true, oldResultPreservedWhilePending: true, reanalysisUsesCorrectedPrompt: true,
    newResultRequiresNewReview: true, realJobProgressShown: true, noRepeatedPhotoReadsDuringPolling: true, narrowViewport320: true,
    analysisCalls, serverPhotoDownloads, externalRequests, errors };
  writeFileSync(output + '/analysis-review.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch (error) { await page.screenshot({ path: output + '/failure.png', fullPage: true }); throw error; }
finally { await browser.close(); await vite.close(); }
