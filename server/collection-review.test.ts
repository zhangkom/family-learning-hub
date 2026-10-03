import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, renameSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { FamilyStore } from './family-store';
import { handleMobile } from './mobile-backend';
import { readStoredScan, writeStoredScan, scanDirectory } from './scan-files';
import { sharp } from './sharp';
import { weaknessMaterials } from './weakness-materials';
import { questionCollectionState } from '../lib/question-collection';
import { questionLearningReadiness } from '../lib/question-context';
import type { MobileScan, Question } from '../lib/mobile';
import { questionDifficultyStars } from '../lib/question-difficulty';
import * as crops from './question-crop';

let directory: string, store: FamilyStore, student: string, sibling: string, scan: MobileScan;
const token = 'c'.repeat(64), other = 'd'.repeat(64);
const paperMark: Question['paperMark'] = { classification: 'pending', ruleIds: ['R09'], evidence: [{ text: '合成蓝星，颜色不符合自动重点规则' }], reviewedAt: '2026-01-01T00:00:00Z', reviewedBy: 'codex-manual', independentAssessment: false };
function call(path: string, method = 'GET', body?: unknown, auth = token) {
  return handleMobile(new Request('https://family.example/family-learning/api/mobile/v1/' + path, { method, headers: { Origin: 'https://localhost', Authorization: 'Bearer ' + auth }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) }), path.split('?')[0].split('/'), store) as Promise<Omit<Response, 'json'> & { json(): Promise<{scan: MobileScan}> }>;
}
const input = (extra = {}) => ({ studentId: student, revision: scan.revision, decision: 'focus', materialStatus: 'incomplete', reason: '人工决定先收录，缺失条件继续待补', ...extra });
const endpoint = () => `scans/${scan.id}/questions/q/collection-review`;
async function decide(extra = {}) { const response = await call(endpoint(), 'POST', input(extra)); const data = await response.json(); expect(response.status, JSON.stringify(data)).toBe(200); scan = data.scan; return scan.questions[0]; }
async function edit(extra = {}) { const response = await call(`scans/${scan.id}/review`, 'PUT', { revision: scan.revision, questions: scan.questions.map(q => ({ ...q, ...extra })) }); expect(response.status).toBe(200); scan = (await response.json()).scan; return scan.questions[0]; }
const complete = { materialStatus: 'complete', materialEvidence: '逐框核对完整题干、所有配图和关联材料，无缺字遮挡。' };
const learn = () => call('learning-sessions', 'POST', { requestId: randomUUID(), studentId: student, scanId: scan.id, questionId: 'q', revision: scan.revision, mode: 'practice' });
beforeEach(async () => {
  mkdirSync('work', { recursive: true }); directory = mkdtempSync(resolve('work/collection-review-')); store = new FamilyStore(join(directory, 'family.sqlite'));
  vi.stubEnv('FAMILY_DATA_DIR', directory); vi.stubEnv('FAMILY_PUBLIC_ORIGIN', 'https://family.example'); vi.stubEnv('FAMILY_MOBILE_ORIGINS', 'https://localhost');
  vi.stubEnv('FAMILY_RECOGNITION_ENABLED', 'true'); vi.stubEnv('FAMILY_AI_API_KEY', 'synthetic'); vi.stubEnv('FAMILY_AI_MODEL', 'synthetic'); vi.stubEnv('FAMILY_AI_BASE_URL', 'https://model.example/v1');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No external calls permitted')));
  for (const [id, t] of [['a', token], ['b', other]]) { store.db.prepare('INSERT INTO accounts VALUES (?,?,?,?)').run(id, id, 'unusable-synthetic-password', Date.now()); store.db.prepare('INSERT INTO mobile_sessions VALUES (?,?,?,?,?)').run(createHash('sha256').update(t).digest('hex'), id, Date.now() + 600000, 'synthetic', Date.now()); }
  student = store.addStudent('a', '合成学生').id; sibling = store.addStudent('a', '同家庭另一学生').id;
  const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#eee' } }).png().toBuffer();
  const form = new FormData(); form.set('studentId', student); form.set('source', '合成资料'); form.set('clientRequestId', randomUUID()); form.set('file', new File([new Uint8Array(png)], 'synthetic.png', { type: 'image/png' }));
  scan = (await (await call('scans', 'POST', form)).json()).scan;
  const q: Question = { id: 'q', number: '1', subject: '数学', confirmed: true, prompt: '题目定位摘要：合成代入题，以完整图为准', promptKind: 'summary', diagram: '', regions: [{ id: 'r', kind: 'stem', x: 0, y: 0, width: 1, height: 1 }], knowledgePoints: ['代入计算'], answerSteps: [], uncertainties: ['合成待复核'], paperMark };
  store.transaction(() => writeStoredScan(store, store.scanOwner('a'), { ...readStoredScan(store, store.scanOwner('a'), scan.id)!, revision: scan.revision + 1, structuredQuestions: [q], status: 'needs_review' }, 'synthetic-paper-mark'));
  scan = (await (await call(`scans/${scan.id}`)).json()).scan;
});
afterEach(() => { store.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); expect(directory.startsWith(resolve('work') + sep)).toBe(true); rmSync(directory, { recursive: true, force: true }); });

