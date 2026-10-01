import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.env.CLIENT_URL || 'http://127.0.0.1:3178';
const api = 'http://127.0.0.1:3199/family-learning/api/mobile/v1';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const cdp = await context.newCDPSession(page);
const errors = [], checks = [];
page.on('pageerror', (e) => errors.push(e.message));
const now = new Date().toISOString();
const students = [{ id: 'large', name: '大宝测试', createdAt: now }, { id: 'small', name: '小宝测试', createdAt: now }];
let scan = { id: 'long-photo', studentId: 'large', subject: '待选择', source: '合成测试', originalName: '物理长试卷（合成）.png',
  mimeType: 'image/png', size: 1000, createdAt: now, revision: 1, status: 'needs_review', questions: [] };
const calls = [];
let explainFailure = true;
const fixture = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="4000"><rect width="800" height="4000" fill="#fffcf2"/>' +
  Array.from({ length: 10 }, (_, i) => '<text x="50" y="' + (150 + i * 370) + '" font-size="28">' + (i + 1) + '. 物理合成样例：动能与功</text><path d="M50 ' + (260 + i * 370) + 'H740" stroke="#9da6b2"/>').join('') + '</svg>';
await page.route('**/*', async (route) => {
  const req = route.request(), url = new URL(req.url());
  if (url.origin === new URL(base).origin) return route.continue();
  if (!req.url().startsWith(api)) return route.abort();
  const path = url.pathname.split('/v1')[1];
  const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  if (path === '/setup') return send({ enabled: true, registrationEnabled: true });
  if (path === '/session/login') return send({ token: 'synthetic-only', user: { id: 'synthetic-family', username: '测试家庭' }, expiresAt: Date.now() + 999999 });
  assert.equal(req.headers().authorization, 'Bearer synthetic-only');
  if (path === '/students') return send({ students });
  if (path === '/scans') return send({ scans: url.searchParams.get('studentId') === 'large' ? [scan] : [], recognition: true });
  if (path.endsWith('/file')) return route.fulfill({ contentType: 'image/svg+xml', body: fixture });
  if (path === '/scans/long-photo') return send({ scan });
  if (path.endsWith('/review')) {
    calls.push('review');
    const input = req.postDataJSON();
    assert.equal(input.revision, scan.revision);
    scan = { ...scan, questions: input.questions, revision: scan.revision + 1 };
    return send({ scan });
  }
  if (path.endsWith('/wrong-book')) {
    calls.push('wrong-book');
    const qid = path.split('/')[4], q = scan.questions.find((item) => item.id === qid);
    assert.equal(req.postDataJSON().revision, scan.revision);
    assert.ok(q.subject);
    q.wrongBook = { savedAt: now };
    scan.revision++;
    return send({ scan });
  }
  if (path.endsWith('/explain')) {
    calls.push('explain');
    assert.equal(req.postDataJSON().revision, scan.revision);
    if (explainFailure) return send({ error: '合成网络故障' }, 503);
    const q = scan.questions.find((item) => item.id === path.split('/')[4]);
    q.tutoring = { status: 'queued' }; scan.revision++;
    return send({ scan }, 202);
  }
  errors.push('Unexpected ' + req.method() + ' ' + path);
  return route.abort();
});
async function touchDrag(start, end, cancel = false) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y, id: 0, radiusX: 2, radiusY: 2 }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * i / 8, y: start.y + (end.y - start.y) * i / 8, id: 0, radiusX: 2, radiusY: 2 }] });
    await new Promise((resolve) => setTimeout(resolve, 22));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
}
async function photoBounds() {
  await page.locator('.paper-scroll').scrollIntoViewIfNeeded();
  return page.locator('.paper-scroll').boundingBox();
}
try {
  await page.goto(base);
  await page.getByRole('navigation', { name: '账户' }).getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('家庭服务地址').fill(api);
  await page.getByLabel('账号', { exact: true }).fill('synthetic');
  await page.getByLabel('密码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: /物理长试卷/ }).click();
  await page.getByRole('button', { name: '框选一道题', exact: true }).waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find((b) => b.textContent.includes('框选一道题')).disabled);
  assert.equal(await page.getByRole('button', { name: '调整框', exact: true }).count(), 0);
  // Real touch scrolling must work before a single question exists.
  let box = await photoBounds();
  await touchDrag({ x: box.x + 130, y: box.y + box.height - 35 }, { x: box.x + 130, y: box.y + 35 });
  await page.waitForFunction(() => document.querySelector('.paper-scroll').scrollTop > 100);
  checks.push('real touch scroll with zero questions');
  await page.getByRole('button', { name: '框选一道题', exact: true }).click();
  box = await photoBounds();
  await touchDrag({ x: box.x + 35, y: box.y + 70 }, { x: box.x + 200, y: box.y + 150 }, true);
  assert.equal(await page.locator('[data-region-id]').count(), 0);
  await touchDrag({ x: box.x + 35, y: box.y + 70 }, { x: box.x + 39, y: box.y + 74 });
  assert.equal(await page.locator('[data-region-id]').count(), 0);
  checks.push('cancel and tiny frame create no empty question');
  // Zoom and pan before drawing, coordinates remain relative to entire original.
  await page.getByRole('button', { name: '放大照片' }).click();
  await page.locator('.paper-scroll').evaluate((el) => { el.scrollTop = 850; el.scrollLeft = 90; });
  await page.getByRole('button', { name: '框选一道题', exact: true }).click();
  box = await photoBounds();
  const surface = await page.locator('.region-overlay').boundingBox();
  const p1 = { x: box.x + 35, y: box.y + 60 }, p2 = { x: box.x + 215, y: box.y + 170 };
  const expected = { x: (p1.x - surface.x) / surface.width, y: (p1.y - surface.y) / surface.height,
    width: (p2.x - p1.x) / surface.width, height: (p2.y - p1.y) / surface.height };
  await touchDrag(p1, p2);
  await page.getByLabel('这道题的科目').waitFor();
  assert.equal(await page.getByLabel('这道题的科目').inputValue(), '');
  assert.equal(await page.getByRole('button', { name: '保存并分析这道题' }).isDisabled(), true);
  await page.getByLabel('这道题的科目').selectOption('物理');
  assert.equal(await page.locator('.resize-target').getAttribute('r'), '22');
  await page.getByRole('button', { name: '保存校对', exact: true }).click();
  await page.getByText('已保存题目框和手写步骤').waitFor();
  const r = scan.questions[0].regions[0];
  for (const key of Object.keys(expected)) assert.ok(Math.abs(r[key] - expected[key]) < 0.004, key + ' normalized coordinates');
  assert.equal(scan.questions[0].subject, '物理');
  assert.equal(scan.questions[0].prompt, '');
  checks.push('150% zoom plus two-axis pan produces correct normalized frame; subject explicit; no prompt required');
  // A real touch resize commits once and preserves the photo's coordinates.
  await photoBounds();
  const handle = await page.locator('.resize-target').boundingBox();
  const resizeStart = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  await touchDrag(resizeStart, { x: resizeStart.x + 20, y: resizeStart.y + 20 });
  await page.getByRole('button', { name: '保存校对', exact: true }).click();
  await page.getByText('已保存题目框和手写步骤').waitFor();
  assert.ok(scan.questions[0].regions[0].width > r.width);
  checks.push('44px touch resize hit target changes saved frame');
  await page.getByRole('button', { name: '保存并分析这道题' }).click();
  await page.getByRole('alert').filter({ hasText: '分析未提交成功' }).waitFor();
  assert.ok(scan.questions[0].wrongBook);
  assert.deepEqual(calls.slice(-2), ['wrong-book', 'explain']);
  const markCount = calls.filter((value) => value === 'wrong-book').length;
  explainFailure = false;
  await page.getByRole('button', { name: '保存并分析这道题' }).click();
  await page.getByText('已存入错题本，AI 正在分析这道题。可以返回，稍后再看。').waitFor();
  assert.equal(calls.filter((value) => value === 'wrong-book').length, markCount);
  scan.questions[0].tutoring = { status: 'needs_review', result: { transcribedPrompt: '合成物理题：动能的变化', referenceAnswer: 'W = ΔE',
    explanation: '先确定研究对象，再用动能定理。', answerEvidence: [], errorHypotheses: [], uncertainties: ['手写作答未提供'], generatedAt: now, needsReview: true } };
  scan.revision++;
  await page.getByText('未看到足够的作答证据，暂不判断错因。', { exact: true }).waitFor();
  assert.equal(scan.questions[0].prompt, '');
  checks.push('wrong-book remains saved on AI failure; retry has no duplicate; polling renders result separate from manual prompt');
  await page.getByLabel('这道题的科目').selectOption('化学');
  await page.getByText('题框、科目或作答已有修改。下方是旧分析，请重新分析后再使用。').waitFor();
  await page.getByRole('button', { name: '只存错题本' }).click();
  assert.equal(scan.questions[0].tutoring.status, 'stale');
  await page.getByRole('button', { name: '返回资料列表' }).click();
  await page.getByRole('region', { name: '学习工具' }).getByRole('button', { name: /错题本/ }).click();
  await page.getByRole('region', { name: '错题本' }).getByRole('button', { name: /化学/ }).click();
  assert.equal(await page.getByLabel('这道题的科目').inputValue(), '化学');
  await page.getByRole('button', { name: '返回资料列表' }).click();
  await page.getByLabel('当前学生').selectOption('small');
  await page.getByText('还没有收录错题。打开一张照片，框题、选科后就能保存。').waitFor();
  assert.equal(await page.locator('.wrong-question-card').count(), 0);
  checks.push('subject roundtrip; changed input marks stale; wrongbook reopens selected question; another child cannot see it');
  assert.equal(await page.getByRole('navigation', { name: '主要页面' }).getByRole('button').count(), 3);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  mkdirSync('test-results', { recursive: true });
  await page.getByLabel('当前学生').selectOption('large');
  await page.locator('.wrong-question-card').click();
  await page.screenshot({ path: 'test-results/framing-subject-390.png', fullPage: true });
  writeFileSync('test-results/framing-result.json', JSON.stringify({ syntheticOnly: true, checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }));
} finally { await browser.close(); }

