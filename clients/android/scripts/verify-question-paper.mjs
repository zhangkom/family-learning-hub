import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const client = process.env.PILOT_PREVIEW_URL || 'http://127.0.0.1:3179';
assert.equal(new URL(client).hostname, '127.0.0.1');
const out = resolve(process.env.PHOTO_QA_OUTPUT || 'test-results/question-paper'); mkdirSync(out, { recursive: true });
const api = 'https://123.207.232.151/family-learning/api/mobile/v1';
const now = new Date().toISOString(), checks = [], layouts = [], errors = [];
const region = (id, kind, x, y, width, height) => ({ id, kind, x, y, width, height });
const q = (id, number, prompt, regions, extra = {}) => ({ id, number, prompt, regions, diagram: '', subject: '数学', knowledgePoints: ['三角形'], answerSteps: [], uncertainties: [], confirmed: true, ...extra });
const questions = [
  q('q1', '1', '如图，在直角三角形 ABC 中，∠C = 90°，AC = 3，BC = 4。求斜边 AB 的长度。\nA. 3　 B. 4　 C. 5　 D. 7',
    [region('stem1', 'stem', .05, .06, .9, .32), region('figure1', 'figure', .3, .15, .4, .19), region('answer1', 'answer', .05, .39, .9, .08)], { wrongBook: { savedAt: now } }),
  q('q2', '2', '这段识别文字尚未包含图表，完整题图仍应保留。', [region('stem2', 'stem', .05, .51, .9, .24)], { knowledgePoints: ['统计图'], wrongBook: { savedAt: now } }),
  q('q3', '3', '利用上题中的三角形，求其面积。', [region('stem3', 'stem', .05, .85, .9, .08)], { sharedRegionIds: ['figure1'], knowledgePoints: ['面积'] }),
  q('q4', '4', '没有题框的历史题目，保留文字并提示补框。', [], { subject: '物理', knowledgePoints: [] }),
];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400"><rect width="1000" height="1400" fill="white"/>
<g fill="#1d2530" font-family="SimSun,serif" font-size="28"><text x="60" y="115">1. 如图，在直角三角形 ABC 中，∠C = 90°，</text><text x="60" y="165">AC = 3，BC = 4。求斜边 AB 的长度。</text>
<text x="60" y="505">A. 3　　 B. 4　　 C. 5　　 D. 7</text>
<text x="330" y="260">A</text><text x="330" y="460">C</text><text x="640" y="460">B</text><text x="320" y="350">3</text><text x="470" y="475">4</text></g>
<path d="M370 240 L370 440 L620 440 Z M370 417 H393 V440" fill="none" stroke="#23334a" stroke-width="3"/>
<text x="60" y="600" fill="#2b5b9c" font-family="cursive" font-size="30">我的原作答：3 + 4 = 7</text>
<g fill="#1d2530" font-family="SimSun,serif" font-size="28"><text x="60" y="755">2. 观察统计图，哪一个月份读书最多？</text><text x="60" y="1015">请根据图中的信息回答。</text><text x="60" y="1240">3. 利用上题中的三角形，求其面积。</text></g>
<path d="M260 800 V940 H760" fill="none" stroke="#273342" stroke-width="3"/><g fill="#41546b"><rect x="330" y="855" width="75" height="85"/><rect x="470" y="800" width="75" height="140"/><rect x="610" y="875" width="75" height="65"/></g>
<g font-size="22" fill="#273342"><text x="330" y="978">一月</text><text x="470" y="978">二月</text><text x="610" y="978">三月</text></g></svg>`;
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
try {
  const maker = await browser.newPage();
  const photo = await maker.evaluate(async svg => {
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 1400; canvas.getContext('2d').drawImage(img, 0, 0);
    const data = canvas.toDataURL('image/jpeg', .97), bytes = Uint8Array.from(atob(data.split(',')[1]), c => c.charCodeAt(0));
    return { data, bytes: bytes.length };
  }, svg);
  photo.sha256 = createHash('sha256').update(Buffer.from(photo.data.split(',')[1], 'base64')).digest('hex');
  await maker.close();
  const originalId = '11111111-1111-4111-8111-111111111111', outputId = '22222222-2222-4222-8222-222222222222';
  const processing = { schemaVersion: 1, algorithmVersion: 'android-photo-v1', originalId, outputId, studentId: 'a', sourceSha256: photo.sha256, sha256: photo.sha256, bytes: photo.bytes, mime: 'image/jpeg',
    width: 1000, height: 1400, sourceWidth: 1000, sourceHeight: 1400, decodedWidth: 1000, decodedHeight: 1400, exifOrientation: 1,
    sourceSpace: 'exif-upright-normalized-edges', outputSpace: 'normalized-edges', corners: [0,0,1,0,1,1,0,1], quarterTurns: 0, enhancement: 'none', jpegQuality: 97, maxEdge: 3072,
    sourceToOutput: [1,0,0,0,1,0,0,0,1], outputToSource: [1,0,0,0,1,0,0,0,1], quality: { advisoryOnly: true, warnings: [] }, createdAt: Date.now() };
  const original = { schemaVersion: 1, originalId, studentId: 'a', sha256: photo.sha256, bytes: photo.bytes, mime: 'image/jpeg', width: 1000, height: 1400, orientation: 1,
    uprightWidth: 1000, uprightHeight: 1400, originalUri: 'file:///synthetic/original', previewUri: 'file:///synthetic/preview.jpg', createdAt: Date.now() };
  const scan = { id: 'paper-a', studentId: 'a', subject: '数学', source: '合成试卷', originalName: '合成几何与统计.jpg', mimeType: 'image/jpeg', size: photo.bytes, createdAt: now, revision: 1, status: 'ready', sourceKind: 'processed-photo', processing, questions };
  for (const native of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await context.newPage(); page.setDefaultTimeout(10000);
    const requests = { cloudImages: 0 }; let delayStudent = false;
    page.on('pageerror', error => errors.push(error.message));
    if (native) await context.addInitScript(({ original, photo }) => {
      window.nativeReads = 0; window.localMissing = false; window.androidBridge = {};
      window.Capacitor = {
        PluginHeaders: ['App','SessionVault','AppUpdater','PhotoProcessing'].map(name => ({ name, methods: [
          ...['get','set','clear','getOriginal','listOriginals','listOriginalBatches','removeListener'].map(name => ({ name, rtype: 'promise' })), { name: 'addListener', rtype: 'callback' },
        ] })), nativeCallback() { return 'synthetic-event'; },
        convertFileSrc() { window.nativeReads++; return photo.data; },
        async nativePromise(plugin, method) {
          if (plugin === 'SessionVault' && method === 'get') return { value: '' };
          if (method === 'listOriginalBatches') return { batches: [] };
          if (method === 'listOriginals') return { originals: [], total: 0 };
          if (method === 'getOriginal') { if (window.localMissing) throw new Error('synthetic local missing'); return original; }
          return {};
        },
      };
    }, { original, photo });
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()); if (url.origin === new URL(client).origin) return route.continue();
      const send = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      if (url.pathname.endsWith('latest.json')) return route.fulfill({ status: 503, body: '{}' });
      if (url.href === api + '/setup') return send({ enabled: true, registrationEnabled: true });
      if (url.href === api + '/session/login') return send({ token: 'synthetic', user: { id: 'paper-family', username: '题卡合成验收' }, expiresAt: Date.now() + 999999 });
      if (url.pathname.endsWith('/learning-sessions')) return send({ sessions: [], more: false, enabled: true });
    if (url.pathname.endsWith('/students')) return send({ students: [{ id: 'a', name: '合成学生甲', createdAt: now }, { id: 'b', name: '合成学生乙', createdAt: now }] });
      if (url.pathname.endsWith('/scans')) { if (delayStudent && url.searchParams.get('studentId') === 'b') await new Promise(resolve => setTimeout(resolve, 500)); return send({ scans: url.searchParams.get('studentId') === 'a' ? [scan] : [], recognition: false }); }
      if (url.href === api + '/scans/paper-a') return send({ scan });
      if (url.href === api + '/scans/paper-a/file') { requests.cloudImages++; return route.fulfill({ contentType: 'image/jpeg', body: Buffer.from(photo.data.split(',')[1], 'base64') }); }
      errors.push('Unexpected request: ' + url.pathname); return route.abort();
    });
    await page.goto(client);
    await page.getByRole('navigation', { name: '账户' }).getByRole('button', { name: '登录', exact: true }).click();
    await page.getByLabel('账号', { exact: true }).fill('paper-family'); await page.getByLabel('密码', { exact: true }).fill('synthetic-pass');
    await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('.learning-continue button').waitFor();
    const nav = page.getByRole('navigation', { name: '主要页面' }); await nav.getByRole('button', { name: '题目', exact: true }).click();
    await page.getByRole('region', { name: '全部题目', exact: true }).waitFor(); assert.equal(await page.locator('.question-card').count(), 4);
    const card = () => page.getByRole('article', { name: '第 1 题', exact: true });
    await card().getByRole('img', { name: '原题配图', exact: true }).waitFor();
    assert.match(await card().locator('.paper-prompt').textContent(), /AC = 3，BC = 4/);
    if (native) { assert.equal(requests.cloudImages, 0); assert.equal(await page.evaluate(() => window.nativeReads), 1); }
    else assert.equal(requests.cloudImages, 1);
    await page.getByRole('article', { name: '第 2 题', exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole('article', { name: '第 2 题', exact: true }).getByRole('img', { name: '原题题干与配图', exact: true }).waitFor();
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 900 }); await card().scrollIntoViewIfNeeded(); await card().locator('img').waitFor();
      const geometry = await card().evaluate(node => {
        const header = node.querySelector('.question-card-heading').getBoundingClientRect(), button = node.querySelector('.question-original-toggle').getBoundingClientRect();
        const crop = node.querySelector('.question-crop').getBoundingClientRect(), image = node.querySelector('.question-crop img').getBoundingClientRect();
        return { noOverflow: document.documentElement.scrollWidth <= innerWidth, headerTop: header.top, buttonTop: button.top, buttonRight: button.right, headerRight: header.right,
          cropWidth: crop.width, cropHeight: crop.height, imageWidth: image.width, imageLeft: image.left, cropLeft: crop.left };
      });
      assert.equal(geometry.noOverflow, true); assert.ok(Math.abs(geometry.buttonRight - geometry.headerRight) < 1);
      assert.ok(Math.abs(geometry.imageWidth * .4 - geometry.cropWidth) < 1);
      assert.ok(Math.abs((geometry.cropLeft - geometry.imageLeft) / geometry.imageWidth - .3) < .002);
      layouts.push({ native, width, ...geometry });
      await page.screenshot({ path: resolve(out, `${native ? 'native' : 'web'}-paper-${width}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await card().getByRole('button', { name: '原图', exact: true }).click();
    await card().getByRole('img', { name: /这道题的原图题框/ }).first().waitFor();
    assert.equal(await card().locator('.paper-prompt').count(), 0); assert.equal(await card().locator('.question-crop').count(), 2);
    assert.equal(await page.locator('.review-page').count(), 0, 'Toggle stays inside the card');
    await card().scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(out, `${native ? 'native' : 'web'}-original-390.png`) });
    await card().getByRole('button', { name: '整理版', exact: true }).click(); await card().getByRole('img', { name: '原题配图', exact: true }).waitFor();
    await page.getByRole('button', { name: '错题本', exact: true }).click(); assert.equal(await page.locator('.question-card').count(), 2);
    await page.getByRole('button', { name: '全部', exact: true }).click(); assert.equal(await page.locator('.question-card').count(), 4);
    await page.getByRole('button', { name: '物理 1 道题', exact: true }).click(); assert.equal(await page.locator('.question-card').count(), 1);
    assert.match(await page.locator('.question-card').textContent(), /尚未框选/);
    await page.getByRole('button', { name: '全部科目', exact: true }).click();
    await page.getByRole('article', { name: '第 3 题', exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole('article', { name: '第 3 题', exact: true }).getByRole('img', { name: '原题配图', exact: true }).waitFor();
    await card().getByRole('button', { name: '题目详情', exact: true }).click();
    await page.getByRole('region', { name: '当前题目原题' }).getByRole('img', { name: '原题配图', exact: true }).waitFor();
    await page.getByRole('region', { name: '当前题目原题' }).getByRole('button', { name: '原图', exact: true }).click();
    await page.getByRole('region', { name: '当前题目原题' }).getByRole('img', { name: /这道题的原图题框/ }).first().waitFor();
    await page.getByRole('button', { name: '返回资料列表', exact: true }).click();
    await nav.getByRole('button', { name: '首页', exact: true }).click();
    await page.getByText('接着上次学', { exact: true }).waitFor();
    assert.match(await page.locator('.learning-continue small').textContent(), /数学 · 第 1 题/);
    await page.getByRole('button', { name: '继续学习', exact: true }).click();
    await page.getByRole('region', { name: '当前题目原题' }).getByRole('img', { name: '原题配图', exact: true }).waitFor();
    await page.getByRole('button', { name: '返回资料列表', exact: true }).click();
    await page.getByLabel('当前学生').selectOption('b');
    await page.getByText('从第一道题开始', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '继续学习', exact: true }).count(), 0);
    await page.getByLabel('当前学生').selectOption('a');
    await page.getByText('接着上次学', { exact: true }).waitFor();
    await nav.getByRole('button', { name: '题目', exact: true }).click();
    delayStudent = true; await page.getByLabel('当前学生').selectOption('b');
    assert.equal(await page.locator('.question-card').count(), 0, 'Previous student cards clear while next request is pending');
    await page.getByText('还没有题目，请到首页拍照或选图。', { exact: true }).waitFor();
    if (native) {
      assert.equal(requests.cloudImages, 0); await page.evaluate(() => { window.localMissing = true; });
      await page.getByLabel('当前学生').selectOption('a'); await card().getByText('本机题图暂不可用', { exact: true }).waitFor();
      assert.equal(requests.cloudImages, 0);
      await card().getByRole('button', { name: '从云端读取这张题图', exact: true }).click(); await card().getByRole('img', { name: '原题配图', exact: true }).waitFor();
      assert.equal(requests.cloudImages, 1);
      checks.push('Android bridge: exact local file hash checked, one read shared between question cards, no server image download until explicit missing-file recovery');
    }
    checks.push(`${native ? 'Native bridge' : 'Browser'}: all four questions including unsaved ones; subject/wrong filters; inline original toggle; shared figure; unsegmented diagram fallback; detail preview; continue exact last opened question, isolated by student; delayed student switch isolation`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, 'question-paper-result.json'), JSON.stringify({ checkedAt: new Date().toISOString(), syntheticOnly: true, nativeDeviceTested: false, productionWrites: false, modelCalls: 0, checks, layouts, errors }, null, 2));
  console.log('Question paper, source crops, local reads, and student isolation passed.');
} finally { await browser.close(); }
