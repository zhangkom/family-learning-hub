import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const out = 'test-results/photo-subject';
fs.mkdirSync(out, { recursive: true });
const base = process.env.CLIENT_URL || 'http://127.0.0.1:3178';
assert.equal(new URL(base).hostname, '127.0.0.1');
const api = 'http://127.0.0.1:3298/family-learning/api/mobile/v1';
const now = new Date().toISOString();
const checks = [], errors = [], layouts = [];
function fresh(id, studentId = 'large') { return { id, studentId, subject: '数学', source: '合成设计验收', originalName: `${id}（合成测试）.png`, mimeType: 'image/png', size: 1000, createdAt: now, revision: 1, status: 'needs_review', questions: [] }; }
const scans = [fresh('同图科目验收'), fresh('另一张照片'), fresh('删除来源题验收'), fresh('小宝照片', 'small')];
const students = [{ id: 'large', name: '体验学生A（合成）', createdAt: now }, { id: 'small', name: '体验学生B（合成）', createdAt: now }];
const fixture = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="4000"><rect width="800" height="4000" fill="#fffdf7"/>' + Array.from({length:12}, (_,i)=>`<text x="30" y="${100+i*320}" font-size="26">${i+1}. 合成验收题：不含真实学习资料</text><path d="M30 ${200+i*320}H740" stroke="#abb8ce"/>`).join('') + '</svg>';
await (async()=> {
 const browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
 const context = await browser.newContext({viewport:{width:360,height:740},hasTouch:true,isMobile:true});
 const page = await context.newPage();
 const cdp = await context.newCDPSession(page);
 page.setDefaultTimeout(10000);
 page.on('pageerror', e=>errors.push(e.message));
 page.on('dialog', d=>d.accept());
 await page.route('**/*', async route=> {
  const req=route.request(), u=new URL(req.url());
  if (u.origin===base) return route.continue();
  if (!req.url().startsWith(api)) return route.abort();
  const path=decodeURIComponent(u.pathname.split('/v1')[1]);
  const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(path==='/setup') return send({enabled:true,registrationEnabled:true});
  if(path==='/session/login') return send({token:'synthetic-only',user:{id:'design-qa-family',username:'设计验收合成家庭'},expiresAt:Date.now()+9999999});
  if(path==='/students') return send({students});
  if(path==='/scans') return send({scans:scans.filter(s=>s.studentId===u.searchParams.get('studentId')),recognition:true});
  const s=scans.find(s=>path.startsWith('/scans/'+s.id));
  if(s && path.endsWith('/file')) return route.fulfill({contentType:'image/svg+xml',body:fixture});
  if(s && path.endsWith('/review')) {
   assert.equal(req.postDataJSON().revision,s.revision);
   s.questions=req.postDataJSON().questions;s.revision++;return send({scan:s});
  }
  if(s && path==='/scans/'+s.id) return send({scan:s});
  errors.push('Unexpected '+req.method()+' '+path);return route.abort();
 });
 const subject=()=>page.getByLabel('这道题的科目');
 const hint=()=>page.locator('.question-actions output');
 async function draw(append=false){
  if(append){ await page.locator('.extra-regions summary').click(); await page.getByRole('button',{name:'补一个框',exact:true}).click(); }
  else await page.getByRole('button',{name:'框选一道题',exact:true}).click();
  await page.locator('.paper-scroll').scrollIntoViewIfNeeded();
  const b=await page.locator('.paper-scroll').boundingBox();
  const start={x:b.x+25,y:b.y+35},end={x:b.x+Math.min(200,b.width-25),y:b.y+145};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:0}]});
  for(let i=1;i<=6;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*i/6,y:start.y+(end.y-start.y)*i/6,id:0}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await subject().waitFor();
 }
 async function save(){ await page.getByRole('button',{name:'保存校对',exact:true}).click();await page.getByText('已保存题目框和手写步骤',{exact:true}).waitFor(); }
 async function back(){ await page.getByRole('button',{name:'返回资料列表'}).click(); }
 async function open(id){
  await page.getByRole('navigation',{name:'主要页面'}).getByRole('button',{name:/题目/}).click();
  await page.getByRole('button',{name:new RegExp(id+'（合成测试）')}).click();
  await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('框选一道题'));return b&&!b.matches(':disabled');});
 }
 async function selectQuestion(n){await page.getByRole('navigation',{name:'选择题目'}).getByRole('button',{name:String(n),exact:true}).click();}
 async function shot(name){await page.locator('.question-actions').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/'+name+'.png',fullPage:true});}
 try {
  await page.goto(base);
  await page.getByRole('navigation',{name:'账户'}).getByRole('button',{name:'登录',exact:true}).click();
  await page.getByLabel('家庭服务地址').fill(api);
  await page.getByLabel('账号',{exact:true}).fill('design-qa');
  await page.getByLabel('密码',{exact:true}).fill('123456');
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await open('同图科目验收');
  await draw();assert.equal(await subject().inputValue(),'');
  checks.push('旧照片级数学默认不使首题自动选科');
  await subject().selectOption('物理');await draw();assert.equal(await subject().inputValue(),'物理');
  assert.equal(await page.getByRole('button',{name:'保存并分析这道题'}).isEnabled(),true);
  checks.push('首题明确选物理，后续拖框直接沿用，可进入保存分析');
  await page.getByRole('button',{name:'补题',exact:true}).click();assert.equal(await subject().inputValue(),'物理');
  assert.equal(await page.getByRole('button',{name:'保存并分析这道题'}).isDisabled(),true);
  await draw(true);assert.equal(await page.getByRole('button',{name:'保存并分析这道题'}).isEnabled(),true);
  checks.push('补题沿用物理，无题框仍禁保存，补框后可保存');
  await subject().selectOption('化学');await selectQuestion(1);
  assert.equal(await subject().inputValue(),'物理');assert.match(await hint().textContent(),/沿用化学/);
  await draw();assert.equal(await subject().inputValue(),'化学');await save();
  assert.deepEqual(scans[0].questions.map(q=>q.subject),['物理','物理','化学','化学']);
  checks.push('改科只影响本题与新题；回看旧题不改变新题默认');
  await back();await open('同图科目验收');await draw();assert.equal(await subject().inputValue(),'化学');
  checks.push('混科同图关闭重开后新题仍沿用化学');
  for(const [width,height] of [[320,740],[360,740],[390,844],[768,1024]]){
   await page.setViewportSize({width,height});await page.locator('.question-actions').scrollIntoViewIfNeeded();
   const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,actionWidth:document.querySelector('.question-actions').getBoundingClientRect().width,subject:document.querySelector('.question-actions select').value,hint:document.querySelector('.question-actions output').textContent}));
   assert.ok(layout.scrollWidth<=width,`horizontal overflow ${width}`);layouts.push(layout);await shot('subject-'+width);
  }
  await page.setViewportSize({width:360,height:740});
  await subject().selectOption('');assert.equal(await subject().inputValue(),'');assert.doesNotMatch(await hint().textContent(),/沿用化学/);
  await save();await back();await open('同图科目验收');await draw();assert.equal(await subject().inputValue(),'');
  checks.push('显式清空科目保持未选，重开后也不擅自补回默认');
  await subject().selectOption('生物');await back();await open('同图科目验收');
  await page.getByText('已恢复本机未完成的校对',{exact:true}).waitFor();await draw();assert.equal(await subject().inputValue(),'生物');await save();
  checks.push('未保存的本机草稿重开后恢复明确选科与后续沿用');
  await back();await open('另一张照片');await draw();assert.equal(await subject().inputValue(),'');await save();await back();
  checks.push('换照片不沿用上一张生物');
  await page.getByLabel('当前学生').selectOption('small');await open('小宝照片');await draw();assert.equal(await subject().inputValue(),'');await save();await back();
  checks.push('换学生后新图无上一名学生默认');
  await page.getByLabel('当前学生').selectOption('large');await open('同图科目验收');
  await page.evaluate(()=>{for(const key of Object.keys(localStorage)) if(key.startsWith('family-learning:photo-subject:'))localStorage.removeItem(key);});
  await back();await open('同图科目验收');await draw();assert.equal(await subject().inputValue(),'');await save();await back();
  checks.push('混科且本机无有效偏好时不按题目顺序猜默认');
  await open('删除来源题验收');await draw();await subject().selectOption('物理');await draw();await subject().selectOption('化学');
  await page.locator('.manual-review > summary').click();await page.locator('.organize > summary').click();
  await page.getByRole('button',{name:'移除这道题',exact:true}).click();
  const before=await hint().textContent();await draw();const value=await subject().inputValue();const after=await hint().textContent();
  assert.doesNotMatch(before, /沿用化学/);
  assert.equal(value, '');
  assert.doesNotMatch(after, /沿用化学/);
  checks.push('删除默认来源题后提示与新题科目保持一致');
  await shot('deleted-source');
  assert.deepEqual(errors,[]);
 } catch(e){errors.push(e.stack);await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});}
 finally{
  fs.writeFileSync(out+'/design-qa.json',JSON.stringify({syntheticOnly:true,noProductionRequests:true,checks,layouts,errors},null,2));
  console.log(JSON.stringify({checks,layouts,errors}));await browser.close();
 }
 if(errors.length)process.exitCode=1;
})();

