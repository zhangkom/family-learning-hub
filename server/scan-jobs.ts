import { randomUUID } from 'node:crypto';
import { HttpError } from './family-backend';
import type { FamilyStore } from './family-store';
import { readScanFile, readStoredScan, writeStoredScan } from './scan-files';
import {
  recognitionEnabled,
  recognizeStructuredQuestions,
  explainQuestion,
  ModelGatewayError,
} from './model-gateway';
import {
  measurePhase,
  measureValidation,
  writeAttemptAudit,
  type AttemptAudit,
  type ModelTrace,
} from './model-audit';
import { selectedQuestion } from './question-learning';
import { questionsOf, requireStudent } from './mobile-service';
import {
  validateQuestions,
  type Question,
  type TutoringResult,
} from '../lib/mobile';
import type { ScanRecord } from '../lib/scans';

export function enqueueRecognition(
  store: FamilyStore,
  account: string,
  scanId: string,
  revision: unknown,
) {
  if (!Number.isSafeInteger(revision) || Number(revision) < 0)
    throw new HttpError(400, '资料版本无效');
  if (!recognitionEnabled())
    throw new HttpError(503, 'AI 识题暂未启用，可以先手动整理');
  const owner = store.scanOwner(account);
  const original = readStoredScan(store, owner, scanId);
  if (!original || original.deletedAt) throw new HttpError(404, '资料不存在');
  requireStudent(
    store,
    account,
    original.studentId || original.child || 'dabao',
  );
  if (
    original.mimeType === 'application/pdf' &&
    (process.env.FAMILY_AI_PROTOCOL ||
      (process.env.FAMILY_AI_API_KEY ? 'chat-completions' : 'responses')) !==
      'responses'
  )
    throw new HttpError(
      400,
      '当前模型不支持 PDF 识别，请手动整理或上传清晰照片',
    );
  return store.transaction(() => {
    const record = readStoredScan(store, owner, scanId)!;
    if (record.revision !== revision)
      throw new HttpError(409, '资料已更新，请刷新后再识别');
    const running = store.db
      .prepare(
        "SELECT id FROM scan_jobs WHERE owner=? AND scan_id=? AND status IN ('queued','processing')",
      )
      .get(owner, scanId);
    if (running) return record;
    if (
      record.confirmedAt ||
      questionsOf(record).length ||
      record.status === '识别中'
    )
      throw new HttpError(
        409,
        '已有校对内容或正在处理，请保留草稿，不重复覆盖识别',
      );
    const next = {
      ...record,
      status: 'queued',
      structuredQuestions: [],
      revision: record.revision + 1,
      error: undefined,
    };
    writeStoredScan(store, owner, next, 'enqueue');
    store.db
      .prepare(
        'INSERT INTO scan_jobs (id,account_id,owner,student_id,scan_id,revision,status,available_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(
        randomUUID(),
        account,
        owner,
        record.studentId || record.child || 'dabao',
        scanId,
        next.revision,
        'queued',
        Date.now(),
        Date.now(),
      );
    return next;
  });
}
export type ClaimedJob = {
  id: string;
  token: string;
  account: string;
  owner: string;
  studentId: string;
  scanId: string;
  revision: number;
  attempts: number;
  queuedAt: number;
  readyAt: number;
  startedAt: number;
  record: ScanRecord;
  questionId?: string;
};

export function enqueueExplanation(
  store: FamilyStore,
  account: string,
  scanId: string,
  questionId: string,
  revision: unknown,
) {
  if (!Number.isSafeInteger(revision) || Number(revision) < 0)
    throw new HttpError(400, '资料版本无效');
  if (!recognitionEnabled())
    throw new HttpError(503, 'AI 讲题暂未启用，错题与原件仍保留');
  const owner = store.scanOwner(account);
  return store.transaction(() => {
    const current = readStoredScan(store, owner, scanId);
    if (!current || current.deletedAt) throw new HttpError(404, '资料不存在');
    requireStudent(
      store,
      account,
      current.studentId || current.child || 'dabao',
    );
    if (current.revision !== revision)
      throw new HttpError(409, '资料已更新，请刷新后讲解');
    selectedQuestion(current, questionId);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(current.mimeType))
      throw new HttpError(400, '单题框选讲解暂支持照片，PDF 原件仍保留');
    const running = store.db
      .prepare(
        "SELECT question_id FROM scan_jobs WHERE owner=? AND scan_id=? AND status IN ('queued','processing')",
      )
      .get(owner, scanId);
    if (running) {
      if (running.question_id === questionId) return current;
      throw new HttpError(409, '本页还有 AI 任务，请完成后再讲解另一题');
    }
    const next: ScanRecord = {
      ...current,
      revision: current.revision + 1,
      status: 'queued',
      error: undefined,
      structuredQuestions: questionsOf(current).map((q) =>
        q.id === questionId ? { ...q, tutoring: { status: 'queued' } } : q,
      ),
    };
    writeStoredScan(store, owner, next, 'enqueue-question-explanation');
    store.db
      .prepare(
        'INSERT INTO scan_jobs (id,account_id,owner,student_id,scan_id,revision,status,available_at,created_at,question_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        randomUUID(),
        account,
        owner,
        current.studentId || current.child || 'dabao',
        scanId,
        next.revision,
        'queued',
        Date.now(),
        Date.now(),
        questionId,
      );
    return next;
  });
}

