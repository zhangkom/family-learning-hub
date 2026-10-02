import { createHash, randomUUID } from 'node:crypto';
import type { FamilyStore } from './family-store';
import { HttpError, json, readJson } from './family-backend';
import { requireStudent } from './mobile-service';
import { listScans } from './scan-files';
import { scanSubjects } from '../lib/scans';
import type { WeaknessCoverage, WeaknessReport } from '../lib/weakness';
import { recognitionEnabled } from './model-gateway';
import { weaknessMaterials, type WeaknessMaterial } from './weakness-materials';
import { emptyAbilityAxes } from './ability-evidence';

export type StoredWeakness = Omit<WeaknessReport, 'stale'> & { input: WeaknessMaterial[]; jobId: string; grade?: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function scope(value: unknown) {
  if (value === undefined || value === null || value === '' || value === '全部') return '';
  if (typeof value !== 'string' || !scanSubjects.includes(value as typeof scanSubjects[number])) throw new HttpError(400, '科目无效');
  return value;
}
export function weaknessById(store: FamilyStore, account: string, id: string): StoredWeakness {
  const row = store.db.prepare('SELECT body FROM weakness_reports WHERE account_id=? AND id=?').get(account, id);
  if (!row) throw new HttpError(404, '薄弱点分析不存在');
  return JSON.parse(String(row.body));
}
export function publicWeakness(store: FamilyStore, account: string, report: StoredWeakness, version?: string): WeaknessReport {
  const { input: _input, jobId: _job, ...rest } = report;
  return { ...rest, stale: report.sourceVersion !== (version || weaknessMaterials(store, account, report.studentId, report.subject).materials.version) };
}
export function saveWeakness(store: FamilyStore, report: StoredWeakness) {
  report.revision++; report.updatedAt = new Date().toISOString();
  store.db.prepare('UPDATE weakness_reports SET updated_at=?,body=? WHERE id=?').run(report.updatedAt, JSON.stringify(report), report.id);
}
function enqueue(store: FamilyStore, report: StoredWeakness) {
  if (!recognitionEnabled()) throw new HttpError(503, 'AI 分析服务暂不可用，已有分析仍保留');
  report.jobId = randomUUID(); report.status = 'queued'; delete report.error;
  const now = Date.now();
  store.db.prepare('INSERT INTO weakness_jobs(id,report_id,status,available_at,created_at) VALUES (?,?,?,?,?)').run(report.jobId, report.id, 'queued', now, now);
}
function coverage(m: WeaknessCoverage): WeaknessCoverage {
  return { total: m.total, eligible: m.eligible, selected: m.selected, omitted: m.omitted, needsReview: m.needsReview, limit: m.limit };
}
export async function createWeakness(store: FamilyStore, account: string, body: Record<string, unknown>) {
  if (typeof body.requestId !== 'string' || !uuid.test(body.requestId)) throw new HttpError(400, '请求标识无效，请重新打开');
  requireStudent(store, account, body.studentId);
  if (typeof body.materialVersion !== 'string' || !/^[a-f0-9]{64}$/.test(body.materialVersion)) throw new HttpError(400, '请先刷新错题材料');
  const requestId = body.requestId, student = String(body.studentId), subject = scope(body.subject), version = body.materialVersion;
  const fingerprint = createHash('sha256').update(JSON.stringify([student, subject, version])).digest('hex');
  const existing = () => {
    const row = store.db.prepare('SELECT fingerprint,body FROM weakness_reports WHERE account_id=? AND request_id=?').get(account, requestId);
    if (row && row.fingerprint !== fingerprint) throw new HttpError(409, '同一次分析请求的材料已改变，请刷新后重试');
    return row ? JSON.parse(String(row.body)) as StoredWeakness : undefined;
  };
  const old = existing(); if (old) return publicWeakness(store, account, old);
  await listScans(store.scanOwner(account), store);
  return store.transaction(() => {
    const duplicate = existing(); if (duplicate) return publicWeakness(store, account, duplicate);
    const bundle = weaknessMaterials(store, account, student, subject);
    if (bundle.materials.version !== version) throw new HttpError(409, '错题或学习记录已变化，请刷新材料后重新分析');
    if (bundle.sources.length < 2) throw new HttpError(400, '至少需要 2 道已收录且校对完整的错题，才能分析共同补强方向');
    const subjectCounts = new Map<string, number>();
    for (const source of bundle.sources) subjectCounts.set(source.subject, (subjectCounts.get(source.subject) || 0) + 1);
    if (![...subjectCounts.values()].some(count => count >= 2)) throw new HttpError(400, '至少需要同一科目的 2 道已校对错题；不同科目不合并判断能力');
    const active = store.db.prepare("SELECT r.student_id,r.body FROM weakness_reports r JOIN weakness_jobs j ON j.report_id=r.id WHERE r.account_id=? AND j.status IN ('queued','processing')").all(account);
    // An unrelated request ID is not an idempotent replay. Reject it while this
    // scope is active; returning another receipt would not survive a later retry.
    if (active.some(row => row.student_id === student && (JSON.parse(String(row.body)) as StoredWeakness).subject === subject)) throw new HttpError(409, '当前范围已有分析在处理，请刷新查看进度');
    if (active.length >= 2) throw new HttpError(429, '已有薄弱点分析在处理，请等待完成');
    const now = new Date().toISOString();
    const report: StoredWeakness = { id: randomUUID(), studentId: student, subject, revision: 1, status: 'queued', createdAt: now, updatedAt: now,
      sourceVersion: version, coverage: coverage(bundle.materials), input: bundle.sources, grade: requireStudent(store, account, student).grade,
      sources: bundle.sources.map(({ id, scanId, questionId, revision, number, subject, prompt }) => ({ id, scanId, questionId, revision, number, subject, prompt })), jobId: '' };
    store.db.prepare('INSERT INTO weakness_reports VALUES (?,?,?,?,?,?,?)').run(report.id, account, student, requestId, fingerprint, now, JSON.stringify(report));
    enqueue(store, report); saveWeakness(store, report); return publicWeakness(store, account, report, version);
  });
}
export async function weaknessResponse(request: Request, parts: string[], store: FamilyStore, account: string) {
  if (parts.length === 1) {
    if (request.method === 'POST') {
      if (!store.allow(`weakness-create:${account}`, 30, 60000)) throw new HttpError(429, '操作过于频繁，请稍后重试');
      return json({ report: await createWeakness(store, account, await readJson(request, 5000)) }, 202);
    }
    if (request.method !== 'GET') throw new HttpError(405, '请求方式不支持');
    const params = new URL(request.url).searchParams, profile = requireStudent(store, account, params.get('studentId')), student = profile.id, subject = scope(params.get('subject'));
    await listScans(store.scanOwner(account), store);
    const { materials } = weaknessMaterials(store, account, student, subject);
    const row = store.db.prepare("SELECT body FROM weakness_reports WHERE account_id=? AND student_id=? AND json_extract(body,'$.subject')=? ORDER BY rowid DESC LIMIT 1").get(account, student, subject);
    return json({ enabled: recognitionEnabled(), materials, axes: emptyAbilityAxes(subject, profile.grade), ...(row ? { report: publicWeakness(store, account, JSON.parse(String(row.body)), materials.version) } : {}) });
  }
  if (parts.length === 2 && request.method === 'GET') {
    const report = weaknessById(store, account, parts[1]);
    await listScans(store.scanOwner(account), store);
    return json({ report: publicWeakness(store, account, report) });
  }
  if (parts.length === 3 && parts[2] === 'retry' && request.method === 'POST') {
    if (!store.allow(`weakness-retry:${account}`, 20, 60000)) throw new HttpError(429, '操作过于频繁，请稍后重试');
    const body = await readJson(request, 1000);
    return json({ report: store.transaction(() => {
      const report = weaknessById(store, account, parts[1]);
      // A lost retry receipt does not queue a second job.
      if (['queued', 'processing'].includes(report.status)) return publicWeakness(store, account, report);
      if (report.revision !== body.revision) throw new HttpError(409, '分析进度已变化，请刷新');
      if (report.status !== 'failed') throw new HttpError(400, '没有需要重试的分析');
      if (publicWeakness(store, account, report).stale) throw new HttpError(409, '错题材料已变化，请重新分析最新材料');
      enqueue(store, report); saveWeakness(store, report); return publicWeakness(store, account, report);
    }) }, 202);
  }
  throw new HttpError(405, '请求方式不支持');
}
