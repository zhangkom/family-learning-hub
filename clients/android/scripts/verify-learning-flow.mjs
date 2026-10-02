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
const studentResponse = await fetch(api + '/students', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '学习全流程合成学生' }) });
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
const errors = []; let lostCreateReceipts = 0, analysisCalls = 0, serverPhotoDownloads = 0, externalRequests = 0;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.url().endsWith('/explain') && request.method() === 'POST') analysisCalls++; });
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.href === 'https://123.207.232.151/family-learning/downloads/android/latest.json') return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ channel: 'release', version: '0.3.2', versionCode: 14, bytes: 1, sha256: 'a'.repeat(64), downloadUrl: 'https://123.207.232.151/family-learning/downloads/android/family-learning-0.3.2-release-abcdef0.apk' }) });
  if (![new URL(client).origin, new URL(api).origin].includes(url.origin)) { externalRequests++; return route.abort(); }
  if (/\/scans\/[^/]+\/file$/.test(url.pathname)) { serverPhotoDownloads++; return route.abort(); }
  if (url.pathname.endsWith('/learning-sessions') && route.request().method() === 'POST' && lostCreateReceipts === 0) { const receipt = await route.fetch(); assert.equal(receipt.status(), 202); lostCreateReceipts++; return route.abort(); }
  return route.continue();
});
const button = name => page.getByRole('button', { name, exact: true });
const output = process.env.FAMILY_LEARNING_QA_DIR || 'test-results/learning-flow'; mkdirSync(output, { recursive: true });

