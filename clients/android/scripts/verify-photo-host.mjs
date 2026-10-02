import { installSyntheticPhotoBridge } from './synthetic-photo-bridge.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
if (!process.env.PHOTO_QA_OUTPUT) throw new Error('Set PHOTO_QA_OUTPUT to a project artifacts/qa directory');
const out = path.resolve(process.env.PHOTO_QA_OUTPUT); await mkdir(out, { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:3294', api = origin + '/test-api';
const server = await createServer({ root, server: { host: '127.0.0.1', port: 3294, strictPort: true } }); await server.listen();
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errors = [], checks = [], uploads = [], records = new Map(); let replyMode = 'success', replyDelay = 0;
await context.addInitScript(installSyntheticPhotoBridge, { api });
const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
const students = ['a', 'b'].map(id => ({ id, name: '测试学生' + id.toUpperCase(), createdAt: '2026-10-01T12:00:00Z' }));
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.href.includes('/downloads/android/latest.json')) return route.fulfill({ status: 503, body: '{}' });
  if (url.origin !== origin) throw new Error('Unexpected external request: ' + url.origin);
  if (!url.pathname.startsWith('/test-api')) return route.continue();
  const endpoint = url.pathname.slice('/test-api'.length), method = request.method();
  const token = request.headers().authorization?.replace('Bearer test-', '') || 'A';
  const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  if (endpoint === '/session') return send({ user: { id: token, username: '家庭' + token } });
  if (endpoint === '/setup') return send({ enabled: true, needsSetup: false, ...(replyMode === 'old-server' ? {} : { processedPhotoMetadataVersion: 1 }) });
  if (endpoint === '/session/login') { const letter = request.postDataJSON().username; return send({ token: 'test-' + letter, user: { id: letter, username: '家庭' + letter } }); }
  if (endpoint === '/session/logout') return send({ ok: true });
  if (endpoint === '/students') return send({ students });
  if (endpoint === '/scans' && method === 'GET') return send({ scans: [...records.values()].filter(s => s.owner === token && s.studentId === url.searchParams.get('studentId')), recognition: true });
  if (endpoint === '/scans' && method === 'POST') {
    const raw = request.postDataBuffer(), body = raw.toString('utf8');
    const field = name => new RegExp('name="' + name + '"\\r\\n\\r\\n([^\\r]*)').exec(body)?.[1];
    const processing = field('processing') ? JSON.parse(field('processing')) : null;
    const id = field('clientRequestId'), studentId = field('studentId');
    uploads.push({ id, studentId, processing, sourceKind: field('sourceKind'), owner: token });
    if (processing) {
      assert.equal(id, processing.outputId); assert.equal(field('sourceKind'), 'processed-photo'); assert.equal(studentId, processing.studentId);
      assert.ok(!body.includes('file:///') && !body.includes('originalUri') && !body.includes('record') && !body.includes(api + '|'));
    }
    if (replyMode === 'offline') return route.abort('internetdisconnected');
    if (replyDelay) await new Promise(resolve => setTimeout(resolve, replyDelay));
    const scan = { id: 'scan-' + id, studentId, subject: '', source: 'synthetic', originalName: '题图.jpg', mimeType: processing?.mime || 'image/png',
      size: processing?.bytes || 100, createdAt: new Date().toISOString(), revision: 1, status: 'ready', questions: [], owner: token,
      ...(processing ? { sourceKind: 'processed-photo', processing } : {}) };
    if (replyMode === 'old-server') { delete scan.sourceKind; delete scan.processing; }
    if (replyMode === 'wrong-receipt') scan.processing = { ...processing, sha256: '0'.repeat(64) };
    if (replyMode === 'success') records.set(token + '/' + id, scan);
    return send({ scan });
  }
  throw new Error('Unexpected API: ' + method + ' ' + endpoint);
});
const button = name => page.getByRole('button', { name, exact: true });
const waitHome = async () => { await page.getByLabel('当前学生').waitFor(); };
const library = async () => { await page.getByRole('button', { name: /题目/, exact: true }).last().click(); };
const pendingCount = () => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('family-photo-delivery-v1:')).length);
const confirmPhoto = async () => {
  await button('生成预览').click(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '确认使用处理图')?.disabled);
  await button('确认使用处理图').click(); await button('上传处理图').waitFor();
};
try {
  await page.goto(origin); await waitHome(); await page.getByRole('button', { name: /拍照收题/ }).click();
  await button('完成选择，逐张调整').click();
  await page.getByRole('heading', { name: '把题目拍清楚' }).waitFor();
  assert.equal(uploads.length, 0); await button('取消，保留原片').click(); await button('本机原片').click();
  await button('继续处理').waitFor(); assert.equal(await page.locator('.photo-library-card').count(), 1);
  await button('继续处理').click(); await confirmPhoto();
  assert.equal(uploads.length, 0); assert.equal(await pendingCount(), 1);
  checks.push('拍照先存原片；取消后可恢复；确认仅入队且没有网络上传');
  await page.reload(); await waitHome(); await library(); await button('上传处理图').waitFor();
  replyMode = 'offline'; await button('上传处理图').click(); await page.getByRole('alert').filter({ hasText: '待提交照片已保留' }).waitFor();
  assert.equal(await pendingCount(), 1);
  const beforeOldServer = uploads.length;
  replyMode = 'old-server'; await button('上传处理图').click(); await page.getByRole('alert').filter({ hasText: '需要升级服务' }).waitFor();
  assert.equal(await pendingCount(), 1);
  assert.equal(uploads.length, beforeOldServer);
  replyMode = 'wrong-receipt'; await button('上传处理图').click(); await page.getByRole('alert').filter({ hasText: '回执' }).waitFor();
  assert.equal(await pendingCount(), 1);
  replyMode = 'success'; await button('上传处理图').click(); await page.waitForFunction(() => !Object.keys(localStorage).some(k => k.startsWith('family-photo-delivery-v1:')));
  assert.equal(await pendingCount(), 0); assert.equal(new Set(uploads.map(u => u.id)).size, 1);
  await button('本机原片').click(); await button('继续处理').waitFor(); assert.equal(await page.locator('.photo-library-card').count(), 1);
  checks.push('重启恢复；断网、旧服务器、错误回执保留；匹配回执才清队列，同outputId重试；上传后原片保留');
  await button('返回题目资料').click(); await page.evaluate(() => window.hostPhotoTest.seedRestore('b')); await page.reload(); await waitHome();
  assert.equal(await page.getByRole('heading', { name: '把题目拍清楚' }).count(), 0);
  await page.getByLabel('当前学生').selectOption('b'); await page.getByRole('heading', { name: '把题目拍清楚' }).waitFor();
  assert.match(await page.locator('.photo-prep-student').innerText(), /B/); await confirmPhoto();
  checks.push('App认证前接住Camera restore；切到原所属学生才导入和显示');
  replyDelay = 450; await button('上传处理图').click(); await page.getByLabel('当前学生').selectOption('a'); await page.waitForTimeout(650);
  assert.equal(await pendingCount(), 1); assert.equal(await button('上传处理图').count(), 0);
  await page.getByLabel('当前学生').selectOption('b'); await button('上传处理图').waitFor(); replyDelay = 0;
  await page.evaluate(() => { const key = Object.keys(localStorage).find(k => k.startsWith('family-photo-delivery-v1:')); const scope = JSON.parse(key.slice('family-photo-delivery-v1:'.length)); scope[2] = 'broken-record'; localStorage.setItem('family-photo-delivery-v1:' + JSON.stringify(scope), '{bad'); });
  await button('刷新').click(); await page.getByRole('alert').filter({ hasText: '无法恢复' }).waitFor(); assert.equal(await button('上传处理图').count(), 1);
  await page.screenshot({ path: path.join(out, 'host-pending-isolation.png'), fullPage: true });
  await button('上传处理图').click(); await page.waitForFunction(() => Object.keys(localStorage).filter(k => k.startsWith('family-photo-delivery-v1:')).length === 1);
  assert.equal(await pendingCount(), 1); // Only explicitly marked corrupt entry remains.
  await page.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('family-photo-delivery-v1:')); const scope = JSON.parse(k.slice('family-photo-delivery-v1:'.length)); scope[2] = { invalid: true }; localStorage.setItem('family-photo-delivery-v1:' + JSON.stringify(scope), '{bad'); });
  await button('刷新').click();
  const brokenObject = page.locator('.draft-card').filter({ hasText: '未知编号' }); await brokenObject.waitFor();
  await brokenObject.getByRole('button', { name: '移除这条损坏记录，保留原片', exact: true }).click();
  assert.equal(await pendingCount(), 1); assert.equal(await brokenObject.count(), 0);
  checks.push('上传中换学生回执不串；坏记录单独提示，健康项仍能重试');
  checks.push('损坏记录非字符串编号安全显示，显式移除只删该条引用');
  await page.evaluate(() => window.hostPhotoTest.switchAccount('B')); await waitHome(); await library();
  assert.equal(await page.getByText('这份本机待提交记录无法恢复', { exact: false }).count(), 0);
  await button('本机原片').click(); await page.getByText('这位学生在本机还没有保存的原片。').waitFor();
  await button('返回题目资料').click();
  // Keep existing simple account actions discoverable.
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await button('修改用户名').waitFor(); await button('修改密码').waitFor();
  checks.push('换账号不能见另一账号的原片和待提交；我的页用户名/密码入口保留');
  await page.evaluate(() => window.hostPhotoTest.switchAccount('A')); await waitHome(); await page.getByLabel('当前学生').selectOption('a');
  await page.evaluate(({ api }) => {
    localStorage.setItem('family-learning:pending-camera', JSON.stringify({ owner: api + '|A', studentId: 'a' }));
    localStorage.setItem('family-learning:camera-result-v1:unknown-corrupt', '{bad');
  }, { api });
  await page.reload(); await waitHome(); await library(); await button('取消未完成的相机操作').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('family-learning:pending-camera')), null);
  await page.getByRole('button', { name: /拍照收题/ }).click(); await button('完成选择，逐张调整').click(); await page.getByRole('heading', { name: '把题目拍清楚' }).waitFor();
  const queueBeforeBack = await pendingCount();
  await page.evaluate(() => window.hostPhotoTest.delay(500)); await button('生成预览').click();
  await page.evaluate(() => window.hostPhotoTest.back()); await button('本机原片').waitFor(); await page.waitForTimeout(700);
  assert.equal(await pendingCount(), queueBeforeBack); assert.equal(await page.getByRole('heading', { name: '把题目拍清楚' }).count(), 0);
  await button('本机原片').click(); await page.locator('.photo-library-card').first().waitFor(); assert.equal(await page.locator('.photo-library-card').count(), 2);
  await page.evaluate(() => window.hostPhotoTest.back()); await button('本机原片').waitFor();
  checks.push('处理途中系统返回立即取消迟到入队，原片仍在；原片库系统返回退回资料页');
  await page.getByRole('button', { name: /拍照收题/ }).click(); await button('完成选择，逐张调整').click(); await page.getByRole('heading', { name: '把题目拍清楚' }).waitFor();
  await page.evaluate(() => window.hostPhotoTest.delay(750)); await button('生成预览').click();
  await page.evaluate(() => window.hostPhotoTest.expire());
  await page.getByLabel('账号', { exact: true }).fill('B'); await page.getByLabel('密码', { exact: true }).fill('synthetic-password');
  await page.locator('form').getByRole('button', { name: '登录', exact: true }).click(); await waitHome(); await page.waitForTimeout(900);
  assert.equal(await page.getByRole('heading', { name: '把题目拍清楚' }).count(), 0);
  await library(); assert.equal(await button('上传处理图').count(), 0);
  await button('本机原片').click(); await page.getByText('这位学生在本机还没有保存的原片。').waitFor(); await button('返回题目资料').click();
  checks.push('旧版本相机上下文可由原账号取消；未知坏相机记录不挡新拍摄；处理途中登录过期换账号不显示迟到结果');
  await page.goto(origin + '/?legacy=1'); await waitHome(); await page.getByRole('button', { name: /拍照收题/ }).click();
  await button('完成选择，查看待上传').click();
  await button('确认并上传').waitFor(); assert.equal(await page.getByRole('heading', { name: '把题目拍清楚' }).count(), 0);
  await button('确认并上传').click(); await page.waitForFunction(() => document.querySelectorAll('.draft-card').length === 0);
  assert.equal(uploads.at(-1).processing, null);
  checks.push('未注册原生照片插件保留原有Blob草稿和上传路径');
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'host-result.json'), JSON.stringify({ syntheticBridgeOnly: true, nativeRuntimeTested: false, checks, uploadAttempts: uploads.length, uniqueProcessedIds: new Set(uploads.filter(u => u.processing).map(u => u.id)).size, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors, uploads: uploads.length }, null, 2));
} catch(e) { await page.screenshot({ path: path.join(out, 'host-failure.png'), fullPage: true }); console.error((await page.locator('body').innerText()).slice(0, 5000)); throw e; }
finally { await browser.close(); await server.close(); }
