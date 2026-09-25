// Run against a local standalone build. Set PLAYWRIGHT_MODULE_PATH if using a bundled runtime.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || 'playwright',
);
const base = process.argv[2] || 'http://127.0.0.1:3191/family-learning';
const output = resolve('outputs/study-qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error')
    errors.push(`${message.text()} ${message.location().url}`);
});
page.on('response', (response) => {
  if (response.status() >= 400)
    errors.push(`HTTP ${response.status()} ${response.url()}`);
});
try {
  await page.goto(`${base}/xiaobao/study?lesson=xb-abs-box`);
  await page
    .getByRole('heading', { name: '绝对值盒子：同款才能合并', exact: true })
    .waitFor();
  await page.getByRole('radio', { name: 'A. 5a', exact: true }).check();
  await page.getByRole('button', { name: '检查答案', exact: true }).click();
  await page
    .getByText('这次没对，已尝试收录错题；看看关键一步。', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: '同类再练', exact: true }).click();
  await page.getByRole('radio', { name: 'C. 6|x|', exact: true }).check();
  await page.getByRole('button', { name: '检查答案', exact: true }).click();
  await page.getByRole('button', { name: '换个条件', exact: true }).click();
  await page
    .getByRole('radio', {
      name: 'B. 先保留，若要去绝对值需分情况',
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: '检查答案', exact: true }).click();
  await page.getByText(/独立完成 · 建议复习/).waitFor();
  await page.screenshot({
    path: resolve(output, 'math-desktop.png'),
    fullPage: true,
  });
  await page.goto(`${base}/xiaobao/wrong-book`);
  await page
    .getByText('3|a|＋2|a|＝？请先在纸上圈出相同部分。', { exact: true })
    .waitFor();
  await page.getByText('查看本题作答历史（1次）', { exact: true }).click();
  assert.equal(await page.getByText('5a', { exact: true }).count(), 1);
  await page.reload();
  await page.getByText('查看本题作答历史（1次）', { exact: true }).waitFor();

  await page.goto(`${base}/xiaobao/study?lesson=xb-geo-address`);
  await page
    .getByRole('heading', { name: '给地球寄快递：地址要写全', exact: true })
    .waitFor();
  await page.getByLabel('经度', { exact: true }).selectOption('-60');
  await page.getByLabel('纬度', { exact: true }).selectOption('-30');
  await page.getByText('宝箱地址：60°W，30°S', { exact: true }).waitFor();
  await page
    .getByRole('radio', { name: 'A. 北纬120°，东经30°', exact: true })
    .check();
  await page.getByRole('button', { name: '检查答案', exact: true }).click();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      true,
      `overflow at ${width}`,
    );
    await page.screenshot({
      path: resolve(output, `geography-${width}.png`),
      fullPage: true,
    });
  }
  await page.goto(`${base}/xiaobao/wrong-book`);
  await page.getByRole('button', { name: '地理', exact: true }).click();
  await page.getByText('（120°E，30°N）读作？', { exact: true }).waitFor();

  await page.goto(`${base}/xiaobao/practice/method-xb-abs-box`);
  await page.getByText('查看答案与一对一讲解要点', { exact: true }).click();
  await page.getByRole('checkbox').first().check();
  await page
    .getByRole('button', { name: '保存批改与错题', exact: true })
    .click();
  await page.getByText('已保存；本页标记为完成', { exact: true }).waitFor();
  await page.goto(`${base}/xiaobao/wrong-book`);
  await page.getByText('查看本题作答历史（2次）', { exact: true }).click();
  await page.getByText(/纸笔复盘（提示情况未核实）/).waitFor();
  assert.equal(
    await page.getByText('5a', { exact: true }).count(),
    1,
    'first answer must survive paper grading',
  );

  await page.goto(`${base}/xiaobao/practice/method-xb-abs-boundary`);
  await page
    .getByRole('heading', { name: '绝对值里面是一整句话', exact: true })
    .waitFor();
  assert.equal(await page.locator('.worksheet-solution').count(), 0);
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: resolve(output, 'student.pdf'),
    format: 'A4',
    printBackground: true,
  });
  await page.emulateMedia({ media: 'screen' });
  await page.getByLabel('打印版本').selectOption('answers');
  assert.equal(await page.locator('.worksheet-solution').count(), 4);
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: resolve(output, 'answers.pdf'),
    format: 'A4',
    printBackground: true,
  });
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 320, height: 900 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    true,
    'worksheet mobile overflow',
  );
  await page.screenshot({
    path: resolve(output, 'worksheet-mobile.png'),
    fullPage: true,
  });
  await page.goto(`${base}/dabao/study?lesson=db-equilibrium`);
  await page
    .getByRole('heading', { name: '三段式：先把变化量排成一行', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: '给我一点提示（0/3）', exact: true })
    .click();
  await page.getByRole('radio', { name: 'B. 0.4', exact: true }).check();
  await page.getByRole('button', { name: '检查答案', exact: true }).click();
  await page.getByText(/需要提示 · 建议复习/).waitFor();
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() => document.activeElement !== document.body),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: math feedback, persistent mistakes, geography coordinates, 4 viewport widths, student/answer printing, senior hints and keyboard focus; no browser errors.',
  );
  console.log(`Artifacts: ${output}`);
} finally {
  await browser.close();
}
