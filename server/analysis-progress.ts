import { ANALYSIS_LEASE_MS, MAX_ANALYSIS_ATTEMPTS, type AnalysisProgress } from '../lib/analysis';
import type { FamilyStore } from './family-store';

/** Authenticated callers only; no job identifiers, lease tokens or other families' queue positions. */
export function analysisProgress(store: FamilyStore, account: string, scanId: string, enabled: boolean, now = Date.now()): AnalysisProgress | undefined {
  const row = store.db.prepare("SELECT question_id,status,attempts,created_at,available_at,lease_until FROM scan_jobs WHERE account_id=? AND owner=? AND scan_id=? AND status IN ('queued','processing')")
    .get(account, store.scanOwner(account), scanId);
  if (!row) return;
  const attempts = Number(row.attempts), queuedAt = Number(row.created_at);
  const phase = !enabled ? 'paused' : row.status === 'processing'
    ? Number(row.lease_until) <= now ? 'recovering' : 'processing'
    : attempts > 0 && Number(row.available_at) > now ? 'retry_wait' : 'queued';
  return {
    ...(typeof row.question_id === 'string' ? { questionId: row.question_id } : {}),
    phase, attempts, maxAttempts: MAX_ANALYSIS_ATTEMPTS, queuedAt, serverTime: now,
    ...(row.status === 'processing' ? { startedAt: Math.max(queuedAt, Number(row.lease_until) - ANALYSIS_LEASE_MS) } : {}),
    ...(phase === 'retry_wait' ? { retryAt: Number(row.available_at) } : {}),
  };
}