describe('manual collection decision and material review across modules', () => {
  it('keeps missing materials blocked even after confirmation or collection, and preserves paper evidence', async () => {
    const original = JSON.stringify(paperMark); await edit({ confirmed: true }); expect((await learn()).status).toBe(400);
    expect((await call(`scans/${scan.id}/questions/q/wrong-book`, 'POST', { revision: scan.revision, saved: true })).status).toBe(409);
    const q = await decide({ decision: 'both' }); expect(q.wrongBook).toBeTruthy(); expect(q.focusBook).toBeTruthy(); expect(JSON.stringify(q.paperMark)).toBe(original);
    expect(scan.status).toBe('needs_review');
    expect(questionCollectionState(q)).toMatchObject({ collectionPending: false, materialPending: true }); expect((await learn()).status).toBe(400);
    expect(weaknessMaterials(store, 'a', student, '').materials).toMatchObject({ total: 1, eligible: 0, needsReview: 1 });
    expect(q.collectionReview).toMatchObject({ actorAccountId: 'a', sourceRevision: scan.revision - 1, status: 'current' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('allows an explicit complete-image summary to become focus and learn but keeps graph summary blocked', async () => {
    await decide({ ...complete, decision: 'both' }); const q = scan.questions[0];
    expect(q.paperMark).toEqual(paperMark); expect(q.uncertainties).toEqual(['合成待复核']); expect(questionLearningReadiness(q, scan.questions)).toBe('');
    expect((await learn()).status).toBe(202); expect(weaknessMaterials(store, 'a', student, '').materials).toMatchObject({ total: 1, eligible: 0 });
    await edit({ prompt: '已知x=2，求x+3。', promptKind: 'full' }); expect(scan.questions[0].collectionReview?.status).toBe('stale');
    await decide({ ...complete, decision: 'both' }); expect(weaknessMaterials(store, 'a', student, '').materials).toMatchObject({ total: 1, eligible: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('supports none without a complete image, removes collection and does not unlock learning', async () => {
    await decide({ decision: 'both' }); const savedAt = scan.questions[0].wrongBook!.savedAt;
    await decide({ decision: 'wrong' }); expect(scan.questions[0].wrongBook!.savedAt).toBe(savedAt); expect(scan.questions[0].focusBook).toBeUndefined();
    renameSync(join(scanDirectory(store.scanOwner('a'), scan.id), 'original'), join(scanDirectory(store.scanOwner('a'), scan.id), 'missing-synthetic'));
    const q = await decide({ decision: 'none' }); expect(q.wrongBook).toBeUndefined(); expect(q.focusBook).toBeUndefined();
    expect(questionCollectionState(q)).toMatchObject({ decision: 'none', collectionPending: false, materialPending: true }); expect((await learn()).status).toBe(400);
    expect(weaknessMaterials(store, 'a', student, '').materials.total).toBe(0);
  });
  it('rejects incomplete complete-claims, missing image, stale versions, forged actors and foreign ownership', async () => {
    expect((await call(endpoint(), 'POST', input({ materialStatus: 'complete' }))).status).toBe(400);
    expect((await call(endpoint(), 'POST', input({ ...complete, materialEvidence: '已确认' }))).status).toBe(400);
    expect((await call(endpoint(), 'POST', input({ ...complete, actorAccountId: 'admin' }))).status).toBe(400);
    expect((await call(endpoint(), 'POST', input({ studentId: sibling }))).status).toBe(404);
    expect((await call(endpoint(), 'POST', input(), other)).status).toBe(404);
    expect((await call(endpoint(), 'POST', input({ revision: scan.revision - 1 }))).status).toBe(409);
    await edit({ confirmed: false }); expect((await call(endpoint(), 'POST', input(complete))).status).toBe(400);
    await edit({ confirmed: true }); renameSync(join(scanDirectory(store.scanOwner('a'), scan.id), 'original'), join(scanDirectory(store.scanOwner('a'), scan.id), 'missing-synthetic'));
    expect((await call(endpoint(), 'POST', input(complete))).status).toBeGreaterThanOrEqual(400); expect(scan.questions[0].collectionReview).toBeUndefined();
  });
  it('preserves review on result-only writes, invalidates on image changes, and audits prior decisions', async () => {
    await decide(complete); const reviewed = scan.questions[0].collectionReview;
    await edit(); expect(scan.questions[0].collectionReview).toEqual(reviewed);
    const owner = store.scanOwner('a'), current = readStoredScan(store, owner, scan.id)!;
    store.transaction(() => writeStoredScan(store, owner, { ...current, revision: current.revision + 1, size: current.size + 1 }, 'synthetic-image-change'));
    const changed = readStoredScan(store, owner, scan.id)!;
    expect(changed.structuredQuestions![0].collectionReview?.status).toBe('stale'); expect(changed.structuredQuestions![0].paperMark).toEqual(paperMark);
    const versions = store.db.prepare("SELECT body,actor FROM scan_versions WHERE owner=? AND id=? AND actor LIKE 'collection-review:%'").all(owner, scan.id);
    expect(versions).toHaveLength(1); expect(JSON.parse(String(versions[0].body)).structuredQuestions[0].collectionReview.status).toBe('current');
  });
  it('does not allow a stale importer or model snapshot to replace the latest human collection decision', async () => {
    await decide({ ...complete, decision: 'both' }); const oldQuestion = scan.questions[0];
    await decide({ decision: 'none' }); const owner = store.scanOwner('a'), current = readStoredScan(store, owner, scan.id)!;
    store.transaction(() => writeStoredScan(store, owner, { ...current, revision: current.revision + 1, structuredQuestions: [oldQuestion] }, 'synthetic-old-job'));
    const q = readStoredScan(store, owner, scan.id)!.structuredQuestions![0];
    expect(q.collectionReview?.decision).toBe('none'); expect(q.collectionReview?.materialStatus).toBe('incomplete');
    expect(q.wrongBook).toBeUndefined(); expect(q.focusBook).toBeUndefined(); expect(q.paperMark).toEqual(paperMark);
    expect(questionLearningReadiness(q, [q])).not.toBe('');
  });
  it('rejects concurrent updates during image verification and cannot clear pending shared materials', async () => {
    vi.spyOn(crops, 'cropQuestionImages').mockImplementationOnce(async () => {
      const owner = store.scanOwner('a'), current = readStoredScan(store, owner, scan.id)!;
      store.transaction(() => writeStoredScan(store, owner, { ...current, revision: current.revision + 1 }, 'synthetic-concurrent-edit'));
      return [];
    });
    expect((await call(endpoint(), 'POST', input(complete))).status).toBe(409);
    scan = (await (await call(`scans/${scan.id}`)).json()).scan;
    const parent = { ...scan.questions[0], id: 'parent', regions: [{ ...scan.questions[0].regions[0], id: 'parent-region' }] };
    const owner = store.scanOwner('a'), current = readStoredScan(store, owner, scan.id)!;
    store.transaction(() => writeStoredScan(store, owner, { ...current, revision: current.revision + 1, structuredQuestions: [{ ...scan.questions[0], parentQuestionId: 'parent' }, parent] }, 'synthetic-shared-context'));
    scan = (await (await call(`scans/${scan.id}`)).json()).scan;
    expect((await call(endpoint(), 'POST', input(complete))).status).toBe(400);
    expect(scan.questions[0].collectionReview).toBeUndefined();
  });
  it('persists 1–5 manual stars without changing collection, image or learning content', async () => {
    expect(questionDifficultyStars(scan.questions[0])).toBe(3); await decide(complete);
    const prior = scan.questions[0], path = `scans/${scan.id}/questions/q/difficulty`;
    for (const stars of [5, 1, 3]) {
      const response = await call(path, 'POST', { studentId: student, revision: scan.revision, stars }); expect(response.status).toBe(200); scan = (await response.json()).scan;
      expect(questionDifficultyStars(scan.questions[0])).toBe(stars); expect(scan.questions[0].difficulty).toMatchObject({ stars, source: 'user', actorAccountId: 'a' });
      expect(scan.questions[0].paperMark).toEqual(prior.paperMark); expect(scan.questions[0].collectionReview).toEqual(prior.collectionReview);
    }
    await edit({ difficulty: { stars: 5, source: 'ai' } }); expect(questionDifficultyStars(scan.questions[0])).toBe(3);
    const owner = store.scanOwner('a'), current = readStoredScan(store, owner, scan.id)!;
    store.transaction(() => writeStoredScan(store, owner, { ...current, revision: current.revision + 1, structuredQuestions: current.structuredQuestions!.map(q => ({ ...q, difficulty: { stars: 1, source: 'ai', updatedAt: new Date().toISOString() } })) }, 'synthetic-model-result'));
    expect(readStoredScan(store, owner, scan.id)!.structuredQuestions![0].difficulty?.source).toBe('user');
    expect(readStoredScan(store, owner, scan.id)!.structuredQuestions![0].difficulty?.stars).toBe(3);
  });
  it('rejects invalid stars, foreign students, forged AI attribution and stale writes', async () => {
    const path = `scans/${scan.id}/questions/q/difficulty`, body = { studentId: student, revision: scan.revision, stars: 4 };
    for (const stars of [0, 6, 2.5, '4', null]) expect((await call(path, 'POST', { ...body, stars })).status).toBe(400);
    expect((await call(path, 'POST', { ...body, source: 'ai' })).status).toBe(400);
    expect((await call(path, 'POST', { ...body, studentId: sibling })).status).toBe(404);
    expect((await call(path, 'POST', body, other)).status).toBe(404);
    expect((await call(path, 'POST', { ...body, revision: scan.revision - 1 })).status).toBe(409);
    expect((await call(path, 'POST', body)).status).toBe(200);
    expect((await call(path, 'POST', { ...body, stars: 1 })).status).toBe(409);
  });
});
