import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.env.FAMILY_LIBRARY_CONTEXT_QA_DIR || resolve(root, 'test-results/library-context'));
mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const sharp = require('sharp');
const image = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#f4f0e8' } }).jpeg().toBuffer();
const api = 'https://library-context.invalid/api', client = 'http://127.0.0.1:3320';
const now = '2026-10-01T00:00:00Z';
const question = (number, subject) => ({ id: 'q-' + number, number, subject, prompt: `${subject}合成上下文题 ${number}：请写出计算过程。`, diagram: '',
  regions: [{ id: 'r-' + number, kind: 'stem', x: .1, y: .1, width: .8, height: .5 }], answerSteps: [], uncertainties: [], knowledgePoints: [], confirmed: true, wrongBook: { savedAt: now } });
const scan = (number, subject, date) => ({ id: 'scan-' + number, studentId: 'a', subject, source: '上下文合成验收', originalName: `context-${number}.jpg`,
  mimeType: 'image/jpeg', size: image.length, createdAt: date, revision: 1, status: 'ready', questions: [question(number, subject)] });
const scans = [scan('20', '物理', '2026-10-01T00:00:00Z'), scan('10', '物理', '2026-09-01T00:00:00Z'), scan('30', '数学', '2026-08-01T00:00:00Z')];
const sourceScan = scans[1], sourceQuestion = sourceScan.questions[0];
const source = { scanId: sourceScan.id, questionId: sourceQuestion.id, subject: '物理', number: '10', revision: 1, prompt: sourceQuestion.prompt };
const learning = { id: 'session-a', mode: 'practice', studentId: 'a', source, sourceQuestions: sourceScan.questions, revision: 1, tasks: [], createdAt: now, updatedAt: now };
const summary = { id: learning.id, mode: 'practice', source, createdAt: now, updatedAt: now, taskCount: 3, passedCount: 0, independentRetest: false };
const axesFor = subject => ['概念理解', '建模应用', '实验探究', '运算推导', '图像信息', '综合迁移'].map((label, i) => ({ id: ['concept','modeling','experiment','calculation','graph','transfer'][i], label,
  subject, score: null, evidenceCount: 0, sourceCount: 0, confidence: 'insufficient', evidence: [], grade: '高一', gradeFocus: '合成课程范围' }));
