import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const client = process.env.PILOT_PREVIEW_URL || 'http://127.0.0.1:3179';
assert.equal(new URL(client).hostname, '127.0.0.1');
const api = 'https://123.207.232.151/family-learning/api/mobile/v1';
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const errors = [], geometry = [];
async function scenario(options = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (error) => errors.push(error.message));
  let registerCalls = 0, statusCalls = 0, loginCalls = 0, privateCalls = 0;
  await page.route('**/*', async (route) => {
    const request = route.request(), url = request.url();
    if (new URL(url).origin === new URL(client).origin) return route.continue();
    if (!url.startsWith(`${api}/`)) return route.abort('blockedbyclient');
    const path = new URL(url).pathname.split('/v1')[1];
    const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/setup') {
      statusCalls++;
      if (options.statusFailure) return route.abort('failed');
      return send({ enabled: true, needsSetup: false, registrationEnabled: !options.closed });
    }
    const login = () => ({ token: 'synthetic-new-family-token', user: { id: 'new-family', username: 'family2026' }, expiresAt: Date.now() + 60000 });
    if (path === '/session/register') {
      registerCalls++;
      assert.equal(request.headers().authorization, undefined);
      assert.equal(request.headers().cookie, undefined);
      assert.equal(request.method(), 'POST');
      const body = request.postDataJSON();
      assert.deepEqual(Object.keys(body).sort(), ['password', 'username']);
      assert.equal(body.password, '123456');
      if (options.duplicate && registerCalls === 1) return send({ error: '账号已存在，请登录或换一个账号', code: 'USERNAME_TAKEN' }, 409);
      return send(login());
    }
    if (path === '/session/login') { loginCalls++; return send(login()); }
    privateCalls++;
    assert.equal(request.headers().authorization, 'Bearer synthetic-new-family-token');
    if (path === '/students') return send({ students: [] });
    if (path === '/scans') return send({ scans: [], recognition: false });
    errors.push(`Unexpected mocked API request ${path}`);
    return route.abort('blockedbyclient');
  });
  await page.goto(client);
  await page.getByRole('navigation', { name: '账户' }).waitFor();
  return { page, counts: () => ({ registerCalls, statusCalls, loginCalls, privateCalls }) };
}
async function registerForm(page) {
  await page.getByRole('navigation', { name: '账户' }).getByRole('button', { name: '注册', exact: true }).click();
  await page.getByRole('heading', { name: '注册', exact: true }).waitFor();
  await page.getByLabel('账号', { exact: true }).fill('family2026');
  await page.getByLabel('密码', { exact: true }).fill('123456');
}
try {
  mkdirSync('test-results', { recursive: true });
  const normal = await scenario(), page = normal.page;
  assert.equal(await page.locator('input').count(), 0);
  assert.deepEqual(normal.counts(), { registerCalls: 0, statusCalls: 0, loginCalls: 0, privateCalls: 0 });
  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) {
    await page.setViewportSize(viewport);
    const measured = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
      contentBottom: document.querySelector('.guest-account-hint').getBoundingClientRect().bottom, navTop: document.querySelector('.bottom-nav').getBoundingClientRect().top }));
    geometry.push(measured);
    assert.ok(measured.scrollHeight <= measured.height + 1 && measured.scrollWidth <= measured.width, JSON.stringify(measured));
    assert.ok(measured.contentBottom <= measured.navTop, JSON.stringify(measured));
    await page.screenshot({ path: `test-results/guest-home-${viewport.width}.png`, fullPage: true });
  }
  for (const feature of ['拍照收题', '相册选图', '错题本', '分步辅导', '举一反三', '学习报告']) {
    const button = ['拍照收题', '相册选图'].includes(feature)
      ? page.getByRole('button', { name: new RegExp(feature) })
      : page.getByRole('region', { name: '学习工具' }).getByRole('button', { name: new RegExp(feature) });
    await button.click();
    await page.getByRole('heading', { name: '登录', exact: true }).waitFor();
    assert.ok((await page.locator('.auth-feature-context').textContent()).includes(feature));
    assert.equal(await page.getByLabel('家庭启用码', { exact: true }).count(), 0);
    await page.getByRole('button', { name: '先逛逛', exact: true }).click();
  }
  assert.deepEqual(normal.counts(), { registerCalls: 0, statusCalls: 0, loginCalls: 0, privateCalls: 0 });
  const nav = page.getByRole('navigation', { name: '主要页面' });
  for (const name of ['题目', '我的']) {
    await nav.getByRole('button', { name, exact: true }).click();
    assert.equal(await nav.getByRole('button').count(), 3);
    assert.equal(await nav.locator('[aria-current="page"]').textContent(), name);
    assert.equal(await page.locator('.auth-page').count(), 0);
    const label = name === '题目' ? '登录查看题目' : '登录';
    await page.getByRole('main').getByRole('button', { name: label, exact: true }).click();
    assert.equal(await page.getByRole('navigation', { name: '主要页面' }).count(), 0);
    await page.getByRole('button', { name: `返回${name}`, exact: true }).click();
    assert.equal(await nav.locator('[aria-current="page"]').textContent(), name);
    const size = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      navBottom: document.querySelector('.bottom-nav').getBoundingClientRect().bottom, height: innerHeight }));
    assert.ok(size.width >= size.scrollWidth && size.navBottom <= size.height);
    await page.screenshot({ path: `test-results/guest-${name === '题目' ? 'library' : 'me'}-360.png`, fullPage: true });
  }
  assert.equal(normal.counts().privateCalls, 0);
  await nav.getByRole('button', { name: '首页', exact: true }).click();
  await registerForm(page);
  assert.equal(await page.locator('form input').count(), 2);
  assert.equal(await page.getByLabel('确认密码', { exact: true }).count(), 0);
  await page.getByLabel('密码', { exact: true }).fill('12345');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  assert.equal(normal.counts().registerCalls, 0);
  await page.getByLabel('密码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: '显示密码', exact: true }).click();
  assert.equal(await page.getByLabel('密码', { exact: true }).getAttribute('type'), 'text');
  await page.getByRole('button', { name: '隐藏密码', exact: true }).click();
  await page.screenshot({ path: 'test-results/simple-register.png', fullPage: true });
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByRole('button', { name: '添加第一名学生', exact: true }).waitFor();
  assert.equal(normal.counts().registerCalls, 1);
  assert.equal(normal.counts().loginCalls, 0);
  for (const name of ['题目', '我的', '首页']) {
    await nav.getByRole('button', { name, exact: true }).click();
    assert.equal(await nav.getByRole('button').count(), 3);
    assert.equal(await nav.locator('[aria-current="page"]').textContent(), name);
  }
  assert.equal((await page.evaluate(() => JSON.stringify(localStorage))).includes('123456'), false);
  await page.getByRole('region', { name: '学习工具' }).getByRole('button', { name: /错题本/ }).click();
  await page.getByRole('heading', { name: '题目资料', exact: true }).waitFor();
  await page.getByText('先添加一个学生，再开始收题。', { exact: true }).waitFor();
  await nav.getByRole('button', { name: '首页', exact: true }).click();
  const duplicate = await scenario({ duplicate: true });
  const fromLibrary = await scenario();
  await fromLibrary.page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '题目', exact: true }).click();
  await fromLibrary.page.getByRole('button', { name: '登录查看题目', exact: true }).click();
  await fromLibrary.page.getByLabel('账号', { exact: true }).fill('family2026');
  await fromLibrary.page.getByLabel('密码', { exact: true }).fill('123456');
  await fromLibrary.page.getByRole('button', { name: '登录', exact: true }).click();
  await fromLibrary.page.getByRole('heading', { name: '题目资料', exact: true }).waitFor();
  assert.equal(await fromLibrary.page.locator('.bottom-nav [aria-current="page"]').textContent(), '题目');
  await fromLibrary.page.close();
  await registerForm(duplicate.page);
  await duplicate.page.getByRole('button', { name: '注册', exact: true }).click();
  await duplicate.page.getByRole('alert').getByText('账号已存在，请登录或换一个账号', { exact: true }).waitFor();
  assert.equal(await duplicate.page.getByLabel('账号', { exact: true }).inputValue(), 'family2026');
  await duplicate.page.getByLabel('账号', { exact: true }).fill('another_family');
  await duplicate.page.getByRole('button', { name: '注册', exact: true }).click();
  await duplicate.page.getByRole('button', { name: '添加第一名学生', exact: true }).waitFor();
  for (const options of [{ closed: true }, { statusFailure: true }]) {
    const unavailable = await scenario(options);
    await registerForm(unavailable.page);
    await unavailable.page.getByText(options.closed ? '注册暂未开放，你仍可浏览首页或使用已有账号登录。' : '暂时无法连接注册服务，请稍后重试。', { exact: true }).waitFor();
    assert.equal(await unavailable.page.getByRole('button', { name: '注册', exact: true }).isDisabled(), true);
    await unavailable.page.getByRole('tab', { name: '登录', exact: true }).click();
    await unavailable.page.getByLabel('密码', { exact: true }).fill('existing-long-password');
    await unavailable.page.getByRole('button', { name: '登录', exact: true }).click();
    await unavailable.page.getByRole('button', { name: '添加第一名学生', exact: true }).waitFor();
  }
  assert.deepEqual(errors, []);
  writeFileSync('test-results/registration-verification.json', JSON.stringify({ passed: true, syntheticOnly: true, productionWrites: 0, checkedAt: new Date().toISOString(), geometry,
    checks: ['guest-first home', 'no account data read while browsing', 'all feature entries auth-gated', 'unimplemented features labelled before signup', 'only username/password registration fields', '5 characters rejected and 6 digits accepted', 'direct login on registration', 'no password stored in settings', 'duplicate-name retry', 'existing login works when registration unavailable'] }, null, 2));
  console.log('Guest browsing and simple registration passed with mocked API; no production accounts created.');
} finally { await browser.close(); }
