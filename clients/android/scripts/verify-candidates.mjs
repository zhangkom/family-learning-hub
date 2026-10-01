import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.env.CLIENT_URL || 'http://127.0.0.1:3178';
assert.equal(new URL(base).hostname, '127.0.0.1');
const api = 'http://127.0.0.1:3298/family-learning/api/mobile/v1';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
page.setDefaultTimeout(10000);
const now = new Date().toISOString(), errors = [], checks = [];
const student = { id: 'a', name: '合成学生', createdAt: now };
let scan = { id: 'candidate-photo', studentId: 'a', subject: '数学', source: '合成测试', originalName: '候选框合成照片.png',
  mimeType: 'image/png', size: 1000, createdAt: now, revision: 1, status: 'needs_review', questions: [] };
let mode = 'normal', release, calls = 0, analysisCalls = 0;
const fixture = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="4000"><rect width="800" height="4000" fill="#fffcf2"/>' +
  Array.from({ length: 10 }, (_, i) => `<text x="50" y="${150 + i * 370}" font-size="28">${i + 1}. 合成题框样例，不含真实资料</text>`).join('') + '</svg>';
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/*', async (route) => {
  const req = route.request(), url = new URL(req.url());
  if (url.origin === new URL(base).origin) return route.continue();
  if (!req.url().startsWith(api)) return route.abort();
  const path = url.pathname.split('/v1')[1];
  const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  if (path === '/setup') return send({ enabled: true, registrationEnabled: true });
  if (path === '/session/login') return send({ token: 'synthetic', user: { id: 'candidate-family', username: '合成家庭' }, expiresAt: Date.now() + 999999 });
  if (path === '/students') return send({ students: [student] });
  if (path === '/scans') return send({ scans: [scan], recognition: true });
  if (path.endsWith('/file')) return route.fulfill({ contentType: 'image/svg+xml', body: fixture });
  if (path === '/scans/candidate-photo') return send({ scan });
  if (path.endsWith('/candidate-regions')) {
    calls++;
    assert.equal(req.postDataJSON().revision, scan.revision);
    const revision = scan.revision;
    if (mode === 'pending') await new Promise((resolve) => { release = resolve; });
    if (mode === 'busy') return send({ error: 'busy' }, 503);
    if (mode === 'conflict') return send({ error: 'changed' }, 409);
    if (mode === 'unsupported') return send({ error: 'unavailable' }, 404);
    return send({ scanId: scan.id, revision, algorithm: 'layout-v1', coordinateSpace: 'oriented-normalized',
      image: { width: mode === 'wrong-image' ? 900 : 800, height: 4000 }, status: mode === 'empty' ? 'manual_required' : 'candidates',
      candidates: mode === 'empty' ? [] : [
        { id: 'first', order: 0, region: { x: .06, y: .02, width: .85, height: .07 }, reason: 'LAYOUT_GAP' },
        { id: 'second', order: 1, region: { x: .06, y: .16, width: .85, height: .07 }, reason: 'LAYOUT_GAP' },
      ], warnings: ['LAYOUT_ONLY', 'REVIEW_FIGURES_AND_HANDWRITING'] });
  }
  if (path.endsWith('/review')) {
    const value = req.postDataJSON(); assert.equal(value.revision, scan.revision);
    scan = { ...scan, questions: value.questions, revision: scan.revision + 1 };
    return send({ scan });
  }
  if (path.endsWith('/recognize') || path.endsWith('/explain')) analysisCalls++;
  errors.push('Unexpected request ' + path); return route.abort();
});
const picker = () => page.getByRole('region', { name: '核对建议题框' });
const checksBoxes = () => picker().locator('.candidate-list input');
async function find() { await page.getByRole('button', { name: '自动找题', exact: true }).click(); }
async function save() { await page.getByRole('button', { name: '保存校对', exact: true }).click(); await page.getByText('已保存题目框和手写步骤', { exact: true }).waitFor(); }
async function draw() {
  await page.getByRole('button', { name: '框选一道题', exact: true }).click();
  await page.locator('.paper-scroll').scrollIntoViewIfNeeded();
  const box = await page.locator('.paper-scroll').boundingBox();
  const from = { x: box.x + 30, y: box.y + 40 }, to = { x: box.x + 210, y: box.y + 140 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 0 }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
try {
  await page.goto(base);
  await page.getByRole('navigation', { name: '账户' }).getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('家庭服务地址').fill(api);
  await page.getByLabel('账号', { exact: true }).fill('synthetic');
  await page.getByLabel('密码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: /候选框合成照片/ }).click();
  await find(); await picker().waitFor();
  assert.equal(await picker().getByRole('button', { name: '采用所选 0 个题框' }).isDisabled(), true);
  assert.equal(scan.questions.length, 0); assert.equal(analysisCalls, 0);
  await checksBoxes().nth(0).check();
  await picker().getByRole('button', { name: '当前框上下拆分' }).click(); assert.equal(await checksBoxes().count(), 3);
  await picker().getByRole('button', { name: '撤销上次调整' }).click(); assert.equal(await checksBoxes().count(), 2);
  await picker().getByRole('button', { name: '浏览照片', exact: true }).click();
  await picker().locator('.candidate-region').first().tap(); assert.equal(await checksBoxes().nth(0).isChecked(), false);
  await picker().locator('.candidate-region').first().tap(); assert.equal(await checksBoxes().nth(0).isChecked(), true);
  await picker().getByRole('button', { name: '调整框', exact: true }).click();
  await picker().locator('.paper-scroll').scrollIntoViewIfNeeded();
  const handle = await picker().locator('.resize-target').boundingBox();
  const beforeWidth = await picker().locator('.candidate-region').first().getAttribute('width');
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 12, y: start.y + 12, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.notEqual(await picker().locator('.candidate-region').first().getAttribute('width'), beforeWidth);
  await picker().getByRole('button', { name: '撤销上次调整' }).click();
  assert.equal(await picker().locator('.candidate-region').first().getAttribute('width'), beforeWidth);
  checks.push('touch toggles selection; 44px resize commits; split and resize undo restore original candidates');
  await checksBoxes().nth(1).check();
  await picker().getByRole('button', { name: '合并所选建议' }).click(); assert.equal(await checksBoxes().count(), 1);
  await picker().getByRole('button', { name: '撤销上次调整' }).click(); assert.equal(await checksBoxes().count(), 2);
  await picker().getByRole('button', { name: '移除所选建议' }).click(); assert.equal(await checksBoxes().count(), 0);
  await picker().getByRole('button', { name: '撤销上次调整' }).click(); assert.equal(await checksBoxes().count(), 2);
  await checksBoxes().nth(1).uncheck();
  await picker().getByLabel('所选新题的科目（之后可逐题修改）').selectOption('物理');
  await picker().getByRole('button', { name: '采用所选 1 个题框' }).click();
  await page.getByText('已采用 1 个题框，尚未保存到服务器。', { exact: true }).waitFor();
  assert.equal(scan.questions.length, 0); assert.equal(await checksBoxes().count(), 1);
  assert.equal(await picker().getByRole('button', { name: '采用所选 0 个题框' }).isDisabled(), true);
  await save(); assert.equal(scan.questions.length, 1); assert.equal(scan.questions[0].subject, '物理');
  const firstSaved = structuredClone(scan.questions[0]);
  await picker().getByRole('button', { name: '放弃本轮剩余建议' }).click();
  checks.push('zero selection safe; merge/delete undo; only selected draft adopted; explicit save; no repeat adoption or analysis');
  await find(); await picker().waitFor();
  assert.equal(await picker().getByLabel('所选新题的科目（之后可逐题修改）').inputValue(), '物理');
  await checksBoxes().nth(0).check();
  page.once('dialog', (dialog) => dialog.dismiss());
  await picker().getByRole('button', { name: '采用所选 1 个题框' }).click();
  assert.equal(await checksBoxes().count(), 2); assert.deepEqual(scan.questions[0], firstSaved);
  await checksBoxes().nth(0).uncheck(); await checksBoxes().nth(1).check();
  await picker().getByRole('button', { name: '采用所选 1 个题框' }).click(); await save();
  assert.equal(scan.questions.length, 2); assert.deepEqual(scan.questions[0], firstSaved);
  for (const width of [320, 360, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await picker().getByRole('button', { name: '放弃本轮剩余建议' }).click();
  checks.push('same-photo subject inherited; overlap requires explicit confirmation; existing question unchanged; four viewport widths');
  for (const [scenario, text] of [['empty', '暂时没有找到可用的建议框，请手动框题。'], ['busy', '找题服务正忙，稍后重试，或先手动框题。'],
    ['unsupported', '当前服务尚未开启自动找题，请先手动框题。'], ['wrong-image', '建议框暂时无法与这张原图对应，请手动框题。']]) {
    mode = scenario; await find(); await page.getByText(text, { exact: true }).waitFor();
    assert.equal(await picker().count(), 0); assert.equal(scan.questions.length, 2);
  }
  checks.push('empty, busy, unavailable and wrong coordinate base fall back without overwriting');
  mode = 'pending'; await find(); await page.waitForTimeout(50);
  await page.getByRole('button', { name: '取消找题', exact: true }).click();
  mode = 'normal'; release(); await page.waitForTimeout(100);
  assert.equal(await picker().count(), 0);
  mode = 'pending'; await find(); await page.waitForTimeout(50);
  await draw(); mode = 'normal'; release();
  await page.getByText('你已修改题框，本次建议未应用。', { exact: true }).waitFor();
  assert.equal(await picker().count(), 0); await save(); assert.equal(scan.questions.length, 3);
  checks.push('cancelled and locally stale responses discarded; manual edits preserved');
  mode = 'pending'; await find(); await page.waitForTimeout(50);
  await page.getByRole('button', { name: '返回资料列表', exact: true }).click();
  mode = 'normal'; release(); await page.waitForTimeout(100);
  assert.equal(await picker().count(), 0);
  await page.getByRole('button', { name: /候选框合成照片/ }).click();
  assert.equal(await picker().count(), 0);
  checks.push('leaving and reopening photo discards the previous request');
  mode = 'conflict'; await find(); await page.getByText('这张照片已有更新，本机修改已保留。核对最新内容后可重新找题。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '导出本机草稿' }).isVisible(), true);
  assert.equal(scan.questions.length, 3); assert.equal(analysisCalls, 0); assert.deepEqual(errors, []);
  checks.push('409 preserves local work and offers existing recovery; no AI calls');
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/candidates-result.json', JSON.stringify({ syntheticOnly: true, checks, errors, calls, analysisCalls }, null, 2));
  console.log(JSON.stringify({ checks, errors, calls, analysisCalls }));
} finally { await browser.close(); }
