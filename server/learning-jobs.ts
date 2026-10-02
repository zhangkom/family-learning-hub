import { randomUUID } from 'node:crypto';
import type { FamilyStore } from './family-store';
import { learningById, saveLearning } from './learning-sessions';
import { prepareLearning, gradeLearning } from './learning-model';
import { recognitionEnabled, ModelGatewayError } from './model-gateway';
import { HttpError } from './family-backend';
import { taskPassed } from '../lib/learning-session';
import { writeAttemptAudit, type ModelTrace, type AttemptAudit } from './model-audit';

export const LEARNING_LEASE_MS = 300000;
export function claimLearningJob(store: FamilyStore, now = Date.now()) {
  return store.transaction(() => {
    const row = store.db.prepare("SELECT j.*,s.account_id FROM learning_jobs j JOIN learning_sessions s ON s.id=j.session_id WHERE (j.status='queued' AND j.available_at<=?) OR (j.status='processing' AND j.lease_until<=?) ORDER BY j.created_at LIMIT 1").get(now, now);
    if (!row) return null;
    const session = learningById(store, String(row.account_id), String(row.session_id));
    if (session.job?.id !== row.id) { store.db.prepare("UPDATE learning_jobs SET status='discarded' WHERE id=?").run(row.id); return null; }
    if (Number(row.attempts) >= 3) {
      store.db.prepare("UPDATE learning_jobs SET status='failed',lease_token=NULL,error=? WHERE id=?").run('处理多次中断，请点击重试', row.id);
      session.job.status = 'failed'; session.job.error = '处理多次中断，请点击重试'; saveLearning(store, session); return null;
    }
    const token = randomUUID(), attempt = Number(row.attempts) + 1;
    store.db.prepare("UPDATE learning_jobs SET status='processing',attempts=?,lease_until=?,lease_token=? WHERE id=?").run(attempt, now + LEARNING_LEASE_MS, token, row.id);
    session.job.status = 'processing'; delete session.job.error; saveLearning(store, session);
    return { id: String(row.id), account: String(row.account_id), session, token, attempt, operation: session.job.operation,
      taskId: row.task_id ? String(row.task_id) : '', attemptId: row.attempt_id ? String(row.attempt_id) : '', started: now, queued: Number(row.created_at) };
  });
}
type Claimed = NonNullable<ReturnType<typeof claimLearningJob>>;
export function finishLearningJob(store: FamilyStore, job: Claimed, apply: (session: Claimed['session']) => void, failure?: { message: string; retry: boolean }, now = Date.now()) {
  return store.transaction(() => {
    const row = store.db.prepare('SELECT status,lease_token,lease_until FROM learning_jobs WHERE id=?').get(job.id);
    if (!row || row.status !== 'processing' || row.lease_token !== job.token || Number(row.lease_until) <= now) return false;
    const current = learningById(store, job.account, job.session.id);
    if (current.job?.id !== job.id) return false;
    const retry = !!failure?.retry && job.attempt < 3;
    if (!failure) { apply(current); delete current.job; }
    else current.job = { ...current.job!, status: retry ? 'queued' : 'failed', error: failure.message };
    store.db.prepare('UPDATE learning_jobs SET status=?,available_at=?,lease_token=NULL,lease_until=0,error=? WHERE id=?')
      .run(failure ? retry ? 'queued' : 'failed' : 'succeeded', now + 15000 * job.attempt, failure?.message || null, job.id);
    saveLearning(store, current); return true;
  });
}
export async function runNextLearningJob(store: FamilyStore, prepare = prepareLearning, grade = gradeLearning) {
  if (!recognitionEnabled()) return false;
  const job = claimLearningJob(store); if (!job) return false;
  const trace: ModelTrace = {}, start = performance.now(); let outcome: AttemptAudit['outcome'] = 'discarded'; let failureCode: AttemptAudit['failureCode'];
  try {
    const limit = Math.max(1, Math.min(200, Number(process.env.FAMILY_LEARNING_DAILY_LIMIT) || 30));
    if (!store.allow(`learning-model:${job.account}`, limit, 86400000)) throw new HttpError(429, '已达到本家庭24小时学习任务限额，记录已保存，请稍后重试');
    const owner = store.scanOwner(job.account);
    if (job.operation === 'grade') {
      const task = job.session.tasks.find(t => t.id === job.taskId), attempt = task?.attempts.find(a => a.id === job.attemptId);
      if (!task || !attempt) throw new HttpError(400, '待批改作答不存在');
      const feedback = await grade(owner, job.session, task, attempt.answer, trace);
      outcome = finishLearningJob(store, job, current => {
        current.tasks.find(t => t.id === task.id)!.attempts.find(a => a.id === attempt.id)!.feedback = feedback;
        if (current.tasks.filter(t => t.kind !== 'retest').every(taskPassed)) {
          const passedRetest = task.kind === 'retest' && feedback.verdict === 'correct' && !attempt.helped;
          if (passedRetest) current.retestDueAt = new Date(Date.now() + 3 * 86400000).toISOString();
          else current.retestDueAt ||= new Date(Date.now() + 86400000).toISOString();
        }
      }) ? 'succeeded' : 'discarded';
    } else {
      const tasks = await prepare(owner, job.session, job.operation === 'retest', trace);
      outcome = finishLearningJob(store, job, current => { if (job.operation === 'prepare') current.tasks = tasks; else current.tasks.push(...tasks); }) ? 'succeeded' : 'discarded';
    }
  } catch (error) {
    const retry = error instanceof ModelGatewayError ? error.retry : !(error instanceof HttpError) || error.status >= 500 && error.status !== 503;
    failureCode = error instanceof ModelGatewayError ? error.code : error instanceof HttpError ? error.status === 429 ? 'LOCAL_QUOTA' : 'LOCAL_VALIDATION' : 'INTERNAL_ERROR';
    outcome = finishLearningJob(store, job, () => {}, { message: error instanceof HttpError ? error.message : '学习服务暂时中断，作答已保存', retry }) ? retry && job.attempt < 3 ? 'retry_queued' : 'failed' : 'discarded';
  } finally {
    await writeAttemptAudit({ ...trace, jobId: job.id, kind: 'learning', attempt: job.attempt, queuedAt: job.queued, readyAt: job.queued,
      startedAt: job.started, endedAt: Date.now(), attemptMs: performance.now() - start, outcome, failureCode });
  }
  return true;
}
