import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { installSyntheticPhotoBridge } from './synthetic-photo-bridge.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
if (!process.env.PHOTO_QA_OUTPUT) throw new Error('Set PHOTO_QA_OUTPUT to a project artifacts/qa directory');
const out = path.resolve(process.env.PHOTO_QA_OUTPUT); await mkdir(out, { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:3297', api = origin + '/test-api';
const server = await createServer({ root, server: { host: '127.0.0.1', port: 3297, strictPort: true } }); await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], checks = [], records = new Map(), uploads = []; let loseReceipt = true, active = 0, peak = 0, delay = 0, blockedExternal = 0;
const students = ['a', 'b'].map(id => ({ id, name: '合成孩子' + id, createdAt: '2026-10-02T00:00:00Z' }));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const files = count => Array.from({ length: count }, (_, n) => ({ name: `合成照片-${n + 1}.png`, mimeType: 'image/png', buffer: png }));
async function routes(context) {
  context.on('page', page => { page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message)); });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.href.includes('/downloads/android/latest.json')) return route.fulfill({ status: 503, body: '{}' });
    if (url.origin !== origin) { blockedExternal++; return route.abort(); }
    if (!url.pathname.startsWith('/test-api')) return route.continue();
    const endpoint = url.pathname.slice('/test-api'.length), method = req.method();
    const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (endpoint === '/session') return send({ user: { id: 'A', username: '合成家庭' } });
    if (endpoint === '/session/login') return send({ token: 'test-A', user: { id: 'A', username: '合成家庭' } });
    if (endpoint === '/students') return send({ students });
    if (endpoint === '/setup') return send({ enabled: true, processedPhotoMetadataVersion: 1 });
    if (endpoint === '/scans' && method === 'GET') return send({ scans: [...records.values()].filter(s => s.studentId === url.searchParams.get('studentId')), recognition: false });
    if (endpoint === '/scans' && method === 'POST') {
      active++; peak = Math.max(peak, active);
      const body = req.postDataBuffer().toString('utf8'), field = name => new RegExp('name="' + name + '"\\r\\n\\r\\n([^\\r]*)').exec(body)?.[1];
      const id = field('clientRequestId'), studentId = field('studentId'); uploads.push({ id, studentId });
      const scan = records.get(id) || { id, studentId, subject: '', source: 'synthetic', originalName: '合成照片.png', mimeType: 'image/png', size: png.length,
        createdAt: new Date().toISOString(), revision: 1, status: 'ready', questions: [] };
      records.set(id, scan);
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      active--;
      if (loseReceipt && uploads.length === 34) { loseReceipt = false; return route.abort('connectionreset'); }
      return send({ scan });
    }
    throw new Error('Unexpected API ' + method + ' ' + endpoint);
  });
}
let page;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); await routes(context);
  await context.addInitScript(api => localStorage.setItem('family-learning:server', api), api);
  page = await context.newPage();
  const button = name => page.getByRole('button', { name, exact: true });
  const login = async () => { await button('登录').click(); await page.getByLabel('账号', { exact: true }).fill('synthetic'); await page.getByLabel('密码', { exact: true }).fill('synthetic-password'); await page.locator('form').getByRole('button', { name: '登录', exact: true }).click(); await page.getByLabel('当前学生').waitFor(); };
  const select = async (label, count) => { const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: label, exact: typeof label === 'string' }).click(); const picker = await chooser; assert.equal(picker.isMultiple(), true); await picker.setFiles(files(count)); };
  await page.goto(origin); await login();
  await select(/相册选图/, 101); await page.getByRole('alert').filter({ hasText: '最多 100 张' }).waitFor();
  assert.equal(await page.locator('.capture-batch-grid article').count(), 0);
  await select('从相册添加', 100); await page.waitForFunction(() => document.querySelectorAll('.capture-batch-grid article').length === 100);
  assert.equal(await button('继续拍照').isDisabled(), true); assert.equal(await button('从相册添加').isDisabled(), true); assert.equal(uploads.length, 0);
  await page.setViewportSize({ width: 320, height: 740 }); await page.screenshot({ path: path.join(out, 'capture-100-320.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  checks.push('真实浏览器多选101张明确拒绝；100张全部入本机草稿；达到上限后禁用继续添加；选择本身不上传');
  await button('完成选择，查看待上传').click(); await page.getByRole('button', { name: /确认并批量上传（100 张）/ }).click();
  await page.getByText('本批上传结束：成功 99 张，失败 1 张。未确认成功的照片仍留在本机，可继续上传。', { exact: true }).waitFor();
  assert.equal(uploads.length, 100); assert.equal(records.size, 100); assert.equal(peak, 1); assert.equal(await page.locator('.draft-card').count(), 1);
  const failed = uploads[33].id;
  await page.reload(); await login(); await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: /^题目/ }).click();
  await page.getByRole('button', { name: /确认并批量上传（1 张）/ }).click();
  await page.getByText('本批上传结束：成功 1 张，失败 0 张。未确认成功的照片仍留在本机，可继续上传。', { exact: true }).waitFor();
  assert.equal(uploads.at(-1).id, failed); assert.equal(records.size, 100); assert.equal(await page.locator('.draft-card').count(), 0);
  checks.push('100张顺序上传；丢失回执后99成功1失败；刷新恢复待提交项并用同ID重试，服务器仍只有100份');
  await select(/相册选图/, 5); await button('完成选择，查看待上传').click(); delay = 600;
  await page.getByRole('button', { name: /确认并批量上传（5 张）/ }).click(); await button('停止本批上传').click();
  await page.getByText(/本批已停止：/).waitFor(); const stoppedAt = uploads.length;
  await new Promise(resolve => setTimeout(resolve, 800)); assert.equal(uploads.length, stoppedAt); assert.equal(await page.locator('.draft-card').count(), 5);
  await page.getByLabel('当前学生').selectOption('b'); assert.equal(await page.locator('.draft-card').count(), 0);
  await page.getByLabel('当前学生').selectOption('a'); assert.equal(await page.locator('.draft-card').count(), 5); delay = 0;
  checks.push('停止后不启动后续上传，未确认项保留；切换孩子不串草稿');
  await context.close();
  const native = await browser.newContext({ viewport: { width: 390, height: 844 } }); await routes(native);
  await native.addInitScript(installSyntheticPhotoBridge, { api }); page = await native.newPage();
  await page.goto(origin); await page.getByLabel('当前学生').waitFor(); await page.getByRole('button', { name: /拍照收题/ }).click();
  await page.getByRole('button', { name: '继续拍照', exact: true }).click();
  await page.getByRole('heading', { name: '本批照片 · 2 / 100', exact: true }).waitFor();
  await page.getByRole('button', { name: '完成选择，逐张调整', exact: true }).click();
  await page.getByText('逐张调整 · 第 1 / 2 张', { exact: true }).waitFor();
  await page.getByRole('button', { name: '生成预览', exact: true }).click();
  await page.getByRole('button', { name: '确认使用处理图', exact: true }).click();
  await page.getByText('逐张调整 · 第 2 / 2 张', { exact: true }).waitFor();
  await page.getByRole('button', { name: '生成预览', exact: true }).click(); await page.getByRole('button', { name: '确认使用处理图', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '上传处理图', exact: true }).count(), 2);
  checks.push('合成原生桥连续拍摄两张，逐张预览确认进入同一待提交队列，确认前不上传');
  assert.deepEqual(errors, []); assert.equal(blockedExternal, 0);
  const result = { checkedAt: new Date().toISOString(), syntheticOnly: true, nativeDeviceTested: false, checks, uploadAttempts: uploads.length, maxConcurrentUploads: peak, errors };
  await writeFile(path.join(out, 'capture-batch-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { if (page && !page.isClosed()) { await page.screenshot({ path: path.join(out, 'capture-batch-failure.png'), fullPage: true }); console.error((await page.locator('body').innerText()).slice(0, 3000)); } throw error; }
finally { await browser.close(); await server.close(); }
