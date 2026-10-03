import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { FamilyStore } from './family-store';
import { handleMobile } from './mobile-backend';
import { sharp } from './sharp';
import { claimLearningJob, finishLearningJob, runNextLearningJob, LEARNING_LEASE_MS } from './learning-jobs';
import { learningById, publicLearning } from './learning-sessions';
import { prepareLearning, gradeLearning, validateLearningTasks, validateLearningFeedback } from './learning-model';
import { ModelGatewayError } from './model-gateway';
import { taskPassed, type LearningSession, type LearningSummary } from '../lib/learning-session';
import type { MobileScan } from '../lib/mobile';

let root: string, store: FamilyStore, student: string, otherStudent: string, scan: MobileScan;
const token = 'e'.repeat(64), otherToken = 'f'.repeat(64), hash = (text: string) => createHash('sha256').update(text).digest('hex');
function call(path: string, method = 'GET', body?: unknown, auth = token) {
  return handleMobile(new Request('https://family.example/family-learning/api/mobile/v1/' + path, { method, headers: { Origin: 'https://localhost', Authorization: 'Bearer ' + auth }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) }), path.split('?')[0].split('/'), store);
}
async function ok(path: string, method = 'GET', body?: unknown) { const response = await call(path, method, body); const data = await response.json() as { session: LearningSession; scan: MobileScan; sessions: LearningSummary[]; students: { id: string; overview: Record<string, number> }[] }; expect(response.status, JSON.stringify(data)).toBeLessThan(300); return data; }
const draft = (n = 0) => ({ prompt: `已知 x=${n + 2}，求 x+4 的值，并写出计算过程。`, difficulty: '基础巩固', knowledgePoints: ['代入计算'], hints: ['先找 x 的已知值。','把 x 换成已知数。','将两个数相加并检查。'], answer: String(n + 6), explanation: `${n + 2}+4=${n + 6}` });
const prepare = vi.fn(async (_owner, session, retest) => validateLearningTasks(retest ? [draft(8)] : session.mode === 'challenge' ? [draft(4)] : [draft(0), draft(1), draft(2)], retest || session.mode === 'challenge' ? 1 : 3, retest ? 'retest' : session.mode));
const grade = vi.fn(async (_owner, _session, task, answer) => ({ verdict: answer.includes(task.answer) ? 'correct' as const : 'incorrect' as const, feedback: '核对了本次作答。', nextStep: '检查代入及加法。', evidence: [answer] }));
const createBody = (mode = 'practice') => ({ requestId: randomUUID(), studentId: student, scanId: scan.id, questionId: 'q1', revision: scan.revision, mode, stuckPoint: mode === 'challenge' ? '不会列式' : '', initialWork: '已经读题' });
async function start(mode = 'practice') { return (await ok('learning-sessions', 'POST', createBody(mode))).session as LearningSession; }
async function get(s: LearningSession) { return (await ok('learning-sessions/' + s.id)).session as LearningSession; }
async function action(s: LearningSession, name: string, values = {}) { return (await ok(`learning-sessions/${s.id}/${name}`, 'POST', { revision: s.revision, ...values })).session as LearningSession; }
async function run() { expect(await runNextLearningJob(store, prepare, grade)).toBe(true); }
async function answer(s: LearningSession, index = 0) { s = await action(s, 'attempt', { taskId: s.tasks[index].id, requestId: randomUUID(), answer: learningById(store, 'a', s.id).tasks[index].answer }); await run(); return get(s); }
beforeEach(async () => {
  mkdirSync('work', { recursive: true }); root = mkdtempSync(resolve('work/learning-session-'));
  store = new FamilyStore(join(root, 'family.sqlite')); prepare.mockClear(); grade.mockClear();
  vi.stubEnv('FAMILY_DATA_DIR', root); vi.stubEnv('FAMILY_PUBLIC_ORIGIN','https://family.example'); vi.stubEnv('FAMILY_MOBILE_ORIGINS','https://localhost');
  vi.stubEnv('FAMILY_RECOGNITION_ENABLED','true'); vi.stubEnv('FAMILY_AI_API_KEY','synthetic'); vi.stubEnv('FAMILY_AI_MODEL','synthetic'); vi.stubEnv('FAMILY_AI_BASE_URL','https://model.example/v1'); vi.stubEnv('FAMILY_LEARNING_DAILY_LIMIT','100');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected external request')));
  for (const [id, t] of [['a',token],['b',otherToken]]) { store.db.prepare('INSERT INTO accounts VALUES (?,?,?,?)').run(id,id,'unusable-test-password',Date.now()); store.db.prepare('INSERT INTO mobile_sessions VALUES (?,?,?,?,?)').run(hash(t),id,Date.now()+1000000,'synthetic',Date.now()); }
  student = store.addStudent('a','甲').id; otherStudent = store.addStudent('a','乙').id; store.addStudent('b','丙');
  const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const form = new FormData(); form.set('studentId',student); form.set('source','合成学习验收'); form.set('clientRequestId',randomUUID()); form.set('file',new File([new Uint8Array(png)],'synthetic.png',{type:'image/png'}));
  scan = (await ok('scans','POST',form)).scan;
  scan = (await ok(`scans/${scan.id}/review`,'PUT',{ revision:scan.revision,questions:[{id:'q1',number:'1',subject:'数学',prompt:'已知x=1，求x+4。',diagram:'',knowledgePoints:['代入计算'],regions:[{id:'r1',kind:'stem',x:0,y:0,width:1,height:1}],answerSteps:[],uncertainties:[],confirmed:true}] })).scan;
});
afterEach(() => { store.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); expect(root.startsWith(resolve('work')+sep)).toBe(true); rmSync(root,{recursive:true,force:true}); });

