import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
if (!process.env.PHOTO_QA_OUTPUT) throw new Error('Set PHOTO_QA_OUTPUT to project artifacts/qa');
const out = path.resolve(process.env.PHOTO_QA_OUTPUT); await mkdir(out, { recursive: true });
const origin = 'http://127.0.0.1:3293';
const server = await createServer({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), server: { host: '127.0.0.1', port: 3293, strictPort: true } }); await server.listen();
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const errors = [], checks = [], layouts = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', route => { const url = new URL(route.request().url()); assert.equal(url.origin, origin); return route.continue(); });
const button = name => page.getByRole('button', { name, exact: true });
const svg = () => page.getByLabel('原片四角调整区域');
const transform = () => svg().locator('.photo-prep-source').getAttribute('transform');
const matrices = ['matrix(1 0 0 1 0 0)', 'matrix(0 1 -1 0 1200 0)', 'matrix(-1 0 0 -1 900 1200)', 'matrix(0 -1 1 0 0 900)'];
const configure = value => page.evaluate(v => window.photoFixture.configure(v), value);
const ready = () => page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === '确认使用处理图'); return b && !b.disabled; });
const inverse = (x, y, turns) => [[x,y], [y,1-x], [1-x,1-y], [1-y,x]][turns];
async function displayPoint(x, y) {
  await svg().scrollIntoViewIfNeeded();
  const box = await svg().boundingBox(), [, , width, height] = (await svg().getAttribute('viewBox')).split(' ').map(Number);
  const scale = Math.min(box.width / width, box.height / height);
  return { x: box.x + (box.width - width * scale) / 2 + x * width * scale,
    y: box.y + (box.height - height * scale) / 2 + y * height * scale, width: width * scale, height: height * scale, box };
}
async function sourcePoint(index) {
  const coords = (await svg().locator('polygon').getAttribute('points')).split(' ')[index].split(',').map(Number);
  return [coords[0] / 900, coords[1] / 1200];
}
function near(actual, expected, tolerance = .006) { assert.ok(actual.every((v, i) => Math.abs(v - expected[i]) < tolerance), JSON.stringify({ actual, expected })); }
try {
  await page.goto(origin + '/scripts/photo-preparation-fixture.html'); await page.getByRole('heading', { name: '把题目拍清楚' }).waitFor();
  const stageBox = await page.locator('.photo-prep-stage').boundingBox(), toolBox = await page.locator('.photo-prep-tools').boundingBox();
  assert.ok(stageBox.y + stageBox.height <= toolBox.y);
  for (let turns = 1; turns <= 4; turns++) { await button('顺时针转 90°').click(); assert.equal(await transform(), matrices[turns % 4]); }
  assert.equal(await page.evaluate(() => window.photoFixture.log.prepares.length), 0);
  assert.equal(await button('确认使用处理图').isEnabled(), false);
  checks.push('照片在工具上方；连续四次即时90度旋转回原向，不等待native且不生成处理件');

  for (let turns = 0; turns < 4; turns++) {
    await page.evaluate(t => window.photoFixture.switchScope('坐标账号', '角度' + t), turns);
    for (let i = 0; i < turns; i++) await button('顺时针转 90°').click();
    assert.equal(await transform(), matrices[turns]); await button('调整四角').click();
    await button('左上').click(); const target = await displayPoint(.12, .18);
    const before = await svg().locator('polygon').getAttribute('points');
    if (target.box.width - target.width > 3) await page.touchscreen.tap(target.box.x + 1, target.box.y + target.box.height / 2);
    else if (target.box.height - target.height > 3) await page.touchscreen.tap(target.box.x + target.box.width / 2, target.box.y + 1);
    assert.equal(await svg().locator('polygon').getAttribute('points'), before);
    await page.touchscreen.tap(target.x, target.y);
    const index = [0,3,2,1][turns]; near(await sourcePoint(index), inverse(.12, .18, turns));
    const handle = page.getByRole('button', { name: '移动左上角', exact: true });
    await handle.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
    near(await sourcePoint(index), inverse(.125, .185, turns));
    const drag = await displayPoint(.125, .185);
    await page.mouse.move(drag.x, drag.y); await page.mouse.down(); await page.mouse.move(drag.x + drag.width * .04, drag.y + drag.height * .03, { steps: 3 }); await page.mouse.up();
    near(await sourcePoint(index), inverse(.165, .215, turns));
    await page.getByText('放大检查细节', { exact: true }).click();
    const enlarged = page.getByRole('img', { name: '可滑动查看的放大照片', exact: true });
    assert.equal(await enlarged.locator('g').getAttribute('transform'), matrices[turns]);
    assert.equal(await enlarged.getAttribute('viewBox'), turns % 2 ? '0 0 1200 900' : '0 0 900 1200');
    await page.getByText('放大检查细节', { exact: true }).click();
    await page.screenshot({ path: path.join(out, `source-rotation-${turns * 90}.png`), fullPage: true });
    const callCount = await page.evaluate(() => window.photoFixture.log.prepares.length);
    await button('生成预览').click(); await ready();
    const call = await page.evaluate(() => window.photoFixture.log.prepares.at(-1));
    assert.equal(call.options.quarterTurns, turns); near(call.options.corners.slice(index * 2, index * 2 + 2), inverse(.165, .215, turns));
    assert.equal(await page.evaluate(() => window.photoFixture.log.prepares.length), callCount + 1);
    const finalImage = page.getByAltText('处理后的题目照片');
    assert.equal(await finalImage.evaluate(img => getComputedStyle(img).transform), 'none');
    assert.equal(await finalImage.evaluate(img => img.naturalWidth), turns % 2 ? 1200 : 900);
    await button('查看原片').click(); assert.equal(await transform(), matrices[turns]);
    await button('查看处理结果').click(); assert.equal(await finalImage.evaluate(img => getComputedStyle(img).transform), 'none');
    await button('顺时针转 90°').click(); assert.equal(await transform(), matrices[(turns + 1) % 4]);
    assert.equal(await button('确认使用处理图').isEnabled(), false); assert.equal(await button('查看处理结果').isEnabled(), false);
  }
  checks.push('四方向下四角留白/触摸/拖动/键盘按屏幕方向反向映射；放大与切tab同向；native参数只旋转一次');
  await configure({ delay: 450 }); await button('提亮阴影').click();
  assert.equal(await button('提亮阴影').getAttribute('aria-pressed'), 'true'); assert.equal(await button('确认使用处理图').isEnabled(), false);
  await ready(); assert.equal((await page.evaluate(() => window.photoFixture.log.prepares.at(-1))).options.enhancement, 'light');
  await configure({}); await button('提亮阴影').click(); await ready();
  assert.equal(await button('提亮阴影').getAttribute('aria-pressed'), 'false'); assert.equal((await page.evaluate(() => window.photoFixture.log.prepares.at(-1))).options.enhancement, 'none');
  checks.push('提亮同排toggle选中态；开/关调用处理接口（合成桥），等待时不能确认旧结果');

  await button('调整四角').click(); await button('生成预览').click(); await ready();
  await configure({ failure: true }); await button('重新生成预览').click(); await page.getByRole('alert').filter({ hasText: '模拟处理失败' }).waitFor();
  assert.equal(await button('查看原片').getAttribute('aria-pressed'), 'true'); await button('左上').waitFor();
  const failedView = await displayPoint(.2, .2); await page.touchscreen.tap(failedView.x, failedView.y);
  assert.equal(await button('确认使用处理图').isEnabled(), false);
  checks.push('重新生成失败后回原片视图，四角工具与尺寸观察可继续使用');

  let releaseImage;
  const held = new Promise(resolve => { releaseImage = resolve; });
  await page.route(origin + '/photo-preview-held.svg?*', async route => { await held; await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="900" height="1200" fill="#eee"/></svg>' }); });
  await configure({ holdPreview: true }); await button('提亮阴影').click(); await page.getByAltText('处理后的题目照片').waitFor();
  assert.equal(await page.getByAltText('处理后的题目照片').evaluate(img => img.naturalWidth), 0);
  assert.equal(await button('确认使用处理图').isEnabled(), false);
  releaseImage(); await ready();
  checks.push('新处理图真实加载成功之前仍禁止确认');

  await configure({ delay: 450 }); await button('提亮阴影').click(); await button('取消，保留原片').click();
  await page.getByRole('heading', { name: '本机原片' }).waitFor(); await page.waitForTimeout(550);
  assert.equal(await page.evaluate(() => window.photoFixture.log.confirms.length), 0);
  await configure({}); await button('继续处理').click();
  checks.push('提亮处理期间可取消，迟到结果不入队；原片入口重开同一调整组件');
  for (const width of [320,360,390,430,768]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await page.evaluate(() => {
      const strip = document.querySelector('.photo-prep-toolstrip'), buttons = [...strip.querySelectorAll('button')];
      return { viewport: innerWidth, body: document.documentElement.scrollWidth, stripWidth: strip.clientWidth, stripScroll: strip.scrollWidth,
        stripLeft: strip.getBoundingClientRect().left, stripRight: strip.getBoundingClientRect().right,
        buttons: buttons.map(b => { const r = b.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, height: r.height, clientWidth: b.clientWidth, scrollWidth: b.scrollWidth }; }) };
    });
    assert.ok(layout.body <= width); assert.ok(layout.stripScroll <= layout.stripWidth);
    assert.ok(layout.buttons.every(b => Math.abs(b.top - layout.buttons[0].top) < 1 && b.height >= 44 && b.left >= layout.stripLeft && b.right <= layout.stripRight && b.scrollWidth <= b.clientWidth));
    layouts.push(layout);
    await page.locator('.photo-prep-toolstrip').evaluate(el => { el.scrollLeft = 0; });
    await page.screenshot({ path: path.join(out, `adjustment-${width}.png`), fullPage: true });
  }
  checks.push('320/360/390/430/768宽度四按钮同排全可见，无页面横溢出，触摸高度至少44px');
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'adjustment-result.json'), JSON.stringify({ syntheticOnly: true, nativeRuntimeTested: false, checks, layouts, errors }, null, 2));
  console.log(JSON.stringify({ checks, widths: layouts.map(layout => layout.viewport), errors }, null, 2));
} catch(e) { await page.screenshot({ path: path.join(out, 'adjustment-failure.png'), fullPage: true }); console.error((await page.locator('body').innerText()).slice(0, 3000)); throw e; }
finally { await browser.close(); await server.close(); }
