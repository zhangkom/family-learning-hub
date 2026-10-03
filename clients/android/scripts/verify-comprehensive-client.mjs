import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), out = resolve(process.env.FAMILY_CLIENT_AUDIT_DIR || resolve(root, '../../work/qa-comprehensive-20261003/client'));
mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright'), sharp = require('sharp');
const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="white"/><text x="50" y="80" font-size="28">Synthetic paper: F = ma</text><path d="M70 230H500 M160 230V160H290V230 M290 190H420 L405 180 M420 190L405 200" stroke="#203858" fill="none" stroke-width="4"/><text x="50" y="320" font-size="24">A. 1N    B. 2N    C. 3N</text><text x="50" y="390" font-size="25" fill="#c33">Correction: B</text><text x="50" y="730" font-size="20">Synthetic only - full original page</text></svg>')).jpeg().toBuffer();
const hash = createHash('sha256').update(image).digest('hex'), now = '2026-10-03T00:00:00Z', subjects = ['物理', '生物', '语文', '数学'];
const question = n => ({ id: `q-${n}`, number: String(n), subject: subjects[(n - 1) % 4], prompt: `题目定位摘要：合成题 ${n}`, promptKind: 'summary', diagram: '', regions: [{ id: `r-${n}`, kind: 'stem', x: .05, y: .05, width: .9, height: .55 }], answerSteps: [], uncertainties: [], knowledgePoints: ['合成知识点'], confirmed: n <= 161, ...(n <= 161 ? { wrongBook: { savedAt: now } } : { paperMark: { classification: 'pending', ruleIds: ['R09'], evidence: [{ text: '原件边缘缺字，需要补拍' }], reviewedAt: now, reviewedBy: 'codex-manual', independentAssessment: false } }) });
const scans = Array.from({ length: 163 }, (_, i) => ({ id: `scan-${i + 1}`, studentId: 'a', subject: '物理', source: '综合合成验收', originalName: `合成资料-${i + 1}.jpg`, mimeType: 'image/jpeg', size: image.length, createdAt: now, revision: 1, status: 'ready', questions: [question(i < 159 ? i + 1 : i + 3)] }));
scans[0].questions.push(question(160)); scans[1].questions.push(question(161));
const source = { documentId: 'hw-physics', title: '物理合成作业', subject: '物理', pageNumber: 1, paperPageNumber: 1, pageCount: 2, revision: 1, photoId: 'photo-1', sourceParts: [{ photoId: 'photo-1', title: '物理合成作业', paperPageNumber: 1, role: 'question' }, { photoId: 'photo-2', title: '物理合成答题卡', paperPageNumber: 2, pageRole: 'answer-sheet', originalName: 'answer.jpg', role: 'answer' }] };
scans[0].sourcePage = source; scans[0].questions[0].sourcePage = source;
scans[0].questions[0].tutoring = { status: 'needs_review', result: { transcribedPrompt: '质量为1kg的小车在水平面上受到2N的水平力，求加速度。A. 1 B. 2 C. 3', referenceAnswer: 'B', explanation: 'F = ma', answerEvidence: [], errorHypotheses: [], uncertainties: [], generatedAt: now, needsReview: true } };
const photos = [1, 2].map(n => ({ id: `photo-${n}`, studentId: 'a', clientRequestId: `local-${n}`, batchId: 'batch', originalName: `original-${n}.jpg`, mimeType: 'image/jpeg', size: image.length, sha256: hash, createdAt: now }));
const api = 'https://comprehensive.invalid/api', client = 'http://127.0.0.1:3322';
const requests = [], errors = [], checks = []; let originalMode = 'ok', releaseOriginal, collectionVersion = 1, collectionFailure = false, difficultyVersion = 1, difficultyFailure = false, holdDifficulty = false, releaseDifficulty;
const vite = await createServer({ root, server: { host: '127.0.0.1', port: 3322, strictPort: true, hmr: false, watch: null } }); await vite.listen();
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => { const old = URL.revokeObjectURL.bind(URL); window.revokedUrls = []; URL.revokeObjectURL = url => { window.revokedUrls.push(url); old(url); }; });
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url()); if (url.origin === client) return route.continue();
  const send = data => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
  if (url.pathname.endsWith('latest.json')) return route.fulfill({ status: 503, body: '{}' });
  if (!url.href.startsWith(api)) { errors.push('Unexpected external request'); return route.abort(); }
  const path = url.pathname.slice('/api'.length); requests.push({ path, method: request.method(), student: url.searchParams.get('studentId') });
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (path === '/setup') return send({ enabled: true, registrationEnabled: true, collectionReviewVersion: collectionVersion, questionDifficultyVersion: difficultyVersion });
  if (path === '/session/login') return send({ token: 'synthetic', user: { id: 'synthetic-family', username: 'synthetic' }, expiresAt: Date.now() + 999999 });
  if (path === '/students') return send({ students: [{ id: 'a', name: '合成学生甲', createdAt: now }, { id: 'b', name: '合成学生乙', createdAt: now }], unassignedScanCount: 0 });
  if (path === '/scans') return send({ scans: url.searchParams.get('studentId') === 'a' ? scans : [], recognition: true });
  if (path === '/learning-sessions') return send({ sessions: [], more: false, enabled: true });
  const difficultyPath = path.match(/^\/scans\/([^/]+)\/questions\/([^/]+)\/difficulty$/);
  if (difficultyPath) {
    assert.equal(request.method(), 'POST'); const scan = scans.find(s => s.id === difficultyPath[1]), q = scan.questions.find(q => q.id === difficultyPath[2]), input = request.postDataJSON();
    assert.equal(input.studentId, 'a'); assert.equal(input.revision, scan.revision); assert.ok([1,2,3,4,5].includes(input.stars));
    if (difficultyFailure) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '合成难度保存失败，请重试' }) });
    if (holdDifficulty) await new Promise(resolve => { releaseDifficulty = resolve; });
    q.difficulty = { stars: input.stars, source: 'user', updatedAt: new Date().toISOString(), actorAccountId: 'synthetic-family' }; scan.revision++; return send({ scan }).catch(() => {});
  }
  const collectionPath = path.match(/^\/scans\/([^/]+)\/questions\/([^/]+)\/collection-review$/);
  if (collectionPath) {
    assert.equal(request.method(), 'POST'); const scan = scans.find(s => s.id === collectionPath[1]), q = scan.questions.find(q => q.id === collectionPath[2]);
    const input = request.postDataJSON(); assert.equal(input.studentId, 'a'); assert.equal(input.revision, scan.revision); assert.ok(input.reason.trim());
    if (collectionFailure) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '合成人工复核保存暂时失败，请重试' }) });
    if (input.materialStatus === 'complete') { assert.equal(q.confirmed, true); assert.ok(input.materialEvidence.trim()); }
    q.collectionReview = { decision: input.decision, materialStatus: input.materialStatus, reason: input.reason, materialEvidence: input.materialEvidence, reviewedAt: new Date().toISOString(), actorAccountId: 'synthetic-family', sourceRevision: scan.revision, status: 'current' };
    if (['wrong','both'].includes(input.decision)) q.wrongBook ||= { savedAt: now }; else delete q.wrongBook;
    if (['focus','both'].includes(input.decision)) q.focusBook ||= { savedAt: now }; else delete q.focusBook;
    scan.revision++; return send({ scan });
  }
  const photo = photos.find(p => path === `/cloud-photos/${p.id}` || path === `/cloud-photos/${p.id}/file`);
  if (photo) {
    assert.equal(url.searchParams.get('studentId'), 'a');
    if (!path.endsWith('/file')) return send({ photo: originalMode === 'foreign' ? { ...photo, studentId: 'b' } : photo });
    if (originalMode === 'hold') await new Promise(resolve => { releaseOriginal = resolve; });
    return route.fulfill({ contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: originalMode === 'corrupt' ? Buffer.from('corrupt') : image }).catch(() => {});
  }
  const scan = scans.find(s => path === `/scans/${s.id}` || path === `/scans/${s.id}/file` || path === `/scans/${s.id}/review`);
  if (scan) {
    if (path.endsWith('/file')) return route.fulfill({ contentType: 'image/jpeg', body: image });
    if (path.endsWith('/review')) { scan.questions = request.postDataJSON().questions; scan.revision++; }
    return send({ scan });
  }
  errors.push(`Unexpected ${request.method()} ${path}`); return route.abort();
});
const button = name => page.getByRole('button', { name, exact: true });
const nav = name => page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name, exact: true });
const card = () => page.getByRole('article', { name: '第 1 题', exact: true });
const sources = () => card().locator('.source-originals > button');
async function leaveLearning() { for (let n = 0; n < 4 && await page.locator('.learning-hub').count(); n++) await button('返回学习列表或首页').click(); }
try {
  await page.goto(client); await page.getByRole('navigation', { name: '账户' }).getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('家庭服务地址').fill(api); await page.getByLabel('账号', { exact: true }).fill('synthetic'); await page.getByLabel('密码', { exact: true }).fill('synthetic-only'); await page.locator('form').getByRole('button', { name: '登录', exact: true }).click();
  await nav('题目').click(); await card().waitFor(); assert.equal(await page.locator('.wrong-book .question-card').count(), 161);
  for (const item of await page.locator('.wrong-book .question-card').all()) { await item.scrollIntoViewIfNeeded(); await item.locator('.question-crop img').first().waitFor(); assert.equal(await item.locator('.question-crop img').first().evaluate(img => img.complete && img.naturalWidth > 0), true); }
  checks.push('163 scan / 165 question synthetic scale: all 161 wrong-question images decoded; pending 4 excluded.');
  const difficulty = () => card().getByLabel('题目难度', { exact: true });
  assert.equal(await difficulty().getByRole('button', { name: '难度 3 星', exact: true }).getAttribute('aria-pressed'), 'true');
  difficultyVersion = 0; await difficulty().getByRole('button', { name: '难度 5 星', exact: true }).click(); await difficulty().getByRole('alert').getByText(/家庭服务需要升级/).waitFor(); assert.equal(await difficulty().getByRole('button', { name: '难度 3 星', exact: true }).getAttribute('aria-pressed'), 'true');
  difficultyVersion = 1; difficultyFailure = true; await difficulty().getByRole('button', { name: '难度 5 星', exact: true }).click(); await difficulty().getByRole('alert').getByText(/合成难度保存失败/).waitFor(); assert.equal(scans[0].questions[0].difficulty, undefined);
  difficultyFailure = false; await difficulty().getByRole('button', { name: '难度 5 星', exact: true }).click(); await difficulty().getByText('5 星', { exact: true }).waitFor(); assert.equal(scans[0].questions[0].difficulty.source, 'user');
  for (const width of [320,390,768]) { await page.setViewportSize({ width, height: 900 }); await card().locator('.question-card-heading').scrollIntoViewIfNeeded(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); const boxes = await difficulty().getByRole('button').evaluateAll(nodes => nodes.map(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}))); assert.ok(boxes.every(box=>box.width>=44&&box.height>=44)); await page.screenshot({ path: resolve(out, `difficulty-${width}.png`) }); }
  await page.getByLabel('错题排序').selectOption('hardest'); assert.equal(await page.locator('.wrong-book .question-card').first().getAttribute('aria-label'), '第 1 题'); await page.getByLabel('错题排序').selectOption('easiest'); assert.notEqual(await page.locator('.wrong-book .question-card').first().getAttribute('aria-label'), '第 1 题'); await page.getByLabel('错题排序').selectOption('newest');
  await difficulty().getByRole('button', { name: '难度 1 星', exact: true }).click(); await difficulty().getByText('1 星', { exact: true }).waitFor();
  await card().getByRole('button', { name: '知识点', exact: true }).click(); assert.equal(await difficulty().getByRole('button', { name: '难度 1 星', exact: true }).getAttribute('aria-pressed'), 'true'); await card().getByRole('button', { name: '返回题目', exact: true }).click();
  checks.push('Difficulty defaults to 3, explicit user save goes up/down, unsupported/failing server rolls back with inline feedback, 44px controls fit 320/390/768, high/low sorting uses stored stars and knowledge switching preserves rating.');
  await card().locator('.question-source summary').click(); assert.equal(await sources().count(), 2); assert.equal(requests.filter(r => r.path.startsWith('/cloud-photos/')).length, 0);
  await sources().nth(1).click(); const dialog = page.getByRole('dialog'); await dialog.waitFor(); assert.match(await dialog.textContent(), /答题卡.*第 2 页/); const blob = await dialog.getByRole('img').getAttribute('src');
  await button('适合屏幕').click(); assert.equal(await page.locator('.question-viewer-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true); await page.screenshot({ path: resolve(out, 'source-original.png') });
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' }); assert.equal(await page.evaluate(url => window.revokedUrls.includes(url), blob), true);
  assert.deepEqual(requests.filter(r => /cloud-photos.*\/file$/.test(r.path)).map(r => r.path), ['/cloud-photos/photo-2/file']);
  checks.push('Source provenance opens only selected complete original page with strict student parameter and hash check, zoom/escape and URL release.');
  originalMode = 'corrupt'; await sources().first().click(); await page.getByText('原图完整性校验失败，未保存下载文件', { exact: true }).waitFor(); originalMode = 'ok'; await button('重试读取原件').click(); await dialog.waitFor(); await button('关闭题图放大').click();
  originalMode = 'foreign'; const beforeForeign = requests.filter(r => /cloud-photos.*\/file$/.test(r.path)).length; await sources().first().click(); await page.getByText('原件不属于当前学生，请返回重新读取', { exact: true }).waitFor(); assert.equal(requests.filter(r => /cloud-photos.*\/file$/.test(r.path)).length, beforeForeign); await button('收起').click();
  originalMode = 'hold'; await sources().first().click(); await button('取消读取').waitFor(); while (!releaseOriginal) await new Promise(resolve => setTimeout(resolve, 20)); await button('取消读取').click(); originalMode = 'ok'; releaseOriginal(); await sources().first().click(); await dialog.waitFor(); await page.keyboard.press('Escape');
  checks.push('Corrupt original shows retry, foreign metadata never fetches bytes, cancel resets and next selection works.');
  await card().getByRole('button', { name: '举一反三', exact: true }).click(); await page.locator('.learning-start').waitFor(); assert.equal(await button('生成3道变式').isEnabled(), true); await leaveLearning();
  await card().getByRole('button', { name: '题目详情', exact: true }).click(); await button('采用完整识别题干，再校对').click(); assert.equal(await page.getByLabel('题干与题框已核对', { exact: true }).isChecked(), false); assert.equal(await button('举一反三').isEnabled(), false); await page.getByLabel('题干与题框已核对', { exact: true }).check(); await button('保存这次校对').click(); await page.getByText('已保存题目框和手写步骤', { exact: true }).waitFor(); assert.equal(scans[0].questions[0].promptKind, 'full'); assert.equal(scans[0].questions[0].confirmed, true); await button('返回资料列表').click();
  checks.push('Image-backed summary can enter learning; adopting full transcription resets confirmation and requires explicit confirm/save with promptKind full.');
  await nav('首页').click(); await page.getByRole('button', { name: /原题照片/ }).click(); await page.getByRole('button', { name: '待确认 · 4', exact: true }).click(); assert.equal(await page.locator('.record-card').count(), 4); await page.screenshot({ path: resolve(out, 'pending-filter.png'), fullPage: true });
  await page.locator('.record-card').first().click(); await page.getByText(/本题资料仍待补全/).waitFor(); assert.equal(await button('举一反三').isEnabled(), false); await button('返回资料列表').click(); assert.equal(await button('待确认 · 4').getAttribute('aria-pressed'), 'true'); assert.equal(await page.locator('.record-card').count(), 4);
  await page.locator('.record-card').first().click(); const pendingScan = scans.find(s => s.questions.some(q => q.number === '162')), pendingQ = pendingScan.questions[0]; const originalMark = structuredClone(pendingQ.paperMark);
  const panel = () => page.locator('.collection-review-panel');
  const saveCollection = () => panel().getByRole('button', { name: '保存人工复核', exact: true });
  assert.equal(await button('只存错题本').count(), 0);
  assert.equal(await panel().getByLabel('完整题干、选项、图表和关联续页已核对').isEnabled(), false);
  await panel().getByLabel('这次收录判断').selectOption('focus'); await panel().getByLabel('复核依据', { exact: true }).fill('蓝星为人工指定重点，材料右侧仍缺字');
  collectionVersion = 0; const beforeUnsupported = requests.filter(r => r.path.endsWith('/collection-review')).length; await saveCollection().click(); await panel().getByRole('alert').getByText(/家庭服务需要升级/).waitFor(); assert.equal(requests.filter(r => r.path.endsWith('/collection-review')).length, beforeUnsupported);
  collectionVersion = 1; collectionFailure = true; await saveCollection().click(); await panel().getByRole('alert').getByText('合成人工复核保存暂时失败，请重试', { exact: true }).waitFor(); assert.equal(pendingQ.focusBook, undefined); assert.equal(await panel().getByLabel('复核依据', { exact: true }).inputValue(), '蓝星为人工指定重点，材料右侧仍缺字');
  collectionFailure = false; await saveCollection().click(); await page.getByText('人工复核已保存，收录与待补全状态已更新', { exact: true }).waitFor(); assert.ok(pendingQ.focusBook); assert.equal(pendingQ.wrongBook, undefined); assert.deepEqual(pendingQ.paperMark, originalMark); assert.equal(await button('举一反三').isEnabled(), false);
  await button('返回资料列表').click(); assert.equal(await page.locator('.record-card').count(), 4); await button('返回错题本').click(); await page.getByRole('navigation', { name: '按收录类型筛选' }).getByRole('button', { name: '重点题', exact: true }).click(); assert.equal(await page.locator('.wrong-book .question-card').count(), 1);
  const focusCard = page.getByRole('article', { name: '第 162 题', exact: true }); await focusCard.getByText('已收录 · 材料待补全', { exact: true }).waitFor(); assert.equal(await focusCard.getByRole('button', { name: '举一反三', exact: true }).isEnabled(), false); await focusCard.getByRole('button', { name: '题目详情', exact: true }).click();
  await page.getByLabel('题干与题框已核对', { exact: true }).check(); assert.equal(await saveCollection().isEnabled(), false); await panel().getByText(/请先保存这次校对/).first().waitFor(); await button('保存这次校对').click(); await page.getByText('已保存题目框和手写步骤', { exact: true }).waitFor(); assert.equal(pendingQ.promptKind, 'summary'); assert.equal(await button('举一反三').isEnabled(), false);
  // The mock review replaced the question array, as the real server does.
  const confirmedPending = pendingScan.questions.find(q => q.id === pendingQ.id);
  await panel().getByLabel('这次收录判断').selectOption('both'); await panel().getByLabel('完整题干、选项、图表和关联续页已核对').check(); await panel().getByLabel('复核依据', { exact: true }).fill('人工核对为错题并列重点'); assert.equal(await saveCollection().isEnabled(), false);
  await panel().getByLabel('材料完整的核对依据').fill('已核对原题图、全部选项和配图；合成资料没有续页'); await saveCollection().click(); await page.getByText('人工复核已保存，收录与待补全状态已更新', { exact: true }).waitFor(); assert.ok(confirmedPending.wrongBook && confirmedPending.focusBook); assert.equal(await button('举一反三').isEnabled(), true); assert.deepEqual(confirmedPending.paperMark, originalMark);
  for (const width of [320,390,768]) { await page.setViewportSize({ width, height: 900 }); await panel().locator('summary').click(); await panel().locator('summary').scrollIntoViewIfNeeded(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: resolve(out, `collection-review-${width}.png`) }); }
  await button('返回资料列表').click(); await nav('首页').click(); await page.getByRole('button', { name: /原题照片/ }).click(); await button('待确认 · 3').click(); assert.equal(await page.locator('.record-card').count(), 3);
  await page.locator('.record-card').first().click(); await panel().getByLabel('这次收录判断').selectOption('none'); await panel().getByLabel('复核依据', { exact: true }).fill('保留不完整原资料，本次明确不收录'); await saveCollection().click(); await page.getByText('人工复核已保存，收录与待补全状态已更新', { exact: true }).waitFor(); assert.equal(await button('举一反三').isEnabled(), false); await button('返回资料列表').click(); assert.equal(await page.locator('.record-card').count(), 3);
  checks.push('Manual collection is explicit: unsupported server and failed save retain form; focus+incomplete appears once and blocks learning; dirty text must save first; complete summary image needs confirmation plus separate evidence; both updates filters/pending count; none works without complete materials; original marks retained and no AI request.');
  await page.getByLabel('当前学生').selectOption('b'); await button('全部资料 · 0').waitFor(); assert.equal(await page.locator('.record-card').count(), 0); assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(await button('全部资料 · 0').getAttribute('aria-pressed'), 'true');
  checks.push('Pending filter opens incomplete question, gives blocking reason, survives detail/back; switching student clears filter and records.');
  await page.getByLabel('当前学生').selectOption('a'); await button('返回错题本').click(); await page.getByRole('navigation', { name: '按收录类型筛选' }).getByRole('button', { name: '全部收录', exact: true }).click(); await card().waitFor();
  holdDifficulty = true; await difficulty().getByRole('button', { name: '难度 4 星', exact: true }).click(); while (!releaseDifficulty) await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(await difficulty().getByRole('button', { name: '难度 2 星', exact: true }).isEnabled(), false);
  await page.getByLabel('当前学生').selectOption('b'); releaseDifficulty(); holdDifficulty = false; await page.getByText('还没有错题，先从首页录入。', { exact: true }).waitFor(); assert.equal(await page.locator('.question-card').count(), 0); assert.equal(await page.locator('.question-difficulty').count(), 0);
  checks.push('Switching student while a difficulty save is in flight aborts its client request and never appends another student question or save status.');
  assert.deepEqual(errors, []); assert.equal(requests.some(r => r.path === '/learning-sessions' && r.method === 'POST'), false);
  writeFileSync(resolve(out, 'result.json'), JSON.stringify({ status: 'passed', syntheticOnly: true, realModelCalls: 0, productionWrites: 0, checks, errors }, null, 2)); console.log(JSON.stringify({ status: 'passed', checks }));
} catch (error) { await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }); throw error; }
finally { await browser.close(); await vite.close(); }
