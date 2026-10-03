import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { FamilyStore } from './family-store';
import { handleMobile } from './mobile-backend';
import { writeStoredScan, readStoredScan } from './scan-files';
import { weaknessById, type StoredWeakness } from './weakness-reports';
import { weaknessMaterials } from './weakness-materials';
import { analyzeWeakness, applyWeaknessReview, validateWeaknessResult } from './weakness-model';
import { claimWeaknessJob, finishWeaknessJob, runNextWeaknessJob, WEAKNESS_LEASE_MS } from './weakness-jobs';
import { ModelGatewayError } from './model-gateway';
import type { WeaknessReport, WeaknessOverview } from '../lib/weakness';
import type { ScanRecord } from '../lib/scans';
import type { Question } from '../lib/mobile';

let root: string, store: FamilyStore, student: string, second: string, scan: ScanRecord;
const token = 'c'.repeat(64), otherToken = 'd'.repeat(64), hash = (text: string) => createHash('sha256').update(text).digest('hex');
function call(path: string, method = 'GET', body?: unknown, auth = token) {
  return handleMobile(new Request('https://family.example/family-learning/api/mobile/v1/' + path, { method,
    headers: { Origin: 'https://localhost', Authorization: 'Bearer ' + auth }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), path.split('?')[0].split('/'), store);
}
async function ok(path: string, method = 'GET', body?: unknown) {
  const response = await call(path, method, body), data = await response.json() as WeaknessOverview & { report: WeaknessReport };
  expect(response.status, JSON.stringify(data)).toBeLessThan(300); return data;
}
const overview = (subject = '') => ok(`weakness-reports?studentId=${student}&subject=${encodeURIComponent(subject)}`);
async function start(subject = '') { return (await ok('weakness-reports', 'POST', { requestId: randomUUID(), studentId: student, subject, materialVersion: (await overview(subject)).materials.version })).report; }
const get = (r: WeaknessReport) => ok(`weakness-reports/${r.id}`);
function question(n: number, subject: Question['subject'] = '数学'): Question {
  return { id: `q${n}`, number: String(n), subject, prompt: `已知 x=${n}，求 x+4 的值。`, diagram: '', knowledgePoints: ['代入计算'], regions: [], answerSteps: [], uncertainties: [], confirmed: true, wrongBook: { savedAt: new Date().toISOString() } };
}
function update(questions: Question[], extra: Partial<ScanRecord> = {}) {
  scan = { ...scan, ...extra, revision: scan.revision + 1, structuredQuestions: questions };
  writeStoredScan(store, 'a', scan, 'synthetic');
}
function resultFor(report: StoredWeakness, basis = 'wrong_question_pattern') {
  return [{ summary: '基于错题分布的 AI 待核对学习建议，仍需结合实际作答核对。', focuses: [{ title: '代入条件与数量关系', subject: '数学', dimensionId: 'calculation', knowledgePoints: ['代入计算'], priority: basis === 'answer_evidence' ? 'high' : 'medium', basis,
    reason: '这些错题共同涉及把条件代入关系式，可优先练习。', practiceDirection: '写出已知条件并逐步代入，使用新条件独立复测。',
    evidence: report.input.slice(0, 2).map(source => ({ sourceId: source.id, kind: basis === 'answer_evidence' ? 'student_answer' : 'question', quote: basis === 'answer_evidence' ? source.studentEvidence[0]?.text : source.prompt, reason: '该题提供相同类型的代入条件。' })) }], limitations: ['仅分析选入的错题，结论需要核对。'] }];
}
function reviewFor(body: { messages: { content: unknown }[] }, approved = true, rejectionCode = approved ? 'none' : 'shared_evidence', reason = '合成逐条核验意见') {
  const text = (body.messages[1].content as { text: string }[])[0].text;
  const input = JSON.parse(text.slice(text.indexOf('\n') + 1));
  return [{ reviews: input.candidate.focuses.map((focus: { id: string }) => ({ focusId: focus.id, approved, rejectionCode, reason })) }];
}
const analyze = vi.fn(async (report: StoredWeakness) => validateWeaknessResult(resultFor(report), report));
beforeEach(() => {
  mkdirSync('work', { recursive: true }); root = mkdtempSync(resolve('work/weakness-report-')); store = new FamilyStore(join(root, 'family.sqlite')); analyze.mockClear();
  vi.stubEnv('FAMILY_DATA_DIR', root); vi.stubEnv('FAMILY_PUBLIC_ORIGIN', 'https://family.example'); vi.stubEnv('FAMILY_MOBILE_ORIGINS', 'https://localhost');
  vi.stubEnv('FAMILY_RECOGNITION_ENABLED', 'true'); vi.stubEnv('FAMILY_AI_API_KEY', 'synthetic'); vi.stubEnv('FAMILY_AI_MODEL', 'synthetic'); vi.stubEnv('FAMILY_AI_BASE_URL', 'https://model.example/v1');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No real model calls permitted')));
  for (const [id, t] of [['a', token], ['b', otherToken]]) {
    store.db.prepare('INSERT INTO accounts VALUES (?,?,?,?)').run(id, id, 'unusable-test-password', Date.now());
    store.db.prepare('INSERT INTO mobile_sessions VALUES (?,?,?,?,?)').run(hash(t), id, Date.now() + 1000000, 'synthetic', Date.now());
  }
  student = store.addStudent('a', '甲').id; second = store.addStudent('a', '乙').id; store.addStudent('b', '丙');
  scan = { id: randomUUID(), studentId: student, subject: '数学', source: '合成测试', originalName: 'synthetic.png', mimeType: 'image/png', size: 0,
    status: 'ready', createdAt: new Date().toISOString(), fileUrl: '', revision: 1, structuredQuestions: [question(1), question(2)] };
  writeStoredScan(store, 'a', scan, 'synthetic');
});
afterEach(() => { store.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); expect(root.startsWith(resolve('work') + sep)).toBe(true); rmSync(root, { recursive: true, force: true }); });

