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
const requests = [], errors = [], checks = []; let originalMode = 'ok', releaseOriginal;
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
  if (path === '/setup') return send({ enabled: true, registrationEnabled: true });
  if (path === '/session/login') return send({ token: 'synthetic', user: { id: 'synthetic-family', username: 'synthetic' }, expiresAt: Date.now() + 999999 });
  if (path === '/students') return send({ students: [{ id: 'a', name: '合成学生甲', createdAt: now }, { id: 'b', name: '合成学生乙', createdAt: now }], unassignedScanCount: 0 });
  if (path === '/scans') return send({ scans: url.searchParams.get('studentId') === 'a' ? scans : [], recognition: true });
  if (path === '/learning-sessions') return send({ sessions: [], more: false, enabled: true });
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
  await page.getByLabel('当前学生').selectOption('b'); await button('全部资料 · 0').waitFor(); assert.equal(await page.locator('.record-card').count(), 0); assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(await button('全部资料 · 0').getAttribute('aria-pressed'), 'true');
  checks.push('Pending filter opens incomplete question, gives blocking reason, survives detail/back; switching student clears filter and records.');
  assert.deepEqual(errors, []); assert.equal(requests.some(r => r.path === '/learning-sessions' && r.method === 'POST'), false);
  writeFileSync(resolve(out, 'result.json'), JSON.stringify({ status: 'passed', syntheticOnly: true, realModelCalls: 0, productionWrites: 0, checks, errors }, null, 2)); console.log(JSON.stringify({ status: 'passed', checks }));
} catch (error) { await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }); throw error; }
finally { await browser.close(); await vite.close(); }