function overview(subject, active) {
  const axes = axesFor(subject), eligible = active && subject === '物理' ? 2 : 0;
  const report = eligible ? { id: 'report-physics', subject, studentId: 'a', status: 'ready', revision: 1, stale: false, sourceVersion: 'synthetic', updatedAt: now,
    coverage: { selected: 2 }, sources: [{ id: 'source-10', ...source }], result: { summary: '合成报告：复核实验条件。', axes,
      focuses: [{ id: 'focus-experiment', dimensionId: 'experiment', subject, title: '实验条件复核', priority: 'medium', basis: 'question_patterns', knowledgePoints: ['实验条件'], reason: '合成跨题依据', practiceDirection: '检查实验条件', evidence: [{ sourceId: 'source-10', quote: sourceQuestion.prompt, reason: '合成证据链接' }] }], limitations: [] } } : undefined;
  return { enabled: true, axes, report, materials: { total: eligible, eligible, selected: eligible, needsReview: 0, omitted: 0, pendingSources: [], pendingMore: 0, version: 'synthetic' } };
}
let account = 'one'; const errors = [], checks = [], requests = [];
const vite = await createServer({ root, server: { host: '127.0.0.1', port: 3320, strictPort: true, hmr: false, watch: null } }); await vite.listen();
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(15000);
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin === new URL(client).origin) return route.continue();
  const send = data => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
  if (url.pathname.endsWith('latest.json')) return route.fulfill({ status: 503, body: '{}' });
  if (!url.href.startsWith(api)) { errors.push('Unexpected external request'); return route.abort(); }
  const path = url.pathname.slice('/api'.length); requests.push({ path, method: request.method() });
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
  if (path === '/setup') return send({ enabled: true, registrationEnabled: true });
  if (path === '/session/login') { account = request.postDataJSON().username; return send({ token: 'synthetic-' + account, user: { id: 'family-' + account, username: account }, expiresAt: Date.now() + 999999 }); }
  if (path === '/session/logout') return send({ ok: true });
  if (path === '/students') return send({ students: [{ id: 'a', name: '合成学生甲', createdAt: now, overview: {} }, { id: 'b', name: '合成学生乙', createdAt: now, overview: {} }], unassignedScanCount: 0 });
  if (path === '/scans') return send({ scans: account === 'one' && url.searchParams.get('studentId') === 'a' ? scans : [], recognition: true });
  if (path === '/weakness-reports') return send(overview(url.searchParams.get('subject'), account === 'one' && url.searchParams.get('studentId') === 'a'));
  if (path === '/learning-sessions') return send({ sessions: account === 'one' && url.searchParams.get('studentId') === 'a' ? [summary] : [], more: false, enabled: true });
  if (path === '/learning-sessions/session-a') return send({ session: learning });
  const selected = scans.find(item => path === `/scans/${item.id}` || path === `/scans/${item.id}/file`);
  if (selected) return path.endsWith('/file') ? route.fulfill({ contentType: 'image/jpeg', body: image }) : send({ scan: selected });
  errors.push(`Unexpected ${request.method()} ${path}`); return route.abort();
});
const button = name => page.getByRole('button', { name, exact: true });
const nav = name => page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name, exact: true });
const tabs = () => page.getByRole('navigation', { name: '题目分类' });
const filters = () => page.getByRole('navigation', { name: '按科目筛选错题' });
const graphSubjects = () => page.getByRole('navigation', { name: '选择图谱科目' });
async function login(username) {
  const entry = page.getByRole('navigation', { name: '账户' }).getByRole('button', { name: '登录', exact: true });
  await entry.waitFor(); await entry.click();
  if (await page.getByLabel('家庭服务地址').count()) await page.getByLabel('家庭服务地址').fill(api);
  await page.getByLabel('账号', { exact: true }).fill(username); await page.getByLabel('密码', { exact: true }).fill('synthetic-only-password');
  await page.locator('form').getByRole('button', { name: '登录', exact: true }).click(); await nav('题目').waitFor();
}
async function assertPhysicsGraph() {
  await page.locator('.weakness-summary').waitFor();
  assert.equal(await tabs().getByRole('button', { name: '能力图谱', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await graphSubjects().getByRole('button', { name: '物理', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.ability-radar-detail strong').textContent(), '实验探究');
}
async function leaveLearning() { for (let i = 0; i < 4 && await page.locator('.learning-hub').count(); i++) await button('返回学习列表或首页').click(); }
try {
  await page.goto(client); await login('one'); await nav('题目').click();
  await filters().getByRole('button', { name: '物理', exact: true }).click(); await page.getByLabel('错题排序').selectOption('oldest');
  assert.deepEqual(await page.locator('.wrong-book .paper-number').allTextContents(), ['10.', '20.']);
  await page.getByRole('article', { name: '第 10 题', exact: true }).getByRole('button', { name: '题目详情', exact: true }).click();
  await page.getByRole('region', { name: '当前题目原题' }).waitFor(); await button('返回资料列表').click();
  assert.equal(await filters().getByRole('button', { name: '物理', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByLabel('错题排序').inputValue(), 'oldest');
  assert.deepEqual(await page.locator('.wrong-book .paper-number').allTextContents(), ['10.', '20.']);
  checks.push('Wrong-book subject and oldest order survive opening a source and returning.');
  await tabs().getByRole('button', { name: '能力图谱', exact: true }).click();
  await page.getByRole('group', { name: '选择能力维度' }).getByRole('button', { name: /^实验探究，/ }).click();
  await assertPhysicsGraph(); await page.locator('.weakness-evidence > summary').click();
  await button('回看原题').click();
  await page.getByRole('region', { name: '当前题目原题' }).getByRole('img', { name: '原题题干与配图', exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: '当前题目原题' }).locator('.paper-number').textContent(), '10.');
  await button('返回资料列表').click(); await assertPhysicsGraph();
  await page.locator('.weakness-evidence > summary').click(); await button('针对这题练习').click();
  await page.locator('.learning-start').getByRole('img', { name: '原题题干与配图', exact: true }).waitFor();
  assert.equal(await page.locator('.learning-start .paper-number').textContent(), '10.');
  await leaveLearning(); await assertPhysicsGraph();
  checks.push('Physics graph tab, subject and non-default dimension survive evidence/source and practice-start round trips.');
  await nav('首页').click(); await button('继续学习').click(); await button('原题详情').click();
  await page.getByRole('region', { name: '当前题目原题' }).waitFor(); await button('返回资料列表').click();
  await page.locator('.learning-source-line').waitFor(); assert.match(await page.locator('.learning-source-line').textContent(), /物理 · 原题 10/);
  await leaveLearning(); await nav('题目').click(); await assertPhysicsGraph();
  checks.push('Existing learning-session source detail returns to its original session; library context remains intact.');
  await page.getByLabel('当前学生').selectOption('b');
  await page.getByText('数学 · 0 道错题', { exact: true }).waitFor();
  assert.equal(await page.locator('.weakness-summary').count(), 0); assert.equal(await page.locator('.ability-radar-detail strong').textContent(), '概念理解');
  await tabs().getByRole('button', { name: '错题本', exact: true }).click();
  assert.equal(await filters().getByRole('button', { name: '全部', exact: true }).getAttribute('aria-pressed'), 'true'); assert.equal(await page.getByLabel('错题排序').inputValue(), 'newest');
  await page.getByLabel('当前学生').selectOption('a'); await page.locator('.wrong-book .question-card').first().waitFor();
  assert.equal(await filters().getByRole('button', { name: '全部', exact: true }).getAttribute('aria-pressed'), 'true');
  checks.push('Switching students clears prior subject, order and ability dimension; no previous child evidence remains.');
  await filters().getByRole('button', { name: '物理', exact: true }).click(); await page.getByLabel('错题排序').selectOption('oldest');
  await tabs().getByRole('button', { name: '能力图谱', exact: true }).click(); await page.locator('.weakness-summary').waitFor();
  await nav('我的').click(); await button('退出登录').click(); await login('two'); await nav('题目').click();
  assert.equal(await tabs().getByRole('button', { name: '错题本', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await filters().getByRole('button', { name: '全部', exact: true }).getAttribute('aria-pressed'), 'true'); assert.equal(await page.getByLabel('错题排序').inputValue(), 'newest');
  assert.equal(await page.locator('.question-card, .weakness-summary').count(), 0);
  checks.push('Logging into another account resets all library context even when synthetic child IDs overlap.');
  assert.deepEqual(errors, []); assert.ok(requests.every(item => item.method === 'GET' || item.method === 'OPTIONS' || ['/session/login', '/session/logout'].includes(item.path)));
  const result = { checkedAt: new Date().toISOString(), syntheticOnly: true, realModelCalls: 0, checks, errors };
  writeFileSync(resolve(out, 'library-context-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }); throw error; }
finally { await browser.close(); await vite.close(); }