describe('weakness analysis API and persistent worker', () => {
  it('excludes locator summaries until complete text and image conditions are explicitly adopted and confirmed', async () => {
    update([{ ...question(1), prompt: '题目定位摘要：含跨页图表的合成题' }, { ...question(2), promptKind: 'summary' }]);
    let m = await overview(); expect(m.materials).toMatchObject({ total: 2, eligible: 0, selected: 0, needsReview: 2 });
    expect(m.materials.pendingSources.every(source => source.reason.includes('完整题干、选项与图示条件'))).toBe(true);
    expect((await call('weakness-reports', 'POST', { requestId: randomUUID(), studentId: student, materialVersion: m.materials.version })).status).toBe(400);
    update([{ ...question(1), promptKind: 'full' }, { ...question(2), promptKind: 'full', confirmed: false }]);
    m = await overview(); expect(m.materials).toMatchObject({ selected: 1, needsReview: 1 });
    update([{ ...question(1), promptKind: 'full' }, { ...question(2), promptKind: 'full' }]); expect((await overview()).materials.selected).toBe(2);
  });
  it('rejects a pre-upgrade queued summary snapshot before any model request', async () => {
    const report = weaknessById(store, 'a', (await start()).id);
    report.input[0].prompt = '题目定位摘要：旧任务中的不完整文字';
    await expect(analyzeWeakness(report, {})).rejects.toThrow('定位摘要'); expect(fetch).not.toHaveBeenCalled();
  });
  it('analyzes real wrong-book inputs once and returns evidence links without internal model material', async () => {
    const m = await overview(); expect(m.materials).toMatchObject({ total: 2, selected: 2, needsReview: 0 });
    expect(m.axes).toHaveLength(42); expect(m.axes.every(a => a.score === null)).toBe(true);
    const body = { studentId: student, requestId: randomUUID(), materialVersion: m.materials.version };
    const report = (await ok('weakness-reports', 'POST', body)).report;
    expect((await ok('weakness-reports', 'POST', body)).report.id).toBe(report.id);
    expect((await call('weakness-reports', 'POST', { ...body, subject: '物理' })).status).toBe(409);
    expect(await runNextWeaknessJob(store, analyze)).toBe(true); expect(await runNextWeaknessJob(store, analyze)).toBe(false);
    const done = (await get(report)).report; expect(done.status).toBe('ready'); expect(done.stale).toBe(false);
    expect(done.result!.axes).toHaveLength(42); expect(done.result!.axes.every(a => a.score === null)).toBe(true);
    expect(done.result!.focuses[0]).toMatchObject({ basis: 'wrong_question_pattern', needsReview: true });
    expect(done.result!.focuses[0].evidence.map(e => e.sourceId)).toEqual(done.sources.map(s => s.id));
    expect(done).not.toHaveProperty('input'); expect(done).not.toHaveProperty('jobId'); expect(analyze).toHaveBeenCalledTimes(1);
    expect((await overview()).report!.id).toBe(done.id);
  });
  it('isolates families and students and restricts scope to owned, explicitly assigned wrong-book questions', async () => {
    const report = await start();
    expect((await call(`weakness-reports/${report.id}`, 'GET', undefined, otherToken)).status).toBe(404);
    expect((await call(`weakness-reports/${report.id}/retry`, 'POST', { revision: report.revision }, otherToken)).status).toBe(404);
    expect((await call(`weakness-reports?studentId=${student}`, 'GET', undefined, otherToken)).status).toBe(404);
    expect((await ok(`weakness-reports?studentId=${second}`)).materials.total).toBe(0);
    update([question(1), { ...question(2), wrongBook: undefined }, question(3, '物理')]);
    expect((await overview('数学')).materials.total).toBe(1); expect((await overview('物理')).materials.total).toBe(1);
    update(scan.structuredQuestions!, { studentId: undefined, child: 'dabao' });
    expect((await overview()).materials.total).toBe(0);
  });
  it('requires two confirmed questions, exposes pending sources, and rejects changed material versions', async () => {
    const version = (await overview()).materials.version;
    update([question(1), { ...question(2), confirmed: false }, { ...question(3), prompt: '' }]);
    const m = await overview(); expect(m.materials).toMatchObject({ total: 3, selected: 1, needsReview: 2, pendingMore: 0 });
    expect(m.materials.pendingSources.map(p => p.questionId)).toEqual(['q2', 'q3']);
    expect(m.materials.pendingSources[0].reason).toBe('请先核对并确认题干与题框');
    expect((await call('weakness-reports', 'POST', { studentId: student, requestId: randomUUID(), materialVersion: version })).status).toBe(409);
    expect((await call('weakness-reports', 'POST', { studentId: student, requestId: randomUUID(), materialVersion: m.materials.version })).status).toBe(400);
  });
  it('requires a same-subject pair and marks a report stale after the student grade changes', async () => {
    update([question(1), question(2, '物理')]);
    let m = await overview();
    expect((await call('weakness-reports', 'POST', { studentId: student, requestId: randomUUID(), materialVersion: m.materials.version })).status).toBe(400);
    update([question(1), question(2)]); const r = await start('数学');
    store.db.prepare('UPDATE students SET grade=? WHERE account_id=? AND id=?').run('初二', 'a', student);
    m = await overview('数学'); expect(m.axes).toHaveLength(6); expect(m.axes[0].grade).toBe('初二'); expect((await get(r)).report.stale).toBe(true);
  });
  it('provides Chinese-language axes and analyzes only a same-subject pair without borrowing other subjects', async () => {
    const first = { ...question(1, '语文'), prompt: '结合语境解释“学而时习之”的“习”。', knowledgePoints: ['文言实词'] };
    update([first, question(2, '物理')]);
    let m = await overview('语文'); expect(m.axes.map(a => a.label)).toEqual(['语言积累', '语境理解', '文本分析', '鉴赏评价', '表达组织', '综合迁移']);
    expect(m.materials.selected).toBe(1);
    expect((await call('weakness-reports', 'POST', { requestId: randomUUID(), studentId: student, subject: '语文', materialVersion: m.materials.version })).status).toBe(400);
    update([first, { ...question(3, '语文'), prompt: '结合语境解释“温故而知新”的“故”。', knowledgePoints: ['文言实词'] }, question(2, '物理')]);
    const r = await start('语文'); expect(r.coverage.total).toBe(2);
    await runNextWeaknessJob(store, async report => validateWeaknessResult([{ summary: '这些已收录古文错题共同涉及词义与语境，建议待核对。',
      focuses: [{ title: '联系上下文辨析文言实词', subject: '语文', dimensionId: 'context', knowledgePoints: ['文言实词', '语境推断'], priority: 'medium', basis: 'wrong_question_pattern',
        reason: '两题都要求联系语境解释文言词义，可以作为共同练习方向。', practiceDirection: '先解释上下文，再比较候选词义并用原句验证。',
        evidence: report.sources.map(s => ({ sourceId: s.id, kind: 'question', quote: s.prompt, reason: '题干要求根据语境解释实词。' })) }], limitations: ['仅有题干不能确定实际错因。'] }], report));
    m = await overview('语文'); expect(m.report!.result!.axes).toHaveLength(6);
    expect(m.report!.result!.axes.every(a => a.subject === '语文' && a.score === null)).toBe(true);
    expect(m.report!.result!.focuses[0].dimensionId).toBe('context');
  });
  it('shows explicit coverage rather than silently truncating a large library', async () => {
    update(Array.from({ length: 34 }, (_, i) => question(i + 1)));
    const m = await overview(); expect(m.materials).toMatchObject({ total: 34, eligible: 34, selected: 30, omitted: 4, limit: 30 });
    const r = await start(); expect(r.coverage).toMatchObject({ selected: 30, omitted: 4 }); expect(r.sources).toHaveLength(30);
    update(Array.from({ length: 60 }, (_, i) => ({ ...question(i + 1), confirmed: false })));
    const pending = (await overview()).materials; expect(pending.pendingSources).toHaveLength(50); expect(pending.pendingMore).toBe(10);
  });
  it('keeps immutable input and marks results stale after edits, removals or newly collected questions', async () => {
    const r = await start(), old = weaknessById(store, 'a', r.id).input[0].prompt;
    update([question(1), { ...question(2), prompt: '新的题干内容' }, question(3)]);
    expect((await get(r)).report.stale).toBe(true); expect(weaknessById(store, 'a', r.id).input[0].prompt).toBe(old);
    await runNextWeaknessJob(store, analyze); expect((await get(r)).report).toMatchObject({ status: 'ready', stale: true });
    expect((await overview()).materials.total).toBe(3);
    update([], { deletedAt: new Date().toISOString() }); expect((await overview()).materials.total).toBe(0);
  });
  it('restores expired work after reopen and fences stale workers', async () => {
    const r = await start(), first = claimWeaknessJob(store)!;
    store.close(); store = new FamilyStore(join(root, 'family.sqlite'));
    const secondJob = claimWeaknessJob(store, first.started + WEAKNESS_LEASE_MS + 1)!;
    expect(secondJob.token).not.toBe(first.token);
    expect(finishWeaknessJob(store, first, () => { throw new Error('must not apply'); })).toBe(false);
    expect(finishWeaknessJob(store, secondJob, current => { current.result = validateWeaknessResult(resultFor(current), current); }, undefined, secondJob.started + 1)).toBe(true);
    expect((await get(r)).report.status).toBe('ready');
  });
  it('retains failures for explicit retry and makes lost retry receipts idempotent', async () => {
    const r = await start(); await runNextWeaknessJob(store, async () => { throw new ModelGatewayError('合成核验未通过', 'MODEL_OUTPUT', false); });
    const failed = (await get(r)).report; expect(failed).toMatchObject({ status: 'failed', error: '合成核验未通过' });
    const path = `weakness-reports/${r.id}/retry`, body = { revision: failed.revision };
    const retry = (await ok(path, 'POST', body)).report; expect((await ok(path, 'POST', body)).report.revision).toBe(retry.revision);
    expect(store.db.prepare('SELECT COUNT(*) n FROM weakness_jobs WHERE report_id=?').get(r.id)?.n).toBe(2);
    await runNextWeaknessJob(store, analyze); expect((await get(r)).report.status).toBe('ready');
  });
  it('does not consume paused work or retry outdated snapshots', async () => {
    const r = await start(); vi.stubEnv('FAMILY_RECOGNITION_ENABLED', 'false');
    expect(await runNextWeaknessJob(store, analyze)).toBe(false); expect((await get(r)).report.status).toBe('queued');
    vi.stubEnv('FAMILY_RECOGNITION_ENABLED', 'true'); await runNextWeaknessJob(store, async () => { throw new ModelGatewayError('合成错误', 'MODEL_OUTPUT', false); });
    const failed = (await get(r)).report; update([question(1), question(2), question(3)]);
    expect((await call(`weakness-reports/${r.id}/retry`, 'POST', { revision: failed.revision })).status).toBe(409);
  });
  it('rejects competing creates while a scope is active and only consumes a bounded daily model allowance', async () => {
    vi.stubEnv('FAMILY_WEAKNESS_DAILY_LIMIT', '1');
    const r = await start();
    expect((await call('weakness-reports', 'POST', { studentId: student, requestId: randomUUID(), materialVersion: (await overview()).materials.version })).status).toBe(409);
    await runNextWeaknessJob(store, analyze); const secondReport = await start();
    await runNextWeaknessJob(store, analyze); expect((await get(secondReport)).report).toMatchObject({ status: 'failed' });
    expect((await get(secondReport)).report.error).toContain('24小时'); expect(analyze).toHaveBeenCalledTimes(1);
    expect((await get(r)).report.status).toBe('ready');
  });
  it('marks repeatedly abandoned leases failed instead of retrying forever', async () => {
    const r = await start(), first = claimWeaknessJob(store)!;
    expect(claimWeaknessJob(store, first.started + WEAKNESS_LEASE_MS + 1)!.attempt).toBe(2);
    expect(claimWeaknessJob(store, first.started + 2 * WEAKNESS_LEASE_MS + 2)!.attempt).toBe(3);
    expect(claimWeaknessJob(store, first.started + 3 * WEAKNESS_LEASE_MS + 3)).toBeNull();
    expect((await get(r)).report).toMatchObject({ status: 'failed' });
  });
  it('does not analyze an unconfirmed shared parent or silently trim overlong question material', async () => {
    update([{ ...question(1), parentQuestionId: 'q3' }, question(2), { ...question(3), confirmed: false, wrongBook: undefined }]);
    expect((await overview()).materials).toMatchObject({ total: 2, selected: 1, needsReview: 1 });
    update([{ ...question(1), prompt: '很长的合成条件'.repeat(7000) }, question(2)]);
    const materials = (await overview()).materials;
    expect(materials).toMatchObject({ total: 2, selected: 1, needsReview: 1 });
    expect(materials.pendingSources[0].reason).toContain('过长');
  });
  it('includes only verified student writing and user-reviewed teaching material, never raw error hypotheses', () => {
    const q = question(1); q.answerSteps = [
      { id: 's1', order: 0, text: 'x+4=1+4=4', author: 'student', crossedOut: false, uncertain: false, regionIds: [] },
      { id: 's2', order: 1, text: '教师说明', author: 'teacher', crossedOut: false, uncertain: false, regionIds: [] },
      { id: 's3', order: 2, text: '不确定笔迹', author: 'student', crossedOut: false, uncertain: true, regionIds: [] },
    ];
    q.tutoring = { status: 'needs_review', result: { transcribedPrompt: '未经确认的转写', referenceAnswer: '5', explanation: '已核对的讲解', answerEvidence: [],
      errorHypotheses: [{ text: '未经确认的错因', evidenceIndexes: [] }], uncertainties: [], generatedAt: '2026-10-02T00:00:00Z', needsReview: true } };
    update([q, question(2)]); let input = weaknessMaterials(store, 'a', student, '').sources[0];
    expect(input.studentEvidence).toEqual([{ text: 'x+4=1+4=4', kind: 'confirmed_answer' }]); expect(input.reviewedExplanation).toBeUndefined();
    q.tutoring.review = { status: 'confirmed', reviewedAt: '2026-10-02T00:01:00Z', resultGeneratedAt: q.tutoring.result!.generatedAt }; update([q, question(2)]);
    input = weaknessMaterials(store, 'a', student, '').sources[0]; expect(input.reviewedExplanation).toBe('已核对的讲解'); expect(JSON.stringify(input)).not.toContain('未经确认');
  });
  it('includes existing learning outcomes and invalidates an earlier report when an attempt changes', async () => {
    const r = await start(), now = new Date().toISOString();
    const s = { id: randomUUID(), studentId: student, mode: 'practice', revision: 1, createdAt: now, updatedAt: now,
      source: { scanId: scan.id, questionId: 'q1', revision: scan.revision }, tasks: [{ kind: 'retest', prompt: '新的复测条件', attempts: [{ answer: '独立计算为5', helped: false, feedback: { verdict: 'correct', feedback: 'AI批改认为正确' } }] }] };
    store.db.prepare('INSERT INTO learning_sessions VALUES (?,?,?,?,?,?,?)').run(s.id, 'a', student, randomUUID(), 'synthetic', now, JSON.stringify(s));
    const input = weaknessMaterials(store, 'a', student, '').sources[0]; expect(input.studentEvidence[0]).toMatchObject({ result: 'retest:correct', helped: false, taskPrompt: '新的复测条件' });
    expect((await get(r)).report.stale).toBe(true);
  });
  it('retains learning evidence across metadata-only revisions, but excludes it when original conditions really change', () => {
    const now = new Date().toISOString(), original = JSON.parse(JSON.stringify(scan));
    const session = { id: randomUUID(), studentId: student, mode: 'challenge', revision: 1, sourceRecord: original,
      source: { scanId: scan.id, questionId: 'q1', revision: scan.revision }, tasks: [{ id: 't1', kind: 'retest', prompt: '独立复测题', attempts: [{ id: 'a1', answer: '5', helped: false, feedback: { verdict: 'correct', feedback: 'AI批改认为正确', evidence: ['5'] } }] }] };
    store.db.prepare('INSERT INTO learning_sessions VALUES (?,?,?,?,?,?,?)').run(session.id, 'a', student, randomUUID(), 'synthetic', now, JSON.stringify(session));
    update(scan.structuredQuestions!, { confirmedAt: now });
    let input = weaknessMaterials(store, 'a', student, '').sources[0]; expect(input.studentEvidence[0]).toMatchObject({ result: 'retest:correct', mode: 'challenge' });
    update(scan.structuredQuestions!, { sourcePage: { documentId: 'synthetic-doc', photoId: 'synthetic-photo', title: '合成资料', subject: '数学', pageNumber: 1, pageCount: 1, revision: 1, scanSha256: 'a'.repeat(64) } });
    expect(weaknessMaterials(store, 'a', student, '').sources[0].studentEvidence).toEqual([]);
    update(scan.structuredQuestions!, { sourcePage: undefined });
    update(scan.structuredQuestions!.map(q => q.id === 'q1' ? { ...q, prompt: '实际条件已改动' } : q));
    input = weaknessMaterials(store, 'a', student, '').sources[0]; expect(input.studentEvidence).toEqual([]);
  });
});

