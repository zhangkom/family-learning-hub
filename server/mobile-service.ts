import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { HttpError, readBody } from './family-backend';
import type { FamilyStore } from './family-store';
import {
  listScans,
  readScan,
  readStoredScan,
  scanDirectory,
  scanWrongRecords,
  writeStoredScan,
} from './scan-files';
import type { ScanRecord } from '../lib/scans';
import { scanSubjects } from '../lib/scans';
import { questionContext } from '../lib/question-context';
import {
  validateQuestions,
  type MobileScan,
  type Question,
} from '../lib/mobile';
import {
  MAX_SCAN_BYTES,
  sanitizeDisplayName,
  validateScanFile,
} from '../lib/upload-security';

export class MobileError extends HttpError {
  constructor(
    status: number,
    message: string,
    public code: string,
  ) {
    super(status, message);
  }
}
export function requireStudent(
  store: FamilyStore,
  account: string,
  id: unknown,
) {
  const student = store.students(account).find((s) => s.id === id);
  if (!student) throw new HttpError(404, '学生不存在');
  return student;
}
export function questionsOf(record: ScanRecord): Question[] {
  return (
    record.structuredQuestions ??
    (record.questions || []).map((q, i) => ({
      id: `${record.id}-q${i}`,
      number: q.number,
      prompt: q.prompt,
      diagram: q.diagram,
      knowledgePoints: q.knowledgePoint ? [q.knowledgePoint] : [],
      regions: [],
      sharedRegionIds: [],
      answerSteps:
        q.learnerAnswer && q.learnerAnswer !== '待确认'
          ? [
              {
                id: `${record.id}-s${i}`,
                order: 1,
                text: q.learnerAnswer,
                regionIds: [],
                author: 'unknown',
                crossedOut: false,
                uncertain: true,
              },
            ]
          : [],
      uncertainties: [
        q.uncertainties,
        '旧记录尚未关联原图区域，请核对笔迹作者与步骤',
      ].filter(Boolean),
      confirmed: Boolean(record.confirmedAt),
      referenceAnswer: q.answer,
      explanation: q.analysis,
    }))
  );
}
export function mobileScan(record: ScanRecord): MobileScan {
  const questions = questionsOf(record);
  const status: MobileScan['status'] = [
    'queued',
    'processing',
    'failed',
  ].includes(record.status)
    ? (record.status as MobileScan['status'])
    : record.status === '识别中'
      ? 'processing'
      : record.status === '识别失败'
        ? 'failed'
        : questions.length && questions.every((q) => q.confirmed)
          ? 'ready'
          : 'needs_review';
  return {
    id: record.id,
    studentId: record.studentId || record.child || 'dabao',
    subject: record.subject,
    source: record.source,
    originalName: record.originalName,
    mimeType: record.mimeType,
    size: record.size,
    createdAt: record.createdAt,
    revision: record.revision || 0,
    status,
    questions,
    ...(record.confirmedAt ? { confirmedAt: record.confirmedAt } : {}),
    ...(record.error ? { error: record.error } : {}),
  };
}
export async function ownedScan(
  store: FamilyStore,
  account: string,
  id: string,
) {
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))
    throw new HttpError(404, '资料不存在');
  const record = await readScan(store.scanOwner(account), id, store);
  if (!record || record.deletedAt) throw new HttpError(404, '资料不存在');
  requireStudent(store, account, record.studentId || record.child || 'dabao');
  return record;
}
function deterministicId(account: string, request: string) {
  const bytes = createHash('sha256')
    .update(`family-upload-v1:${account}:${request}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = Buffer.from(bytes).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export async function uploadMobileScan(
  request: Request,
  store: FamilyStore,
  account: string,
) {
  const bytes = await readBody(request, MAX_SCAN_BYTES + 65536);
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(bytes), {
      headers: { 'Content-Type': request.headers.get('content-type') || '' },
    }).formData();
  } catch {
    throw new HttpError(400, '上传表单格式不正确');
  }
  const student = requireStudent(store, account, form.get('studentId'));
  const source = form.get('source'),
    subject = form.get('subject') || '待选择',
    clientId = form.get('clientRequestId'),
    file = form.get('file');
  if (
    typeof source !== 'string' ||
    !source.trim() ||
    source.length > 200 ||
    typeof subject !== 'string' ||
    (subject !== '待选择' && !scanSubjects.includes(subject as never)) ||
    typeof clientId !== 'string' ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(clientId) ||
    !(file instanceof File)
  )
    throw new HttpError(400, '请填写学生、学科、出处、上传标识并选择原件');
  const valid = await validateScanFile(file);
  if (!valid.ok)
    throw new HttpError(file.size > MAX_SCAN_BYTES ? 413 : 400, valid.reason);
  const content = new Uint8Array(await file.arrayBuffer());
  const contentHash = createHash('sha256').update(content).digest('hex');
  const originalName = sanitizeDisplayName(file.name);
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        student.id,
        source.trim(),
        subject,
        originalName,
        valid.mime,
        contentHash,
      ]),
    )
    .digest('hex');
  const owner = store.scanOwner(account),
    requestId = clientId.toLowerCase(),
    id = deterministicId(account, requestId);
  await listScans(owner, store); // Import historical files before checking the quota.
  const previous = store.db
    .prepare('SELECT * FROM scan_uploads WHERE account_id=? AND request_id=?')
    .get(account, requestId);
  if (!previous && !store.allow(`upload:${account}`, 30, 3600000))
    throw new HttpError(429, '上传过于频繁，请稍后再试');
  return store.transaction(() => {
    const prior = store.db
      .prepare('SELECT * FROM scan_uploads WHERE account_id=? AND request_id=?')
      .get(account, requestId);
    const recovered = readStoredScan(store, owner, id);
    if (
      (prior && prior.fingerprint !== fingerprint) ||
      (recovered && recovered.uploadFingerprint !== fingerprint)
    )
      throw new MobileError(
        409,
        '这个上传标识已用于另一份内容，请恢复原草稿或创建新上传',
        'IDEMPOTENCY_CONFLICT',
      );
    if (prior) {
      if (!recovered || recovered.deletedAt)
        throw new HttpError(409, '这份上传已归档或移入回收站');
      return { record: recovered, created: false };
    }
    const total = store.db
      .prepare('SELECT body FROM scan_documents WHERE owner=?')
      .all(owner)
      .reduce(
        (n, row) => n + Number(JSON.parse(String(row.body)).size || 0),
        0,
      );
    if (!recovered && total + content.length > 500 * 1024 * 1024)
      throw new HttpError(413, '扫描空间已达 500 MB');
    const record: ScanRecord = recovered || {
      id,
      studentId: student.id,
      ...(student.legacyChildId ? { child: student.legacyChildId } : {}),
      subject,
      source: source.trim(),
      originalName,
      mimeType: valid.mime,
      size: content.length,
      createdAt: new Date().toISOString(),
      revision: 0,
      status: 'needs_review',
      structuredQuestions: [],
      questions: [],
      uploadFingerprint: fingerprint,
      fileUrl: `/family-learning/api/mobile/v1/scans/${id}/file`,
    };
    const directory = scanDirectory(owner, id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const original = join(directory, 'original');
    if (existsSync(original)) {
      if (
        createHash('sha256').update(readFileSync(original)).digest('hex') !==
        contentHash
      )
        throw new MobileError(
          409,
          '上传原件校验不一致',
          'IDEMPOTENCY_CONFLICT',
        );
      const metadata = join(directory, 'record.json');
      if (
        existsSync(metadata) &&
        JSON.parse(readFileSync(metadata, 'utf8')).uploadFingerprint !==
          fingerprint
      )
        throw new MobileError(
          409,
          '上传元数据校验不一致',
          'IDEMPOTENCY_CONFLICT',
        );
    } else writeFileSync(original, content, { flag: 'wx', mode: 0o600 });
    const temp = join(directory, 'record.json.pending');
    writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
    renameSync(temp, join(directory, 'record.json'));
    writeStoredScan(store, owner, record, 'upload');
    store.db
      .prepare('INSERT INTO scan_uploads VALUES (?,?,?,?)')
      .run(account, requestId, fingerprint, id);
    return { record, created: !recovered };
  });
}
export async function reviewMobileScan(
  store: FamilyStore,
  account: string,
  id: string,
  body: Record<string, unknown>,
) {
  await ownedScan(store, account, id);
  let questions: Question[];
  try {
    questions = validateQuestions(body.questions);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const owner = store.scanOwner(account);
  // Preserve earlier, explicitly marked wrong answers when adopting a legacy scan.
  store.merge(account, await scanWrongRecords(owner, store));
  return store.transaction(() => {
    const current = readStoredScan(store, owner, id)!;
    if (current.deletedAt) throw new HttpError(404, '资料不存在');
    if (body.revision !== current.revision)
      throw new HttpError(409, '其他设备或后台已更新，请重新打开并比较草稿');
    const previous = questionsOf(current);
    // These fields are server-owned. Old clients may omit them; never trust
    // fabricated AI output or a forged wrong-book mark in a review request.
    questions = questions.map((q) => {
      const before = previous.find((old) => old.id === q.id);
      if (!before) return q;
      let tutoring = before.tutoring;
      if (
        tutoring &&
        (['queued', 'processing'].includes(tutoring.status) ||
          JSON.stringify(questionContext(q, questions)) !==
            JSON.stringify(questionContext(before, previous)))
      )
        tutoring = {
          ...tutoring,
          status: 'stale',
          error: '题目内容或选框已修改，请重新讲解并核对',
        };
      return {
        ...q,
        ...(before.wrongBook ? { wrongBook: before.wrongBook } : {}),
        ...(tutoring ? { tutoring } : {}),
      };
    });
    const ready = questions.length > 0 && questions.every((q) => q.confirmed);
    store.db
      .prepare(
        "UPDATE scan_jobs SET status='cancelled',lease_token=NULL,lease_until=0 WHERE owner=? AND scan_id=? AND status IN ('queued','processing')",
      )
      .run(owner, id);
    return writeStoredScan(
      store,
      owner,
      {
        ...current,
        structuredQuestions: questions,
        revision: current.revision + 1,
        status: ready ? 'ready' : 'needs_review',
        confirmedAt: ready ? new Date().toISOString() : undefined,
        error: undefined,
      },
      'human-review',
    );
  });
}
