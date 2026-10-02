import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const client = process.env.PILOT_PREVIEW_URL || 'http://127.0.0.1:3179';
assert.equal(new URL(client).hostname, '127.0.0.1');
const { version, androidVersionCode } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const site = 'https://123.207.232.151/family-learning/', api = `${site}api/mobile/v1`;
const students = [
  { id: 'student-a', name: '大宝', grade: '高二', createdAt: new Date().toISOString() },
  { id: 'student-b', name: '小宝', grade: '初一', createdAt: new Date().toISOString() },
];
const scans = Array.from({ length: 20 }, (_, index) => ({ id: `scan-${index}`, studentId: 'student-a', subject: '数学', source: '合成验证',
  originalName: index === 0 ? '含多个题目和较长文件名的数学作业练习资料.png' : `数学作业-${index}.png`, mimeType: 'image/png', size: 200,
  createdAt: new Date().toISOString(), revision: 1, status: index % 2 ? 'ready' : 'needs_review', questions: [] }));
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [], geometry = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.addInitScript(() => {
  window.androidBridge = {};
  window.nativeCalls = [];
  window.galleryMode = 'cancel';
  window.Capacitor = {
    PluginHeaders: ['App', 'Camera', 'SessionVault', 'AppUpdater', 'AppSettings'].map((name) => ({ name, methods: [
      ...['get', 'set', 'clear', 'takePhoto', 'chooseFromGallery', 'checkPermissions', 'requestPermissions', 'download', 'install', 'openInstallSettings', 'openAppSettings', 'removeListener'].map((name) => ({ name, rtype: 'promise' })),
      { name: 'addListener', rtype: 'callback' },
    ] })),
    nativeCallback() { return 'synthetic-event'; },
    async nativePromise(plugin, method, args) {
      window.nativeCalls.push({ plugin, method, args });
      if (plugin === 'SessionVault' && method === 'get') return { value: '' };
      if (plugin === 'Camera' && method === 'takePhoto') throw Object.assign(new Error('denied'), { code: 'OS-PLUG-CAMR-0003' });
      if (plugin === 'Camera' && method === 'chooseFromGallery') {
        if (window.galleryMode === 'cancel') throw Object.assign(new Error('cancelled'), { code: 'OS-PLUG-CAMR-0020' });
        return { results: [{ webPath: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }] };
      }
      return {};
    },
  };
});
await page.route('**/*', async (route) => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin === new URL(client).origin) return route.continue();
  const send = (data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  if (url.href === `${site}downloads/android/latest.json`) return send({ version, versionCode: androidVersionCode, channel: 'release', bytes: 7000000, sha256: 'a'.repeat(64), downloadUrl: `${site}downloads/android/family-learning-${version}-release-1234567.apk`, notes: '合成版本' });
  if (url.href === `${api}/setup`) return send({ enabled: true, needsSetup: false });
  if (url.href === `${api}/session/login`) return send({ token: 'synthetic-token', user: { id: 'synthetic-family', username: '测试家庭' }, expiresAt: Date.now() + 60000 });
  if (url.href === `${api}/students`) return send({ students });
  if (url.pathname.endsWith('/scans') && request.method() === 'GET') return send({ scans: url.searchParams.get('studentId') === 'student-a' ? scans : [], recognition: true });
  errors.push(`Unexpected request ${url.pathname}`);
  return route.abort('blockedbyclient');
});
try {
  mkdirSync('test-results', { recursive: true });
  await page.goto(client);
  await page.getByRole('navigation', { name: '账户' }).getByRole('button', { name: '登录', exact: true }).click();
  await page.getByText(`知燃 AI ${version} · 家庭试用版`, { exact: true }).waitFor();
  const noSensitiveRequests = async () => {
    assert.deepEqual(await page.evaluate(() => window.nativeCalls.filter(({ plugin, method }) =>
      plugin === 'Camera' || plugin === 'AppSettings' || ['install', 'openInstallSettings'].includes(method))), []);
  };
  await noSensitiveRequests();
  await page.getByLabel('账号', { exact: true }).fill('test-family');
  await page.getByLabel('密码', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: '登录' }).click();
  await page.locator('.home-record-card').first().waitFor();
  await noSensitiveRequests();
  assert.equal(await page.locator('.home-record-card').count(), 1);
  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) {
    await page.setViewportSize(viewport);
    const measured = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
      recentBottom: document.querySelector('.home-recent').getBoundingClientRect().bottom,
      navTop: document.querySelector('.bottom-nav').getBoundingClientRect().top }));
    geometry.push(measured);
    assert.ok(measured.scrollWidth <= viewport.width, JSON.stringify(measured));
    assert.ok(measured.scrollHeight <= viewport.height + 1, `Home should fit one screen: ${JSON.stringify(measured)}`);
    assert.ok(measured.recentBottom <= measured.navTop, `Navigation covers content: ${JSON.stringify(measured)}`);
    await page.screenshot({ path: `test-results/home-${viewport.width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: /查看全部/ }).click();
  assert.equal(await page.locator('.record-card').count(), 20);
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '首页', exact: true }).click();
  await page.getByLabel('当前学生').selectOption('student-b');
  await page.locator('.home-empty-records').waitFor();
  assert.equal(await page.locator('.record-card').count(), 0);
  await page.getByLabel('当前学生').selectOption('student-a');
  await page.locator('.home-record-card').first().waitFor();
  await page.getByRole('button', { name: /拍照收题/ }).click();
  await page.getByText('系统相机未获允许。可以从相册选图，或在系统设置中检查相机的权限后重试。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '返回题目资料', exact: true }).click();
  await page.getByRole('button', { name: /相册选图/ }).click();
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.evaluate(() => { window.galleryMode = 'photo'; });
  await page.getByRole('button', { name: '从相册添加', exact: true }).click();
  await page.getByRole('button', { name: '完成选择，查看待上传', exact: true }).click();
  await page.getByRole('button', { name: '确认并上传', exact: true }).waitFor();
  assert.equal(await page.locator('.bottom-nav button[aria-current="page"]').textContent(), '题目');
  await page.getByLabel('当前学生').selectOption('student-b');
  assert.equal(await page.getByRole('button', { name: '确认并上传', exact: true }).count(), 0);
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '我的', exact: true }).click();
  await page.getByText('权限与隐私', { exact: true }).click();
  await page.getByRole('button', { name: '查看系统应用设置', exact: true }).click();
  const calls = await page.evaluate(() => window.nativeCalls);
  assert.equal(calls.some(({ method }) => ['requestPermissions', 'install', 'openInstallSettings'].includes(method)), false);
  assert.deepEqual(calls.filter(({ plugin }) => plugin === 'Camera').map(({ method }) => method), ['takePhoto', 'chooseFromGallery', 'chooseFromGallery']);
  assert.equal(calls.filter(({ plugin }) => plugin === 'AppSettings').length, 1);
  assert.equal(calls.find(({ method }) => method === 'takePhoto').args.saveToGallery, false);
  assert.equal(calls.find(({ method }) => method === 'chooseFromGallery').args.mediaType, 0);
  assert.deepEqual(errors, []);
  writeFileSync('test-results/home-permission-verification.json', JSON.stringify({ version, checkedAt: new Date().toISOString(), syntheticOnly: true, nativeBridgeSimulated: true, nativeDeviceTested: false,
    geometry, checks: ['no permissions at startup/login', 'camera only after tap', 'denial leaves gallery usable', 'cancel is not an error', 'selected image saves local draft', 'student isolation', 'no automatic install authorization', 'app settings only after tap', 'home capped at one record; complete list on separate tab'] }, null, 2));
  console.log('Compact home and permission timing passed using synthetic API/native bridge. Not a physical-device test.');
} finally { await browser.close(); }
