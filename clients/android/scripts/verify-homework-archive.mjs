import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.env.FAMILY_HOMEWORK_QA_DIR || resolve(root, 'test-results/homework-archive'));
mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const sharp = require('sharp');
const image = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="white"/><g font-family="Microsoft YaHei, sans-serif" fill="#172b48"><text x="45" y="48" font-size="24">物理寒假作业3 · 合成验收资料</text><text x="65" y="115" font-size="21">10. 如图，小车受到水平推力 F。</text><text x="65" y="151" font-size="21">请写出小车的受力分析与运动方程。</text><path d="M90 285H460 M195 280V220H310V280 M313 245H414 L398 235 M414 245L398 255" fill="none" stroke="#172b48" stroke-width="3"/><circle cx="215" cy="286" r="9" fill="white" stroke="#172b48" stroke-width="3"/><circle cx="290" cy="286" r="9" fill="white" stroke="#172b48" stroke-width="3"/><text x="356" y="226" font-size="21">F</text><text x="80" y="360" font-size="21">A. F = ma   B. F − f = ma</text></g><path d="M83 340L210 365 M95 365L190 340" stroke="#be4844" stroke-width="3"/><text x="255" y="415" fill="#be4844" font-size="24">B</text><text x="55" y="740" fill="#8796a6" font-size="18">仅用于本机流程验证，非真实学生资料</text></svg>`)).jpeg().toBuffer();
const api = 'https://library-context.invalid/api', client = 'http://127.0.0.1:3321';
const now = '2026-10-01T00:00:00Z';
const question = (number, subject) => ({ id: 'q-' + number, number, subject, prompt: `${subject}合成上下文题 ${number}：请写出计算过程。`, diagram: '',
  regions: [{ id: 'r-' + number, kind: 'stem', x: .1, y: .1, width: .8, height: .5 }], answerSteps: [], uncertainties: [], knowledgePoints: [], confirmed: true, wrongBook: { savedAt: now } });
const scan = (number, subject, date) => ({ id: 'scan-' + number, studentId: 'a', subject, source: '上下文合成验收', originalName: `context-${number}.jpg`,
  mimeType: 'image/jpeg', size: image.length, createdAt: date, revision: 1, status: 'ready', questions: [question(number, subject)] });
const scans = [scan('20', '物理', '2026-10-01T00:00:00Z'), scan('10', '物理', '2026-09-01T00:00:00Z'), scan('30', '数学', '2026-08-01T00:00:00Z')];
const archive = { documentId: 'hw-physics-3', title: '物理寒假作业3', subject: '物理', pageNumber: 2, pageCount: 3, revision: 1 };
scans[1].sourcePage = { ...archive, photoId: 'photo-2' };
scans[1].questions[0].focusBook = { savedAt: now };
scans[1].questions[0].sourcePage = { ...scans[1].sourcePage, majorNumber: '二', subNumber: '3' };
scans[1].questions[0].paperMark = { classification: 'both', ruleIds: ['red-correction', 'red-star'], evidence: [{ text: '红笔划改 A 为 B；题号前红星（合成标记）' }], reviewedAt: now, reviewedBy: 'codex-manual', independentAssessment: false };
scans[0].questions[0].focusBook = { savedAt: now };
delete scans[0].questions[0].wrongBook;
const sourceScan = scans[1], sourceQuestion = sourceScan.questions[0];
const photos = [1, 2, 3].map(pageNumber => ({ id: 'photo-' + pageNumber, studentId: 'a', batchId: 'batch-a', clientRequestId: 'request-' + pageNumber,
 originalName: `IMG_00${4-pageNumber}.jpg`, size: image.length, mimeType: 'image/jpeg', sha256: 'a'.repeat(64), createdAt: now, archive: { ...archive, pageNumber } }));
const pendingPhoto = { ...photos[0], id: 'pending-photo', originalName: 'IMG_待整理.jpg', archive: undefined };
let archiveEnabled = true, endpointUnavailable = false, holdPages = false, releasePages;
const cloudCap = () => ({ version: 1, maxFileBytes: 33554432, maxBatchItems: 2147483647, mimeTypes: ['image/jpeg'], nameConflictVersion: 1, ...(archiveEnabled ? { archiveVersion: 1 } : {}) });
const storage = { usedBytes: image.length * 4, limitBytes: 2147483648 };
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
const vite = await createServer({ root, server: { host: '127.0.0.1', port: 3321, strictPort: true, hmr: false, watch: null } }); await vite.listen();
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
  if (path === '/setup') return send({ enabled: true, registrationEnabled: true, cloudPhotos: cloudCap() });
  if (path === '/session/login') { account = request.postDataJSON().username; return send({ token: 'synthetic-' + account, user: { id: 'family-' + account, username: account }, expiresAt: Date.now() + 999999 }); }
  if (path === '/session/logout') return send({ ok: true });
  if (path === '/students') return send({ students: [{ id: 'a', name: '合成学生甲', createdAt: now, overview: {} }, { id: 'b', name: '合成学生乙', createdAt: now, overview: {} }], unassignedScanCount: 0 });
  if (path === '/cloud-photo-folders') {
    if (endpointUnavailable) return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '{}' });
    const studentId = url.searchParams.get('studentId'), subject = url.searchParams.get('subject');
    if (studentId !== 'a' || account !== 'one') return send({ subjects: [], unclassifiedCount: 0 });
    if (!subject) return send({ subjects: [{ subject: '生物', documentCount: 2, photoCount: 10 }, { subject: '物理', documentCount: 1, photoCount: 3 }], unclassifiedCount: 1 });
    const biology = subject === '生物', next = url.searchParams.get('cursor');
    return send({ documents: [{ id: biology ? next ? 'hw-bio-5' : 'hw-bio-4' : 'hw-physics-3', title: biology ? next ? '生物寒假作业5' : '生物寒假作业4' : '物理寒假作业3', subject, pageCount: biology ? next ? 6 : 4 : 3, revision: 1, createdAt: now }], ...(biology && !next ? { nextCursor: 'bio-next' } : {}) });
  }
  if (path === '/cloud-photos') {
    const document = url.searchParams.get('documentId');
    if (holdPages && document) await new Promise(resolve => { releasePages = resolve; });
    if (url.searchParams.get('studentId') !== 'a' || account !== 'one') return send({ photos: [], storage });
    return send({ photos: document ? url.searchParams.has('cursor') ? photos.slice(2) : photos.slice(0, 2) : url.searchParams.has('unclassified') ? [pendingPhoto] : [...photos, pendingPhoto], ...(document && !url.searchParams.has('cursor') ? { nextCursor: 'page-3' } : {}), storage });
  }
  if (/^\/cloud-photos\/[^/]+\/thumbnail$/.test(path)) return route.fulfill({ contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: image });
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
  await page.goto(client); await login('one');
  const cloud = () => button('图片云盘').click();
  const back = () => page.getByRole('button', { name: '返回上一页', exact: true }).click();
  const folder = name => page.locator('.cloud-folder').filter({ has: page.getByText(name, { exact: true }) });
  const crumb = name => page.getByRole('navigation', { name: '云盘文件夹' }).getByRole('button', { name, exact: true });
  await cloud(); await folder('物理').waitFor();
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: resolve(out, `folders-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await folder('生物').click(); await folder('生物寒假作业4').waitFor(); await button('加载更多').click(); await folder('生物寒假作业5').waitFor();
  assert.equal(await page.locator('.cloud-folder').count(), 2);
  await crumb('全部科目').click(); await folder('物理').click(); await folder('物理寒假作业3').click();
  await page.locator('.cloud-photo img').first().waitFor();
  assert.deepEqual(await page.locator('.cloud-photo-open > span:last-child').allTextContents(), ['IMG_003.jpg', 'IMG_002.jpg']);
  assert.deepEqual(await page.locator('.cloud-page-number').allTextContents(), ['第 1 页', '第 2 页']);
  await button('加载更多').click(); await page.getByText('第 3 页', { exact: true }).waitFor();
  assert.deepEqual(await page.locator('.cloud-page-number').allTextContents(), ['第 1 页', '第 2 页', '第 3 页']);
  await page.screenshot({ path: resolve(out, 'homework-pages.png'), fullPage: true });
  await page.getByRole('button', { name: '预览 IMG_003.jpg', exact: true }).click(); await page.getByRole('dialog', { name: '云图预览' }).getByRole('img').waitFor();
  assert.match(await page.locator('.cloud-modal').textContent(), /物理寒假作业3 · 第 1 页/);
  await button('关闭预览').click();
  assert.equal(requests.filter(r => /cloud-photos.*\/file$/.test(r.path)).length, 0);
  checks.push('Subject folders, document pagination, confirmed page order, original filenames and thumbnail-only preview pass at 390/768/1280 widths.');
  await crumb('全部科目').click(); await folder('待整理').click(); await page.getByText('IMG_待整理.jpg', { exact: true }).waitFor();
  assert.equal(await page.locator('.cloud-photo').count(), 1);
  await crumb('全部科目').click(); await folder('物理').click(); holdPages = true; await folder('物理寒假作业3').click();
  while (!releasePages) await new Promise(resolve => setTimeout(resolve, 20));
  await back(); await page.getByLabel('当前学生').selectOption('b'); await cloud();
  await page.getByText('还没有云图。上传完成后会出现在这里。', { exact: true }).waitFor();
  holdPages = false; releasePages(); await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await page.locator('.cloud-photo, .cloud-folder').count(), 0);
  await back(); await page.getByLabel('当前学生').selectOption('a');
  archiveEnabled = false; await cloud(); await page.getByText('IMG_003.jpg', { exact: true }).waitFor(); assert.equal(await page.locator('.cloud-breadcrumbs').count(), 0); await back();
  archiveEnabled = true; endpointUnavailable = true; await cloud(); await page.getByText('IMG_003.jpg', { exact: true }).waitFor(); assert.equal(await page.locator('.cloud-breadcrumbs').count(), 0); await back(); endpointUnavailable = false;
  checks.push('Unclassified folder excludes archived pages; leaving/switching student cancels stale pages; older capability and 404 directory endpoints fall back to ordinary photo listing.');
  await nav('题目').click();
  await page.getByRole('navigation', { name: '按收录类型筛选' }).getByRole('button', { name: '重点题', exact: true }).click();
  assert.deepEqual(await page.locator('.wrong-book .paper-number').allTextContents(), ['20.', '10.']);
  await page.getByRole('navigation', { name: '按收录类型筛选' }).getByRole('button', { name: '错题', exact: true }).click();
  assert.deepEqual(await page.locator('.wrong-book .paper-number').allTextContents(), ['10.', '30.']);
  await page.getByRole('navigation', { name: '按收录类型筛选' }).getByRole('button', { name: '全部收录', exact: true }).click();
  assert.equal(await page.locator('.wrong-book .question-card').count(), 3);
  await page.getByRole('navigation', { name: '按收录类型筛选' }).getByRole('button', { name: '重点题', exact: true }).click();
  await page.getByRole('article', { name: '第 10 题', exact: true }).locator('.question-source summary').click();
  await page.getByText('按纸面批改标记收录，不作为独立测验成绩。', { exact: true }).waitFor();
  await page.getByRole('article', { name: '第 10 题', exact: true }).getByRole('button', { name: '原图', exact: true }).click();
  await page.getByRole('article', { name: '第 10 题', exact: true }).getByRole('img', { name: '这道题的原图题框', exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, 'collected-questions.png'), fullPage: true });
  checks.push('Focus-only questions are included; dual wrong/focus classification appears once, filters remain independent of subject; provenance and real crop are visible.');

  await filters().getByRole('button', { name: '物理', exact: true }).click(); await page.getByLabel('错题排序').selectOption('oldest');
  assert.deepEqual(await page.locator('.wrong-book .paper-number').allTextContents(), ['10.', '20.']);
  await page.getByRole('article', { name: '第 10 题', exact: true }).getByRole('button', { name: '题目详情', exact: true }).click();
  await page.getByRole('region', { name: '当前题目原题' }).waitFor(); await button('返回资料列表').click();
  assert.equal(await filters().getByRole('button', { name: '物理', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByLabel('错题排序').inputValue(), 'oldest');
  assert.equal(await page.getByRole('navigation', { name: '按收录类型筛选' }).getByRole('button', { name: '重点题', exact: true }).getAttribute('aria-pressed'), 'true');
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
  const savedQuestions = sourceScan.questions; sourceScan.questions = [];
  await button('刷新').click(); await page.locator('.weakness-summary').waitFor(); await page.locator('.weakness-evidence > summary').click();
  await page.getByText('当前原题已移除或暂不可用，可保留查看上次分析依据。', { exact: true }).waitFor();
  assert.equal(await button('回看原题').count(), 0); assert.equal(await button('针对这题练习').count(), 0);
  await nav('首页').click(); await button('继续学习').click();
  await page.getByText('当前原题已移除或暂不可用；本次已保存的学习记录仍可查看。', { exact: true }).waitFor();
  assert.equal(await button('原题详情').count(), 0);
  await page.getByText('回看创建时的原题', { exact: true }).click();
  await page.locator('.learning-context .question-crop img').first().waitFor(); assert.equal(await page.locator('.learning-context').getByRole('button', { name: '题目详情', exact: true }).count(), 0);
  sourceScan.questions = savedQuestions; await leaveLearning(); await nav('题目').click(); await button('刷新').click(); await assertPhysicsGraph();
  checks.push('Removed source questions disable obsolete graph/session links while retaining saved evidence and the original learning snapshot.');
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
  writeFileSync(resolve(out, 'homework-archive-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }); throw error; }
finally { await browser.close(); await vite.close(); }
