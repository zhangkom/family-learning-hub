import { randomUUID } from 'node:crypto';
import { HttpError } from './family-backend';
import type { FamilyStore } from './family-store';
import { readScanFile, readStoredScan, writeStoredScan } from './scan-files';
import {
  recognitionEnabled,
  recognizeStructuredQuestions,
} from './model-gateway';
import { questionsOf, requireStudent } from './mobile-service';
import { validateQuestions, type Question } from '../lib/mobile';
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
    throw new HttpError(503, 'AI 识题尚未配置，可以先手动整理');
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
  record: ScanRecord;
};
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
      (record.studentId || record.child || 'dabao') !== row.student_id
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
        { ...record, revision: record.revision + 1, status: 'failed', error },
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
      record: next,
    };
  });
}
export function finishJob(
  store: FamilyStore,
  job: ClaimedJob,
  questions?: Question[],
  failure?: { message: string; retry: boolean },
  now = Date.now(),
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
        }
      : {
          ...record,
          revision: record.revision + 1,
          status: 'needs_review',
          structuredQuestions: questions,
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
) {
  const job = claimJob(store);
  if (!job) return false;
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
    const result = await recognize(
      job.record,
      await readScanFile(job.owner, job.scanId),
    );
    const questions = validateQuestions(
      result.map((q) => ({ ...q, confirmed: false })),
    );
    if (!questions.length)
      throw new HttpError(502, '没有提取到题目，请手动整理或重试');
    finishJob(store, job, questions);
  } catch (e) {
    const retry =
      !(e instanceof HttpError) || (e.status >= 500 && e.status !== 503);
    finishJob(store, job, undefined, {
      message: e instanceof HttpError ? e.message : '识别连接中断，原件已保存',
      retry,
    });
  }
  return true;
}
