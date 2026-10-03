import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [origin, directory] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || ''))
  throw new Error('Synthetic loopback verification only');
const fixture = JSON.parse(
  await readFile(resolve(directory, 'fixture.json'), 'utf8'),
);
const output = resolve('work/qa-admin/browser');
await mkdir(output, { recursive: true });
const { chromium } = await import(
  pathToFileURL(
    process.env.PLAYWRIGHT_MODULE_PATH ||
      'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs',
  ).href
);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
    viewport: { width: 1280, height: 950 },
  }),
  page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let client;
try {
  await page.goto(origin + '/family-learning/admin');
  await page.getByLabel('账号', { exact: true }).fill('admin');
  await page.getByLabel('密码', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '请先设置管理员密码' }).waitFor();
  await page.getByLabel('当前密码', { exact: true }).fill(fixture.password);
  const password = 'Synthetic-changed-password-901';
  await page.getByLabel('新密码', { exact: true }).fill(password);
  await page.getByLabel('再输入一次', { exact: true }).fill(password);
  await page.getByRole('button', { name: '保存并重新登录' }).click();
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page
    .getByRole('button', { name: 'test_family_a', exact: false })
    .waitFor();
  const request = async (path, body) =>
    page.evaluate(
      async ({ path, body }) => {
        const r = await fetch('/family-learning/api/admin/' + path, {
          method: body === undefined ? 'GET' : 'POST',
          headers:
            body === undefined ? {} : { 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: r.status, data: await r.json() };
      },
      { path, body },
    );
  assert.equal((await request('overview')).data.users, 2);
  await page
    .getByRole('button', { name: 'test_family_a', exact: false })
    .click();
  await page.getByText('合成学生', { exact: true }).waitFor();
  await page.screenshot({
    path: resolve(output, 'users-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '查看该用户全部题目' }).click();
  await page.getByRole('button', { name: '选中本页' }).click();
  await page.getByText('已选 2 道', { exact: true }).waitFor();
  await page.getByRole('button', { name: '创建复核批次' }).click();
  await page.getByRole('button', { name: '连接电脑 Codex' }).waitFor();
  const listed = (await request('batches')).data,
    batch = (await request('batches/' + listed.items[0].id)).data;
  assert.equal(batch.items.length, 2);
  await page.getByRole('button', { name: '连接电脑 Codex' }).click();
  await page.getByRole('button', { name: '下载电脑复核授权文件' }).waitFor();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '下载电脑复核授权文件' }).click(),
  ]);
  const grantPath = resolve(directory, 'review-grant.json');
  await download.saveAs(grantPath);
  const grant = JSON.parse(await readFile(grantPath, 'utf8'));
  assert.equal(grant.batchId, batch.id);
  client = new Client({ name: 'synthetic-admin-qa', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve('scripts/prism-review-mcp.mjs'), grantPath],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([, v]) => typeof v === 'string'),
        ),
        PRISM_ALLOW_LOCAL_TEST: 'true',
      },
      stderr: 'pipe',
    }),
  );
  const toolList = await client.listTools();
  assert.deepEqual(
    toolList.tools.map((t) => t.name),
    ['get_review_batch', 'get_question', 'submit_review'],
  );
  const listing = await client.callTool({
    name: 'get_review_batch',
    arguments: {},
  });
  assert.equal(JSON.parse(listing.content[0].text).items.length, 2);
  const item = batch.items[0],
    payload = {
      itemId: item.id,
      fingerprint: item.fingerprint,
      model: 'synthetic-test-model',
      summary: '合成复核：修正移项',
      knowledgePoints: ['一元一次方程'],
      result: {
        transcribedPrompt: item.snapshot.question.prompt,
        referenceAnswer: 'x = 1',
        explanation: '两边同时减1，x=2−1=1。代回原式，1+1=2，验证成立。',
        answerEvidence: [],
        errorHypotheses: [],
        uncertainties: [],
      },
    };
  const premature = await client.callTool({
    name: 'submit_review',
    arguments: payload,
  });
  assert.equal(premature.isError, true);
  const question = await client.callTool({
    name: 'get_question',
    arguments: { itemId: item.id },
  });
  assert.ok(
    question.content.some(
      (c) => c.type === 'image' && c.mimeType === 'image/jpeg',
    ),
  );
  assert.equal(question.isError, undefined);
  const saved = await client.callTool({
    name: 'submit_review',
    arguments: payload,
  });
  assert.ok(!saved.isError);
  assert.equal(JSON.parse(saved.content[0].text).status, 'proposed');
  const cliEnv = { ...process.env, PRISM_ALLOW_LOCAL_TEST: 'true' };
  const pulled = JSON.parse(
    execFileSync(
      process.execPath,
      [resolve('scripts/prism-review-cli.mjs'), 'pull', grantPath],
      { encoding: 'utf8', env: cliEnv, windowsHide: true },
    ),
  );
  assert.equal(pulled.count, 2);
  const { itemId, ...body } = payload,
    resultFile = resolve(pulled.directory, 'synthetic-result.json');
  await writeFile(
    resultFile,
    JSON.stringify({ items: [{ id: itemId, ...body, provider: 'codex' }] }),
  );
  const submitted = JSON.parse(
    execFileSync(
      process.execPath,
      [
        resolve('scripts/prism-review-cli.mjs'),
        'submit',
        grantPath,
        resultFile,
      ],
      { encoding: 'utf8', env: cliEnv, windowsHide: true },
    ),
  );
  assert.equal(submitted.saved.length, 1);
  assert.equal(submitted.failed.length, 0);
  await page.getByRole('button', { name: '刷新结果' }).click();
  await page.getByRole('button', { name: '确认并应用到原题' }).waitFor();
  await page.screenshot({
    path: resolve(output, 'review-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '确认并应用到原题' }).click();
  await page.getByRole('button', { name: '回退本次修改' }).waitFor();
  const mobileLogin = await fetch(
    origin + '/family-learning/api/mobile/v1/session/login',
    {
      method: 'POST',
      headers: {
        Origin: 'https://localhost',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'test_family_a',
        password: fixture.password,
      }),
    },
  );
  assert.equal(mobileLogin.status, 200);
  const mobile = await mobileLogin.json();
  const scanResponse = await fetch(
    origin + '/family-learning/api/mobile/v1/scans/' + fixture.scanId,
    {
      headers: {
        Origin: 'https://localhost',
        Authorization: 'Bearer ' + mobile.token,
      },
    },
  );
  const scan = await scanResponse.json();
  assert.equal(scanResponse.status, 200);
  const actual = scan.scan || scan;
  assert.equal(
    actual.questions.find((q) => q.id === item.questionId).tutoring.result
      .referenceAnswer,
    'x = 1',
  );
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      'no overflow at ' + width,
    );
  }
  await page.setViewportSize({ width: 390, height: 850 });
  await page.screenshot({
    path: resolve(output, 'review-mobile.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '回退本次修改' }).click();
  await page.getByText('已回退', { exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭外部复核授权' }).click();
  assert.equal(
    (await client.callTool({ name: 'get_review_batch', arguments: {} }))
      .isError,
    true,
  );
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('test_family_a');
  await page.getByLabel('密码', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByText('当前账号没有平台管理权限', { exact: true }).waitFor();
  assert.equal((await request('accounts')).status, 403);
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, 'verification.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        syntheticOnly: true,
        productionWrites: false,
        realModelCalls: 0,
        checks: [
          'admin initial password rotation, login, exact user totals and profile',
          'ordinary account denied',
          'select questions and download scoped desktop grant',
          'actual MCP SDK client reads protected image and submits proposal',
          'CLI downloads scoped material and submits idempotent proposal',
          'read-image prerequisite enforced',
          'admin applies proposal; existing Android API returns updated answer',
          'safe rollback, closure revokes MCP grant',
          '390/768/1280 no horizontal overflow',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Admin web + actual MCP transport + Android API synthetic flow passed.',
  );
} catch (error) {
  await page.screenshot({
    path: resolve(output, 'failure.png'),
    fullPage: true,
  });
  throw error;
} finally {
  await client?.close();
  await browser.close();
}
