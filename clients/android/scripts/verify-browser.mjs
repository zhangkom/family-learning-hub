import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || 'playwright',
);
const base = process.env.CLIENT_URL || 'http://127.0.0.1:3178';
const api = 'http://127.0.0.1:3199/family-learning/api/mobile/v1';
const output = 'test-results';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const students = [
  {
    id: 'dabao',
    name: '大宝（测试）',
    grade: '高二',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'xiaobao',
    name: '小宝（测试）',
    grade: '初一',
    createdAt: new Date().toISOString(),
  },
];
const records = [
  {
    id: 'synthetic-scan',
    studentId: 'dabao',
    subject: '数学',
    source: '合成测试',
    originalName: '分配律练习（合成样例）.png',
    mimeType: 'image/png',
    size: 2000,
    createdAt: new Date().toISOString(),
    revision: 1,
    status: 'needs_review',
    questions: [
      {
        id: 'q1',
        number: '1',
        prompt: '解方程：2(x + 3) = 10',
        diagram: '',
        knowledgePoints: ['分配律'],
        regions: [
          {
            id: 'r1',
            kind: 'stem',
            x: 0.08,
            y: 0.1,
            width: 0.82,
            height: 0.12,
          },
          {
            id: 'r2',
            kind: 'answer',
            x: 0.08,
            y: 0.24,
            width: 0.72,
            height: 0.25,
          },
        ],
        answerSteps: [
          {
            id: 's1',
            order: 0,
            text: '2x + 3 = 10',
            regionIds: ['r2'],
            author: 'student',
            crossedOut: false,
            uncertain: true,
          },
          {
            id: 's2',
            order: 1,
            text: 'x = 3.5',
            regionIds: ['r2'],
            author: 'student',
            crossedOut: false,
            uncertain: false,
          },
        ],
        uncertainties: ['核对第 1 步的常数项是否为 3。'],
        confirmed: false,
      },
      {
        id: 'q2',
        number: '2',
        prompt: '计算：3(2 + 4)',
        diagram: '',
        knowledgePoints: ['分配律'],
        regions: [
          {
            id: 'r3',
            kind: 'stem',
            x: 0.08,
            y: 0.6,
            width: 0.82,
            height: 0.12,
          },
        ],
        answerSteps: [],
        uncertainties: [],
        confirmed: false,
      },
    ],
  },
];
let forceConflict = false,
  uploads = 0;
