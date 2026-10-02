import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const connectionPath = process.env.FAMILY_DEV_CONNECTION_PATH;
if (!connectionPath)
  throw new Error(
    'Set FAMILY_DEV_CONNECTION_PATH to an isolated synthetic test server connection file.',
  );
const config = JSON.parse(readFileSync(connectionPath, 'utf8'));
if (
  config.syntheticOnly !== true ||
  config.aiEnabled !== false ||
  new URL(config.apiBase).hostname !== '127.0.0.1'
)
  throw new Error(
    'This script only accepts the isolated loopback test server, with AI disabled.',
  );
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || 'playwright',
);
const output = 'test-results';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const client = process.env.CLIENT_URL || 'http://127.0.0.1:3178';
try {
  const fixture = await browser.newPage({
    viewport: { width: 800, height: 1000 },
  });
  await fixture.setContent(
    '<html lang="zh-CN"><body style="margin:0;padding:60px;background:#fffdf8;font-family:sans-serif"><small>合成测试资料，无真实学生数据</small><h2 style="margin-top:50px">1. 解方程：2(x + 3) = 10</h2><p style="font-size:32px;color:#436184">2x + 3 = 10</p><p style="font-size:32px;color:#436184">x = 3.5</p><h2 style="margin-top:140px">2. 计算：3(2 + 4)</h2></body></html>',
  );
  const png = await fixture.screenshot();
  await fixture.close();
  await page.goto(client);
  await page.getByRole('navigation', { name: '账户' }).getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('家庭服务地址').fill(config.apiBase);
  await page.getByLabel('账号', { exact: true }).fill(config.username);
  await page.getByLabel('密码', { exact: true }).fill(config.password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '我的', exact: true }).click();
  const testName = `联调学生-${Date.now().toString().slice(-6)}`;
  await page.getByRole('button', { name: '添加学生' }).click();
  await page.getByLabel('学生昵称').fill(testName);
  await page.getByLabel('年级（选填）').fill('初一');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByLabel('当前学生').waitFor();
  assert.ok((await page.getByLabel('当前学生').locator('option:checked').textContent()).includes(testName));
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /相册选图/ }).click();
  await (
    await chooser
  ).setFiles({
    name: '真实接口合成作业.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await page.getByRole('button', { name: '完成选择，查看待上传', exact: true }).click();
  await page.getByRole('button', { name: '确认并上传' }).click();
  await page.getByRole('button', { name: /真实接口合成作业/ }).waitFor();
  await page.getByRole('button', { name: /真实接口合成作业/ }).click();
  await page.locator('.paper-surface img').waitFor();
  await page.getByRole('button', { name: '补题', exact: true }).click();
  await page.getByLabel('完整题干').fill('解方程：2(x + 3) = 10');
  await page.getByRole('button', { name: '补一个框', exact: true }).click();
  const surface = await page.locator('.region-overlay').boundingBox();
  await page.mouse.move(
    surface.x + surface.width * 0.06,
    surface.y + surface.height * 0.05,
  );
  await page.mouse.down();
  await page.mouse.move(
    surface.x + surface.width * 0.92,
    surface.y + surface.height * 0.35,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.getByRole('button', { name: '添加步骤' }).click();
  await page.getByLabel('步骤1转写').fill('2x + 3 = 10');
  await page.getByRole('button', { name: '保存校对' }).click();
  await page.getByText('已保存题目框和手写步骤').waitFor();
  await page.getByRole('button', { name: '返回资料列表' }).click();
  await page.getByRole('button', { name: /真实接口合成作业/ }).click();
  await page.getByLabel('步骤1转写').waitFor();
  assert.equal(await page.getByLabel('步骤1转写').inputValue(), '2x + 3 = 10');
  assert.equal(await page.locator('.region-overlay rect').count(), 1);
  await page.getByLabel('步骤1转写').fill('2x + 3 = 10（本机草稿）');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '返回资料列表' }).click();
  await page.getByRole('button', { name: /真实接口合成作业/ }).click();
  await page.getByText('已恢复本机未完成的校对').waitFor();
  assert.equal(
    await page.getByLabel('步骤1转写').inputValue(),
    '2x + 3 = 10（本机草稿）',
  );
  await page.getByRole('button', { name: '保存校对' }).click();
  await page.getByText('已保存题目框和手写步骤').waitFor();
  await page.screenshot({
    path: `${output}/integration-mobile-review.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '返回资料列表' }).click();
  const uploadedStudentId = await page.getByLabel('当前学生').inputValue();
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '添加学生' }).click();
  await page.getByLabel('学生昵称').fill(`隔离学生-${Date.now().toString().slice(-6)}`);
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByLabel('当前学生').waitFor();
  const isolatedStudentId = await page.getByLabel('当前学生').inputValue();
  assert.notEqual(isolatedStudentId, uploadedStudentId);
  await page.getByText('从第一道题开始', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: /真实接口合成作业/ }).count(),
    0,
  );
  await page.getByLabel('当前学生').selectOption(uploadedStudentId);
  await page.getByRole('button', { name: /真实接口合成作业/ }).waitFor();
  await page.getByLabel('当前学生').selectOption(isolatedStudentId);
  await page.getByText('从第一道题开始', { exact: true }).waitFor();
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByRole('button', { name: '登录' }).waitFor();
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    checkedAt: new Date().toISOString(),
    syntheticOnly: true,
    checks: [
      'real Bearer login/logout',
      'new dynamic student',
      'multipart upload',
      'authenticated original image',
      'region and step persistence',
      'local review draft restore',
      'student isolation',
    ],
    aiEvaluated: false,
    nativeCameraEvaluated: false,
  };
  writeFileSync(
    `${output}/integration-result.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
