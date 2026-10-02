import { randomUUID } from 'node:crypto';
import type { FamilyStore } from './family-store';
import { weaknessById, saveWeakness, type StoredWeakness } from './weakness-reports';
import { analyzeWeakness } from './weakness-model';
import { recognitionEnabled, ModelGatewayError } from './model-gateway';
import { HttpError } from './family-backend';
import { writeAttemptAudit, type ModelTrace, type AttemptAudit } from './model-audit';
import { abilityAxes } from './ability-evidence';

export const WEAKNESS_LEASE_MS = 300000;
export function claimWeaknessJob(store: FamilyStore, now = Date.now()) {
  return store.transaction(() => {
    const row = store.db.prepare("SELECT j.*,r.account_id FROM weakness_jobs j JOIN weakness_reports r ON r.id=j.report_id WHERE (j.status='queued' AND j.available_at<=?) OR (j.status='processing' AND j.lease_until<=?) ORDER BY j.created_at,j.id LIMIT 1").get(now, now);
    if (!row) return null;
    const report = weaknessById(store, String(row.account_id), String(row.report_id));
    if (report.jobId !== row.id) { store.db.prepare("UPDATE weakness_jobs SET status='discarded' WHERE id=?").run(row.id); return null; }
    if (Number(row.attempts) >= 3) {
      report.status = 'failed'; report.error = '处理多次中断，材料已保存，请点击重试';
      store.db.prepare("UPDATE weakness_jobs SET status='failed',lease_token=NULL,error=? WHERE id=?").run(report.error, row.id); saveWeakness(store, report); return null;
    }
    const token = randomUUID(), attempt = Number(row.attempts) + 1;
    store.db.prepare("UPDATE weakness_jobs SET status='processing',attempts=?,lease_until=?,lease_token=? WHERE id=?").run(attempt, now + WEAKNESS_LEASE_MS, token, row.id);
    report.status = 'processing'; delete report.error; saveWeakness(store, report);
    return { id: String(row.id), account: String(row.account_id), report, token, attempt, started: now, queued: Number(row.created_at) };
  });
}
type Claimed = NonNullable<ReturnType<typeof claimWeaknessJob>>;
export function finishWeaknessJob(store: FamilyStore, job: Claimed, apply: (report: StoredWeakness) => void, failure?: { message: string; retry: boolean }, now = Date.now()) {
  return store.transaction(() => {
    const row = store.db.prepare('SELECT status,lease_token,lease_until FROM weakness_jobs WHERE id=?').get(job.id);
    if (!row || row.status !== 'processing' || row.lease_token !== job.token || Number(row.lease_until) <= now) return false;
    const current = weaknessById(store, job.account, job.report.id);
    if (current.jobId !== job.id) return false;
    const retry = !!failure?.retry && job.attempt < 3;
    if (!failure) { apply(current); current.status = 'ready'; delete current.error; }
    else { current.status = retry ? 'queued' : 'failed'; current.error = failure.message; }
    store.db.prepare('UPDATE weakness_jobs SET status=?,available_at=?,lease_token=NULL,lease_until=0,error=? WHERE id=?')
      .run(failure ? retry ? 'queued' : 'failed' : 'succeeded', now + 15000 * job.attempt, failure?.message || null, job.id);
    saveWeakness(store, current); return true;
  });
}
export async function runNextWeaknessJob(store: FamilyStore, analyze = analyzeWeakness) {
  if (!recognitionEnabled()) return false;
  const job = claimWeaknessJob(store); if (!job) return false;
  const trace: ModelTrace = {}, start = performance.now(); let outcome: AttemptAudit['outcome'] = 'discarded'; let failureCode: AttemptAudit['failureCode'];
  try {
    const limit = Math.max(1, Math.min(100, Number(process.env.FAMILY_WEAKNESS_DAILY_LIMIT) || 10));
    if (!store.allow(`weakness-model:${job.account}`, limit, 86400000)) throw new HttpError(429, '已达到本家庭24小时薄弱点分析限额，材料已保存，请稍后重试');
    const result = await analyze(job.report, trace);
    result.axes = abilityAxes(job.report, result);
    outcome = finishWeaknessJob(store, job, current => { current.result = result; }) ? 'succeeded' : 'discarded';
  } catch (error) {
    const retry = error instanceof ModelGatewayError ? error.retry : !(error instanceof HttpError) || error.status >= 500 && error.status !== 503;
    failureCode = error instanceof ModelGatewayError ? error.code : error instanceof HttpError ? error.status === 429 ? 'LOCAL_QUOTA' : 'LOCAL_VALIDATION' : 'INTERNAL_ERROR';
    outcome = finishWeaknessJob(store, job, () => {}, { message: error instanceof HttpError || error instanceof ModelGatewayError ? error.message : '薄弱点分析暂时中断，材料已保存', retry }) ? retry && job.attempt < 3 ? 'retry_queued' : 'failed' : 'discarded';
  } finally {
    await writeAttemptAudit({ ...trace, jobId: job.id, kind: 'weakness', attempt: job.attempt, queuedAt: job.queued, readyAt: job.queued,
      startedAt: job.started, endedAt: Date.now(), attemptMs: performance.now() - start, outcome, failureCode });
  }
  return true;
}