describe('learning sessions cross-module workflow', () => {
  it('creates once, hides future hints and answers, and retains source snapshot after editing', async () => {
    const body = createBody(); const first = (await ok('learning-sessions','POST',body)).session;
    expect((await ok('learning-sessions','POST',body)).session.id).toBe(first.id);
    expect((await call('learning-sessions','POST',{...body,initialWork:'different'})).status).toBe(409);
    await run(); let s = await get(first); expect(s.tasks).toHaveLength(3);
    expect(JSON.stringify(s)).not.toContain('allHints'); expect(s.tasks[0]).not.toHaveProperty('answer'); expect(s.tasks[0].solution).toBeUndefined(); expect(s.tasks[0].hints).toEqual([]);
    s = await action(s,'hint',{taskId:s.tasks[0].id}); expect(s.tasks[0].hints).toHaveLength(1); expect(s.tasks[0].hints[0]).toContain('先找');
    expect((await call(`learning-sessions/${s.id}/hint`,'POST',{revision:s.revision-1,taskId:s.tasks[0].id})).status).toBe(409);
    expect((await call(`learning-sessions/${s.id}/solution`,'POST',{revision:s.revision,taskId:s.tasks[0].id})).status).toBe(400);
    const saved = await ok(`scans/${scan.id}/review`,'PUT',{revision:scan.revision,questions:scan.questions.map(q=>({...q,prompt:'原题更新后的内容'}))});
    expect(saved.scan.questions[0].prompt).not.toBe(s.source.prompt); expect((await get(s)).sourceQuestions![0].prompt).toBe('已知x=1，求x+4。');
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  it('isolates accounts and students and rejects stale, unconfirmed or unidentified sources', async () => {
    const s = await start();
    expect((await call('learning-sessions/'+s.id,'GET',undefined,otherToken)).status).toBe(404);
    expect((await call('learning-sessions/'+s.id+'/hint','POST',{revision:s.revision,taskId:'x'},otherToken)).status).toBe(404);
    expect((await call('learning-sessions','POST',{...createBody(),studentId:otherStudent})).status).toBe(409);
    expect((await call('learning-sessions','POST',{...createBody(),revision:0})).status).toBe(409);
    expect((await ok('learning-sessions?studentId='+otherStudent)).sessions).toEqual([]);
    expect((await call('learning-sessions?studentId='+student,'GET',undefined,otherToken)).status).toBe(404);
    scan = (await ok(`scans/${scan.id}/review`,'PUT',{revision:scan.revision,questions:scan.questions.map(q=>({...q,confirmed:false}))})).scan;
    expect((await call('learning-sessions','POST',createBody())).status).toBe(400);
  });
  it('preserves uncertain receipt, grades only once, records help and requires independent retest', async () => {
    let s = await start(); await run(); s = await get(s);
    const submitted = {revision:s.revision,taskId:s.tasks[0].id,requestId:randomUUID(),answer:'6'};
    await ok(`learning-sessions/${s.id}/attempt`,'POST',submitted);
    await ok(`learning-sessions/${s.id}/attempt`,'POST',submitted);
    await run(); s = await get(s); expect(s.tasks[0].attempts).toHaveLength(1); expect(s.tasks[0].attempts[0].helped).toBe(false);
    await ok(`learning-sessions/${s.id}/attempt`,'POST',submitted); expect(grade).toHaveBeenCalledTimes(1);
    expect((await call(`learning-sessions/${s.id}/attempt`,'POST',{...submitted,answer:'other'})).status).toBe(409);
    s = await action(s,'solution',{taskId:s.tasks[0].id}); expect(s.tasks[0].solution!.answer).toBe('6');
    expect((await call(`learning-sessions/${s.id}/retest`,'POST',{revision:s.revision})).status).toBe(400);
    s = await action(s,'hint',{taskId:s.tasks[1].id}); s = await answer(s,1); expect(s.tasks[1].attempts[0].helped).toBe(true); s = await answer(s,2);
    expect(s.retestDueAt).toBeTruthy(); s = await action(s,'retest'); await run(); s = await get(s); expect(s.tasks).toHaveLength(4);
    expect(s.tasks[3].kind).toBe('retest'); expect(s.tasks[3].solution).toBeUndefined();
    expect((await call(`learning-sessions/${s.id}/hint`,'POST',{revision:s.revision,taskId:s.tasks[3].id})).status).toBe(400);
    s = await answer(s,3);
    const list = await ok('learning-sessions?studentId='+student); expect(list.sessions[0].independentRetest).toBe(true);
    const overview = await ok('students?overview=1'); expect(overview.students.find(x=>x.id===student)!.overview).toMatchObject({learningSessionCount:1,independentRetestCount:1});
    expect(overview.students.find(x=>x.id===otherStudent)!.overview).toMatchObject({learningSessionCount:0,independentRetestCount:0});
    expect(s.tasks.every(taskPassed)).toBe(true);
  });
  it('runs challenge through three gated hints, submission and an independent new question', async () => {
    let s = await start('challenge'); await run(); s = await get(s); expect(s.stuckPoint).toBe('不会列式');
    for (let i=1;i<=4;i++) { s=await action(s,'hint',{taskId:s.tasks[0].id}); expect(s.tasks[0].hints).toHaveLength(Math.min(i,3)); }
    s=await answer(s); expect(s.tasks[0].attempts[0].helped).toBe(true);
    s=await action(s,'retest'); await run(); s=await get(s); expect(s.tasks[1].kind).toBe('retest'); expect(s.tasks[1].prompt).not.toBe(s.tasks[0].prompt);
    s=await answer(s,1); expect(s.tasks[1].attempts[0].helped).toBe(false);
  });
  it('persists queued work across reopen and ignores late worker results after lease takeover', async () => {
    const s=await start(); const first=claimLearningJob(store)!;
    store.close(); store=new FamilyStore(join(root,'family.sqlite'));
    const second=claimLearningJob(store,first.started+LEARNING_LEASE_MS+1)!; expect(second.token).not.toBe(first.token);
    expect(finishLearningJob(store,first,()=>{throw new Error('must never apply');})).toBe(false);
    expect(finishLearningJob(store,second,current=>{current.tasks=validateLearningTasks([draft(0),draft(1),draft(2)],3,'practice');},undefined,second.started+1)).toBe(true);
    expect((await get(s)).tasks).toHaveLength(3);
  });
  it('leaves paused queues untouched, saves failed answers and retries without creating new attempts', async () => {
    let s=await start(); vi.stubEnv('FAMILY_RECOGNITION_ENABLED','false'); expect(await runNextLearningJob(store,prepare,grade)).toBe(false); expect((await get(s)).job!.status).toBe('queued');
    vi.stubEnv('FAMILY_RECOGNITION_ENABLED','true'); await run(); s=await get(s); s=await action(s,'attempt',{taskId:s.tasks[0].id,requestId:randomUUID(),answer:'6'});
    await runNextLearningJob(store,prepare,async()=>{throw new ModelGatewayError('核对未完成','MODEL_OUTPUT',false);});
    s=await get(s); expect(s.job!.status).toBe('failed'); expect(s.tasks[0].attempts[0].answer).toBe('6');
    s=await action(s,'retry'); await run(); s=await get(s); expect(s.tasks[0].attempts).toHaveLength(1); expect(s.tasks[0].attempts[0].feedback!.verdict).toBe('correct');
  });
  it('returns summaries without hidden answers or full source scans', async()=>{
    const s=await start(); await run();
    const list=await ok('learning-sessions?studentId='+student); const row=list.sessions[0] as LearningSummary;
    expect(row.source.scanId).toBe(scan.id); expect(row.taskCount).toBe(3); expect(row).not.toHaveProperty('tasks'); expect(row).not.toHaveProperty('sourceRecord');
    expect(publicLearning(learningById(store,'a',s.id))).not.toHaveProperty('sourceRecord');
  });
});

describe('learning model validation',()=>{
  it.each(['practice', 'challenge', 'retest'] as const)('omits unconfirmed writing from the actual %s model request without changing the stored original', async mode => {
    const steps = [
      { id: 'trusted', order: 0, author: 'student' as const, text: '已确认学生步骤：先代入 x=1', uncertain: false, crossedOut: false, regionIds: ['r1'] },
      { id: 'unknown', order: 1, author: 'unknown' as const, text: '未知作者笔迹不能当学生作答', uncertain: false, crossedOut: false, regionIds: ['r1'] },
      { id: 'uncertain', order: 2, author: 'student' as const, text: '模糊学生笔迹不能确定内容', uncertain: true, crossedOut: false, regionIds: ['r1'] },
      { id: 'crossed', order: 3, author: 'student' as const, text: '已划去步骤不应作为当前作答', uncertain: false, crossedOut: true, regionIds: ['r1'] },
      { id: 'teacher', order: 4, author: 'teacher' as const, text: '老师批改不能当学生原作答', uncertain: false, crossedOut: false, regionIds: ['r1'] },
    ];
    scan = (await ok(`scans/${scan.id}/review`, 'PUT', { revision: scan.revision, questions: scan.questions.map(q => ({ ...q, confirmed: true, answerSteps: steps })) })).scan;
    const session = await start(mode === 'challenge' ? 'challenge' : 'practice'), stored = learningById(store, 'a', session.id);
    const before = JSON.stringify(stored.sourceRecord), requests: { messages: { content: string | { text: string }[] }[] }[] = [];
    const count = mode === 'practice' ? 3 : 1;
    const responses = [Array.from({ length: count }, (_, index) => draft(index)), Array.from({ length: count }, (_, index) => ({ approved: true, reason: '合成核验通过', answer: String(index + 6), explanation: '合成计算一致' }))];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => { requests.push(JSON.parse(options.body)); return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questions: responses.shift() }) } }] }); }));
    await prepareLearning('a', stored, mode === 'retest', {});
    const text = (requests[0].messages[1].content as { text: string }[])[0].text;
    const input = JSON.parse(text.slice(text.indexOf('\n') + 1));
    expect(input.source.answerSteps).toEqual([steps[0]]);
    expect(requests[0].messages[0].content).toContain('confirmed只表示题干与题框已核对');
    expect(requests[0].messages[0].content).toContain('author=unknown');
    expect(JSON.stringify(stored.sourceRecord)).toBe(before);
    expect(learningById(store, 'a', session.id).sourceRecord.structuredQuestions![0].answerSteps).toEqual(steps);
  });
  it('rejects a confirmed child when its shared source is unconfirmed, missing or pending', async () => {
    const parent = { ...scan.questions[0], id: 'parent', confirmed: false, regions: [{ ...scan.questions[0].regions[0], id: 'parent-r' }] };
    scan = (await ok(`scans/${scan.id}/review`, 'PUT', { revision: scan.revision, questions: [parent, { ...scan.questions[0], parentQuestionId: 'parent' }] })).scan;
    expect((await call('learning-sessions', 'POST', createBody())).status).toBe(400);
    scan = (await ok(`scans/${scan.id}/review`, 'PUT', { revision: scan.revision, questions: [parent, { ...scan.questions[1], parentQuestionId: undefined, sharedRegionIds: ['parent-r'] }] })).scan;
    expect((await call('learning-sessions', 'POST', createBody())).status).toBe(400);
    scan = (await ok(`scans/${scan.id}/review`, 'PUT', { revision: scan.revision, questions: scan.questions.map(q => ({ ...q, confirmed: true })) })).scan;
    expect((await call('learning-sessions', 'POST', createBody())).status).toBe(202);
  });
  it('rejects missing images, duplicate questions, fabricated grading evidence and empty confirmations',()=>{
    expect(()=>validateLearningTasks([{...draft(),prompt:'如图，求面积'}],1,'practice')).toThrow();
    expect(()=>validateLearningTasks([draft(),draft(),draft()],3,'practice')).toThrow();
    expect(()=>validateLearningFeedback([{verdict:'correct',feedback:'正确',nextStep:'继续',evidence:['并未写过的文字']}],'6')).toThrow();
    expect(()=>validateLearningFeedback([{verdict:'correct',feedback:'正确',nextStep:'继续',evidence:[]}],'6')).toThrow();
    expect(validateLearningFeedback([{verdict:'uncertain',feedback:'条件有歧义',nextStep:'核对题干',evidence:[]}],'6').verdict).toBe('uncertain');
  });
  it('uses independent model verification, text-only grading and untrusted learner-answer boundaries',async()=>{
    const s=await start(); const stored=learningById(store,'a',s.id), requests:Record<string,unknown>[]=[];
    const responses = [[draft(0),draft(1),draft(2)],[0,1,2].map(n=>({approved:true,reason:'条件完整',answer:String(n+6),explanation:'独立计算一致'})),[{verdict:'correct',feedback:'计算正确',nextStep:'练习新的条件',evidence:['6']}]];
    vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{ requests.push(JSON.parse(options.body)); return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({questions:responses.shift()})}}]}),{status:200}); }));
    const tasks=await prepareLearning('a',stored,false,{}); expect(requests).toHaveLength(2); expect(tasks[0].explanation).toBe('独立计算一致');
    expect(await gradeLearning('a',stored,tasks[0],'6',{})).toMatchObject({verdict:'correct'});
    expect(JSON.stringify(requests[0])).toContain('image_url'); expect(JSON.stringify(requests[1])).not.toContain('image_url'); expect(JSON.stringify(requests[2])).not.toContain('image_url'); expect(JSON.stringify(requests[2])).toContain('不可信');
  });
});
