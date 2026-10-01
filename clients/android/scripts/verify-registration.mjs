import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const client = process.env.PILOT_PREVIEW_URL || 'http://127.0.0.1:3179';
assert.equal(new URL(client).hostname, '127.0.0.1');
const api = 'https://123.207.232.151/family-learning/api/mobile/v1';
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const errors = [];
const password = 'synthetic-password-2026', code = 'synthetic-private-setup-code';
async function scenario(options = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (error) => errors.push(error.message));
  let created = false, setupCalls = 0, statusCalls = 0, loginCalls = 0;
  await page.route('**/*', async (route) => {
    const request = route.request(), url = request.url();
    if (new URL(url).origin === new URL(client).origin) return route.continue();
    if (!url.startsWith(`${api}/`)) return route.abort('blockedbyclient');
    const path = new URL(url).pathname.split('/v1')[1];
    const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/setup') {
      statusCalls++;
      if (options.statusFailure) return route.abort('failed');
      return send({ enabled: true, needsSetup: !created });
    }
    const login = () => ({ token: 'synthetic-new-family-token', user: { id: 'new-family', username: 'family2026' }, expiresAt: Date.now() + 60000 });
    if (path === '/session/setup') {
      setupCalls++;
      assert.equal(request.headers().authorization, undefined);
      assert.equal(request.headers().cookie, undefined);
      assert.equal(request.method(), 'POST');
      const body = request.postDataJSON();
      assert.equal(body.username, 'family2026');
      assert.equal(body.password, password);
      if (options.concurrentCreation) { created = true; return send({ error: '家庭账号已创建，请直接登录', code: 'SETUP_COMPLETE' }, 409); }
      if (body.setupToken !== code) return send({ error: '家庭启用码不正确', code: 'INVALID_SETUP_TOKEN' }, 403);
      assert.equal(created, false);
      created = true;
      return send(login());
    }
    if (path === '/session/login') { loginCalls++; return send(login()); }
    assert.equal(request.headers().authorization, 'Bearer synthetic-new-family-token');
    if (path === '/students') return send({ students: [{ id: 'first-child', name: '测试孩子', createdAt: new Date().toISOString() }] });
    if (path === '/scans') return send({ scans: [], recognition: false });
    errors.push(`Unexpected mocked API request ${path}`);
    return route.abort('blockedbyclient');
  });
  await page.goto(client);
  return { page, counts: () => ({ setupCalls, statusCalls, loginCalls }) };
}
async function fillRegistration(page, token = code, confirmed = password) {
  await page.getByRole('tab', { name: '首次注册家庭账号' }).click();
  await page.getByLabel('家庭启用码', { exact: true }).waitFor();
  await page.getByLabel('家庭启用码', { exact: true }).fill(token);
  await page.getByLabel('家庭账号', { exact: true }).fill('family2026');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码', { exact: true }).fill(confirmed);
}
try {
  const normal = await scenario();
  await normal.page.getByText('还没有账号？点击“首次注册家庭账号”，由家长设置账号和密码。', { exact: true }).waitFor();
  await normal.page.getByRole('tab', { name: '首次注册家庭账号' }).click();
  mkdirSync('test-results', { recursive: true });
  await normal.page.screenshot({ path: 'test-results/registration-empty.png', fullPage: true });
  await fillRegistration(normal.page, 'wrong-synthetic-code', 'different-synthetic-password');
  await normal.page.getByRole('button', { name: '注册并进入家庭学习', exact: true }).click();
  await normal.page.getByText('两次输入的密码不一致，请重新确认。', { exact: true }).waitFor();
  assert.equal(normal.counts().setupCalls, 0);
  await normal.page.getByLabel('确认密码', { exact: true }).fill(password);
  await normal.page.getByRole('button', { name: '注册并进入家庭学习', exact: true }).click();
  await normal.page.getByText('家庭启用码不正确', { exact: true }).waitFor();
  await normal.page.getByLabel('家庭启用码', { exact: true }).fill(code);
  await normal.page.getByRole('button', { name: '注册并进入家庭学习', exact: true }).click();
  await normal.page.getByText('测试孩子 的学习资料', { exact: true }).waitFor();
  assert.equal(normal.counts().setupCalls, 2);
  assert.equal(normal.counts().loginCalls, 0, 'Registration should sign in without an extra login request');
  const savedSettings = await normal.page.evaluate(() => JSON.stringify(localStorage));
  for (const secret of [password, code, 'synthetic-new-family-token']) assert.equal(savedSettings.includes(secret), false);
  assert.equal(await normal.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await normal.page.close();

  const race = await scenario({ concurrentCreation: true });
  await fillRegistration(race.page);
  await race.page.getByRole('button', { name: '注册并进入家庭学习', exact: true }).click();
  await race.page.getByRole('heading', { name: '登录家庭账号', exact: true }).waitFor();
  await race.page.getByText('家庭账号已创建，请使用已有账号登录。', { exact: true }).waitFor();
  assert.equal(await race.page.getByLabel('家庭账号', { exact: true }).inputValue(), 'family2026');
  assert.equal(await race.page.getByLabel('密码', { exact: true }).inputValue(), '');
  await race.page.getByRole('tab', { name: '首次注册家庭账号' }).click();
  await race.page.getByText('当前家庭注册入口已关闭。已有家庭成员请使用家长创建的账号登录；新增家庭需由管理员开通。', { exact: true }).waitFor();
  assert.equal(await race.page.getByRole('button', { name: '注册并进入家庭学习', exact: true }).isDisabled(), true);
  assert.equal(race.counts().setupCalls, 1);
  await race.page.close();

  const offline = await scenario({ statusFailure: true });
  await offline.page.getByRole('tab', { name: '首次注册家庭账号' }).click();
  await offline.page.getByText('暂时无法检查注册状态，已有账号仍可直接登录。', { exact: true }).waitFor();
  assert.equal(await offline.page.getByRole('button', { name: '注册并进入家庭学习', exact: true }).isDisabled(), true);
  await offline.page.getByRole('tab', { name: '已有账号登录' }).click();
  await offline.page.getByLabel('家庭账号', { exact: true }).fill('family2026');
  await offline.page.getByLabel('密码', { exact: true }).fill(password);
  await offline.page.getByRole('button', { name: '进入家庭学习', exact: true }).click();
  await offline.page.getByText('测试孩子 的学习资料', { exact: true }).waitFor();
  assert.equal(offline.counts().setupCalls, 0);
  await offline.page.close();
  assert.deepEqual(errors, []);
  writeFileSync('test-results/registration-result.json', JSON.stringify({ passed: true, syntheticOnly: true, productionRequests: 0, checkedAt: new Date().toISOString(), checks: ['registration entry', 'password confirmation before request', 'wrong setup code recovery', 'registration directly logs in', 'no credential persistence in browser settings', 'concurrent setup conflict returns to login', 'closed setup cannot submit', 'status failure preserves existing-account login'] }, null, 2));
  console.log('Registration UI checks passed; all external requests mocked, no production accounts created.');
} finally { await browser.close(); }
