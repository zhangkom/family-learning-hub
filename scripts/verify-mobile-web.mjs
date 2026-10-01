import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || 'playwright',
);
mkdirSync('work', { recursive: true });
mkdirSync('outputs/mobile-backend', { recursive: true });
const directory = mkdtempSync(resolve('work/mobile-web-test-'));
const port = process.env.FAMILY_MOBILE_WEB_TEST_PORT || '3286';
const origin = `http://127.0.0.1:${port}`,
  base = origin + '/family-learning';
const setupToken = randomBytes(32).toString('hex'),
  password = randomBytes(20).toString('hex');
const server = spawn(process.execPath, ['dist/standalone/server.js'], {
  windowsHide: true,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: port,
    NODE_ENV: 'production',
    FAMILY_DATA_DIR: directory,
    FAMILY_SETUP_TOKEN: setupToken,
    FAMILY_PUBLIC_ORIGIN: origin,
    FAMILY_AI_API_KEY: '',
    OPENAI_API_KEY: '',
    FAMILY_MOBILE_ORIGINS: 'https://localhost,http://127.0.0.1:3178',
  },
});
let output = '',
  browser,
  page;
server.stdout.on('data', (chunk) => {
  output += chunk;
});
server.stderr.on('data', (chunk) => {
  output += chunk;
});
try {
  for (let i = 0; i < 50; i++) {
    if (server.exitCode !== null) throw new Error('Test server failed');
    try {
      if ((await fetch(base + '/api/family/session')).ok) break;
    } catch {
      /* starting */
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  const setup = await fetch(base + '/api/family/setup', {
    method: 'POST',
    headers: { Origin: origin },
    body: JSON.stringify({ username: 'webtest', password, setupToken }),
  });
  assert.equal(setup.status, 200);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/account');
  await page.getByLabel('家庭账号', { exact: true }).fill('webtest');
  await page.getByLabel('密码（至少 12 位）', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '已登录：webtest' }).waitFor();
  await page.goto(base + '/students');
  await page.addStyleTag({
    content: 'html { scroll-behavior: auto !important; }',
  });
  await page.getByLabel('当前学生', { exact: true }).selectOption('dabao');
  await page.getByLabel('学生姓名', { exact: true }).fill('合成第三学生');
  await page.getByLabel('年级（可选）', { exact: true }).fill('初一');
  await page.getByRole('button', { name: '添加学生', exact: true }).click();
  await page
    .getByRole('button', { name: '保存到合成第三学生的资料' })
    .waitFor();
  const fixture = await context.newPage();
  await fixture.setViewportSize({ width: 900, height: 650 });
  await fixture.setContent(
    '<main style="padding:60px;font:28px serif;background:white;color:#172a35"><h2>合成练习资料</h2><p>1. 计算 2 + 3 = ?</p><p style="color:#2563eb;font-style:italic;padding-left:40px">2 + 3 = 6</p><hr><p>2. 已知 x + 4 = 9，求 x。</p><p style="color:#2563eb;font-style:italic;padding-left:40px">x = 9 − 4 = 5</p></main>',
  );
  const image = resolve('outputs/mobile-backend/synthetic-sheet.png');
  await fixture.screenshot({ path: image });
  await fixture.close();
  await page.locator('input[name="source"]').fill('后台网页合成验证');
  await page.locator('input[name="file"]').setInputFiles(image);
  await page.getByRole('button', { name: '保存到合成第三学生的资料' }).click();
  await page
    .getByRole('heading', { name: '合成第三学生 · 后台网页合成验证' })
    .waitFor();
  await page.getByRole('button', { name: '增加一道题', exact: true }).click();
  await page.getByLabel('题干与条件', { exact: true }).fill('计算 2+3=?');
  const synced = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/family/sync') && response.status() === 200,
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await synced;
  assert.equal(
    await page.getByLabel('题干与条件', { exact: true }).inputValue(),
    '计算 2+3=?',
  );
  await page.getByRole('button', { name: '增加可见步骤', exact: true }).click();
  await page.getByLabel('步骤1转写', { exact: true }).fill('2+3=6');
  await page.getByLabel('步骤1作者', { exact: true }).selectOption('student');
  await page.getByLabel('区域类型', { exact: true }).selectOption('answer');
  const editor = page.locator('svg[aria-label="原图区域编辑器"]');
  await editor.scrollIntoViewIfNeeded();
  const box = await editor.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width * 0.16, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.52, {
    steps: 8,
  });
  await page.mouse.up();
  await page
    .getByText('本题区域与共享配图（1 个框）', { exact: true })
    .waitFor();
  await page.getByLabel('作答框 1', { exact: true }).check();
  await page
    .getByLabel('本题内容与笔迹归属已经人工校对', { exact: true })
    .check();
  await page.getByRole('button', { name: '保存校对', exact: true }).click();
  await page
    .getByText('校对已保存，原图和先前修订仍保留。', { exact: true })
    .waitFor();
  await page.screenshot({
    path: 'outputs/mobile-backend/desktop-review.png',
    fullPage: true,
  });
  const selected = await page
    .getByLabel('当前学生', { exact: true })
    .inputValue();
  const login = await fetch(base + '/api/mobile/v1/session/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'webtest', password }),
  });
  const token = (await login.json()).token;
  const list = await fetch(
    base + '/api/mobile/v1/scans?studentId=' + selected,
    { headers: { Authorization: 'Bearer ' + token } },
  );
  const scan = (await list.json()).scans[0];
  assert.equal(scan.studentId, selected);
  assert.equal(scan.status, 'ready');
  assert.equal(scan.questions[0].answerSteps[0].text, '2+3=6');
  assert.equal(scan.questions[0].regions.length, 1);
  assert.equal(scan.questions[0].answerSteps[0].regionIds.length, 1);
  await page.getByLabel('当前学生', { exact: true }).selectOption('xiaobao');
  await page
    .getByText('还没有资料，上传原件后即可开始校对。', { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole('heading', { name: '合成第三学生 · 后台网页合成验证' })
      .count(),
    0,
  );
  await page.getByLabel('当前学生', { exact: true }).selectOption(selected);
  await page
    .getByRole('button', { name: '后台网页合成验证 · 已校对', exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: 'outputs/mobile-backend/mobile-review.png',
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: cookie login, third student, original upload, visible-step transcription, rectangle linkage, save/reopen, Bearer reads, student isolation and mobile layout.',
  );
  writeFileSync(
    resolve(directory, 'verification.json'),
    JSON.stringify(
      {
        success: true,
        syntheticOnly: true,
        studentId: selected,
        scanId: scan.id,
        assertions: 12,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await page
    ?.screenshot({ path: 'outputs/mobile-backend/failure.png', fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server.kill();
  writeFileSync(resolve(directory, 'server.log'), output);
}
