import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  cpSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || 'playwright',
);
const port = process.env.FAMILY_TEST_PORT || '3197';
const origin = `http://localhost:${port}`;
const base = `${origin}/family-learning`;
mkdirSync('work', { recursive: true });
mkdirSync('outputs/family-qa', { recursive: true });
const dataDir = mkdtempSync(resolve('work/family-test-'));
const setupToken = randomBytes(32).toString('hex');
const password = randomBytes(18).toString('hex');
let serverLog = '';
const server = spawn(process.execPath, ['dist/standalone/server.js'], {
  windowsHide: true,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: port,
    NODE_ENV: 'production',
    FAMILY_DATA_DIR: dataDir,
    FAMILY_SETUP_TOKEN: setupToken,
    FAMILY_PUBLIC_ORIGIN: origin,
    FAMILY_RECOGNITION_ENABLED:
      process.env.FAMILY_TEST_AI === '1' ? 'true' : 'false',
  },
});
server.stdout.on('data', (chunk) => {
  serverLog += chunk;
});
server.stderr.on('data', (chunk) => {
  serverLog += chunk;
});
let browser, restoredServer;
try {
  for (let i = 0; i < 50; i++) {
    if (server.exitCode !== null)
      throw new Error(`Server exited: ${serverLog}`);
    try {
      if ((await fetch(`${base}/api/family/session`)).ok) break;
    } catch {
      /* Start up. */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal((await fetch(`${base}/api/family/sync`)).status, 401);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const a = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const b = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await a.newPage(),
    mobile = await b.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  mobile.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/account`);
  console.log(
    'Session configuration:',
    await (await fetch(`${base}/api/family/session`)).json(),
  );
  await page.screenshot({
    path: 'outputs/family-qa/initial-account.png',
    fullPage: true,
  });
  await page.locator('input[name="setupToken"]').fill(setupToken);
  await page.getByLabel('家庭账号', { exact: true }).fill('family');
  await page.getByLabel('密码（至少 12 位）', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建家庭账号', exact: true }).click();
  await page.getByRole('heading', { name: '已登录：family' }).waitFor();
  await mobile.goto(`${base}/account`);
  await mobile.getByLabel('家庭账号', { exact: true }).fill('family');
  await mobile.getByLabel('密码（至少 12 位）', { exact: true }).fill(password);
  await mobile.getByRole('button', { name: '登录', exact: true }).click();
  await mobile.getByRole('heading', { name: '已登录：family' }).waitFor();
  console.log('PASS private activation and login on two devices');

  await page.goto(`${base}/xiaobao/study?lesson=xb-abs-box`);
  await page.getByRole('radio', { name: 'A. 5a', exact: true }).check();
  await page.getByRole('button', { name: '检查答案', exact: true }).click();
  await page
    .getByRole('status')
    .filter({ hasText: '已同步' })
    .first()
    .waitFor();
  await mobile.goto(`${base}/xiaobao/wrong-book`);
  await mobile.getByText('5a', { exact: true }).first().waitFor();
  console.log('PASS answer from desktop is visible in mobile wrong book');

  await a.setOffline(true);
  await page.getByRole('button', { name: '同类再练', exact: true }).click();
  await page.getByRole('radio', { name: 'C. 6|x|', exact: true }).check();
  await page.getByRole('button', { name: '检查答案', exact: true }).click();
  await a.setOffline(false);
  await page
    .getByRole('status')
    .filter({ hasText: '已同步' })
    .first()
    .waitFor();
  await mobile.goto(`${base}/family-review`);
  await mobile
    .getByRole('heading', { name: '下一次陪学，从哪里开始' })
    .waitFor();
  await mobile
    .getByRole('status')
    .filter({ hasText: '已同步' })
    .first()
    .waitFor();
  await mobile.screenshot({
    path: 'outputs/family-qa/mobile-review.png',
    fullPage: true,
  });
  const state = await mobile.evaluate(
    async (url) =>
      (await (await fetch(`${url}/api/family/sync`)).json()).records,
    base,
  );
  assert.equal(state.xiaobao.attempts.length, 2);
  assert.equal(state.xiaobao.wrong.length, 1);
  console.log(
    'PASS offline answer survives reconnect without replacing first mistake',
  );

  const fixture = await a.newPage();
  await fixture.setViewportSize({ width: 900, height: 500 });
  await fixture.setContent(
    '<html><body style="font:32px Arial;padding:50px;background:white;color:black"><h1>Practice worksheet</h1><p>1. Calculate 2 + 3.</p><p>Student answer: 6</p></body></html>',
  );
  await fixture.screenshot({ path: 'outputs/family-qa/scan-fixture.png' });
  await fixture.close();
  await page.goto(`${base}/scans`);
  await page.getByLabel('出处', { exact: true }).fill('Synthetic QA worksheet');
  await page
    .getByLabel('照片或 PDF（不超过 8 MB）')
    .setInputFiles('outputs/family-qa/scan-fixture.png');
  await page.getByRole('button', { name: '保存扫描原件', exact: true }).click();
  await page.getByRole('link', { name: '新窗口查看原件' }).waitFor();
  if (process.env.FAMILY_TEST_AI === '1') {
    await page.getByRole('button', { name: '自动识题', exact: true }).click();
    await page
      .getByText('识别结果需要逐题核对，确认后再收录错题。', { exact: true })
      .waitFor({ timeout: 115000 });
    assert.match(
      await page.getByLabel('孩子原作答', { exact: true }).inputValue(),
      /6/,
    );
    assert.match(
      await page.getByLabel('参考答案（待核对）', { exact: true }).inputValue(),
      /5/,
    );
    console.log(
      'PASS real DeepSeek image recognition preserves learner answer and supplies reference answer',
    );
  } else {
    await page
      .getByRole('button', { name: '手动增加一道题', exact: true })
      .click();
    await page.getByLabel('完整题干', { exact: true }).fill('Calculate 2 + 3.');
    await page.getByLabel('孩子原作答', { exact: true }).fill('6');
    await page.getByLabel('参考答案（待核对）', { exact: true }).fill('5');
  }
  await page.getByLabel('这道题做错或思路不完整，确认后收入错题本').check();
  await page
    .getByRole('button', { name: '已核对原件，确认收录所选错题', exact: true })
    .click();
  await page
    .getByText('核对已保存，勾选的题目已归入错题本。', { exact: true })
    .waitFor();
  await mobile.goto(`${base}/dabao/wrong-book`);
  await mobile
    .getByRole('link', { name: '查看扫描原件与完整讲解', exact: true })
    .waitFor();
  await mobile
    .getByRole('link', { name: '查看扫描原件与完整讲解', exact: true })
    .click();
  await mobile.getByLabel('孩子原作答', { exact: true }).waitFor();
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    'No mobile horizontal overflow',
  );
  await mobile.screenshot({
    path: 'outputs/family-qa/mobile-scans.png',
    fullPage: true,
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '移到回收站', exact: true }).click();
  await page.getByRole('button', { name: '从回收站恢复', exact: true }).click();
  await page.getByRole('button', { name: '移到回收站', exact: true }).waitFor();
  console.log(
    'PASS scan upload, confirmation, cross-device original access and trash restore',
  );

  await page.goto(`${base}/account`);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出学习备份', exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs('outputs/family-qa/test-backup.json');
  await page
    .getByLabel('选择学习备份文件')
    .setInputFiles('outputs/family-qa/test-backup.json');
  await page.getByRole('button', { name: '确认合并', exact: true }).click();
  await page
    .getByRole('status')
    .filter({ hasText: '已同步' })
    .first()
    .waitFor();
  const merged = await page.evaluate(
    async (url) =>
      (await (await fetch(`${url}/api/family/sync`)).json()).records,
    base,
  );
  assert.equal(merged.xiaobao.attempts.length, 2);
  await page.screenshot({
    path: 'outputs/family-qa/account.png',
    fullPage: true,
  });
  console.log('PASS export/import is idempotent');

  await page.getByRole('button', { name: '退出家庭账号', exact: true }).click();
  await page.getByRole('heading', { name: '家庭登录', exact: true }).waitFor();
  await page.goto(`${base}/xiaobao/wrong-book`);
  await page.getByText('还没有错题', { exact: false }).waitFor();
  assert.equal(
    await page.evaluate(
      async (url) => (await fetch(url)).status,
      `${base}/api/family/sync`,
    ),
    401,
  );
  assert.deepEqual(errors, []);
  console.log('PASS logout hides account data; no uncaught browser errors');
  console.log(
    execFileSync(process.execPath, ['scripts/backup-family.mjs'], {
      env: { ...process.env, FAMILY_DATA_DIR: dataDir },
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
  );
  const snapshot = resolve(
    dataDir,
    'backups',
    readdirSync(resolve(dataDir, 'backups'))
      .filter((x) => x.startsWith('family-'))
      .sort()
      .at(-1),
  );
  const manifest = JSON.parse(
    readFileSync(resolve(snapshot, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.files.length, 3);
  for (const file of manifest.files)
    assert.equal(
      createHash('sha256')
        .update(readFileSync(resolve(snapshot, file.path)))
        .digest('hex'),
      file.sha256,
    );
  const restoredDir = mkdtempSync(resolve('work/family-restore-test-'));
  cpSync(snapshot, restoredDir, { recursive: true });
  const restoreBase = `http://localhost:3198/family-learning`;
  restoredServer = spawn(process.execPath, ['dist/standalone/server.js'], {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '3198',
      NODE_ENV: 'production',
      FAMILY_DATA_DIR: restoredDir,
      FAMILY_PUBLIC_ORIGIN: 'http://localhost:3198',
    },
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${restoreBase}/api/family/session`)).ok) break;
    } catch {
      /* Startup. */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const sessionCookie = (await b.cookies()).find(
    (x) => x.name === 'family_session',
  );
  const headers = { cookie: `family_session=${sessionCookie.value}` };
  const recovered = await (
    await fetch(`${restoreBase}/api/family/sync`, { headers })
  ).json();
  assert.equal(recovered.records.xiaobao.attempts.length, 2);
  assert.equal(recovered.records.dabao.wrong.length, 1);
  const recoveredScans = await (
    await fetch(`${restoreBase}/api/family/scans`, { headers })
  ).json();
  const original = await fetch(
    `${restoreBase}/api/family/scans/${recoveredScans.items[0].id}/file`,
    { headers },
  );
  assert.deepEqual(
    Buffer.from(await original.arrayBuffer()),
    readFileSync('outputs/family-qa/scan-fixture.png'),
  );
  console.log('PASS backup checksums and full restore on a separate server');
  console.log(
    execFileSync(process.execPath, ['scripts/smoke-self-hosted.mjs', origin], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
  );
  console.log(
    execFileSync(process.execPath, ['scripts/test-study-browser.mjs', base], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
  );
  console.log(`Family browser verification complete. Test data: ${dataDir}`);
} finally {
  await browser?.close();
  server.kill();
  restoredServer?.kill();
}
