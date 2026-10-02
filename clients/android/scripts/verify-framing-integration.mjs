import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const config = JSON.parse(readFileSync(process.env.FAMILY_DEV_CONNECTION_PATH, 'utf8'));
if (!config.syntheticOnly || config.questionModelStub !== true || new URL(config.apiBase).hostname !== '127.0.0.1')
  throw new Error('Only isolated local synthetic model fixture is allowed');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const client = process.env.CLIENT_URL || 'http://127.0.0.1:3178';
const api = config.apiBase, errors = [];
const cdp = await context.newCDPSession(page);
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/*', (route) => {
  const url = new URL(route.request().url());
  return [new URL(client).origin, new URL(api).origin].includes(url.origin) ? route.continue() : route.abort();
});
async function draw() {
  await page.getByRole('button', { name: '框选一道题', exact: true }).click();
  await page.locator('.paper-scroll').scrollIntoViewIfNeeded();
  const box = await page.locator('.paper-scroll').boundingBox();
  const start = { x: box.x + 22, y: box.y + 30 }, end = { x: box.x + box.width - 24, y: box.y + 155 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 0 }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * i / 8, y: start.y + (end.y - start.y) * i / 8, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
try {
  const fixture = await browser.newPage({ viewport: { width: 800, height: 2200 } });
  await fixture.setContent('<html lang="zh"><body style="padding:40px;background:#fffdf8;font:26px sans-serif"><small>合成测试 / 无真实学生数据</small><h2>1. 物体匀速运动</h2><p>速度 2 m/s，时间 3 s，求路程。</p><div style="height:650px"></div><h2>2. 生物样例</h2><p>叶片通过什么过程制造有机物？</p></body></html>');
  const png = await fixture.screenshot();
  await fixture.close();
  const username = 'framing_' + Date.now().toString(36);
  const password = 'synthetic_' + crypto.randomUUID();
  const registered = await page.request.post(api + '/session/register', { data: { username, password } });
  assert.equal(registered.status(), 200);
  await page.goto(client);
  await page.getByRole('navigation', { name: '账户' }).getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('家庭服务地址').fill(api);
  await page.getByLabel('账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  const loginResponse = page.waitForResponse((r) => r.url() === api + '/session/login');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const authenticated = await loginResponse;
  assert.equal(authenticated.status(), 200);
  const login = await authenticated.json();
  const headers = { Authorization: 'Bearer ' + login.token };
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '添加学生', exact: true }).click();
  await page.getByLabel('学生昵称').fill('框题联调-' + Date.now().toString().slice(-6));
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByLabel('当前学生').waitFor();
  const studentId = await page.getByLabel('当前学生').inputValue();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /相册选图/ }).click();
  await (await chooser).setFiles({ name: '多学科框题合成.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: '完成选择，查看待上传', exact: true }).click();
  const uploadResponse = page.waitForResponse((r) => r.url() === api + '/scans' && r.request().method() === 'POST');
  await page.getByRole('button', { name: '确认并上传', exact: true }).click();
  const upload = await uploadResponse;
  assert.equal(upload.status(), 201);
  const originalScan = (await upload.json()).scan;
  assert.equal(originalScan.subject, '待选择');
  await page.getByRole('button', { name: /多学科框题合成/ }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find((b) => b.textContent.includes('框选一道题')).disabled);
  await draw();
  assert.equal(await page.getByLabel('这道题的科目').inputValue(), '');
  await page.getByLabel('这道题的科目').selectOption('物理');
  const explainResponse = page.waitForResponse((r) => r.url().endsWith('/explain'));
  await page.getByRole('button', { name: '保存并分析这道题', exact: true }).click();
  assert.equal((await explainResponse).status(), 202);
  await page.getByText('6 m', { exact: true }).waitFor({ timeout: 25000 });
  await page.getByText('未看到足够的作答证据，暂不判断错因。', { exact: true }).waitFor();
  let saved = (await (await page.request.get(api + '/scans/' + originalScan.id, { headers })).json()).scan;
  assert.equal(saved.questions[0].subject, '物理');
  assert.equal(saved.questions[0].prompt, '');
  assert.equal(saved.questions[0].tutoring.status, 'needs_review');
  assert.ok(saved.questions[0].wrongBook.savedAt);
  const original = await page.request.get(api + '/scans/' + saved.id + '/file', { headers });
  assert.deepEqual(await original.body(), png);
  // A new question inherits this photo's explicit choice, but remains editable.
  await page.getByRole('button', { name: '浏览照片', exact: true }).click();
  await page.locator('.paper-scroll').evaluate((el) => { el.scrollTop = 350; });
  await draw();
  assert.equal(await page.getByLabel('这道题的科目').inputValue(), '物理');
  assert.equal(await page.getByRole('button', { name: '只存错题本', exact: true }).isEnabled(), true);
  await page.getByLabel('这道题的科目').selectOption('生物');
  await page.getByRole('button', { name: '只存错题本', exact: true }).click();
  await page.getByText('已存入当前学生的错题本', { exact: true }).waitFor();
  const wrong = await page.request.get(api + '/wrong-book?studentId=' + studentId, { headers });
  assert.equal(wrong.status(), 200);
  const items = (await wrong.json()).items;
  assert.deepEqual(items.map((i) => i.subject).sort(), ['物理', '生物'].sort());
  assert.ok(items.every((i) => i.studentId === studentId && i.scanId === saved.id));
  await page.getByRole('button', { name: '返回资料列表', exact: true }).click();
  await page.getByRole('button', { name: /错题本 · 2/ }).click();
  await page.locator('.wrong-question-card').filter({ hasText: '生物' }).click();
  assert.equal(await page.getByLabel('这道题的科目').inputValue(), '生物');
  const selectedFrame = await page.locator('.active-region').boundingBox(), viewport = await page.locator('.paper-scroll').boundingBox();
  assert.ok(selectedFrame.y < viewport.y + viewport.height && selectedFrame.y + selectedFrame.height > viewport.y);
  await page.getByLabel('这道题的科目').selectOption('化学');
  await page.getByRole('button', { name: '只存错题本', exact: true }).click();
  await page.getByText('已存入当前学生的错题本', { exact: true }).waitFor();
  saved = (await (await page.request.get(api + '/scans/' + originalScan.id, { headers })).json()).scan;
  assert.deepEqual(saved.questions.map((q) => q.subject), ['物理', '化学']);
  assert.equal(saved.questions[0].tutoring.status, 'needs_review', 'editing different question must not invalidate first');
  // Persisted choice survives reopening; merely visiting an older physics question
  // must not replace the last explicit chemistry choice on this same device.
  await page.getByRole('button', { name: '返回资料列表', exact: true }).click();
  await page.locator('.wrong-question-card').filter({ hasText: '物理' }).click();
  assert.equal(await page.getByLabel('这道题的科目').inputValue(), '物理');
  await draw();
  assert.equal(await page.getByLabel('这道题的科目').inputValue(), '化学');
  await page.getByRole('button', { name: '只存错题本', exact: true }).click();
  await page.getByText('已存入当前学生的错题本', { exact: true }).waitFor();
  saved = (await (await page.request.get(api + '/scans/' + originalScan.id, { headers })).json()).scan;
  assert.deepEqual(saved.questions.map((q) => q.subject), ['物理', '化学', '化学']);
  assert.equal(saved.questions[0].tutoring.status, 'needs_review');
  // A different image still starts without a subject even for the same student.
  const secondUpload = await page.request.post(api + '/scans', { headers, multipart: {
    file: { name: '另一张合成照片.png', mimeType: 'image/png', buffer: png },
    studentId, clientRequestId: crypto.randomUUID(), source: '合成测试',
  } });
  assert.equal(secondUpload.status(), 201);
  await page.getByRole('button', { name: '返回资料列表', exact: true }).click();
  await page.getByRole('button', { name: /^全部照片/ }).click();
  await page.getByRole('button', { name: /另一张合成照片/ }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find((b) => b.textContent.includes('框选一道题')).disabled);
  await draw();
  assert.equal(await page.getByLabel('这道题的科目').inputValue(), '');
  assert.equal(await page.getByRole('button', { name: '只存错题本', exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/framing-integration.png', fullPage: true });
  writeFileSync('test-results/framing-integration.json', JSON.stringify({ syntheticOnly: true, model: 'local stub; no network model',
    checks: ['upload subject pending', 'touch frame no manual text required', 'per-question physics/biology/chemistry independent subjects',
      'save wrongbook then queued-to-result', 'no invented answer evidence', 'original exact bytes preserved', 'wrongbook API and UI reopen selected qid',
      'reopen scrolls frame into photo viewport', 'unrelated question edit preserves result',
      'new frames inherit explicit photo subject; independent overrides remain',
      'reopen mixed photo remembers chemistry even when visiting older physics question',
      'another photo requires its own subject selection'], errors }, null, 2));
  console.log('Real isolated backend and local worker passed framing/subjects/wrongbook/tutoring roundtrip; no external model or production data.');
} finally { await browser.close(); }

