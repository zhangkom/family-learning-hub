import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const config = JSON.parse(readFileSync(process.env.FAMILY_DEV_CONNECTION_PATH, 'utf8'));
assert.equal(config.syntheticOnly, true); assert.equal(config.aiEnabled, false); assert.equal(config.questionModelStub, true);
assert.equal(new URL(config.apiBase).hostname, '127.0.0.1');
const api = config.apiBase, client = 'http://127.0.0.1:3310';
const output = resolve(process.env.FAMILY_ABILITY_QA_DIR || 'test-results/ability-flow'); mkdirSync(output, { recursive: true });
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vite = await createServer({ root, server: { host: '127.0.0.1', port: 3310, strictPort: true, hmr: false, watch: null } });
await vite.listen();
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await context.addInitScript(value => { if (/^https?:$/.test(location.protocol)) localStorage.setItem('family-learning:server', value); }, api);
const page = await context.newPage(); page.setDefaultTimeout(30000);
const errors = [], checks = [], layouts = [], creates = [];
let externalRequests = 0, lostReceipt = false, failOverviewRead = false, readFailures = 0, headers;
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.pathname.endsWith('/downloads/android/latest.json')) return route.fulfill({ status: 503, body: '{}' });
  if (![new URL(client).origin, new URL(api).origin].includes(url.origin)) { externalRequests++; return route.abort(); }
  if (url.pathname.endsWith('/weakness-reports') && request.method() === 'GET' && failOverviewRead) {
    failOverviewRead = false; readFailures++; return route.abort('connectionreset');
  }
  if (url.href === api + '/weakness-reports' && request.method() === 'POST') {
    const response = await route.fetch(); assert.equal(response.status(), 202);
    const result = await response.json(); creates.push({ request: request.postDataJSON(), reportId: result.report.id });
    if (!lostReceipt) { lostReceipt = true; return route.abort('connectionreset'); }
    return route.fulfill({ response });
  }
  return route.continue();
});
async function request(path, method = 'GET', body) {
  const options = { method, headers: { ...headers, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) } };
  if (method !== 'GET') options.body = body instanceof FormData ? body : body ? JSON.stringify(body) : undefined;
  const response = await fetch(api + path, options);
  const result = await response.json(); assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(result)}`); return result;
}
const button = name => page.getByRole('button', { name, exact: true });
const nav = name => page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name, exact: true });
const libraryTabs = () => page.getByRole('navigation', { name: '题目分类' });
const graphSubjects = () => page.getByRole('navigation', { name: '选择图谱科目' });
async function logIn(student) {
  await page.getByRole('navigation', { name: '账户' }).getByRole('button', { name: '登录', exact: true }).click();
  if (await page.getByLabel('家庭服务地址').count()) await page.getByLabel('家庭服务地址').fill(api);
  await page.getByLabel('账号', { exact: true }).fill(config.username); await page.getByLabel('密码', { exact: true }).fill(config.password);
  await page.locator('form').getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('当前学生').selectOption(student.id);
}
async function openGraph(subject = '数学', recoverRead = false) {
  await nav('题目').click(); await libraryTabs().getByRole('button', { name: '能力图谱', exact: true }).click();
  await graphSubjects().getByRole('button', { name: subject, exact: true }).click();
  if (recoverRead) { await page.getByRole('alert').waitFor(); await button('重新读取').click(); }
  await page.locator('.weakness-materials strong').getByText(new RegExp('^' + subject)).waitFor();
}
async function screenshot(name, width) {
  await page.setViewportSize({ width, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Page overflow at ${width}`);
  const geometry = await page.locator('.ability-radar').evaluate(node => ({ width: node.getBoundingClientRect().width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
  assert.ok(geometry.scrollWidth <= geometry.clientWidth); layouts.push({ viewportWidth: width, ...geometry });
  await page.screenshot({ path: resolve(output, `${name}-${width}.png`), fullPage: true });
}
async function leaveLearning() {
  for (let i = 0; i < 4 && await page.locator('.learning-hub').count(); i++) await button('返回学习列表或首页').click();
  await nav('题目').waitFor();
}
async function startMathPractice(fixture) {
  await nav('题目').click(); await libraryTabs().getByRole('button', { name: '错题本', exact: true }).click();
  await page.getByRole('navigation', { name: '按科目筛选错题' }).getByRole('button', { name: '数学', exact: true }).click();
  await page.getByRole('article', { name: `第 ${fixture.number} 题`, exact: true }).getByRole('button', { name: '举一反三', exact: true }).click();
  const created = page.waitForResponse(response => response.url() === api + '/learning-sessions' && response.request().method() === 'POST');
  await button('生成3道变式').click(); const session = (await (await created).json()).session;
  assert.equal(session.source.scanId, fixture.scan.id);
  await page.waitForFunction(() => document.querySelectorAll('.learning-task').length === 3, null, { timeout: 90000 });
  await page.locator('.learning-job').waitFor({ state: 'detached', timeout: 90000 });
  return session.id;
}
async function submitMath(index, correct = true) {
  const task = page.locator('.learning-task').nth(index), prompt = await task.locator('.paper-prompt').textContent();
  const dimensions = /长 (\d+) 厘米，宽 (\d+) 厘米/.exec(prompt); assert.ok(dimensions, 'Synthetic mathematics fixture must preserve a solvable complete prompt');
  const answer = correct ? `面积=${dimensions[1]}×${dimensions[2]}=${Number(dimensions[1]) * Number(dimensions[2])} 平方厘米` : '我计算的面积=0 平方厘米';
  await task.getByLabel('我的答案与步骤').fill(answer);
  const submitted = page.waitForResponse(response => /\/learning-sessions\/[^/]+\/attempt$/.test(new URL(response.url()).pathname));
  await task.getByRole('button', { name: '提交作答', exact: true }).click(); await submitted;
  await task.locator('.learning-attempts details').first().getByText(answer, { exact: true }).waitFor();
  await page.locator('.learning-job').waitFor({ state: 'detached', timeout: 90000 });
  return answer;
}
async function updateGraph() {
  await button('更新分析').click();
  await page.waitForFunction(() => !!document.querySelector('.weakness-summary') && !document.querySelector('.weakness-job, .weakness-stale'), null, { timeout: 90000 });
}
const fixtures = [
  { number: '1', subject: '数学', prompt: '一个长方形长 8 厘米，宽 3 厘米。求它的周长和面积，并写出数量关系。', knowledge: ['长方形周长与面积'] },
  { number: '2', subject: '数学', prompt: '一个长方形的周长是 30 厘米，宽是 5 厘米。求它的长和面积，说明计算步骤。', knowledge: ['长方形周长与面积'] },
  { number: '3', subject: '物理', prompt: '物体以 2 m/s 匀速运动 3 s，求它通过的路程，并写出计算步骤。', knowledge: ['匀速运动'] },
];
try {
  const login = await request('/session/login', 'POST', { username: config.username, password: config.password }); headers = { Authorization: 'Bearer ' + login.token };
  const student = (await request('/students', 'POST', { name: '能力图谱合成验收A', grade: '初二' })).student;
  const other = (await request('/students', 'POST', { name: '能力图谱隔离学生B', grade: '高一' })).student;
  // Original photos and unconfirmed questions enter through public HTTP routes.
  // The browser then confirms each source and collects it, just as a user does.
  for (const fixture of fixtures) {
    const data = await page.evaluate(({ prompt, number, subject }) => {
      const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 1200;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 900, 1200);
      ctx.fillStyle = '#17212f'; ctx.font = '34px sans-serif'; ctx.fillText(`合成验收 ${subject} · 第 ${number} 题`, 80, 125);
      ctx.font = '30px sans-serif'; Array.from({ length: Math.ceil(prompt.length / 23) }, (_, i) => prompt.slice(i * 23, (i + 1) * 23)).forEach((line, i) => ctx.fillText(line, 80, 200 + i * 55));
      if (subject === '数学') { ctx.strokeStyle = '#243c5a'; ctx.lineWidth = 3; ctx.strokeRect(200, 365, 420, 145); }
      return canvas.toDataURL('image/jpeg', .96).split(',')[1];
    }, fixture);
    const bytes = Buffer.from(data, 'base64'), name = `能力图谱-${fixture.subject}-${fixture.number}.jpg`; writeFileSync(resolve(output, name), bytes);
    const form = new FormData(); form.set('file', new Blob([bytes], { type: 'image/jpeg' }), name);
    form.set('studentId', student.id); form.set('subject', fixture.subject); form.set('source', '隔离合成能力图谱验收'); form.set('clientRequestId', randomUUID());
    const uploaded = (await request('/scans', 'POST', form)).scan;
    const question = { id: randomUUID(), number: fixture.number, prompt: fixture.prompt, diagram: '', subject: fixture.subject, knowledgePoints: fixture.knowledge,
      regions: [{ id: randomUUID(), kind: 'stem', x: .06, y: .07, width: .88, height: .4 }], answerSteps: [], uncertainties: [], confirmed: false };
    fixture.scan = (await request(`/scans/${uploaded.id}/review`, 'PUT', { revision: uploaded.revision, questions: [question] })).scan;
  }
  await page.goto(client); await logIn(student);
  for (const fixture of fixtures) {
    await nav('首页').click(); await page.getByRole('navigation', { name: '资料管理' }).getByRole('button', { name: /^原题照片/ }).click();
    await page.getByRole('button', { name: new RegExp(`能力图谱-${fixture.subject}-${fixture.number}\\.jpg`) }).click();
    await page.getByRole('region', { name: '当前题目原题' }).getByRole('img', { name: '原题题干与配图', exact: true }).waitFor();
    await page.getByLabel('题干与题框已核对').check();
    await button('保存校对').click(); await page.getByText('已保存题目框和手写步骤', { exact: true }).waitFor();
    const saved = page.waitForResponse(response => response.url().endsWith('/wrong-book') && response.request().method() === 'POST');
    await button('只存错题本').click(); fixture.scan = (await (await saved).json()).scan;
    assert.equal(fixture.scan.questions[0].confirmed, true); assert.ok(fixture.scan.questions[0].wrongBook);
    await button('返回资料列表').click();
  }
  checks.push('Three distinct photos uploaded through HTTP; two mathematics and one physics questions individually confirmed and collected through the UI');
  await nav('首页').click(); await nav('题目').click(); await libraryTabs().getByRole('button', { name: '错题本', exact: true }).click();
  const filters = page.getByRole('navigation', { name: '按科目筛选错题' });
  assert.deepEqual(await filters.getByRole('button').allTextContents(), ['全部', '数学', '语文', '英语', '地理', '物理', '化学', '生物']);
  const displayedPrompts = () => page.locator('.wrong-book .paper-prompt').allTextContents();
  assert.deepEqual(await displayedPrompts(), [...fixtures].reverse().map(f => f.prompt));
  await filters.getByRole('button', { name: '数学', exact: true }).click(); assert.deepEqual(await displayedPrompts(), [fixtures[1].prompt, fixtures[0].prompt]);
  await page.getByLabel('错题排序').selectOption('oldest'); assert.deepEqual(await displayedPrompts(), fixtures.slice(0, 2).map(f => f.prompt));
  await filters.getByRole('button', { name: '全部', exact: true }).click(); assert.deepEqual(await displayedPrompts(), fixtures.map(f => f.prompt));
  await filters.getByRole('button', { name: '物理', exact: true }).click(); assert.deepEqual(await displayedPrompts(), [fixtures[2].prompt]);
  checks.push('Seven supported subjects plus All retain upload ordering; subject filtering and oldest/newest sorting do not reshuffle unrelated items');
  await openGraph();
  await page.getByText('数学 · 2 道错题', { exact: true }).waitFor();
  const initial = await request(`/weakness-reports?studentId=${student.id}&subject=${encodeURIComponent('数学')}`);
  assert.equal(initial.materials.eligible, 2); assert.equal(initial.report, undefined); assert.equal(initial.axes.length, 6);
  assert.ok(initial.axes.every(axis => axis.score === null && axis.evidenceCount === 0));
  await button('分析多道错题').click(); await page.getByRole('alert').waitFor();
  await button('分析多道错题').click(); await page.locator('.weakness-summary').waitFor({ timeout: 90000 });
  assert.equal(creates.length, 2); assert.equal(creates[0].request.requestId, creates[1].request.requestId); assert.equal(creates[0].reportId, creates[1].reportId);
  const first = (await request(`/weakness-reports/${creates[0].reportId}`)).report;
  assert.equal(first.status, 'ready'); assert.equal(first.subject, '数学'); assert.equal(first.coverage.selected, 2);
  assert.deepEqual(new Set(first.sources.map(source => source.scanId)), new Set(fixtures.slice(0, 2).map(f => f.scan.id)));
  assert.ok(first.result.axes.every(axis => axis.subject === '数学' && axis.score === null && axis.evidenceCount === 0));
  assert.equal(await page.locator('[data-ability-point], [data-ability-shape]').count(), 0);
  assert.equal(await page.locator('.ability-radar-choice').count(), 6);
  checks.push('Lost creation receipt retries the same request/report; worker returns two real source references, while all six scores remain null without independent practice evidence');
  await page.getByRole('group', { name: '选择能力维度' }).getByRole('button', { name: /^概念理解，/ }).click();
  assert.equal(await page.locator('.ability-radar-detail strong').textContent(), '概念理解');
  await page.locator('.ability-radar-axis-label[data-axis-id="modeling"]').tap();
  assert.equal(await page.locator('.ability-radar-detail strong').textContent(), '建模应用');
  await page.locator('.weakness-evidence > summary').first().click();
  const evidence = page.locator('.weakness-focus .weakness-evidence');
  assert.equal(await evidence.getByRole('button', { name: '回看原题', exact: true }).count(), 2);
  for (const fixture of fixtures.slice(0, 2)) await evidence.getByText(fixture.prompt, { exact: true }).waitFor();
  for (const width of [320, 390, 768]) await screenshot('ability-two-sources', width);
  await page.setViewportSize({ width: 390, height: 844 });
  const chosenSource = first.sources.find(source => source.id === first.result.focuses[0].evidence[0].sourceId);
  await evidence.getByRole('button', { name: '回看原题', exact: true }).first().click();
  assert.equal(await page.getByRole('region', { name: '当前题目原题' }).locator('.paper-prompt').textContent(), chosenSource.prompt);
  await button('返回资料列表').click(); await page.locator('.weakness-summary').waitFor();
  await page.locator('.weakness-evidence > summary').first().click();
  await page.locator('.weakness-evidence-actions').first().getByRole('button', { name: '针对这题练习', exact: true }).click();
  await page.locator('.learning-start').waitFor();
  assert.equal(await page.locator('.learning-start .paper-prompt').textContent(), chosenSource.prompt);
  assert.equal(await button('生成3道变式').isEnabled(), true);
  for (let i = 0; i < 3 && await page.locator('.learning-hub').count(); i++) await button('返回学习列表或首页').click();
  checks.push('Radar label touch and accessible buttons select dimensions; two evidence links open their exact original and the practice entry carries the same question');
  await openGraph(); await page.locator('.weakness-summary').waitFor();
  await page.locator('.weakness-evidence > summary').first().click();
  await page.locator('.weakness-evidence-actions').first().getByRole('button', { name: '回看原题', exact: true }).click();
  await page.locator('.manual-review > summary').click();
  const revisedPrompt = chosenSource.prompt + '（已再次核对题目单位。）';
  await page.getByLabel('完整题干', { exact: true }).fill(revisedPrompt); await page.getByLabel('题干与题框已核对').check();
  await button('保存校对').click(); await page.getByText('已保存题目框和手写步骤', { exact: true }).waitFor(); await button('返回资料列表').click();
  await page.locator('.weakness-stale').waitFor();
  await page.locator('.weakness-evidence > summary').first().click();
  assert.equal(await page.locator('.weakness-evidence-actions').getByRole('button', { name: '针对这题练习', exact: true }).first().isDisabled(), true);
  assert.equal((await request(`/weakness-reports/${first.id}`)).report.stale, true);
  await updateGraph();
  const updated = (await request(`/weakness-reports?studentId=${student.id}&subject=${encodeURIComponent('数学')}`)).report;
  assert.equal(updated.status, 'ready'); assert.notEqual(updated.id, first.id); assert.equal(updated.stale, false);
  assert.ok(updated.sources.some(source => source.prompt === revisedPrompt)); assert.ok(updated.result.axes.every(axis => axis.score === null));
  checks.push('Editing confirmed source marks the old graph stale and disables old practice advice; Update creates a new snapshot with the revised source and retains honest unassessed scores');

  const practiceA = await startMathPractice(fixtures[0]);
  await submitMath(0); await submitMath(1, false); await leaveLearning();
  const practiceB = await startMathPractice(fixtures[1]);
  await submitMath(0); await leaveLearning();
  await openGraph(); await page.locator('.weakness-stale').waitFor(); await updateGraph();
  const assessed = (await request(`/weakness-reports?studentId=${student.id}&subject=${encodeURIComponent('数学')}`)).report;
  const axis = assessed.result.axes.find(item => item.id === 'modeling');
  assert.equal(axis.score, 75); assert.equal(axis.evidenceCount, 3); assert.equal(axis.sourceCount, 2); assert.equal(axis.confidence, 'limited');
  assert.ok(axis.evidence.every(item => item.helped === false && item.mode === 'practice'));
  assert.deepEqual(new Set(axis.evidence.map(item => item.sessionId)), new Set([practiceA, practiceB]));
  assert.equal(new Set(axis.evidence.map(item => item.prompt)).size, 3);
  assert.ok(assessed.result.axes.filter(item => item.id !== 'modeling').every(item => item.score === null));
  assert.equal(await page.locator('[data-ability-point]').count(), 1);
  assert.equal(await page.locator('[data-ability-point="modeling"]').getAttribute('data-score'), '75');
  assert.equal(await page.locator('[data-ability-shape]').count(), 0, 'Missing axes cannot create a filled ability polygon');
  for (const width of [320, 390, 768]) await screenshot('ability-independent-score', width);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.ability-performance > summary').click();
  const evidenceIndex = axis.evidence.findIndex(item => item.sessionId === practiceB);
  await page.locator('.ability-performance').getByRole('button', { name: '查看作答与复测', exact: true }).nth(evidenceIndex).click();
  await page.waitForFunction(() => document.querySelectorAll('.learning-task').length === 3);
  const sessionB = (await request(`/learning-sessions/${practiceB}`)).session;
  assert.equal(await page.locator('.learning-task .paper-prompt').first().textContent(), sessionB.tasks[0].prompt);
  assert.equal((await request(`/learning-sessions?studentId=${student.id}`)).sessions.length, 2, 'Evidence navigation must reuse the original learning session');
  await page.locator('.learning-task').nth(1).getByRole('button', { name: /给我一点提示/ }).click();
  await page.locator('.learning-task').nth(1).locator('.learning-hints').waitFor();
  const hintedAnswer = await submitMath(1); await leaveLearning();
  const hinted = (await request(`/learning-sessions/${practiceB}`)).session.tasks[1].attempts[0];
  assert.equal(hinted.helped, true); assert.equal(hinted.feedback.verdict, 'correct'); assert.equal(hinted.answer, hintedAnswer);
  await openGraph(); await page.locator('.weakness-stale').waitFor(); await updateGraph();
  const finalReport = (await request(`/weakness-reports?studentId=${student.id}&subject=${encodeURIComponent('数学')}`)).report;
  const unchangedAxis = finalReport.result.axes.find(item => item.id === 'modeling');
  assert.equal(unchangedAxis.score, 75); assert.equal(unchangedAxis.evidenceCount, 3);
  assert.ok(!unchangedAxis.evidence.some(item => item.attemptId === hinted.id));
  assert.ok(finalReport.result.axes.filter(item => item.id !== 'modeling').every(item => item.score === null));
  checks.push('Two real practice sessions yield three distinct independent answers across two sources; balanced score is 75 only on the grounded modeling dimension. A correct hinted answer is excluded and cannot raise the score; the evidence link reopens the exact session');

  await graphSubjects().getByRole('button', { name: '物理', exact: true }).click();
  await page.getByText('物理 · 1 道错题', { exact: true }).waitFor(); assert.equal(await button('分析多道错题').isDisabled(), true);
  assert.equal(await page.locator('.weakness-focus').count(), 0); assert.equal((await request(`/weakness-reports?studentId=${student.id}&subject=${encodeURIComponent('物理')}`)).report, undefined);
  await graphSubjects().getByRole('button', { name: '数学', exact: true }).click(); await page.locator('.weakness-summary').waitFor();
  await page.reload(); await logIn(student); failOverviewRead = true; await openGraph('数学', true); await page.locator('.weakness-summary').waitFor();
  assert.equal(readFailures, 1); assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal((await request(`/weakness-reports?studentId=${student.id}&subject=${encodeURIComponent('数学')}`)).report.id, finalReport.id);
  await page.getByLabel('当前学生').selectOption(other.id);
  await page.getByText('数学 · 0 道错题', { exact: true }).waitFor(); assert.equal(await page.locator('.weakness-focus, .weakness-summary').count(), 0);
  assert.equal(await button('分析多道错题').isDisabled(), true); assert.equal(await page.locator('[data-ability-point]').count(), 0);
  checks.push('Physics cannot inherit mathematics analysis; refreshed graph survives a failed read and explicit retry, while another student has zero sources, no report and no invented scores');
  assert.equal(externalRequests, 0); assert.deepEqual(errors, []);
  const result = { checkedAt: new Date().toISOString(), syntheticOnly: true, actualIsolatedBackend: true, syntheticWorkerModel: true, realModelCalls: 0, nativeDeviceTested: false,
    sourcePhotos: 3, confirmedMathQuestions: 2, physicsQuestions: 1, lostCreateReceipts: Number(lostReceipt), createAttempts: creates.length, uniqueCreatedReports: new Set(creates.map(item => item.reportId)).size,
    sourceEvidenceCount: first.result.focuses[0].evidence.length, unassessedAxes: first.result.axes.length, scoredDimension: 'modeling', independentScore: unchangedAxis.score,
    independentAnswers: unchangedAxis.evidenceCount, independentSourceQuestions: unchangedAxis.sourceCount, hintedAnswerExcluded: true,
    readFailuresRecovered: readFailures, checks, layouts, externalRequests, errors };
  writeFileSync(resolve(output, 'ability-flow.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ errors, body: (await page.locator('body').innerText()).slice(-7000) })); throw error;
} finally { await browser.close(); await vite.close(); }
