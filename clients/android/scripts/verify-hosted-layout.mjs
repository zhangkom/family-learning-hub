import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.env.FAMILY_WEB_LAYOUT_QA_DIR || resolve(root, '../../work/qa-hosted-web-layout'));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const sharp = require('sharp');
mkdirSync(out, { recursive: true });
const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="540"><rect width="800" height="540" fill="white"/><g font-family="sans-serif" fill="#182440"><text x="40" y="60" font-size="24">13. F = ma — synthetic example</text><rect x="260" y="200" width="170" height="100" fill="none" stroke="#182440" stroke-width="3"/><path d="M80 314H700M440 240H600L585 230M600 240L585 250" fill="none" stroke="#182440" stroke-width="3"/><text x="550" y="225" font-size="28">F</text><text x="40" y="430" font-size="24">A. F = ma     B. F + f = ma</text></g></svg>')).png().toBuffer();
const hash = createHash('sha256').update(image).digest('hex');
const source = { documentId: 'synthetic-paper', title: '高二物理暑假作业（三）· 合成布局验收示例', subject: '物理', pageNumber: 2, pageCount: 4, revision: 1, photoId: 'synthetic-photo', scanSha256: hash };
const scan = { id: 'synthetic-scan', studentId: 'synthetic-a', source: source.title, sourcePage: source, subject: '物理', originalName: 'synthetic.png', mimeType: 'image/png', size: image.length, createdAt: '2026-10-03T00:00:00Z', revision: 1, status: 'ready', questions: [{ id: 'synthetic-question', number: '13', subject: '物理', prompt: '如图，水平面上的小车受到水平推力 F。请结合图示分析小车受力，并写出加速度与合力之间的关系。', diagram: '', confirmed: true, knowledgePoints: ['牛顿第二定律'], answerSteps: [], uncertainties: [], wrongBook: { savedAt: '2026-10-03T00:00:00Z' }, sourcePage: source, regions: [{ id: 'synthetic-region', kind: 'stem', x: 0.02, y: 0.02, width: .96, height: .90 }] }] };
const p = path => JSON.stringify(resolve(root, 'src', path).replaceAll('\\', '/'));
const fixtureId = resolve(out, 'hosted-fixture.tsx');
const fixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {HomeView} from ${p('HomeView.tsx')};import {GuestHome} from ${p('GuestHome.tsx')};import {LearningHub} from ${p('LearningHub.tsx')};
import {useHostedWebNavigation} from ${p('web-navigation.ts')};import {isHostedWeb} from ${p('hosted-web.ts')};
import ${p('styles.css')};import ${p('library-layout.css')};import ${p('web.css')};
const scan=${JSON.stringify(scan)};const bytes=Uint8Array.from(atob(${JSON.stringify(image.toString('base64'))}),c=>c.charCodeAt(0));
const api={learningSessions:async()=>({sessions:[],enabled:true,more:false}),image:async()=>new File([bytes],'synthetic.png',{type:'image/png'}),setup:async()=>({questionDifficultyVersion:1,collectionReviewVersion:1}),weaknessOverview:async()=>({enabled:true,axes:[],materials:{total:0,eligible:0,selected:0,needsReview:0,omitted:0,pendingSources:[],pendingMore:0,version:'synthetic'}})};
const students=[{id:'synthetic-a',name:'布局验证甲',grade:'高二'},{id:'synthetic-b',name:'布局验证乙',grade:'高一'}];
function Fixture(){const {route,navigate}=useHostedWebNavigation();const [selected,setSelected]=useState('synthetic-a');const [context,setContext]=useState({subject:'全部',order:'newest',dimension:''});
const records=selected==='synthetic-a'?[scan]:[];const toPage=page=>navigate({page});const learn=(mode,source,sessionId)=>navigate({...route,learning:{mode,source,sessionId}});
if(new URLSearchParams(location.search).has('guest'))return <GuestHome page={route.page} onNavigate={toPage} onAuth={()=>{}}/>;
if(route.learning)return <LearningHub api={api} owner="synthetic-owner" studentId={selected} studentName="布局验证甲" records={records} view={route.learning} onClose={()=>navigate({page:route.page,libraryMode:route.libraryMode})} onOpenSource={()=>{}} onRefreshSources={()=>{}}/>;
return <HomeView api={api} owner="synthetic-owner" username="合成布局验收账号" students={students} selected={selected} records={records} localDrafts={[]} busy={false} uploading="" refreshing={false} recognition={true} error="" notice="" page={route.page} onNavigate={toPage} libraryMode={route.libraryMode||'wrong'} onLibraryMode={libraryMode=>navigate({page:'library',libraryMode})} libraryContext={context} onLibraryContext={setContext} studentOverview={{students:students.map(s=>({...s,overview:{scanCount:s.id===selected?records.length:0,questionCount:s.id===selected?records.length:0,wrongQuestionCount:s.id===selected?records.length:0,needsReviewCount:0,cloudPhotoCount:0}})),unassignedScanCount:0}} overviewError="" onRefreshOverview={()=>{}} onSelect={setSelected} onCapture={()=>{}} learningRevision={0} onLearn={learn} onRefresh={()=>{}} onOpenScan={()=>{}} onUpdateScan={()=>{}} onLogout={()=>{}} onAddStudent={async()=>false} onUpdateAccount={async()=>''} renderDraft={()=>null} onOpenCloud={()=>{}}><div className="family-links">合成布局验收 · 非真实学生资料</div></HomeView>;
}document.getElementById('root').className=isHostedWeb?'hosted-web':'';createRoot(document.getElementById('root')).render(<Fixture/>);`;
writeFileSync(fixtureId, fixture);
const checks = [], errors = [], screenshots = [];
let browser, vite, page;
const check = (id, value) => { checks.push({ id, passed: !!value }); assert.ok(value, id); };
try {
  vite = await createServer({ root, define: { 'import.meta.env.VITE_FAMILY_WEB': '"true"' }, resolve: { dedupe: ['react', 'react-dom'] }, server: { host: '127.0.0.1', port: 3346, strictPort: true, hmr: false, watch: null, fs: { allow: [resolve(root, '../..')] } }, plugins: [{ name: 'hosted-layout-fixture', resolveId(id) { if (id === '/__hosted-fixture.tsx') return fixtureId; }, load(id) { if (id === fixtureId) return fixture; }, configureServer(server) { server.middlewares.use((req, res, next) => { if (req.url?.split('?')[0] !== '/__hosted-layout') return next(); res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module" src="/@fs/${fixtureId.replaceAll('\\', '/')}"></script></body></html>`); }); } }] });
  await vite.listen(); browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('503')) console.error('browser:', message.text()); });
  page.on('requestfailed', request => console.error('request failed:', request.url(), request.failure()?.errorText));
  await page.route('**/*', route => { const u = new URL(route.request().url()); if (u.pathname.endsWith('/latest.json')) return route.fulfill({ status: 503, body: '{}' }); return u.origin === 'http://127.0.0.1:3346' ? route.continue() : route.abort(); });
  const open = async (hash, guest = false) => { await page.goto(`http://127.0.0.1:3346/__hosted-layout${guest ? '?guest=1' : ''}${hash}`); await page.locator('.hosted-web').waitFor(); };
  const nav = name => page.getByRole('navigation', { name: '主要页面' }).getByRole('link', { name, exact: true });
  const shot = async name => { await page.screenshot({ path: resolve(out, name + '.png'), fullPage: false }); screenshots.push(name + '.png'); };
  for (const width of [320, 390, 768, 1280, 1600]) {
    await page.setViewportSize({ width, height: 900 }); await open('#/home'); await page.locator('.capture-entry-grid').waitFor();
    check(`home-no-overflow-${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const capture = await page.locator('.capture-entry').first().boundingBox(), module = await page.locator('.learning-module').first().boundingBox();
    check(`main-entries-larger-and-above-modules-${width}`, capture.height > module.height && capture.y + capture.height < module.y);
    const bar = await page.locator('.bottom-nav').boundingBox(); check(`navigation-position-${width}`, width >= 1024 ? bar.y < 80 : bar.y > 760);
    if(width>=1024){const brand=await page.locator('.brand').boundingBox(), student=await page.locator('.student-switcher').boundingBox();check(`header-regions-do-not-overlap-${width}`,brand.x+brand.width<bar.x&&bar.x+bar.width<student.x);}
    await shot(`home-${width}`); await nav('题目').click(); await page.locator('.question-card').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.question-crops img')].some(i => i.complete && i.naturalWidth > 0));
    check(`question-no-overflow-${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check(`question-reading-width-${width}`, (await page.locator('.question-card').boundingBox()).width <= 880);
    await shot(`question-${width}`); await page.getByRole('button', { name: '知识点', exact: true }).click(); await page.getByRole('region', { name: '本题知识点' }).waitFor();
    check(`knowledge-no-overflow-${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await shot(`knowledge-${width}`);
    await nav('我的').click(); await page.locator('.student-profile-card').first().waitFor(); check(`account-no-overflow-${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await open('#/home', true); await page.locator('.capture-entry-grid').waitFor(); check(`guest-no-overflow-${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await nav('我的').click(); await page.locator('.web-app-info').waitFor(); check(`web-no-apk-update-provider-${width}`, !await page.locator('.guest-update-panel,.update-control').count());
  }
  await page.setViewportSize({ width: 1280, height: 900 }); await open('#/home'); await nav('题目').click(); await nav('我的').click(); await page.goBack(); await page.waitForURL('**#/questions'); await page.locator('.question-library').waitFor();
  check('browser-back', await nav('题目').getAttribute('aria-current') === 'page'); await page.goForward(); await page.waitForURL('**#/me'); await page.reload(); await page.locator('.student-profile-card').first().waitFor(); check('forward-and-refresh', await nav('我的').getAttribute('aria-current') === 'page');
  await open('#/learn/practice?scan=synthetic-scan&question=synthetic-question&from=library'); await page.locator('.learning-hub').waitFor(); await page.reload(); await page.locator('.learning-hub').waitFor(); check('learning-refresh-preserves-mode-and-source', page.url().includes('/learn/practice?scan=synthetic-scan'));
  check('learning-no-overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await shot('learning-1280');
  check('no-page-errors', errors.length === 0);
} catch (error) { errors.push(error.message); if (page) await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {}); process.exitCode = 1; }
finally { await browser?.close(); await vite?.close(); writeFileSync(resolve(out, 'result.json'), JSON.stringify({ status: errors.length ? 'failed' : 'passed', checks, errors, screenshots, data: 'synthetic-only', scope: 'Actual HomeView/GuestHome/QuestionCard/LearningHub components with browser history hook. API/auth integration covered by host suite.' }, null, 2)); console.log(JSON.stringify({ status: errors.length ? 'failed' : 'passed', checks: checks.length, errors })); }