describe('weakness model grounding', () => {
  it('rejects forged IDs, forged quotes, one-question evidence and specific errors inferred from a prompt', async () => {
    const r = await start(), saved = weaknessById(store, 'a', r.id);
    const forged = resultFor(saved); forged[0].focuses[0].evidence[1].sourceId = 'another-child/q1'; expect(() => validateWeaknessResult(forged, saved)).toThrow();
    const quote = resultFor(saved); quote[0].focuses[0].evidence[1].quote = '未写过的内容'; expect(() => validateWeaknessResult(quote, saved)).toThrow();
    const duplicate = resultFor(saved); duplicate[0].focuses[0].evidence[1] = duplicate[0].focuses[0].evidence[0]; expect(() => validateWeaknessResult(duplicate, saved)).toThrow();
    const blame = resultFor(saved); blame[0].focuses[0].reason = '学生粗心导致计算错误'; expect(() => validateWeaknessResult(blame, saved)).toThrow();
    expect(() => validateWeaknessResult(resultFor(saved, 'answer_evidence'), saved)).toThrow();
    const psychological = resultFor(saved); psychological[0].summary = '学生天生学不会'; expect(() => validateWeaknessResult(psychological, saved)).toThrow();
  });
  it('accepts tentative pattern suggestions without handwriting and safely returns no focus when evidence is insufficient', async () => {
    const r = await start(), saved = weaknessById(store, 'a', r.id);
    expect(validateWeaknessResult(resultFor(saved), saved).focuses[0].basis).toBe('wrong_question_pattern');
    expect(validateWeaknessResult([{ summary: '共同方向证据不足', focuses: [], limitations: ['请补充同科目的其他错题与作答。'] }], saved).focuses).toEqual([]);
  });
  it('limits prompt-only suggestions to two and rejects high priority without answer evidence', async () => {
    const r = await start(), saved = weaknessById(store, 'a', r.id), response = resultFor(saved);
    response[0].focuses[0].priority = 'high';
    expect(() => validateWeaknessResult(response, saved)).toThrow('不能标为高优先级');
    response[0].focuses[0].priority = 'medium';
    response[0].focuses.push({ ...response[0].focuses[0], title: '条件与目标量的联系', priority: 'low' });
    expect(validateWeaknessResult(response, saved).focuses).toHaveLength(2);
    response[0].focuses.push({ ...response[0].focuses[0], title: '额外的泛化练习方向' });
    expect(() => validateWeaknessResult(response, saved)).toThrow('最多保留两项');
  });
  it('accepts narrowly stated abstentions and future prevention without treating them as observed errors', async () => {
    const r = await start(), saved = weaknessById(store, 'a', r.id), response = resultFor(saved);
    response[0].summary = '这是收录题目的待核对学习建议；无法确定学生是否出现计算错误。';
    response[0].focuses[0].reason = '两题共同涉及代入条件，不能据此判断学生存在概念混淆。';
    response[0].focuses[0].practiceDirection = '练习时核对符号，避免计算错误。';
    response[0].focuses[0].evidence[0].reason = '题干给出代入条件，不能判断概念混淆。';
    response[0].limitations = ['一次正确不代表完全掌握。', '一次复测正确不代表永久掌握。', '现有材料不能证明已经掌握。'];
    const result = validateWeaknessResult(response, saved);
    expect(result.focuses[0].reason).toBe(response[0].focuses[0].reason);
    expect(result.limitations).toEqual(response[0].limitations);
  });
  it.each([
    ['reason', '不能判断概念混淆，但学生确实不理解这些条件。'],
    ['reason', '不能判断概念混淆但学生确实不理解这些条件。'],
    ['reason', '不能排除概念混淆。'],
    ['reason', '不能判断没有计算错误。'],
    ['practiceDirection', '避免计算错误，也说明学生经常粗心。'],
    ['practiceDirection', '学生没有避免计算错误。'],
    ['summary', '这些题表明学生理解不足。'],
    ['limitations', '无法确定学生是否出现计算错误，但这位学生基础薄弱。'],
    ['limitations', '一次正确不代表完全掌握，但该学生已经掌握。'],
    ['limitations', '一次正确不代表完全掌握但学生天生学不会。'],
    ['knowledgePoints', '概念混淆'],
    ['evidenceReason', '这些条件证明学生计算能力差。'],
  ])('still rejects unsupported claims in %s even beside a disclaimer: %s', async (field, value) => {
    const r = await start(), saved = weaknessById(store, 'a', r.id), response = resultFor(saved), focus = response[0].focuses[0];
    if (field === 'summary') response[0].summary = value;
    else if (field === 'limitations') response[0].limitations = [value];
    else if (field === 'knowledgePoints') focus.knowledgePoints = [value];
    else if (field === 'evidenceReason') focus.evidence[0].reason = value;
    else if (field === 'reason') focus.reason = value;
    else focus.practiceDirection = value;
    expect(() => validateWeaknessResult(response, saved)).toThrow('已拦下');
  });
  it('runs a three-question physics review sample with unknown handwriting through both model passes and leaves all axes unscored', async () => {
    // Entirely synthetic: reproduces the evidence shape, never private photos or text.
    const questions = [1, 2, 3].map((n): Question => ({ ...question(n, '物理'), prompt: `物体以 ${n + 1} m/s 的恒定速度运动 4 s，求路程。`, knowledgePoints: ['匀速运动'],
      answerSteps: [{ id: `s${n}`, order: 0, text: '待确认笔迹仅供合成测试', author: 'unknown', crossedOut: false, uncertain: false, regionIds: [] }],
      tutoring: { status: 'needs_review' as const, result: { transcribedPrompt: '', referenceAnswer: `${(n + 1) * 4} m`, explanation: '路程等于速度乘时间。',
        answerEvidence: [], errorHypotheses: [], uncertainties: [], generatedAt: '2026-10-02T00:00:00Z', needsReview: true as const },
        review: { status: 'confirmed' as const, reviewedAt: '2026-10-02T00:01:00Z', resultGeneratedAt: '2026-10-02T00:00:00Z' } } }));
    update([...questions, ...[4, 5, 6].map(n => ({ ...question(n, '物理'), prompt: '', confirmed: false })), question(7, '化学'), question(8, '语文')]);
    const r = await start('物理'), saved = weaknessById(store, 'a', r.id), requests: Record<string, unknown>[] = [];
    expect(saved.coverage).toMatchObject({ total: 6, eligible: 3, selected: 3, needsReview: 3 });
    expect(saved.input.every(s => s.studentEvidence.length === 0)).toBe(true);
    const response = [{ summary: '这些收录题目共同涉及匀速运动，是待核对的练习建议。', focuses: [{ title: '联系速度、时间与路程', subject: '物理', dimensionId: 'calculation',
      knowledgePoints: ['匀速运动'], priority: 'medium', basis: 'wrong_question_pattern', reason: '三题都提供速度与时间，可以练习条件和关系式之间的联系。',
      practiceDirection: '列出条件与单位后再代入，避免计算错误。', evidence: saved.input.map(s => ({ sourceId: s.id, kind: 'question', quote: s.prompt, reason: '题干要求由速度和时间求路程。' })) }],
      limitations: ['缺少经确认的独立作答，个人能力与具体错因待评估。'] }];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      const contextText = body.messages[1].content[0].text as string;
      const context = JSON.parse(contextText.slice(contextText.indexOf('\n') + 1));
      expect(context.evidencePolicy).toContain('收录到错题本只表示希望复习，不证明这道题实际做错');
      expect(context.evidencePolicy).toContain('reviewedAnswer是核对过的参考答案，不是学生的作答表现');
      expect(context.subjectEvidence).toEqual([{ subject: '物理', questionCount: 3, sourcesWithStudentEvidence: 0, allowedBasis: ['wrong_question_pattern'] }]);
      expect(context.sources).toEqual(saved.input); expect(JSON.stringify(body)).not.toContain('待确认笔迹仅供合成测试');
      const isReview = String(body.messages[0].content).includes('依据核验老师');
      expect(String(body.messages[0].content)).toContain('正确');
      expect(String(body.messages[0].content)).toContain('精确交集');
      expect(String(body.messages[0].content)).toContain('选择题选项是待判断的命题');
      expect(String(body.messages[0].content)).toContain('不为覆盖六轴');
      if (!isReview) {
        const properties = JSON.parse(String(body.messages[0].content).split('仅输出符合以下结构的 JSON，不要添加 Markdown 标记：')[1]).properties.questions.items.properties;
        expect(Object.keys(properties)).toEqual(['focuses']);
        const output = properties.focuses;
        expect(output.maxItems).toBe(2);
        expect(output.items.properties.priority.enum).toEqual(['medium', 'low']);
        expect(output.items.properties.basis.enum).toEqual(['wrong_question_pattern']);
      }
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questions: isReview ? reviewFor(body) : response }) } }] });
    }));
    await runNextWeaknessJob(store);
    const done = (await get(r)).report;
    expect(done.status).toBe('ready'); expect(requests).toHaveLength(2);
    expect(done.result!.axes).toHaveLength(6); expect(done.result!.axes.every(a => a.score === null && a.evidenceCount === 0 && a.confidence === 'insufficient')).toBe(true);
    expect(done.result!.focuses[0].evidence).toHaveLength(3);
    expect(JSON.stringify(requests)).not.toContain('image_url');
  });
  it('does not publish even a structurally valid non-claim when the independent semantic review rejects it', async () => {
    const r = await start(), saved = weaknessById(store, 'a', r.id), response = resultFor(saved);
    response[0].focuses[0].practiceDirection = '避免计算错误。';
    const fetch = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body), isReview = String(body.messages[0].content).includes('依据核验老师');
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questions: isReview ? reviewFor(body, false, 'shared_evidence', '私有合成复核正文：只有第一题支持核心要求，第二题仅同章节。') : response }) } }] });
    });
    vi.stubGlobal('fetch', fetch); await runNextWeaknessJob(store);
    const failed = (await get(r)).report;
    expect(fetch).toHaveBeenCalledTimes(2); expect(failed).toMatchObject({ status: 'failed', error: '本次未形成有充分依据的练习建议：部分建议缺少至少两道题的共同依据。原题已保留，可补充材料后重试分析。' });
    expect(failed.result).toBeUndefined();
    expect(JSON.stringify(failed)).not.toContain('私有合成复核正文');
    const auditRoot = join(root, 'model-audit'), day = readdirSync(auditRoot)[0];
    const audits = readdirSync(join(auditRoot, day)).map(name => JSON.parse(readFileSync(join(auditRoot, day, name), 'utf8')));
    expect(audits).toHaveLength(1); expect(audits[0]).toMatchObject({ kind: 'weakness', failureCode: 'MODEL_OUTPUT', weaknessRejection: 'shared_evidence' });
    expect(JSON.stringify(audits)).not.toContain('私有合成复核正文');
  });
  it('rejects unknown review categories without echoing model text or adding model calls', async () => {
    const r = await start(), saved = weaknessById(store, 'a', r.id), trace = {};
    const fetch = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body), isReview = String(body.messages[0].content).includes('依据核验老师');
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questions: isReview ? reviewFor(body, false, '私有随意文本', '私有复核原因') : resultFor(saved) }) } }] });
    });
    vi.stubGlobal('fetch', fetch);
    await expect(analyzeWeakness(saved, trace)).rejects.toThrow('分析复核结构不完整');
    expect(fetch).toHaveBeenCalledTimes(2); expect(trace).not.toHaveProperty('weaknessRejection');
  });
  it('keeps only the complete original approved focus and replaces model narratives with an honest partial-result summary', async () => {
    const r = await start(), saved = weaknessById(store, 'a', r.id), response = resultFor(saved);
    response[0].focuses.push({ ...response[0].focuses[0], title: '不被两题共同支持的额外方向', dimensionId: 'reasoning' });
    response[0].summary = '第一轮越界摘要：学生已经完全掌握全部内容。';
    response[0].limitations = ['第一轮越界限制：无需继续学习。'];
    let original: ReturnType<typeof validateWeaknessResult>['focuses'] = [];
    const fetch = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body), isReview = String(body.messages[0].content).includes('依据核验老师');
      const text = body.messages[1].content[0].text as string, input = JSON.parse(text.slice(text.indexOf('\n') + 1));
      let questions: unknown = response;
      if (isReview) {
        expect(Object.keys(input.candidate)).toEqual(['focuses']);
        expect(JSON.stringify(body)).not.toContain('第一轮越界');
        original = input.candidate.focuses;
        questions = [{ reviews: [
          { focusId: original[1].id, approved: false, rejectionCode: 'shared_evidence', reason: '仅一题支持，私有复核说明。' },
          { focusId: original[0].id, approved: true, rejectionCode: 'none', reason: '两题共同支持。', replacementFocus: { title: '不能接受的改写' } },
        ], summary: '第二轮越界摘要：学生智力不足。', limitations: ['不能采用的模型限制'], focuses: [{ title: '不能接受的新条目' }] }];
      }
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questions }) } }] });
    });
    vi.stubGlobal('fetch', fetch); await runNextWeaknessJob(store);
    const done = (await get(r)).report;
    expect(fetch).toHaveBeenCalledTimes(2); expect(done.status).toBe('ready');
    expect(done.result!.focuses).toEqual([original[0]]);
    expect(done.result!.summary).toContain('保留 1 项'); expect(done.result!.summary).toContain('另有 1 项候选建议未通过复核');
    expect(done.result!.limitations.join(' ')).toContain('本次没有可用的学生作答');
    expect(JSON.stringify(done.result)).not.toMatch(/越界|无需继续学习|不能接受|智力不足/);
    expect(done.result!.axes.every(axis => axis.score === null)).toBe(true);
    const auditRoot = join(root, 'model-audit'), day = readdirSync(auditRoot)[0];
    const audit = JSON.parse(readFileSync(join(auditRoot, day, readdirSync(join(auditRoot, day))[0]), 'utf8'));
    expect(audit.weaknessFocusReviews).toEqual([
      { focusId: original[1].id, approved: false, rejectionCode: 'shared_evidence' },
      { focusId: original[0].id, approved: true, rejectionCode: 'none' },
    ]);
    expect(JSON.stringify(audit)).not.toMatch(/私有复核说明|sourceId|代入条件/);
  });
  it.each(['missing', 'duplicate', 'foreign', 'source_id', 'true_reject_code', 'false_none_code', 'not_boolean'])('rejects the entire %s review instead of selecting from malformed correspondence', async variant => {
    const r = await start(), saved = weaknessById(store, 'a', r.id), response = resultFor(saved);
    response[0].focuses.push({ ...response[0].focuses[0], title: '另一候选方向' });
    const candidate = validateWeaknessResult(response, saved), trace = {};
    const reviews: { focusId: string; approved: unknown; rejectionCode: string; reason: string }[] = candidate.focuses.map(focus => ({ focusId: focus.id, approved: true, rejectionCode: 'none', reason: '合成通过' }));
    if (variant === 'missing') reviews.pop();
    else if (variant === 'duplicate') reviews[1] = { ...reviews[0] };
    else if (variant === 'foreign') reviews[1].focusId = randomUUID();
    else if (variant === 'source_id') reviews[1].focusId = saved.input[0].id;
    else if (variant === 'true_reject_code') reviews[1].rejectionCode = 'shared_evidence';
    else if (variant === 'false_none_code') reviews[1].approved = false;
    else reviews[1].approved = 'true';
    expect(() => applyWeaknessReview([{ reviews }], candidate, saved, trace)).toThrow();
    expect(trace).not.toHaveProperty('weaknessFocusReviews');
  });
  it('leaves an empty candidate set failed with evidence insufficiency and does not buy an empty second review', async () => {
    const r = await start();
    const fetch = vi.fn(async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questions: [{ focuses: [] }] }) } }] }));
    vi.stubGlobal('fetch', fetch); await runNextWeaknessJob(store);
    const failed = (await get(r)).report;
    expect(fetch).toHaveBeenCalledTimes(1); expect(failed.status).toBe('failed'); expect(failed.result).toBeUndefined();
    expect(failed.error).toContain('未形成有充分依据');
  });
  it('accepts specific tentative error directions only with actual writing from at least two questions', async () => {
    update([1, 2].map(n => ({ ...question(n), answerSteps: [{ id: `s${n}`, order: 0, text: `x+4=${n}+4=4`, author: 'student', crossedOut: false, uncertain: false, regionIds: [] }] })));
    const r = await start(), saved = weaknessById(store, 'a', r.id), response = resultFor(saved, 'answer_evidence');
    response[0].focuses[0].reason = '已核对作答中的代入结果可能有计算错误，建议检查加法。';
    expect(validateWeaknessResult(response, saved).focuses[0].basis).toBe('answer_evidence');
  });
  it('uses two text-only model requests and rejects failed independent grounding review', async () => {
    const r = await start(), saved = weaknessById(store, 'a', r.id), requests: Record<string, unknown>[] = [];
    let approved = true;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      const response = String(body.messages[0].content).includes('依据核验老师') ? reviewFor(body, approved, approved ? 'none' : 'other') : resultFor(saved);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questions: response }) } }] });
    }));
    expect((await analyzeWeakness(saved, {})).focuses).toHaveLength(1); expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests)).not.toContain('image_url'); expect(JSON.stringify(requests)).toContain('不可信');
    approved = false; await expect(analyzeWeakness(saved, {})).rejects.toThrow('未形成有充分依据');
    expect(readStoredScan(store, 'a', scan.id)!.revision).toBe(scan.revision);
  });
});
