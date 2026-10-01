import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const config = JSON.parse(readFileSync(process.env.FAMILY_DEV_CONNECTION_PATH, 'utf8'));
if (config.syntheticOnly !== true || config.aiEnabled !== false || new URL(config.apiBase).hostname !== '127.0.0.1')
  throw new Error('Use only the isolated loopback synthetic service with real AI disabled.');
const fixture = readFileSync(process.env.FAMILY_CANDIDATE_FIXTURE_PATH);
const hash = (data) => createHash('sha256').update(data).digest('hex');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const client = process.env.CLIENT_URL || 'http://127.0.0.1:3178';
assert.equal(new URL(client).hostname, '127.0.0.1');
const api = config.apiBase;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.setDefaultTimeout(15000);
const errors = [];
let analysisCalls = 0;
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => { if (/\/(recognize|explain)$/.test(request.url())) analysisCalls++; });
await page.route('**/*', (route) => {
  const url = new URL(route.request().url());
  return [new URL(client).origin, new URL(api).origin].includes(url.origin) ? route.continue() : route.abort();
});
async function post(path, data, headers = {}) { return page.request.post(api + path, { data, headers }); }
try {
  const { username, password } = config;
  const login = await post('/session/login', { username, password });
  assert.equal(login.status(), 200);
  const auth = await login.json();
  const headers = { Authorization: 'Bearer ' + auth.token };
  const createdStudent = await post('/students', { name: '候选接口合成学生' }, headers);
  assert.equal(createdStudent.status(), 201);
  const student = (await createdStudent.json()).student;
  const upload = await page.request.post(api + '/scans', { headers, multipart: {
    studentId: student.id, source: '算法合成样例', clientRequestId: crypto.randomUUID(),
    file: { name: '候选接口合成照片.png', mimeType: 'image/png', buffer: fixture },
  } });
  assert.equal(upload.status(), 201);
  const before = (await upload.json()).scan;
  await page.goto(client);
  await page.getByRole('navigation', { name: '账户' }).getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('家庭服务地址').fill(api);
  await page.getByLabel('账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('当前学生').selectOption(student.id);
  await page.getByRole('button', { name: /候选接口合成照片/ }).click();
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/candidate-regions'));
  await page.getByRole('button', { name: '自动找题', exact: true }).click();
  const response = await responsePromise; assert.equal(response.status(), 200);
  const candidates = await response.json();
  assert.equal(candidates.status, 'candidates'); assert.ok(candidates.candidates.length >= 2);
  assert.equal(candidates.revision, before.revision);
  const picker = page.getByRole('region', { name: '核对建议题框' });
  await picker.waitFor();
  const readScan = async () => (await (await page.request.get(api + '/scans/' + before.id, { headers })).json()).scan;
  assert.equal((await readScan()).revision, before.revision);
  assert.deepEqual((await readScan()).questions, []);
  await picker.locator('.candidate-list input').nth(0).check();
  await picker.locator('.candidate-list input').nth(1).check();
  await picker.getByLabel('所选新题的科目（之后可逐题修改）').selectOption('物理');
  await picker.getByRole('button', { name: '采用所选 2 个题框' }).click();
  await page.getByText('已采用 2 个题框，尚未保存到服务器。', { exact: true }).waitFor();
  assert.deepEqual((await readScan()).questions, []);
  await page.getByRole('button', { name: '保存校对', exact: true }).click();
  await page.getByText('已保存题目框和手写步骤', { exact: true }).waitFor();
  let saved = await readScan();
  assert.equal(saved.questions.length, 2); assert.deepEqual(saved.questions.map((q) => q.subject), ['物理', '物理']);
  assert.ok(saved.questions.every((q) => !q.wrongBook && !q.tutoring));
  await picker.getByRole('button', { name: /放弃本轮剩余建议|返回题目校对/ }).click();
  await page.getByRole('button', { name: '只存错题本', exact: true }).click();
  await page.getByText('已存入当前学生的错题本', { exact: true }).waitFor();
  saved = await readScan();
  assert.equal(saved.questions.filter((q) => q.wrongBook).length, 1);
  assert.ok(saved.questions.every((q) => !q.tutoring));
  const original = await page.request.get(api + '/scans/' + before.id + '/file', { headers });
  assert.equal(original.status(), 200); assert.equal(hash(await original.body()), hash(fixture));
  const stale = await post('/scans/' + before.id + '/candidate-regions', { revision: before.revision }, headers);
  assert.equal(stale.status(), 409);
  const other = await post('/session/register', { username: 'candidate_other_' + Date.now().toString(36), password });
  assert.equal(other.status(), 200);
  const foreign = await post('/scans/' + before.id + '/candidate-regions', { revision: saved.revision }, { Authorization: 'Bearer ' + (await other.json()).token });
  assert.equal(foreign.status(), 404);
  await page.getByRole('button', { name: '返回资料列表', exact: true }).click();
  await page.getByRole('button', { name: /候选接口合成照片/ }).click();
  assert.equal(await page.getByLabel('这道题的科目').inputValue(), '物理');
  await page.locator('[data-region-id]').first().waitFor();
  assert.equal(await page.locator('[data-region-id]').count(), 2);
  assert.equal(analysisCalls, 0); assert.deepEqual(errors, []);
  mkdirSync('test-results', { recursive: true });
  const report = { syntheticOnly: true, realLocalBackend: true, realModelCalls: 0, analysisCalls,
    candidateCount: candidates.candidates.length, fixtureSha256: hash(fixture),
    originalPreserved: true, candidateRequestDidNotWrite: true, explicitAdoptionThenSave: true,
    wrongBookOnlyByExplicitAction: true, staleStatus: stale.status(), foreignFamilyStatus: foreign.status(),
    saveAndReopen: true, errors };
  await page.screenshot({ path: 'test-results/candidates-integration.png', fullPage: true });
  writeFileSync('test-results/candidates-integration.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
