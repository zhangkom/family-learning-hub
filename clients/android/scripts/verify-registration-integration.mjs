import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const connectionPath = process.env.FAMILY_DEV_CONNECTION_PATH;
if (!connectionPath) throw new Error('An isolated synthetic server connection file is required');
const config = JSON.parse(readFileSync(connectionPath, 'utf8'));
assert.equal(config.syntheticOnly, true);
assert.equal(config.aiEnabled, false);
assert.equal(new URL(config.apiBase).hostname, '127.0.0.1');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const client = process.env.CLIENT_URL || 'http://127.0.0.1:3178';
assert.equal(new URL(client).hostname, '127.0.0.1');
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const password = '123456', nextPassword = '654321', stamp = Date.now(), credentials = [], errors = [];
let stage = 'check registration availability';
try {
  const availability = await fetch(`${config.apiBase}/setup`);
  assert.equal(availability.status, 200);
  assert.equal((await availability.json()).registrationEnabled, true);
  for (let i = 0; i < 2; i++) {
    stage = `register isolated synthetic family ${i + 1}`;
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (error) => errors.push(error.message));
    let extraLoginRequests = 0;
    page.on('request', (request) => { if (request.url() === `${config.apiBase}/session/login`) extraLoginRequests++; });
    await page.goto(client);
    await page.getByRole('navigation', { name: '账户' }).getByRole('button', { name: '注册', exact: true }).click();
    await page.getByLabel('家庭服务地址').fill(config.apiBase);
    let username = `guest_${stamp}_${i}`;
    await page.getByLabel('账号', { exact: true }).fill(username);
    await page.getByLabel('密码', { exact: true }).fill(password);
    assert.equal(await page.getByLabel('家庭启用码', { exact: true }).count(), 0);
    const registered = page.waitForResponse((response) => response.url() === `${config.apiBase}/session/register` && response.request().method() === 'POST');
    await page.getByRole('button', { name: '注册', exact: true }).click();
    const response = await registered;
    assert.equal(response.status(), 200);
    assert.equal((await response.allHeaders())['set-cookie'], undefined);
    assert.deepEqual(Object.keys(response.request().postDataJSON()).sort(), ['password', 'username']);
    const login = await response.json();
    credentials.push({ username, token: login.token, userId: login.user.id });
    await page.getByRole('button', { name: '添加第一名学生', exact: true }).waitFor();
    assert.equal(extraLoginRequests, 0);
    assert.equal((await page.evaluate(() => JSON.stringify(localStorage))).includes(password), false);
    assert.equal(await page.getByLabel('当前学生').count(), 0);
    await page.getByRole('button', { name: '添加第一名学生', exact: true }).click();
    await page.getByLabel('学生昵称').fill(`独立家庭孩子${i + 1}`);
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await page.getByLabel('当前学生').waitFor();
    assert.equal(await page.getByLabel('当前学生').locator('option').count(), 1);
    assert.equal(await page.getByLabel('当前学生').locator('option:checked').textContent(), `独立家庭孩子${i + 1}`);
    const studentId = await page.getByLabel('当前学生').inputValue();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '批量错题上传', exact: true }).click();
    await (await chooser).setFiles({ name: `合成账号资料${i}.png`, mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
    await page.getByRole('button', { name: '完成选择，查看待上传', exact: true }).click();
    const uploaded = page.waitForResponse((response) => response.url() === `${config.apiBase}/scans` && response.request().method() === 'POST');
    await page.getByRole('button', { name: '确认并上传', exact: true }).click();
    const uploadResponse = await uploaded;
    assert.equal(uploadResponse.status(), 201);
    const scanId = (await uploadResponse.json()).scan.id;
    credentials[i].scanId = scanId;
    credentials[i].studentId = studentId;
    await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '我的', exact: true }).click();
    stage = `change credentials for synthetic family ${i + 1}`;
    for (const kind of ['username', 'password']) {
      const oldToken = credentials[i].token;
      const label = kind === 'username' ? '修改用户名' : '修改密码';
      await page.getByRole('button', { name: label, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: label });
      if (kind === 'username') username = `changed_${stamp}_${i}`;
      await dialog.getByLabel(kind === 'username' ? '新用户名' : '新密码', { exact: true }).fill(kind === 'username' ? username : nextPassword);
      await dialog.getByLabel('当前密码', { exact: true }).fill(password);
      const saved = page.waitForResponse((response) => response.url() === `${config.apiBase}/account/${kind}` && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      const savedResponse = await saved;
      assert.equal(savedResponse.status(), 200);
      const changed = await savedResponse.json();
      assert.equal(changed.user.id, credentials[i].userId);
      assert.equal(changed.user.username, username);
      assert.notEqual(changed.token, oldToken);
      credentials[i].token = changed.token; credentials[i].username = username;
      await dialog.getByRole('button', { name: '完成', exact: true }).click();
      const revoked = await fetch(`${config.apiBase}/session`, { headers: { Authorization: `Bearer ${oldToken}` } });
      assert.equal(revoked.status, 401);
      await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '首页', exact: true }).click();
      assert.equal(await page.getByLabel('当前学生').inputValue(), studentId);
      await page.getByRole('navigation', { name: '资料管理' }).getByRole('button', { name: /^原题照片/ }).click();
      await page.getByRole('button', { name: new RegExp(`合成账号资料${i}`) }).waitFor();
      await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '首页', exact: true }).click();
      await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '我的', exact: true }).click();
    }
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.getByRole('navigation', { name: '账户' }).getByRole('button', { name: '登录', exact: true }).click();
    await page.getByLabel('账号', { exact: true }).fill(username);
    await page.getByLabel('密码', { exact: true }).fill(nextPassword);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByLabel('当前学生').waitFor();
    assert.equal(await page.getByLabel('当前学生').locator('option:checked').textContent(), `独立家庭孩子${i + 1}`);
    await page.close();
  }
  assert.notEqual(credentials[0].userId, credentials[1].userId);
  stage = 'verify changed accounts retain their own saved records';
  for (let i = 0; i < credentials.length; i++) {
    const credential = credentials[i];
    const requestLogin = async (secret) => fetch(`${config.apiBase}/session/login`, { method: 'POST', headers: { Origin: client, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: credential.username, password: secret }) });
    assert.equal((await requestLogin(password)).status, 401);
    const current = await requestLogin(nextPassword); assert.equal(current.status, 200);
    credential.token = (await current.json()).token;
    const headers = { Authorization: `Bearer ${credential.token}` };
    const own = await fetch(`${config.apiBase}/scans/${credential.scanId}`, { headers }); assert.equal(own.status, 200);
    assert.equal((await own.json()).scan.studentId, credential.studentId);
    const foreign = await fetch(`${config.apiBase}/scans/${credentials[1 - i].scanId}`, { headers }); assert.equal(foreign.status, 404);
  }
  stage = 'duplicate account and short-password server validation';
  for (const [body, status] of [[{ username: credentials[0].username, password }, 409], [{ username: `short_${stamp}`, password: '12345' }, 400]]) {
    const response = await fetch(`${config.apiBase}/session/register`, { method: 'POST', headers: { Origin: client, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, status);
  }
  assert.equal((await (await fetch(`${config.apiBase}/setup`)).json()).registrationEnabled, true);
  assert.deepEqual(errors, []);
  mkdirSync('test-results', { recursive: true });
  const report = { passed: true, syntheticOnly: true, aiEnabled: false, productionWrites: 0, checkedAt: new Date().toISOString(),
    checks: ['two ordinary families without setup code', '6-digit password registration and subsequent login', 'direct Bearer login without cookie or second login', 'new families start with zero legacy students', 'per-family student isolation', 'registration remains open after first family', 'server rejects duplicate account and 5-digit password', 'password absent from local settings', 'username and password changed through real UI/API', 'old tokens and passwords rejected', 'stable account/student IDs and uploaded records preserved', 'other family scans remain inaccessible'] };
  writeFileSync('test-results/registration-integration-result.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  let details = error instanceof Error ? error.message : 'Unknown failure';
  for (const secret of [password, nextPassword, config.setupToken, config.password, ...credentials.flatMap((item) => [item.token, item.username])]) if (secret) details = details.replaceAll(secret, '[redacted]');
  console.error(`Synthetic registration integration failed during ${stage}: ${details}`);
  process.exitCode = 1;
} finally { await browser.close(); }
