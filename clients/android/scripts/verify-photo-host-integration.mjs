import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { installSyntheticPhotoBridge } from './synthetic-photo-bridge.mjs';
const config = JSON.parse(readFileSync(process.env.FAMILY_DEV_CONNECTION_PATH, 'utf8'));
assert.equal(config.syntheticOnly, true); assert.equal(config.aiEnabled, false);
assert.equal(new URL(config.apiBase).hostname, '127.0.0.1');
const api = config.apiBase, client = process.env.CLIENT_URL || 'http://127.0.0.1:3178';
assert.equal(new URL(client).hostname, '127.0.0.1');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const loginResponse = await fetch(api + '/session/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: config.username, password: config.password }) });
assert.equal(loginResponse.status, 200);
const login = await loginResponse.json(), headers = { Authorization: 'Bearer ' + login.token };
const studentResponse = await fetch(api + '/students', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: '处理图链路合成学生' }) });
assert.equal(studentResponse.status, 201);
const student = (await studentResponse.json()).student;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await context.addInitScript(installSyntheticPhotoBridge, { api, initialToken: login.token, initialUserId: login.user.id });
const page = await context.newPage(), cdp = await context.newCDPSession(page);
page.setDefaultTimeout(15000);
const errors = []; let externalRequests = 0, analysisCalls = 0, uploadAttempts = 0, mockedUpdateChecks = 0, firstReceipt;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (/\/(recognize|explain)$/.test(request.url())) analysisCalls++; });
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (request.url() === 'https://123.207.232.151/family-learning/downloads/android/latest.json') {
    assert.equal(request.headers().authorization, undefined); mockedUpdateChecks++;
    return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({
      channel: 'release', version: '0.2.7', versionCode: 9, bytes: 1, sha256: 'a'.repeat(64),
      downloadUrl: 'https://123.207.232.151/family-learning/downloads/android/family-learning-0.2.7-release-0000000.apk',
    }) });
  }
  if (![new URL(client).origin, new URL(api).origin].includes(url.origin)) { externalRequests++; return route.abort(); }
  if (request.url() === api + '/scans' && request.method() === 'POST') {
    uploadAttempts++;
    // Simulate a lost acknowledgement after the server already committed the upload.
    if (uploadAttempts === 1) {
      const response = await route.fetch(); assert.equal(response.status(), 201);
      firstReceipt = (await response.json()).scan; return route.abort('connectionreset');
    }
  }
  return route.continue();
});
const button = name => page.getByRole('button', { name, exact: true });
const queue = () => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('family-photo-delivery-v1:')).map(k => JSON.parse(localStorage.getItem(k))));
const readScan = async id => (await (await page.request.get(api + '/scans/' + id, { headers })).json()).scan;
try {
  await page.goto(client); await page.getByLabel('当前学生').selectOption(student.id);
  await page.getByRole('button', { name: /拍照收题/ }).click();
  await button('完成选择，逐张调整').click();
  await page.getByRole('heading', { name: '把题目拍清楚' }).waitFor();
  await button('取消，保留原片').click(); await button('本机原片').click();
  await button('继续处理').click();
  await page.locator('.photo-prep-tools').getByRole('button', { name: /90/ }).click();
  await button('生成预览').click();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '确认使用处理图')?.disabled);
  await button('确认使用处理图').click(); await button('上传处理图').waitFor();
  assert.equal(uploadAttempts, 0);
  const [delivery] = await queue(); assert.ok(delivery); assert.equal(delivery.studentId, student.id);
  assert.equal(delivery.prepared.quarterTurns, 1);
  assert.equal(delivery.prepared.width, 1200); assert.equal(delivery.prepared.height, 900);
  assert.deepEqual(delivery.prepared.sourceToOutput, [0,-1,1,1,0,0,0,0,1]);
  await button('上传处理图').click(); await page.getByRole('alert').filter({ hasText: '待提交照片已保留' }).waitFor();
  assert.equal((await queue()).length, 1); assert.equal(firstReceipt.sourceKind, 'processed-photo');
  assert.equal(firstReceipt.processing.sourceSha256, delivery.original.sha256);
  const { uri: _localUri, ...processing } = delivery.prepared;
  assert.deepEqual(firstReceipt.processing, processing);
  await page.reload(); await page.getByLabel('当前学生').waitFor();
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: /^题目/ }).click();
  const retry = page.waitForResponse(response => response.url() === api + '/scans' && response.request().method() === 'POST');
  await button('上传处理图').click(); const retried = await retry; assert.equal(retried.status(), 200);
  const scan = (await retried.json()).scan; assert.equal(scan.id, firstReceipt.id);
  await page.waitForFunction(() => !Object.keys(localStorage).some(k => k.startsWith('family-photo-delivery-v1:')));
  const scans = await (await page.request.get(api + '/scans?studentId=' + student.id, { headers })).json();
  assert.equal(scans.scans.length, 1);
  assert.equal(scan.processing.outputId, delivery.id); assert.deepEqual(scan.processing, processing);
  const uploaded = await page.request.get(api + '/scans/' + scan.id + '/file', { headers });
  assert.equal(uploaded.status(), 200);
  assert.equal(createHash('sha256').update(await uploaded.body()).digest('hex'), processing.sha256);
  await page.getByRole('button', { name: new RegExp(scan.originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  await page.locator('.paper-surface img').waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '自动找题')?.disabled);
  const candidateResponse = page.waitForResponse(response => response.url().endsWith('/candidate-regions'));
  await button('自动找题').click(); const candidate = await candidateResponse; assert.equal(candidate.status(), 200);
  const suggestion = await candidate.json(); assert.deepEqual(suggestion.image, { width: 1200, height: 900 });
  if (suggestion.status === 'candidates') await button('放弃本轮剩余建议').click();
  else await page.getByText('暂时没有找到可用的建议框，请手动框题。', { exact: true }).waitFor();
  await button('框选一道题').click(); await page.locator('.paper-scroll').scrollIntoViewIfNeeded();
  const bounds = await page.locator('.paper-scroll').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + 25, y: bounds.y + 25, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bounds.x + 270, y: bounds.y + 140, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.getByLabel('这道题的科目').selectOption('数学'); await button('保存校对').click();
  await page.getByText('已保存题目框和手写步骤', { exact: true }).waitFor();
  const saved = await readScan(scan.id); assert.deepEqual(saved.processing, processing); assert.equal(saved.questions.length, 1);
  await button('返回资料列表').click(); await button('本机原片').click(); await button('继续处理').waitFor();
  assert.equal(await page.locator('.photo-library-card').count(), 1);
  const originalHash = await page.evaluate(async uri => {
    const data = JSON.parse(localStorage.getItem('host-test:file:' + uri));
    const bytes = await (await fetch(data)).arrayBuffer();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  }, delivery.original.originalUri);
  assert.equal(originalHash, delivery.original.sha256);
  assert.equal(uploadAttempts, 2); assert.equal(externalRequests, 0); assert.equal(analysisCalls, 0); assert.deepEqual(errors, []);
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/photo-host-integration.png', fullPage: true });
  const report = { syntheticBridgeOnly: true, realLocalBackend: true, nativeRuntimeTested: false, realModelCalls: 0,
    originalPreserved: true, originalOnlyOnPhone: true, explicitConfirmationBeforeUpload: true,
    lostAcknowledgementRecovered: true, retryCreatesNoDuplicate: true, restartQueueRecovery: true,
    uploadedHashVerified: true, metadataReceiptMatches: true, reviewPreservesProcessingMetadata: true,
    rotatedUploadVerified: true, quarterTurns: processing.quarterTurns, processedDimensions: { width: processing.width, height: processing.height },
    candidateStatus: suggestion.status, candidateImage: suggestion.image, uploadAttempts, externalRequests, mockedUpdateChecks, analysisCalls, errors };
  writeFileSync('test-results/photo-host-integration.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch (error) {
  mkdirSync('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/photo-host-integration-failure.png', fullPage: true }); throw error;
} finally { await browser.close(); }
