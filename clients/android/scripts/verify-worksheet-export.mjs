import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// All data and requests are synthetic. The fixture is produced by the worksheet engine QA.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.env.FAMILY_WORKSHEET_QA_DIR || resolve(root, '../../work/qa-comprehensive-20261003/worksheet-client'));
const fixture = resolve(process.env.FAMILY_WORKSHEET_FIXTURE || resolve(root, '../../work/qa-comprehensive-20261003/word/worksheet-synthetic.docx'));
const bytes = readFileSync(fixture), hash = createHash('sha256').update(bytes).digest('hex');
mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright'), sharp = require('sharp');
const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="white"/><text x="40" y="80" font-size="30">Synthetic: F = ma</text><path d="M80 180H400 M150 180V130H260V180" fill="none" stroke="black" stroke-width="3"/></svg>')).jpeg().toBuffer();
const now = '2026-10-03T00:00:00Z', api = 'https://worksheet.invalid/api', client = 'http://127.0.0.1:3334';
const scans = [1,2].map(n => ({ id: `scan-${n}`, studentId: 'a', subject: '物理', source: '高二物理暑假作业（三）合成示例', originalName: 'synthetic.jpg', mimeType: 'image/jpeg', size: image.length, createdAt: now, revision: 1, status: 'ready', questions: [{ id: `q-${n}`, number: String(n), subject: '物理', prompt: n === 1 ? '质量为1kg的小车在水平面受2N的合力，求加速度。' : '题目定位摘要：待核对打印排版的题目', promptKind: n === 1 ? 'full' : 'summary', regions: [{ id: `r-${n}`, kind: 'stem', x: .05, y: .04, width: .9, height: .3 }], diagram: '', answerSteps: [], knowledgePoints: ['牛顿第二定律'], uncertainties: [], confirmed: true, wrongBook: { savedAt: now } }] }));
const requests = [], errors = [], checks = []; let version = 1, mode = 'ok', releaseExport, malformedPreview = false, answerReadyId = 'q-1';
const vite = await createServer({ root, server: { host: '127.0.0.1', port: 3334, strictPort: true, hmr: false, watch: null } }); await vite.listen();
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true }); page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message));
const downloads = []; page.on('download', item => downloads.push(item));
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url()); if (url.origin === client) return route.continue();
  const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
  if (url.pathname.endsWith('latest.json')) return send({}, 503);
  if (!url.href.startsWith(api)) { errors.push('Unexpected external request'); return route.abort(); }
  const path = url.pathname.slice('/api'.length); requests.push({ path, method: request.method(), body: request.postDataJSON(), url: url.href });
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (path === '/setup') return send({ enabled: true, registrationEnabled: true, worksheetExportVersion: version });
  if (path === '/session/login') return send({ token: 'synthetic-only-token', user: { id: 'synthetic-family', username: 'synthetic' }, expiresAt: Date.now() + 999999 });
  if (path === '/students') return send({ students: [{ id: 'a', name: '合成学生甲', createdAt: now }, { id: 'b', name: '合成学生乙', createdAt: now }], unassignedScanCount: 0 });
  if (path === '/scans') return send({ scans: url.searchParams.get('studentId') === 'a' ? scans : [], recognition: true });
  if (path === '/learning-sessions') return send({ sessions: [], more: false, enabled: true });
  if (path === '/worksheets/preview') {
    assert.equal(request.method(), 'POST'); const input = request.postDataJSON(); assert.equal(input.studentId, 'a');
    const items = input.selections.map(selected => { const ready = selected.questionId === (input.includeAnswers ? answerReadyId : 'q-1'); return { ...selected, sourceTitle: scans[0].source, originalNumber: selected.questionId.slice(2), subject: '物理', stars: 3, sourceFingerprint: hash, ready, reasons: ready ? [] : ['需核对完整打印排版，不能导出定位摘要'] }; });
    return send({ items: malformedPreview ? items.slice(1) : items, totalCount: items.length, readyCount: items.filter(i => i.ready).length });
  }
  if (path === '/worksheets/export') {
    assert.equal(request.method(), 'POST'); assert.equal(request.headers().authorization, 'Bearer synthetic-only-token'); assert.equal(url.search, '');
    const input = request.postDataJSON(); assert.equal(input.studentId, 'a'); assert.deepEqual(input.selections, [{ scanId: 'scan-1', questionId: 'q-1', revision: 1 }]);
    if (mode === 'hold') await new Promise(resolve => { releaseExport = resolve; });
    if (mode === 'conflict') return send({ error: '原题排版已变更，请重新检查' }, 409);
    if (mode === 'expired') return send({ error: '会话已过期' }, 401);
    return route.fulfill({ contentType: mode === 'html' ? 'text/html' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', headers: { 'content-length': String(bytes.length), 'access-control-expose-headers': 'X-Content-SHA256', 'x-content-sha256': mode === 'hash' ? 'a'.repeat(64) : hash }, body: bytes }).catch(() => {});
  }
  const scan = scans.find(s => path === `/scans/${s.id}` || path === `/scans/${s.id}/file`);
  if (scan) return path.endsWith('/file') ? route.fulfill({ contentType: 'image/jpeg', body: image }) : send({ scan });
  errors.push(`Unexpected ${request.method()} ${path}`); return route.abort();
});
const button = name => page.getByRole('button', { name, exact: true });
const dialog = () => page.getByRole('dialog', { name: '导出 Word 练习卷' });
const save = () => dialog().getByRole('button', { name: '保存 Word', exact: true });
async function openReady() { await button('导出 Word').click(); await dialog().getByText('需核对完整打印排版，不能导出定位摘要', { exact: true }).waitFor(); assert.equal(await dialog().getByRole('checkbox', { name: '选择第 2 题', exact: true }).isChecked(), true); await dialog().getByRole('button', { name: '仅选可导出题目（1 道）', exact: true }).click(); await save().waitFor(); await page.waitForFunction(() => !document.querySelector('.worksheet-export-dialog footer .primary')?.disabled); assert.equal(await dialog().getByRole('checkbox', { name: '选择第 2 题', exact: true }).isChecked(), false); await dialog().getByText('已选择 1 道可导出题目，其余题目已取消勾选', { exact: true }).waitFor(); }
async function waitHeld() { await page.waitForFunction(() => document.querySelector('.worksheet-export-dialog footer .primary')?.textContent.includes('正在')); for(let i=0; !releaseExport && i<100; i++) await new Promise(resolve=>setTimeout(resolve,20)); assert.ok(releaseExport); }
try {
  await page.goto(client, { timeout: 60000, waitUntil: 'domcontentloaded' }); await page.getByRole('navigation', { name: '账户' }).getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('家庭服务地址').fill(api); await page.getByLabel('账号', { exact: true }).fill('synthetic'); await page.getByLabel('密码', { exact: true }).fill('synthetic-only'); await page.locator('form').getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('navigation', { name: '主要页面' }).getByRole('button', { name: '题目', exact: true }).click(); await button('导出 Word').waitFor();
  await button('导出 Word').click(); await dialog().getByText('需核对完整打印排版，不能导出定位摘要', { exact: true }).waitFor(); assert.equal(await save().isEnabled(), false); assert.equal(await dialog().getByRole('checkbox', { name: '另附参考答案与解析' }).isChecked(), false);
  for (const width of [320,390,768]) { await page.setViewportSize({ width, height: 844 }); await page.evaluate(()=>{ for(const [k,v] of Object.entries({'--safe-area-inset-left':'20px','--safe-area-inset-right':'15px','--app-safe-top':'24px','--app-safe-bottom':'16px'})) document.documentElement.style.setProperty(k,v); }); assert.equal(await dialog().evaluate(el=>el.scrollWidth<=el.clientWidth+1), true); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), true); await page.screenshot({ path: resolve(out, `worksheet-${width}.png`) }); }
  await dialog().getByRole('button', { name: '查看原题并核对', exact: true }).click(); await button('返回资料列表').waitFor(); assert.equal(await dialog().count(), 0); await button('返回资料列表').click(); await button('导出 Word').waitFor();
  checks.push('Current filtered selection defaults to all, answers opt-in; incomplete printing content blocks download with a working detail/back link; 320/390/768 safe-inset layouts do not overflow.');
  version=0; await button('导出 Word').click(); await dialog().getByText('家庭服务需要升级后才能导出 Word', { exact:true }).waitFor(); assert.equal(await save().isEnabled(),false); version=1; malformedPreview=true; await dialog().getByRole('button',{name:'重新检查打印内容',exact:true}).click(); await dialog().getByText('打印检查结果与所选题目不一致，请刷新后重试',{exact:true}).waitFor(); malformedPreview=false; await dialog().getByRole('button',{name:'重新检查打印内容',exact:true}).click(); await dialog().getByText('需核对完整打印排版，不能导出定位摘要',{exact:true}).waitFor(); await button('关闭 Word 导出').click();
  checks.push('Old server gives upgrade reason, malformed preview cannot drop a selection, retry refreshes capabilities and content.');
  answerReadyId='q-2'; await button('导出 Word').click(); await dialog().getByRole('button',{name:'仅选可导出题目（1 道）',exact:true}).waitFor(); await dialog().getByRole('checkbox',{name:'另附参考答案与解析'}).check(); await dialog().locator('li').filter({has:page.getByRole('checkbox',{name:'选择第 2 题',exact:true})}).getByText('可导出',{exact:true}).waitFor(); await dialog().getByRole('button',{name:'仅选可导出题目（1 道）',exact:true}).click(); await page.waitForFunction(()=>!document.querySelector('.worksheet-export-dialog footer .primary')?.disabled); assert.equal(await dialog().getByRole('checkbox',{name:'选择第 1 题',exact:true}).isChecked(),false); assert.equal(await dialog().getByRole('checkbox',{name:'选择第 2 题',exact:true}).isChecked(),true); assert.equal(requests.filter(r=>r.path==='/worksheets/preview').at(-1).body.includeAnswers,true); assert.equal(await dialog().getByRole('button',{name:/仅选可导出题目/}).count(),0); await button('关闭 Word 导出').click(); answerReadyId='q-1';
  checks.push('Ready-only selection is explicit, reports its count, preserves displayed order and uses current answer-option readiness; unready items are never silently dropped.');
  await openReady(); await dialog().getByRole('checkbox',{name:'另附参考答案与解析'}).check(); await page.waitForFunction(()=>!document.querySelector('.worksheet-export-dialog footer .primary')?.disabled);
  const downloaded=page.waitForEvent('download'); await save().click(); const result=await downloaded; await result.saveAs(resolve(out,'downloaded-synthetic.docx')); assert.equal(createHash('sha256').update(readFileSync(resolve(out,'downloaded-synthetic.docx'))).digest('hex'),hash); assert.equal(requests.filter(r=>r.path==='/worksheets/export').at(-1).body.includeAnswers,true); await dialog().getByText('已开始下载 Word，请在浏览器下载列表查看',{exact:true}).waitFor(); await button('关闭 Word 导出').click();
  checks.push('Real browser download equals the synthetic engine DOCX SHA-256; authenticated POST only and explicit answer option forwarded.');
  for(const failure of ['conflict','html','hash']) { mode=failure; await openReady(); const n=downloads.length; await save().click(); await dialog().getByRole('alert').waitFor(); assert.equal(downloads.length,n); assert.equal(await dialog().getByRole('checkbox',{name:'选择第 1 题',exact:true}).isChecked(),true); await button('关闭 Word 导出').click(); }
  checks.push('409, wrong MIME and bad digest retain selection and show errors without downloading JSON, HTML or corrupt content.');
  mode='hold'; releaseExport=undefined; await openReady(); await save().click(); await waitHeld(); const n=downloads.length; await dialog().getByRole('button',{name:'取消导出',exact:true}).click(); await dialog().getByText('已取消导出',{exact:true}).waitFor(); mode='ok'; releaseExport(); assert.equal(downloads.length,n); await button('关闭 Word 导出').click();
  mode='hold'; releaseExport=undefined; await openReady(); await save().click(); await waitHeld(); await page.keyboard.press('Escape'); await dialog().waitFor({state:'detached'}); mode='ok'; releaseExport(); assert.equal(downloads.length,n);
  mode='hold'; releaseExport=undefined; await openReady(); await save().click(); await waitHeld(); await page.getByLabel('当前学生').evaluate(el=>{el.value='b';el.dispatchEvent(new Event('change',{bubbles:true}));}); await dialog().waitFor({state:'detached'}); mode='ok'; releaseExport(); await page.getByText('还没有错题，先从首页录入。',{exact:true}).waitFor(); assert.equal(downloads.length,n); assert.equal(await page.locator('.question-card').count(),0);
  checks.push('Explicit cancel, Escape and forced student change abort an in-flight export; late successful bytes produce no download or other-student result.');
  await page.getByLabel('当前学生').selectOption('a'); mode='expired'; await openReady(); await save().click(); await page.getByText('登录已过期，请重新登录。未完成的本机草稿仍然保留。',{exact:true}).waitFor(); assert.equal(await dialog().count(),0); assert.equal(await page.locator('.question-card').count(),0); assert.equal(downloads.length,n);
  checks.push('Expired export authentication closes personal views, clears session and requests login without a download.');
  assert.deepEqual(errors,[]); assert.equal(requests.some(r=>r.url.includes('synthetic-only-token')),false); assert.equal(requests.some(r=>r.method==='POST'&&!['/session/login','/worksheets/preview','/worksheets/export'].includes(r.path)),false);
  writeFileSync(resolve(out,'result.json'),JSON.stringify({status:'passed',syntheticOnly:true,productionWrites:0,realModelCalls:0,nativeHandsetTest:false,checks,errors,downloadBytes:bytes.length,downloadSha256:hash},null,2)); console.log(JSON.stringify({status:'passed',checks}));
} catch(error) { await page.screenshot({path:resolve(out,'failure.png'),fullPage:true}); throw error; }
finally { await browser.close(); await vite.close(); }
