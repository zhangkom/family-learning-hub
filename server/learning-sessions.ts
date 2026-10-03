import { createHash, randomUUID } from 'node:crypto';
import type { LearningSession, LearningTask, LearningJob, LearningSummary } from '../lib/learning-session';
import { sessionSummary, taskPassed } from '../lib/learning-session';
import type { ScanRecord } from '../lib/scans';
import type { FamilyStore } from './family-store';
import { HttpError, json, readJson } from './family-backend';
import { ownedScan, requireStudent } from './mobile-service';
import { readStoredScan } from './scan-files';
import { selectedQuestion } from './question-learning';
import { recognitionEnabled } from './model-gateway';
import { questionLearningReadiness } from '../lib/question-context';

export type StoredTask = LearningTask & { answer: string; explanation: string; allHints: string[] };
export type StoredLearning = Omit<LearningSession, 'tasks' | 'job'> & { tasks: StoredTask[]; sourceRecord: ScanRecord; job?: LearningJob };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function textField(value: unknown, label: string, max: number, optional = false) {
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) throw new HttpError(400, `${label}请填写${optional ? '不超过' : '1 至'} ${max} 字`);
  return value.trim();
}
function requestId(value: unknown) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new HttpError(400, '请求标识无效，请重新打开');
  return value;
}
export function learningById(store: FamilyStore, account: string, id: string): StoredLearning {
  const row = store.db.prepare('SELECT body FROM learning_sessions WHERE account_id=? AND id=?').get(account, id);
  if (!row) throw new HttpError(404, '学习记录不存在');
  return JSON.parse(String(row.body));
}
export function publicLearning(session: StoredLearning): LearningSession {
  const { sourceRecord: _source, tasks, ...rest } = session;
  return { ...rest, sourceQuestions: _source.structuredQuestions, sourceImage: { size: _source.size, mimeType: _source.mimeType, sourcePage: _source.sourcePage, processing: _source.processing, sourceKind: _source.sourceKind }, tasks: tasks.map(({ answer, explanation, allHints, ...task }) => ({ ...task,
    hints: allHints.slice(0, task.hintCount), totalHints: allHints.length,
    ...(task.solutionViewed ? { solution: { answer, explanation } } : { solution: undefined }),
  })) };
}
export function saveLearning(store: FamilyStore, session: StoredLearning) {
  session.revision++; session.updatedAt = new Date().toISOString();
  store.db.prepare('UPDATE learning_sessions SET body=?,updated_at=? WHERE id=?').run(JSON.stringify(session), session.updatedAt, session.id);
}
function enqueue(store: FamilyStore, session: StoredLearning, operation: LearningJob['operation'], taskId?: string, attemptId?: string) {
  if (!recognitionEnabled()) throw new HttpError(503, 'AI 学习服务暂不可用，已有学习记录仍保留');
  const id = randomUUID(), now = Date.now();
  store.db.prepare('INSERT INTO learning_jobs(id,session_id,status,operation,task_id,attempt_id,available_at,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, session.id, 'queued', operation, taskId || null, attemptId || null, now, now);
  session.job = { id, operation, status: 'queued', taskId };
}
export async function createLearning(store: FamilyStore, account: string, body: Record<string, unknown>) {
  const id = requestId(body.requestId), studentId = textField(body.studentId, '学生', 100);
  const scanId = textField(body.scanId, '照片', 100), questionId = textField(body.questionId, '题目', 100);
  if (!['practice', 'challenge'].includes(String(body.mode)) || !Number.isSafeInteger(body.revision)) throw new HttpError(400, '学习栏目或题目版本无效');
  const mode = body.mode as 'practice' | 'challenge';
  const stuckPoint = textField(body.stuckPoint ?? '', '卡点', 2000, mode === 'practice');
  const initialWork = textField(body.initialWork ?? '', '已有尝试', 8000, true);
  const fingerprint = createHash('sha256').update(JSON.stringify([studentId, scanId, questionId, body.revision, mode, stuckPoint, initialWork])).digest('hex');
  const existing = () => {
    const row = store.db.prepare('SELECT fingerprint,body FROM learning_sessions WHERE account_id=? AND request_id=?').get(account, id);
    if (row && row.fingerprint !== fingerprint) throw new HttpError(409, '同一次请求内容已改变，请刷新后重试');
    return row ? JSON.parse(String(row.body)) as StoredLearning : undefined;
  };
  requireStudent(store, account, studentId);
  const old = existing(); if (old) return publicLearning(old);
  await ownedScan(store, account, scanId);
  return store.transaction(() => {
    const duplicate = existing(); if (duplicate) return publicLearning(duplicate);
    const record = readStoredScan(store, store.scanOwner(account), scanId);
    if (!record || record.deletedAt) throw new HttpError(404, '原题已不存在');
    if (record.studentId !== studentId) throw new HttpError(409, '原题不属于当前学生，请先核对归属');
    if (record.revision !== body.revision) throw new HttpError(409, '原题已更新，请刷新后重新选择');
    const question = selectedQuestion(record, questionId);
    const readiness = questionLearningReadiness(question, record.structuredQuestions || []);
    if (readiness) throw new HttpError(400, readiness);
    if (store.db.prepare("SELECT id FROM scan_jobs WHERE owner=? AND scan_id=? AND status IN ('queued','processing')").get(store.scanOwner(account), scanId)) throw new HttpError(409, '原题正在分析，请等待完成');
    const active = store.db.prepare("SELECT COUNT(*) AS n FROM learning_jobs j JOIN learning_sessions s ON s.id=j.session_id WHERE s.account_id=? AND j.status IN ('queued','processing')").get(account);
    if (Number(active?.n) >= 4) throw new HttpError(429, '已有学习任务在处理，请先完成或等待');
    const now = new Date().toISOString();
    const session: StoredLearning = { id: randomUUID(), studentId, mode, revision: 1, createdAt: now, updatedAt: now, stuckPoint, initialWork,
      source: { scanId, questionId, revision: record.revision, number: question.number, subject: question.subject!, prompt: question.prompt, knowledgePoints: question.knowledgePoints },
      sourceRecord: record, tasks: [] };
    store.db.prepare('INSERT INTO learning_sessions VALUES (?,?,?,?,?,?,?)').run(session.id, account, studentId, id, fingerprint, now, JSON.stringify(session));
    enqueue(store, session, 'prepare'); saveLearning(store, session); return publicLearning(session);
  });
}
export function changeLearning(store: FamilyStore, account: string, id: string, action: string, body: Record<string, unknown>) {
  return store.transaction(() => {
    const session = learningById(store, account, id);
    const task = session.tasks.find(t => t.id === body.taskId);
    // Receipt-loss retries return the original submission even after its revision advances.
    if (action === 'attempt' && task) {
      const attempt = task.attempts.find(a => a.id === body.requestId);
      if (attempt) {
        if (attempt.answer !== (typeof body.answer === 'string' ? body.answer.trim() : body.answer)) throw new HttpError(409, '作答已提交，请刷新查看原记录');
        return publicLearning(session);
      }
    }
    if (session.revision !== body.revision) throw new HttpError(409, '学习进度已更新，请刷新后继续');
    if (session.job && session.job.status !== 'failed') throw new HttpError(409, '任务正在处理，请等待完成');
    if (action === 'retry') {
      if (session.job?.status !== 'failed') throw new HttpError(400, '没有需要重试的任务');
      if (!recognitionEnabled()) throw new HttpError(503, 'AI 学习服务暂不可用');
      const row = store.db.prepare('SELECT * FROM learning_jobs WHERE id=? AND status=?').get(session.job.id, 'failed');
      if (!row) throw new HttpError(409, '任务状态已变化');
      enqueue(store, session, session.job.operation, row.task_id ? String(row.task_id) : undefined, row.attempt_id ? String(row.attempt_id) : undefined);
    } else if (action === 'retest') {
      if (!session.tasks.length || !session.tasks.filter(t => t.kind !== 'retest').every(taskPassed)) throw new HttpError(400, '请先完成当前练习，再开始复测');
      if (session.tasks.some(t => t.kind === 'retest' && !taskPassed(t))) throw new HttpError(409, '还有未完成的复测，请先完成');
      if (session.tasks.length >= 30) throw new HttpError(400, '这组学习记录已完成多次复测，请从原题新建一组');
      enqueue(store, session, 'retest');
    } else {
      if (!task) throw new HttpError(404, '学习题目不存在');
      if (session.job?.status === 'failed') throw new HttpError(409, '请先重试未完成的任务，作答内容已保留');
      if (action === 'hint') {
        if (task.kind === 'retest') throw new HttpError(400, '复测请独立作答，提交后再核对');
        if (task.hintCount < task.allHints.length) task.hintCount++;
      } else if (action === 'solution') {
        if (!task.attempts.some(a => a.feedback)) throw new HttpError(400, '请先提交一次作答，再查看参考解法');
        task.solutionViewed = true;
      } else if (action === 'attempt') {
        const attemptId = requestId(body.requestId), answer = textField(body.answer, '作答与步骤', 8000);
        if (task.attempts.length >= 20) throw new HttpError(400, '本题已提交多次，请核对讲解后开始新的练习');
        task.attempts.push({ id: attemptId, answer, createdAt: new Date().toISOString(), helped: task.hintCount > 0 || task.solutionViewed || task.attempts.some(a => !!a.feedback) });
        enqueue(store, session, 'grade', task.id, attemptId);
      } else throw new HttpError(404, '操作不存在');
    }
    saveLearning(store, session); return publicLearning(session);
  });
}
export async function learningResponse(request: Request, parts: string[], store: FamilyStore, account: string) {
  if (parts.length === 1) {
    if (request.method === 'POST') return json({ session: await createLearning(store, account, await readJson(request, 20000)) }, 202);
    if (request.method !== 'GET') throw new HttpError(405, '请求方式不支持');
    const params = new URL(request.url).searchParams, student = params.get('studentId'); requireStudent(store, account, student);
    const offset = Number(params.get('offset') || '0'); if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new HttpError(400, '页码无效');
    const sessions: LearningSummary[] = store.db.prepare("SELECT body FROM learning_sessions WHERE account_id=? AND student_id=? ORDER BY json_extract(body,'$.createdAt') DESC,id DESC LIMIT 51 OFFSET ?").all(account, student!, offset)
      .map(row => sessionSummary(publicLearning(JSON.parse(String(row.body)))));
    return json({ sessions: sessions.slice(0, 50), more: sessions.length > 50, enabled: recognitionEnabled() });
  }
  if (parts.length === 2 && request.method === 'GET') return json({ session: publicLearning(learningById(store, account, parts[1])) });
  if (parts.length === 3 && request.method === 'POST') {
    if (!store.allow(`learning-action:${account}`, 90, 60000)) throw new HttpError(429, '操作过于频繁，请稍后重试');
    return json({ session: changeLearning(store, account, parts[1], parts[2], await readJson(request, 20000)) });
  }
  throw new HttpError(405, '请求方式不支持');
}