const fixture = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#fffdf8"/><text x="70" y="60" font-size="20" fill="#888">合成测试资料 · 无真实学生数据</text><text x="80" y="160" font-size="30">1. 解方程：2(x + 3) = 10</text><text x="90" y="300" font-size="37" fill="#3a557d" font-style="italic">2x + 3 = 10</text><text x="100" y="390" font-size="37" fill="#3a557d" font-style="italic">x = 3.5</text><text x="80" y="660" font-size="30">2. 计算：3(2 + 4)</text><path d="M70 500H730M70 780H730M70 860H730" stroke="#eeeee5"/></svg>`;
await page.route(`${api}/**`, async (route) => {
  const req = route.request(),
    url = new URL(req.url()),
    path = url.pathname.split('/v1')[1],
    method = req.method();
  const send = (data, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  if (path === '/setup') return send({ enabled: true, needsSetup: false });
  if (path === '/session/login')
    return send({
      token: 'synthetic-test-token',
      user: { id: 'test-family', username: '测试家庭' },
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
  assert.equal(req.headers().authorization, 'Bearer synthetic-test-token');
  if (path === '/session/logout') return send({ ok: true });
  if (path === '/students' && method === 'GET') return send({ students });
  if (path === '/students') {
    const input = req.postDataJSON();
    const student = {
      id: 'student-3',
      ...input,
      createdAt: new Date().toISOString(),
    };
    students.push(student);
    return send({ student }, 201);
  }
  if (path === '/scans' && method === 'GET')
    return send({
      scans: records.filter(
        (r) => r.studentId === url.searchParams.get('studentId'),
      ),
      recognition: true,
    });
  if (path === '/scans' && method === 'POST') {
    uploads++;
    const body = req.postDataBuffer().toString();
    assert.match(body, /dabao/);
    return send({ scan: records[0] }, 201);
  }
  if (path.endsWith('/file'))
    return route.fulfill({ contentType: 'image/svg+xml', body: fixture });
  if (path.endsWith('/review')) {
    if (forceConflict)
      return send({ error: '版本已更新', code: 'REVISION_CONFLICT' }, 409);
    const data = req.postDataJSON();
    assert.equal(data.revision, records[0].revision);
    records[0] = {
      ...records[0],
      questions: data.questions,
      revision: records[0].revision + 1,
    };
    return send({ scan: records[0] });
  }
  if (path === '/scans/synthetic-scan') return send({ scan: records[0] });
  throw new Error(`Unexpected ${method} ${path}`);
});
try {
  await page.goto(base);
  await page.getByRole('navigation', { name: '账户' }).getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('家庭服务地址').fill(api);
  await page.getByLabel('账号', { exact: true }).fill('测试家庭');
  await page
    .getByLabel('密码', { exact: true })
    .fill('synthetic-only-password');
  await page.getByRole('button', { name: '登录' }).click();
  assert.equal(await page.getByLabel('当前学生').inputValue(), 'dabao');
  await page.screenshot({ path: `${output}/desktop-home.png`, fullPage: true });
  await page.getByRole('button', { name: /分配律练习/ }).click();
  await page.locator('.manual-review > summary').click();
  await page.getByLabel('步骤1转写').waitFor();
  await page.getByLabel('步骤1转写').fill('2x + 3 = 10（待核对）');
  await page.getByRole('button', { name: '保存校对' }).click();
  await page.getByText('已保存题目框和手写步骤').waitFor();
  assert.equal(
    records[0].questions[0].answerSteps[0].text,
    '2x + 3 = 10（待核对）',
  );
  await page.locator('.extra-regions > summary').click();
  await page.getByRole('button', { name: '补一个框', exact: true }).click();
  await page.locator('.paper-scroll').scrollIntoViewIfNeeded();
  const surface = await page.locator('.paper-scroll').boundingBox();
  await page.mouse.move(
    surface.x + surface.width * 0.15,
    surface.y + surface.height * 0.20,
  );
  await page.mouse.down();
  await page.mouse.move(
    surface.x + surface.width * 0.75,
    surface.y + surface.height * 0.65,
    { steps: 6 },
  );
  await page.mouse.up();
  await page.getByRole('button', { name: '保存校对' }).click();
  await page.getByText('已保存题目框和手写步骤').waitFor();
  assert.equal(records[0].questions[0].regions.length, 3);
  await page.screenshot({
    path: `${output}/desktop-review.png`,
    fullPage: true,
  });
  forceConflict = true;
  records[0].revision++;
  await page.getByLabel('完整题干').fill('保留的冲突草稿');
  await page.getByRole('button', { name: '保存校对' }).click();
  await page.getByRole('button', { name: '加载服务器版本' }).waitFor();
  await page.locator('.manual-review').evaluate((el) => { el.open = true; });
  assert.equal(
    await page.getByLabel('完整题干').inputValue(),
    '保留的冲突草稿',
  );
  assert.equal(
    await page.getByRole('button', { name: '保存校对' }).isDisabled(),
    true,
  );
  forceConflict = false;
  await page.getByLabel('完整题干').fill('冲突后继续编辑的草稿');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '返回资料列表' }).click();
  await page.getByRole('button', { name: /分配律练习/ }).click();
  await page.getByRole('button', { name: '加载服务器版本' }).waitFor();
  await page.locator('.manual-review').evaluate((el) => { el.open = true; });
  assert.equal(
    await page.getByLabel('完整题干').inputValue(),
    '冲突后继续编辑的草稿',
  );
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '加载服务器版本' }).click();
  await page
    .getByRole('button', { name: '加载服务器版本' })
    .waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '返回资料列表' }).click();
  await page.getByLabel('当前学生').selectOption('xiaobao');
  assert.equal(await page.getByLabel('当前学生').inputValue(), 'xiaobao');
  assert.equal(
    await page.getByRole('button', { name: /分配律练习/ }).count(),
    0,
  );
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '添加学生' }).click();
  await page.getByLabel('学生昵称').fill('第三位（测试）');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByLabel('当前学生').waitFor();
  assert.equal(await page.getByLabel('当前学生').inputValue(), 'student-3');
  await page.getByLabel('当前学生').selectOption('dabao');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /相册选图/ }).click();
  await (
    await chooserPromise
  ).setFiles({
    name: '合成作业.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.getByRole('button', { name: '完成选择，查看待上传', exact: true }).click();
  await page.getByRole('button', { name: '确认并上传' }).waitFor();
  await page.getByLabel('当前学生').selectOption('xiaobao');
  assert.equal(await page.getByLabel('当前学生').inputValue(), 'xiaobao');
  assert.equal(
    await page.getByRole('button', { name: '确认并上传' }).count(),
    0,
  );
  await page.getByLabel('当前学生').selectOption('dabao');
  await page.getByRole('button', { name: '确认并上传' }).click();
  await page
    .getByRole('button', { name: '确认并上传' })
    .waitFor({ state: 'hidden' });
  assert.equal(uploads, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/mobile-home.png`, fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  await page.getByRole('button', { name: /分配律练习/ }).click();
  await page.locator('.manual-review > summary').click();
  await page.getByLabel('步骤1转写').waitFor();
  await page.screenshot({
    path: `${output}/mobile-review.png`,
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
} finally {
  await browser.close();
}
assert.deepEqual(errors, []);
console.log(
  'Browser checks passed: family login, multi-student isolation, handwriting edits, drawing, revision conflict, third student.',
);
