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
  q('q3', '3', '利用上题中的三角形，求其面积。', [region('stem3', 'stem', .05, .85, .9, .08)], { sharedRegionIds: ['figure1'], knowledgePoints: ['面积'], wrongBook: { savedAt: now } }),
  q('q4', '4', '没有题框的历史题目，保留文字并提示补框。', [], { subject: '物理', knowledgePoints: [], wrongBook: { savedAt: now } }),
  q('q5', '5', '未收录的题目仍可从原题照片整理。', [region('stem5', 'stem', .05, .95, .9, .04)]),
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
let lastPage;
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
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await context.newPage(); lastPage = page; page.setDefaultTimeout(10000);
    const requests = { cloudImages: 0 }; let delayStudent = false, legacy = false, failImage = false, extraPages = false, blockImage = false, unblockImage, whenImageBlocked;
    const currentScan = () => legacy ? { ...scan, id: 'paper-legacy', sourceKind: undefined, processing: undefined } : scan;
    const currentScans = () => [currentScan(), ...(extraPages ? [6, 7].map(n => ({ ...scan, id: `extra-${n}`, sourceKind: undefined, processing: undefined, originalName: `其他合成试卷-${n}.jpg`, questions: [{ ...questions[0], id: `q${n}`, number: String(n) }] })) : [])];
    page.on('pageerror', error => errors.push(error.message));
    if (native) await context.addInitScript(({ original, photo, outputId }) => {
      window.nativeReads = 0; window.localMissing = false; window.nativeBusy = true; window.androidBridge = {};
      // Old WebViews without IntersectionObserver must still show and switch pictures.
      window.IntersectionObserver = undefined;
      window.Capacitor = {
        PluginHeaders: ['App','SessionVault','AppUpdater','PhotoProcessing'].map(name => ({ name, methods: [
          ...['get','set','clear','getOriginal','listOriginals','listOriginalBatches','removeListener'].map(name => ({ name, rtype: 'promise' })), { name: 'addListener', rtype: 'callback' },
        ] })), nativeCallback() { return 'synthetic-event'; },
        convertFileSrc(uri) {
          if (uri !== `file:///synthetic/${outputId}.jpg`) throw new Error('Incorrect processed-photo path: ' + uri);
          window.nativeReads++; return photo.data;
        },
        async nativePromise(plugin, method, input) {
          if (plugin === 'SessionVault') {
            if (method === 'get') return { value: localStorage.getItem('synthetic-vault') || '' };
            if (method === 'set') { localStorage.setItem('synthetic-vault', input.value); return {}; }
            if (method === 'clear') { localStorage.removeItem('synthetic-vault'); return {}; }
          }
          if (method === 'listOriginalBatches') return { batches: [] };
          if (method === 'listOriginals') return { originals: [], total: 0 };
          if (method === 'getOriginal') {
            if (window.nativeBusy) { window.nativeBusy = false; throw Object.assign(new Error('正在处理另一张照片，请稍候'), { code: 'PHOTO_BUSY' }); }
            if (input.originalId !== original.originalId || !input.owner.includes('paper-family')) throw new Error('Incorrect local-photo identity');
            if (window.localMissing) throw new Error('synthetic local missing'); return original;
          }
          return {};
        },
      };
    }, { original, photo, outputId });
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()); if (url.origin === new URL(client).origin) return route.continue();
      const send = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      if (url.pathname.endsWith('latest.json')) return route.fulfill({ status: 503, body: '{}' });
      if (url.href === api + '/setup') return send({ enabled: true, registrationEnabled: true });
      if (url.href === api + '/session/login') return send({ token: 'synthetic', user: { id: 'paper-family', username: '题卡合成验收' }, expiresAt: Date.now() + 999999 });
      if (url.href === api + '/session') return send({ user: { id: 'paper-family', username: '题卡合成验收' } });
      if (url.pathname.endsWith('/learning-sessions')) return send({ sessions: [], more: false, enabled: true });
    if (url.pathname.endsWith('/students')) return send({ students: [{ id: 'a', name: '合成学生甲', createdAt: now }, { id: 'b', name: '合成学生乙', createdAt: now }] });
      if (url.pathname.endsWith('/scans')) { if (delayStudent && url.searchParams.get('studentId') === 'b') await new Promise(resolve => setTimeout(resolve, 500)); return send({ scans: url.searchParams.get('studentId') === 'a' ? currentScans() : [], recognition: false }); }
      if (url.href === api + `/scans/${currentScan().id}`) return send({ scan: currentScan() });
      if (currentScans().some(s => url.href === api + `/scans/${s.id}/file`)) {
        requests.cloudImages++;
        if (failImage) return route.fulfill({ status: 503, body: 'synthetic image service unavailable' });
        if (blockImage) { const resume = new Promise(resolve => { unblockImage = resolve; }); whenImageBlocked?.(); await resume; }
        return route.fulfill({ contentType: 'image/jpeg', body: Buffer.from(photo.data.split(',')[1], 'base64') });
      }
      errors.push('Unexpected request: ' + url.pathname); return route.abort();
    });
    await page.goto(client);
    await page.getByRole('navigation', { name: '账户' }).getByRole('button', { name: '登录', exact: true }).click();
    if (await page.getByLabel('家庭服务地址').count()) await page.getByLabel('家庭服务地址').fill(api);
    await page.getByLabel('账号', { exact: true }).fill('paper-family'); await page.getByLabel('密码', { exact: true }).fill('synthetic-pass');
    await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('.learning-continue button').waitFor();
    const nav = page.getByRole('navigation', { name: '主要页面' }); await nav.getByRole('button', { name: '题目', exact: true }).click();
    await page.getByRole('region', { name: '错题本', exact: true }).waitFor(); assert.equal(await page.locator('.question-card').count(), 4);
    assert.equal(await page.getByRole('navigation', { name: '题目分类' }).getByRole('button', { name: '全部', exact: true }).count(), 0);
    const card = () => page.getByRole('article', { name: '第 1 题', exact: true });
    await card().getByRole('img', { name: '原题配图', exact: true }).waitFor();
    assert.match(await card().locator('.paper-prompt').textContent(), /AC = 3，BC = 4/);
    assert.deepEqual(await card().locator('.paper-options p').allTextContents(), ['A. 3', 'B. 4', 'C. 5', 'D. 7']);
    await card().getByText('题目来源', { exact: true }).click();
    await card().getByText(scan.originalName, { exact: true }).waitFor();
    await card().getByText('题目来源', { exact: true }).click();
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
          cropWidth: crop.width, cropHeight: crop.height, imageWidth: image.width, imageHeight: image.height,
          imageTop: image.top, cropTop: crop.top, imageLeft: image.left, cropLeft: crop.left };
      });
      assert.equal(geometry.noOverflow, true); assert.ok(Math.abs(geometry.buttonRight - geometry.headerRight) < 1);
      assert.ok(Math.abs(geometry.imageWidth * .4 - geometry.cropWidth) < 1);
      assert.ok(Math.abs((geometry.cropLeft - geometry.imageLeft) / geometry.imageWidth - .3) < .002);
      assert.ok(Math.abs(geometry.imageHeight * .19 - geometry.cropHeight) < 1);
      assert.ok(Math.abs((geometry.cropTop - geometry.imageTop) / geometry.imageHeight - .15) < .002);
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
    await card().locator('.question-crop img').first().evaluate(img => { img.src = 'data:image/jpeg;base64,broken'; });
    await card().getByText('题图显示失败，请重新读取本机照片', { exact: true }).waitFor();
    await card().getByRole('button', { name: native ? '重试恢复题图' : '重试读取', exact: true }).click();
    await card().getByRole('img', { name: '原题配图', exact: true }).waitFor();
    if (native) assert.equal(requests.cloudImages, 0, 'Render failure retries the local file without automatic cloud fallback');
    const noFigure = page.getByRole('article', { name: '第 2 题', exact: true });
    await noFigure.scrollIntoViewIfNeeded();
    await noFigure.getByText('原题题框（含配图）', { exact: true }).waitFor();
    assert.equal(await noFigure.locator('.paper-prompt').count(), 0, 'Unsegmented diagrams use the complete crop, avoiding a duplicate text-only reconstruction');
    const beforeToggle = await noFigure.screenshot();
    await noFigure.getByRole('button', { name: '原图', exact: true }).click();
    await noFigure.getByText('原图题框 · 第 2 题', { exact: true }).waitFor();
    await noFigure.getByRole('img', { name: '这道题的原图题框', exact: true }).waitFor();
    assert.equal(await noFigure.locator('.paper-prompt').count(), 0);
    assert.notDeepEqual(await noFigure.screenshot(), beforeToggle, 'Unsegmented image mode has a visible change');
    const subjectNav = page.getByRole('navigation', { name: '按科目筛选错题' });
    await subjectNav.getByRole('button', { name: '物理', exact: true }).click(); assert.equal(await page.locator('.question-card').count(), 1);
    assert.match(await page.locator('.question-card').textContent(), /尚未框选/);
    await subjectNav.getByRole('button', { name: '全部', exact: true }).click();
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
    await page.getByText('还没有错题，先从首页录入。', { exact: true }).waitFor();
    if (native) {
      assert.equal(requests.cloudImages, 0); await page.evaluate(() => { window.localMissing = true; });
      await page.getByLabel('当前学生').selectOption('a');
      await card().getByRole('img', { name: '原题配图', exact: true }).waitFor();
      assert.equal(requests.cloudImages, 1, 'Missing processed photo is recovered without a click');
      assert.equal(await page.getByRole('region', { name: '本机题图恢复', exact: true }).count(), 0, 'Successful auto recovery shows no manual recovery panel');
      await card().getByRole('button', { name: '原图', exact: true }).click();
      await card().getByText('原图题框 · 第 1 题', { exact: true }).waitFor();
      assert.equal(await card().locator('.paper-prompt').count(), 0, 'Missing original never masquerades as a successful text-only view');
      await card().getByRole('img', { name: /这道题的原图题框/ }).first().waitFor();
      assert.equal(requests.cloudImages, 1);
      // Recovered processed images remain usable when their original native file is still missing.
      await page.getByLabel('当前学生').selectOption('b'); await page.getByText('还没有错题，先从首页录入。', { exact: true }).waitFor();
      await page.getByLabel('当前学生').selectOption('a'); await card().getByRole('img', { name: '原题配图', exact: true }).waitFor();
      assert.equal(requests.cloudImages, 1);
      // Reproduce the real legacy/desktop-created record: no processing metadata, no native photo ID.
      await page.getByLabel('当前学生').selectOption('b'); await page.getByText('还没有错题，先从首页录入。', { exact: true }).waitFor(); legacy = true; failImage = true;
      await page.getByLabel('当前学生').selectOption('a'); await card().getByText('题图自动恢复未完成', { exact: true }).waitFor();
      assert.equal(await page.getByText('题图未就绪，当前内容尚不完整。', { exact: true }).count(), 0);
      assert.equal(requests.cloudImages, 2, 'Same-page cards share one automatic recovery attempt');
      for (const width of [320, 390, 768]) {
        await page.setViewportSize({ width, height: 900 }); await card().scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await card().screenshot({ path: resolve(out, `legacy-recovery-${width}.png`) });
      }
      assert.equal(requests.cloudImages, 2, 'Layout changes do not retry a failed recovery');
      const recoveryPanel = page.getByRole('region', { name: '本机题图恢复', exact: true });
      await recoveryPanel.getByText('1 张题图未恢复', { exact: true }).waitFor();
      // A successful network response isn't success until the local transaction commits.
      await page.evaluate(() => {
        // oxlint-disable-next-line typescript/unbound-method -- Keep the actual prototype method for reversible quota fault injection.
        const originalPut = IDBObjectStore.prototype.put;
        window.restoreImageWrites = () => { IDBObjectStore.prototype.put = originalPut; };
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === 'images') throw new DOMException('Synthetic disk full', 'QuotaExceededError');
          return originalPut.apply(this, args);
        };
      });
      failImage = false;
      await recoveryPanel.getByRole('button', { name: '重试恢复全部题图', exact: true }).click();
      await recoveryPanel.getByText('检查完成：已检查 1/1 张，可用 0 张，未完成 1 张', { exact: true }).waitFor();
      await recoveryPanel.getByText('查看未完成原因', { exact: true }).click();
      await recoveryPanel.getByText(/本机题图保存或读取失败/).waitFor();
      assert.equal(await card().locator('img').count(), 0); assert.equal(requests.cloudImages, 3);
      await card().getByRole('button', { name: '题目详情', exact: true }).click();
      await page.locator('.review-page > .notice').getByText('本机题图保存或读取失败，请检查手机可用空间后重试', { exact: true }).waitFor();
      assert.equal(requests.cloudImages, 4, 'Details also attempt automatic recovery');
      await page.evaluate(() => window.restoreImageWrites());
      await page.getByRole('button', { name: '重试恢复题图', exact: true }).click();
      await page.getByRole('region', { name: '当前题目原题' }).getByRole('img', { name: '原题配图', exact: true }).waitFor();
      assert.equal(requests.cloudImages, 5, 'Details recovery can retry after storage failure');
      await page.reload(); await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '题目', exact: true }).click();
      await card().getByRole('img', { name: '原题配图', exact: true }).waitFor(); assert.equal(requests.cloudImages, 5, 'Reload reuses persistent legacy image without downloading');
      await card().getByRole('button', { name: '题目详情', exact: true }).click();
      await page.getByRole('region', { name: '当前题目原题' }).getByRole('img', { name: '原题配图', exact: true }).waitFor();
      assert.equal(requests.cloudImages, 5, 'Details share the same persistent image');
      const cacheChecks = await page.evaluate(async ({ owner, scan }) => {
        const { recoveredImages } = await import('/src/photo-processing/recovered-image.ts');
        const signal = new AbortController().signal;
        const cached = await recoveredImages.read(owner, scan, signal);
        const accountIsolated = !await recoveredImages.read(owner + '-other', scan, signal);
        const studentIsolated = !await recoveredImages.read(owner, { ...scan, studentId: 'b' }, signal);
        let changedRejected = false, aborted = false;
        try { await recoveredImages.read(owner, { ...scan, size: scan.size + 1 }, signal); } catch { changedRejected = true; }
        const cancelled = new AbortController(); cancelled.abort();
        try { await recoveredImages.read(owner, scan, cancelled.signal); } catch (e) { aborted = e.name === 'AbortError'; }
        const hash = async file => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), v => v.toString(16).padStart(2,'0')).join('');
        return { accountIsolated, studentIsolated, changedRejected, aborted, bytes: cached.size, sha256: await hash(cached) };
      }, { owner: api + '|paper-family', scan: currentScan() });
      assert.deepEqual(cacheChecks, { accountIsolated: true, studentIsolated: true, changedRejected: true, aborted: true, bytes: photo.bytes, sha256: photo.sha256 });
      await page.getByRole('button', { name: '返回资料列表', exact: true }).click();
      await card().screenshot({ path: resolve(out, 'legacy-restored.png') });
      await page.evaluate(async ({ owner, scan }) => {
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open('family-learning-recovered-question-images', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        await new Promise((resolve, reject) => {
          const tx = db.transaction('images', 'readwrite'), store = tx.objectStore('images');
          const r = store.get(JSON.stringify([owner, scan.studentId, scan.id]));
          r.onsuccess = () => { const saved = r.result; store.put({ ...saved, file: new Blob([new Uint8Array(saved.file.size)], { type: saved.file.type }) }); };
          tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
        }); db.close();
      }, { owner: api + '|paper-family', scan: currentScan() });
      await page.reload(); await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '题目', exact: true }).click();
      await card().getByRole('img', { name: '原题配图', exact: true }).waitFor(); assert.equal(requests.cloudImages, 6, 'Corrupt cached image automatically recovered once');
      // Mixed batch: the existing page is reused, two failed pages can be retried together or stopped.
      extraPages = true; failImage = true;
      await page.getByRole('button', { name: '刷新', exact: true }).click();
      await page.getByRole('article', { name: '第 6 题', exact: true }).getByText('题图自动恢复未完成', { exact: true }).waitFor();
      await page.getByRole('article', { name: '第 7 题', exact: true }).getByText('题图自动恢复未完成', { exact: true }).waitFor();
      assert.equal(requests.cloudImages, 8);
      await recoveryPanel.getByText('2 张题图未恢复', { exact: true }).waitFor();
      await recoveryPanel.getByRole('button', { name: '重试恢复全部题图', exact: true }).click();
      await recoveryPanel.getByText('检查完成：已检查 3/3 张，可用 1 张，未完成 2 张', { exact: true }).waitFor();
      assert.equal(requests.cloudImages, 10, 'Already saved page is not downloaded again during batch retry');
      failImage = false; blockImage = true;
      const imageBlocked = new Promise(resolve => { whenImageBlocked = resolve; });
      await recoveryPanel.getByRole('button', { name: '重新检查与恢复', exact: true }).click(); await imageBlocked;
      await recoveryPanel.getByRole('button', { name: '停止恢复', exact: true }).click();
      await recoveryPanel.getByText('已停止：已检查 1/3 张，可用 1 张', { exact: true }).waitFor();
      blockImage = false; unblockImage();
      await page.getByRole('article', { name: '第 6 题', exact: true }).getByRole('img', { name: '原题配图', exact: true }).waitFor();
      assert.equal(requests.cloudImages, 11, 'Stopping leaves later failed pages untouched; a visible card can finish its shared in-flight read');
      await recoveryPanel.getByRole('button', { name: '重新检查与恢复', exact: true }).click();
      await recoveryPanel.getByText('检查完成：已检查 3/3 张，可用 3 张', { exact: true }).waitFor();
      await page.getByRole('article', { name: '第 7 题', exact: true }).getByRole('img', { name: '原题配图', exact: true }).waitFor();
      assert.equal(requests.cloudImages, 12);
      await recoveryPanel.screenshot({ path: resolve(out, 'batch-recovered.png') });
      checks.push('Mixed-page batch recovery: exact 3-page total, one existing file reused, two failures retained; stopped unstarted work, resumed without redownloading successes; shared card and batch read never duplicates an in-flight download');
      checks.push('Actual IndexedDB: automatic recovery on missing or corrupt images; failed server/storage recovery exposes manual retry, successful automatic recovery shows no manual controls');
      checks.push('Real IndexedDB: legacy scan recovery persists after reload and detail navigation; exact original bytes/hash; account/student isolation; changed metadata and cancellation rejected; local-first avoids repeated downloads');
      checks.push('Android bridge: exact private processed path and file hash; transient PHOTO_BUSY recovery; no IntersectionObserver fallback; same-page image shared; whole-book manual recovery counts photos rather than questions');
    }
    checks.push(`${native ? 'Native bridge' : 'Browser'}: four saved wrong questions, unsaved excluded; subject filters; inline original toggle; shared figure; unsegmented diagram fallback with a visibly distinct original view; detail preview; continue exact last opened question, isolated by student; delayed student switch isolation`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, 'question-paper-result.json'), JSON.stringify({ checkedAt: new Date().toISOString(), syntheticOnly: true, nativeDeviceTested: false, productionWrites: false, modelCalls: 0, checks, layouts, errors }, null, 2));
  console.log('Question paper, source crops, local reads, and student isolation passed.');
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: resolve(out, 'question-paper-failure.png'), fullPage: true });
    console.error(JSON.stringify({ errors, body: (await lastPage.locator('body').innerText()).slice(0, 5000) }));
  }
  throw error;
} finally { await browser.close(); }