const nav = name => page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: new RegExp('^' + name) });
const readSessions = async () => (await (await fetch(api + '/learning-sessions?studentId=' + student.id, { headers })).json()).sessions;
const readSession = async id => (await (await fetch(api + '/learning-sessions/' + id, { headers })).json()).session;
async function waitTasks(n) {
  await page.waitForFunction(n => document.querySelectorAll('.learning-task').length === n, n);
  await page.locator('.learning-job').waitFor({ state: 'detached', timeout: 90000 });
}
async function submit(index, text) {
  const task = page.locator('.learning-task').nth(index);
  await task.getByLabel('我的答案与步骤').fill(text);
  const response = page.waitForResponse(r => /\/learning-sessions\/[^/]+\/attempt$/.test(new URL(r.url()).pathname));
  await task.getByRole('button', { name: '提交作答', exact: true }).click(); await response;
  await page.locator('.learning-job').waitFor({ state: 'detached', timeout: 90000 });
  await task.locator('.learning-attempts details').first().getByText(text, { exact: true }).waitFor();
}
async function goHome() { for (let i = 0; i < 4 && await page.locator('.learning-hub').count(); i++) await button('返回学习列表或首页').click(); await nav('首页').waitFor(); }
async function screenshot(name, width) { await page.setViewportSize({ width, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: output + '/' + name + '-' + width + '.png', fullPage: true }); }
try {
  await page.goto(client); await page.getByLabel('当前学生').selectOption(student.id);
  await button('录错题').click(); await button('完成选择，逐张调整').click();
  await button('生成预览').click(); await button('确认使用处理图').click();
  const uploaded = page.waitForResponse(r => r.url() === api + '/scans' && r.request().method() === 'POST');
  await button('上传处理图').click(); const scan = (await (await uploaded).json()).scan;
  await button('继续学习').click(); await page.locator('.paper-surface img').waitFor();
  await button('框选一道题').click(); await page.locator('.paper-scroll').scrollIntoViewIfNeeded();
  const bounds = await page.locator('.paper-scroll').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + 25, y: bounds.y + 25, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bounds.x + 270, y: bounds.y + 150, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.getByLabel('这道题的科目').selectOption('物理'); await button('保存并分析这道题').click();
  await page.getByText('6 m', { exact: true }).waitFor({ timeout: 90000 }); await button('核对无误').click();
  await button('采用识别题干，再校对').click(); await page.locator('.manual-review > summary').click();
  await page.getByLabel('知识点（用逗号分隔）').fill('匀速运动，路程计算'); await page.getByLabel('完整题干', { exact: true }).focus();
  await page.getByLabel('题干与题框已核对').check(); await button('保存校对').first().click();
  await button('举一反三').waitFor(); await button('举一反三').click(); await button('生成3道变式').click(); await page.getByRole('alert').waitFor(); await button('生成3道变式').click(); await waitTasks(3);
  const practice = (await readSessions()).find(s => s.mode === 'practice'); assert.ok(practice); assert.equal(practice.source.scanId, scan.id);
  let session = await readSession(practice.id); assert.equal(session.tasks.length, 3); assert.ok(session.tasks.every(t => !t.solution && !t.answer && !t.hints.length));
  await page.locator('.learning-task').first().getByLabel('我的答案与步骤').fill('草稿：先求路程');
  await button('原题详情').click(); await button('返回资料列表').click(); await waitTasks(3);
  assert.equal(await page.locator('.learning-task').first().getByLabel('我的答案与步骤').inputValue(), '草稿：先求路程');
  assert.equal((await readSessions()).length, 1);
  await submit(0, 's=2+4=6 m'); assert.equal((await readSession(practice.id)).tasks[0].attempts[0].feedback.verdict, 'incorrect');
  await page.locator('.learning-task').first().getByRole('button', { name: /给我一点提示/ }).click(); await page.locator('.learning-hints').first().waitFor();
  await submit(0, 's=2×4=8 m'); await submit(1, 's=2×5=10 m'); await submit(2, 's=2×6=12 m');
  session = await readSession(practice.id); assert.equal(session.tasks[0].attempts[1].helped, true); assert.equal(session.tasks[1].attempts[0].helped, false);
  await button('生成新的复测题').click(); await waitTasks(4); assert.equal(await page.locator('.learning-task').last().getByRole('button', { name: /提示/ }).count(), 0);
  await submit(3, 's=2×13=26 m');
  await screenshot('practice', 390); await screenshot('practice', 320);
  await goHome(); await nav('题目').click(); await button('全部').click();
  await page.locator('.question-learning-history').getByText(/已独立通过复测/).waitFor();
  await button('能力图谱').click(); await page.getByText('至少需要 2 道已核对题干的错题，才能交叉分析。',{exact:true}).waitFor();
  assert.equal(await button('分析多道错题').isDisabled(),true);
  await nav('首页').click(); await page.getByRole('button', { name: /破茧成蝶/ }).click(); await page.locator('.learning-source-option').first().click();
  await page.getByLabel('卡在哪一步？', { exact: true }).fill('速度和时间应怎样配合使用？');
  await page.getByLabel('已经尝试了什么？（选填）').fill('我试过把速度与时间相加。');
  await button('开始逐步突破').click(); await waitTasks(1);
  const challenge = (await readSessions()).find(s => s.mode === 'challenge'); assert.ok(challenge);
  for (let i = 0; i < 3; i++) { await page.locator('.learning-hint-button').click(); await page.waitForFunction(n => document.querySelectorAll('.learning-hints > div').length === n, i + 1); }
  await submit(0, 's=vt=2×3=6 m'); await button('查看参考解法').click(); await page.locator('.learning-solution').waitFor();
  await page.reload(); await button('继续学习').click(); await waitTasks(1); assert.match(await page.locator('.learning-hub h1').innerText(), /难题突破|破茧成蝶/);
  await button('生成新的复测题').click(); await waitTasks(2); await submit(1, 's=2×11=22 m');
  await screenshot('challenge', 390); await screenshot('challenge', 320);
  await goHome(); await nav('我的').click(); await page.locator('.student-profile-card.active').getByText('练习与突破 2 组 · 独立复测通过 2 组', { exact: true }).waitFor(); await screenshot('profile-learning', 390);
  await nav('首页').click();
  for (const width of [320, 360, 390, 768]) await screenshot('home-learning', width);
  const otherResponse = await fetch(api + '/students', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '隔离学生B' }) });
  assert.equal(otherResponse.status, 201); const other = (await otherResponse.json()).student;
  await page.reload(); await page.getByLabel('当前学生').selectOption(other.id); await page.getByRole('button', { name: /融会贯通/ }).click();
  await page.getByText('选择一道自己的题，开始第一次练习。', { exact: true }).waitFor(); assert.equal(await page.locator('.learning-source-option').count(), 0);
  assert.equal(serverPhotoDownloads, 0); assert.equal(externalRequests, 0); assert.deepEqual(errors, []);
  const report = { syntheticOnly: true, syntheticNativeBridge: true, actualIsolatedBackend: true, realModelCalls: 0, nativeDeviceTested: false, sourceCaptureReviewAnalysis: true, practiceThreeTasks: true, wrongThenHintedCorrection: true, challengeThreeHints: true, twoIndependentRetests: true, sourceReturnRetainsSessionAndDraft: true, historyAfterReload: true, knowledgeAndLibraryLinked: true, profileRealCounts: true, studentIsolation: true, widths: [320,360,390,768], lostCreateReceipts, duplicateSessionOnRetry: false, analysisCalls, serverPhotoDownloads, externalRequests, errors };
  writeFileSync(output + '/learning-flow.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch (error) { await page.screenshot({ path: output + '/failure.png', fullPage: true }); console.error((await page.locator('body').innerText()).slice(-6000)); throw error; }
finally { await browser.close(); await vite.close(); }
