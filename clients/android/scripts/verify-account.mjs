import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const client = process.env.PILOT_PREVIEW_URL || 'http://127.0.0.1:3179';
assert.equal(new URL(client).hostname, '127.0.0.1');
const api = 'https://123.207.232.151/family-learning/api/mobile/v1';
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
const errors = [], requests = [];
let token = 'synthetic-original-token', username = 'family_test', failure = '';
const students = ['a', 'b'].map((id) => ({ id, name: `测试孩子${id}`, createdAt: new Date().toISOString() }));
page.on('pageerror', (error) => errors.push(error.message));
await page.addInitScript(({ api }) => {
  window.androidBridge = {};
  window.accountVault = JSON.stringify({ base: api, token: 'synthetic-original-token' });
  window.Capacitor = {
    PluginHeaders: ['App', 'AppUpdater', 'SessionVault'].map((name) => ({ name, methods: [
      ...['get', 'set', 'clear', 'removeListener'].map((name) => ({ name, rtype: 'promise' })), { name: 'addListener', rtype: 'callback' },
    ] })),
    nativeCallback() { return 'account-test-listener'; },
    async nativePromise(plugin, method, args) {
      if (plugin !== 'SessionVault') return {};
      if (method === 'get') return { value: window.accountVault };
      if (method === 'set') {
        if (window.failVault) throw new Error('Synthetic keystore failure');
        window.accountVault = args.value;
      }
      if (method === 'clear') window.accountVault = '';
      return {};
    },
  };
}, { api });
await page.route('**/*', async (route) => {
  const request = route.request(), url = request.url();
  if (new URL(url).origin === new URL(client).origin) return route.continue();
  if (!url.startsWith(`${api}/`)) return route.abort('blockedbyclient');
  const path = new URL(url).pathname.split('/v1')[1];
  const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  assert.equal(request.headers().authorization, `Bearer ${token}`);
  assert.equal(request.headers().cookie, undefined);
  if (path === '/session') return send({ user: { id: 'stable-family', username } });
  if (path === '/students') return send({ students });
  if (path === '/scans') return send({ scans: [], recognition: false });
  if (path.startsWith('/account/')) {
    requests.push(path);
    assert.equal(request.method(), 'POST');
    const body = request.postDataJSON();
    assert.deepEqual(Object.keys(body).sort(), path.endsWith('username') ? ['currentPassword', 'username'] : ['currentPassword', 'password']);
    if (failure) return send({ error: failure }, failure === '账号已存在' ? 409 : 400);
    if (path.endsWith('username')) username = body.username.toLowerCase();
    token = `synthetic-rotated-${requests.length}`;
    return send({ token, user: { id: 'stable-family', username }, expiresAt: Date.now() + 60000 });
  }
  throw new Error(`Unexpected mock route ${path}`);
});
try {
  mkdirSync('test-results', { recursive: true });
  await page.goto(client);
  await page.getByLabel('当前学生').selectOption('b');
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '修改用户名', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '修改用户名' });
  assert.equal(await dialog.locator('input').count(), 2);
  await dialog.getByLabel('新用户名', { exact: true }).fill('Family_new');
  await dialog.getByLabel('当前密码', { exact: true }).fill('123456');
  for (const message of ['当前密码不正确', '账号已存在']) {
    failure = message;
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.getByRole('alert').getByText(message, { exact: true }).waitFor();
    assert.equal(await page.locator('.auth-page').count(), 0);
  }
  failure = '';
  await dialog.getByRole('button', { name: '显示密码', exact: true }).click();
  assert.equal(await dialog.getByLabel('当前密码', { exact: true }).getAttribute('type'), 'text');
  await page.screenshot({ path: 'test-results/account-username-360.png', fullPage: true });
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.getByText('用户名已修改，其他设备需重新登录。', { exact: true }).waitFor();
  assert.equal(await dialog.locator('input').count(), 0);
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('heading', { name: 'family_new', exact: true }).waitFor();
  assert.equal(JSON.parse(await page.evaluate(() => window.accountVault)).token, token);
  // An in-flight 401 for the revoked token must not sign out the replacement session.
  await page.evaluate(({ api }) => window.dispatchEvent(new CustomEvent('family-learning:session-expired', { detail: { base: api, token: 'synthetic-original-token' } })), { api });
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '题目', exact: true }).click();
  assert.equal(await page.getByLabel('当前学生').inputValue(), 'b');
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '修改密码' });
  await dialog.getByLabel('新密码', { exact: true }).fill('12345');
  await dialog.getByLabel('当前密码', { exact: true }).fill('123456');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal(requests.length, 3);
  await dialog.getByLabel('新密码', { exact: true }).fill('654321');
  await page.screenshot({ path: 'test-results/account-password-360.png', fullPage: true });
  await page.evaluate(() => { window.failVault = true; });
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.getByText(/修改已生效。本次登录仍可使用/).waitFor();
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '题目', exact: true }).click();
  assert.equal(await page.getByLabel('当前学生').inputValue(), 'b');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  assert.ok(!storage.includes('123456') && !storage.includes('654321'));
  assert.deepEqual(errors, []);
  const report = { passed: true, mockedOnly: true, nativeDeviceTested: false, checkedAt: new Date().toISOString(),
    checks: ['two fields per change', 'wrong password/duplicate retry without logout', 'show password', 'six-character minimum',
      'same family and student retained', 'replacement session persisted', 'stale 401 ignored', 'keystore failure reports committed change accurately', 'no stored passwords', '360px layout'] };
  writeFileSync('test-results/account-verification.json', JSON.stringify(report, null, 2));
  console.log('Account UI and simulated vault regression passed; no production writes.');
} finally { await browser.close(); }