function withTutoring(
  record: ScanRecord,
  questionId: string | undefined,
  tutoring: NonNullable<Question['tutoring']>,
) {
  return questionId
    ? questionsOf(record).map((q) =>
        q.id === questionId ? { ...q, tutoring } : q,
      )
    : record.structuredQuestions;
}
export function claimJob(
  store: FamilyStore,
  now = Date.now(),
): ClaimedJob | null {
  return store.transaction(() => {
    const row = store.db
      .prepare(
        "SELECT * FROM scan_jobs WHERE (status='queued' AND available_at<=?) OR (status='processing' AND lease_until<=?) ORDER BY created_at,id LIMIT 1",
      )
      .get(now, now);
    if (!row) return null;
    const owner = String(row.owner),
      scanId = String(row.scan_id),
      account = String(row.account_id);
    const questionId =
      typeof row.question_id === 'string' ? row.question_id : undefined;
    const record = readStoredScan(store, owner, scanId);
    const student = store.db
      .prepare('SELECT id FROM students WHERE account_id=? AND id=?')
      .get(account, row.student_id);
    if (
      !record ||
      record.deletedAt ||
      record.revision !== row.revision ||
      !student ||
      store.scanOwner(account) !== owner ||
      (record.studentId || record.child || 'dabao') !== row.student_id ||
      (questionId && !questionsOf(record).some((q) => q.id === questionId))
    ) {
      store.db
        .prepare(
          "UPDATE scan_jobs SET status='cancelled',lease_token=NULL,lease_until=0 WHERE id=?",
        )
        .run(row.id);
      return null;
    }
    if (Number(row.attempts) >= 3) {
      const error = '识别多次中断，原件已保存，请手动整理或重试';
      store.db
        .prepare(
          "UPDATE scan_jobs SET status='failed',lease_token=NULL,lease_until=0,error=? WHERE id=?",
        )
        .run(error, row.id);
      writeStoredScan(
        store,
        owner,
        {
          ...record,
          revision: record.revision + 1,
          status: 'failed',
          error,
          structuredQuestions: withTutoring(record, questionId, {
            status: 'failed',
            error,
          }),
        },
        'job-exhausted',
      );
      return null;
    }
    const token = randomUUID(),
      attempts = Number(row.attempts) + 1;
    const next = {
      ...record,
      revision: record.revision + 1,
      status: 'processing',
      error: undefined,
      structuredQuestions: withTutoring(record, questionId, {
        status: 'processing',
      }),
    };
    writeStoredScan(store, owner, next, 'job-start');
    store.db
      .prepare(
        "UPDATE scan_jobs SET status='processing',attempts=?,lease_until=?,lease_token=?,revision=? WHERE id=?",
      )
      .run(attempts, now + 180000, token, next.revision, row.id);
    return {
      id: String(row.id),
      token,
      account,
      owner,
      scanId,
      studentId: String(row.student_id),
      revision: next.revision,
      attempts,
      queuedAt: Number(row.created_at),
      readyAt: Number(
        row.status === 'processing' ? row.lease_until : row.available_at,
      ),
      startedAt: now,
      record: next,
      questionId,
    };
  });
}
export function finishJob(
  store: FamilyStore,
  job: ClaimedJob,
  questions?: Question[],
  failure?: { message: string; retry: boolean },
  now = Date.now(),
  tutoring?: TutoringResult,
) {
  return store.transaction(() => {
    const row = store.db
      .prepare('SELECT * FROM scan_jobs WHERE id=?')
      .get(job.id);
    const record = readStoredScan(store, job.owner, job.scanId);
    if (
      !row ||
      row.status !== 'processing' ||
      row.lease_token !== job.token ||
      Number(row.lease_until) <= now ||
      !record ||
      record.deletedAt ||
      record.revision !== job.revision ||
      (record.studentId || record.child || 'dabao') !== job.studentId
    )
      return false;
    const retry = Boolean(failure?.retry && job.attempts < 3);
    const next: ScanRecord = failure
      ? {
          ...record,
          revision: record.revision + 1,
          status: retry ? 'queued' : 'failed',
          error: failure.message,
          structuredQuestions: withTutoring(record, job.questionId, {
            status: retry ? 'queued' : 'failed',
            error: failure.message,
          }),
        }
      : {
          ...record,
          revision: record.revision + 1,
          status: 'needs_review',
          structuredQuestions: job.questionId
            ? withTutoring(record, job.questionId, {
                status: 'needs_review',
                result: tutoring,
              })
            : questions,
          error: undefined,
          confirmedAt: undefined,
        };
    writeStoredScan(
      store,
      job.owner,
      next,
      failure ? 'job-failure' : 'ai-draft',
    );
    store.db
      .prepare(
        'UPDATE scan_jobs SET status=?,revision=?,available_at=?,lease_token=NULL,lease_until=0,error=? WHERE id=?',
      )
      .run(
        failure ? (retry ? 'queued' : 'failed') : 'succeeded',
        next.revision,
        now + 15000 * job.attempts,
        failure?.message || null,
        job.id,
      );
    return true;
  });
}
export async function runNextJob(
  store: FamilyStore,
  recognize = recognizeStructuredQuestions,
  explain = explainQuestion,
) {
  // Pausing recognition must not consume queued jobs, attempts or daily quota.
  if (!recognitionEnabled()) return false;
  const job = claimJob(store);
  if (!job) return false;
  const trace: ModelTrace = {};
  const started = performance.now();
  let outcome: AttemptAudit['outcome'] = 'discarded';
  let failureCode: AttemptAudit['failureCode'];
  try {
    const maximum = Math.max(
      1,
      Math.min(50, Number(process.env.FAMILY_AI_DAILY_LIMIT) || 10),
    );
    if (!store.allow(`recognize:${job.account}`, maximum, 24 * 3600000))
      throw new HttpError(
        429,
        '已达到本家庭 24 小时识题限额，可手动整理或稍后重试',
      );
    if (job.questionId) {
      selectedQuestion(job.record, job.questionId);
      const result = await explain(
        job.record,
        await measurePhase(trace, 'readOriginalMs', () =>
          readScanFile(job.owner, job.scanId),
        ),
        job.questionId,
        trace,
      );
      outcome = finishJob(store, job, undefined, undefined, Date.now(), result)
        ? 'succeeded'
        : 'discarded';
      return true;
    }
    const result = await recognize(
      job.record,
      await measurePhase(trace, 'readOriginalMs', () =>
        readScanFile(job.owner, job.scanId),
      ),
      trace,
    );
    const questions = measureValidation(trace, () =>
      validateQuestions(result.map((q) => ({ ...q, confirmed: false }))),
    );
    if (!questions.length)
      throw new ModelGatewayError(
        '没有提取到题目，请手动整理或重试',
        'MODEL_OUTPUT',
        false,
      );
    outcome = finishJob(store, job, questions) ? 'succeeded' : 'discarded';
  } catch (e) {
    const retry =
      e instanceof ModelGatewayError
        ? e.retry
        : !(e instanceof HttpError) || (e.status >= 500 && e.status !== 503);
    failureCode =
      e instanceof ModelGatewayError
        ? e.code
        : e instanceof HttpError
          ? e.status === 429
            ? 'LOCAL_QUOTA'
            : 'LOCAL_VALIDATION'
          : 'INTERNAL_ERROR';
    const applied = finishJob(store, job, undefined, {
      message: e instanceof HttpError ? e.message : '识别连接中断，原件已保存',
      retry,
    });
    outcome = applied
      ? retry && job.attempts < 3
        ? 'retry_queued'
        : 'failed'
      : 'discarded';
  } finally {
    await writeAttemptAudit({
      ...trace,
      jobId: job.id,
      attempt: job.attempts,
      kind: job.questionId ? 'question' : 'page',
      queuedAt: job.queuedAt,
      readyAt: job.readyAt,
      startedAt: job.startedAt,
      endedAt: Date.now(),
      attemptMs: performance.now() - started,
      outcome,
      failureCode,
    });
  }
  return true;
}
