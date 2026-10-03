import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpError, hashPassword } from './family-backend';
import type { FamilyStore } from './family-store';
import { readStoredScan, writeStoredScan } from './scan-files';
import { questionsOf } from './mobile-service';
import { questionContext } from '../lib/question-context';
import { validateTutoringResult } from './model-gateway';
import type { ScanRecord } from '../lib/scans';
import type { Question } from '../lib/mobile';
import type {
  AdminAccount,
  AdminQuestion,
  ReviewBatch,
  ReviewItem,
  ReviewProposal,
} from '../lib/admin';

export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const encoded = (value: unknown) => digest(JSON.stringify(value));
export const isAdmin = (store: FamilyStore, id: string) =>
  !!store.db
    .prepare('SELECT 1 FROM platform_admins WHERE account_id=?')
    .get(id);
export function audit(
  store: FamilyStore,
  actor: string,
  action: string,
  target = '',
) {
  store.db
    .prepare(
      'INSERT INTO admin_audit(actor_id,action,target,created_at) VALUES (?,?,?,?)',
    )
    .run(actor, action, target, Date.now());
}

// Provisioning is a host-only operation. Neither registration nor a username
// grants this role. Refuse to elevate/reset an existing account implicitly.
export async function provisionAdmin(store: FamilyStore, password: string) {
  if (password.length < 16 || password.length > 128)
    throw new Error('管理员初始密码需要16至128个字符');
  const hash = await hashPassword(password);
  return store.transaction(() => {
    if (store.db.prepare("SELECT 1 FROM accounts WHERE username='admin'").get())
      throw new Error('admin账号已存在，未修改其密码或权限');
    const id = randomUUID();
    store.db
      .prepare('INSERT INTO accounts VALUES (?,?,?,?)')
      .run(id, 'admin', hash, Date.now());
    store.db
      .prepare('INSERT INTO platform_admins VALUES (?,?,1)')
      .run(id, Date.now());
    audit(store, id, 'provision-admin', id);
    return { id, username: 'admin', mustChangePassword: true };
  });
}

export function pageParams(url: URL) {
  const page = Number(url.searchParams.get('page') || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000)
    throw new HttpError(400, '页码无效');
  return { page, limit: 30, offset: (page - 1) * 30 };
}
export function accountStudents(store: FamilyStore, id: string) {
  return store.db
    .prepare(
      'SELECT id,name,grade,created_at,legacy_child FROM students WHERE account_id=? ORDER BY created_at,id',
    )
    .all(id)
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      createdAt: String(row.created_at),
      ...(row.grade ? { grade: String(row.grade) } : {}),
      ...(row.legacy_child ? { legacyChildId: String(row.legacy_child) } : {}),
    }));
}
export function accountInfo(store: FamilyStore, id: string): AdminAccount {
  const row = store.db
    .prepare('SELECT id,username,created_at FROM accounts WHERE id=?')
    .get(id);
  if (!row) throw new HttpError(404, '账号不存在');
  const count = (sql: string, key: string) =>
    Number(store.db.prepare(sql).get(key)?.n || 0);
  const owner = store.scanOwner(id);
  return {
    id,
    username: String(row.username),
    createdAt: Number(row.created_at),
    administrator: isAdmin(store, id),
    students: count('SELECT count(*) n FROM students WHERE account_id=?', id),
    scans: count(
      "SELECT count(*) n FROM scan_documents WHERE owner=? AND json_extract(body,'$.deletedAt') IS NULL",
      owner,
    ),
    questions: count(
      "SELECT sum(json_array_length(coalesce(json_extract(body,'$.structuredQuestions'),json_extract(body,'$.questions'),'[]'))) n FROM scan_documents WHERE owner=? AND json_extract(body,'$.deletedAt') IS NULL",
      owner,
    ),
    cloudPhotos: count(
      'SELECT count(*) n FROM cloud_photos WHERE account_id=? AND id NOT IN (SELECT old_id FROM cloud_photo_replacements)',
      id,
    ),
    learningSessions: count(
      'SELECT count(*) n FROM learning_sessions WHERE account_id=?',
      id,
    ),
  };
}
export function accounts(store: FamilyStore, url: URL) {
  const paging = pageParams(url),
    search = (url.searchParams.get('search') || '').slice(0, 100);
  const where = "username LIKE ? ESCAPE '\\'",
    pattern = '%' + search.replace(/[\\%_]/g, '\\$&') + '%';
  return {
    ...paging,
    total: Number(
      store.db
        .prepare(`SELECT count(*) n FROM accounts WHERE ${where}`)
        .get(pattern)?.n,
    ),
    items: store.db
      .prepare(
        `SELECT id FROM accounts WHERE ${where} ORDER BY created_at,id LIMIT ? OFFSET ?`,
      )
      .all(pattern, paging.limit, paging.offset)
      .map((row) => accountInfo(store, String(row.id))),
  };
}
export function allQuestions(store: FamilyStore, url: URL) {
  const paging = pageParams(url);
  const args: string[] = [],
    where = ["json_extract(s.body,'$.deletedAt') IS NULL"];
  for (const [param, column] of [
    ['accountId', 'a.id'],
    [
      'studentId',
      "coalesce(json_extract(s.body,'$.studentId'),json_extract(s.body,'$.child'),'')",
    ],
    [
      'subject',
      "coalesce(json_extract(q.value,'$.subject'),json_extract(s.body,'$.subject'),'')",
    ],
  ]) {
    const value = url.searchParams.get(param);
    if (value) {
      where.push(`${column}=?`);
      args.push(value);
    }
  }
  const search = url.searchParams.get('search');
  if (search) {
    where.push(
      "coalesce(json_extract(q.value,'$.prompt'),'') LIKE ? ESCAPE '\\'",
    );
    args.push('%' + search.slice(0, 200).replace(/[\\%_]/g, '\\$&') + '%');
  }
  const state = url.searchParams.get('state');
  if (state === 'unanswered')
    where.push(
      "coalesce(json_extract(q.value,'$.tutoring.result.referenceAnswer'),json_extract(q.value,'$.referenceAnswer'),json_extract(q.value,'$.answer'),'') IN ('','待确认')",
    );
  else if (state === 'flagged')
    where.push("json_extract(q.value,'$.tutoring.review.status')='flagged'");
  else if (state === 'saved')
    where.push("json_extract(q.value,'$.wrongBook') IS NOT NULL");
  const from = `FROM accounts a LEFT JOIN legacy_owners l ON l.account_id=a.id JOIN scan_documents s ON s.owner=coalesce(l.owner,a.id), json_each(coalesce(json_extract(s.body,'$.structuredQuestions'),json_extract(s.body,'$.questions'),'[]')) q WHERE ${where.join(' AND ')}`;
  const items: AdminQuestion[] = store.db
    .prepare(
      `SELECT a.id account_id,a.username,s.id scan_id,s.body,q.key qi ${from} ORDER BY json_extract(s.body,'$.createdAt') DESC,s.id,q.key LIMIT ? OFFSET ?`,
    )
    .all(...args, paging.limit, paging.offset)
    .map((row) => {
      const scan = JSON.parse(String(row.body)) as ScanRecord;
      const studentId = scan.studentId || scan.child || null;
      return {
        accountId: String(row.account_id),
        username: String(row.username),
        studentId,
        studentName: studentId
          ? String(
              store.db
                .prepare(
                  'SELECT name FROM students WHERE account_id=? AND id=?',
                )
                .get(row.account_id, studentId)?.name || '归属待核对',
            )
          : '归属待核对',
        scanId: scan.id,
        revision: scan.revision,
        originalName: scan.originalName,
        source: scan.source,
        createdAt: scan.createdAt,
        question: questionsOf(scan)[Number(row.qi)],
      };
    });
  return {
    ...paging,
    total: Number(
      store.db.prepare(`SELECT count(*) n ${from}`).get(...args)?.n,
    ),
    items,
  };
}

export function getQuestion(
  store: FamilyStore,
  accountId: string,
  scanId: string,
  questionId: string,
) {
  accountInfo(store, accountId);
  const owner = store.scanOwner(accountId),
    scan = readStoredScan(store, owner, scanId);
  if (!scan || scan.deletedAt) throw new HttpError(404, '原题资料不存在');
  const all = questionsOf(scan),
    question = all.find((q) => q.id === questionId);
  if (!question) throw new HttpError(404, '题目不存在');
  return { owner, scan, all, question };
}
function fingerprint(scan: ScanRecord, q: Question) {
  // Page revision is intentionally excluded: reviewing a sibling question must
  // not invalidate this item. Shared conditions and the complete old answer do.
  return encoded({
    studentId: scan.studentId || scan.child || null,
    processing: scan.processing,
    rotation: scan.rotation,
    size: scan.size,
    mimeType: scan.mimeType,
    imageVersion: scan.sourcePage?.scanSha256,
    question: q,
    context: questionContext(q, questionsOf(scan)),
  });
}
function readItem(store: FamilyStore, batchId: string, id: string): ReviewItem {
  const row = store.db
    .prepare('SELECT body FROM review_items WHERE batch_id=? AND id=?')
    .get(batchId, id);
  if (!row) throw new HttpError(404, '该题不属于本次复核批次');
  return JSON.parse(String(row.body));
}
function saveItem(store: FamilyStore, item: ReviewItem) {
  store.db
    .prepare('UPDATE review_items SET body=? WHERE id=? AND batch_id=?')
    .run(JSON.stringify(item), item.id, item.batchId);
}
export function readBatch(store: FamilyStore, id: string): ReviewBatch {
  const row = store.db
    .prepare('SELECT * FROM review_batches WHERE id=?')
    .get(id);
  if (!row) throw new HttpError(404, '复核批次不存在');
  return {
    id,
    title: String(row.title),
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    revoked: Boolean(row.revoked),
    items: store.db
      .prepare('SELECT body FROM review_items WHERE batch_id=? ORDER BY rowid')
      .all(id)
      .map((row) => JSON.parse(String(row.body))),
  };
}
export function createBatch(
  store: FamilyStore,
  actor: string,
  body: Record<string, unknown>,
) {
  if (
    !Array.isArray(body.items) ||
    !body.items.length ||
    body.items.length > 100
  )
    throw new HttpError(400, '每次复核请选择1至100道题，可分多次创建批次');
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 120)
    throw new HttpError(400, '请输入120字以内的批次名称');
  return store.transaction(() => {
    const id = randomUUID(),
      seen = new Set<string>();
    const items = body.items as Record<string, unknown>[];
    store.db
      .prepare('INSERT INTO review_batches VALUES (?,?,?,?,?,0)')
      .run(id, actor, title, Date.now(), Date.now() + 7 * 86400000);
    for (const selected of items) {
      if (
        !selected ||
        typeof selected !== 'object' ||
        !['accountId', 'scanId', 'questionId'].every(
          (k) => typeof selected[k] === 'string',
        )
      )
        throw new HttpError(400, '选题标识无效');
      const accountId = String(selected.accountId),
        scanId = String(selected.scanId),
        questionId = String(selected.questionId);
      const key = JSON.stringify([accountId, scanId, questionId]);
      if (seen.has(key)) throw new HttpError(400, '同一道题重复选择');
      seen.add(key);
      const { scan, question, all } = getQuestion(
        store,
        accountId,
        scanId,
        questionId,
      );
      if (
        !questionContext(question, all).regions.some((r) => r.kind === 'stem')
      )
        throw new HttpError(400, '所选题目尚未框出题干，请先完成框题');
      const item: ReviewItem = {
        id: randomUUID(),
        batchId: id,
        accountId,
        scanId,
        questionId,
        fingerprint: fingerprint(scan, question),
        snapshot: { scan, question },
        status: 'pending',
      };
      store.db
        .prepare('INSERT INTO review_items VALUES (?,?,?)')
        .run(item.id, id, JSON.stringify(item));
    }
    audit(store, actor, 'create-review-batch', id);
    return readBatch(store, id);
  });
}
export function createReviewToken(
  store: FamilyStore,
  actor: string,
  id: string,
) {
  const batch = readBatch(store, id);
  if (batch.revoked || batch.expiresAt <= Date.now())
    throw new HttpError(409, '批次已关闭或过期，请重新选题');
  const token = Buffer.from(randomBytes(32)).toString('hex'),
    expiresAt = Math.min(batch.expiresAt, Date.now() + 12 * 3600000);
  store.db
    .prepare('INSERT INTO review_tokens VALUES (?,?,?)')
    .run(digest(token), id, expiresAt);
  audit(store, actor, 'issue-review-token', id);
  return { token, batchId: id, expiresAt };
}
export function reviewToken(store: FamilyStore, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new HttpError(401, '复核授权无效或已过期');
  const row = store.db
    .prepare(
      'SELECT b.id,b.admin_id FROM review_tokens t JOIN review_batches b ON b.id=t.batch_id JOIN platform_admins a ON a.account_id=b.admin_id WHERE t.token_hash=? AND t.expires_at>? AND b.expires_at>? AND b.revoked=0 AND a.must_change_password=0',
    )
    .get(digest(token), Date.now(), Date.now());
  if (!row) throw new HttpError(401, '复核授权无效或已过期');
  return { batchId: String(row.id), actor: String(row.admin_id) };
}
export function externalItem(store: FamilyStore, batchId: string, id: string) {
  const item = readItem(store, batchId, id);
  return {
    id: item.id,
    fingerprint: item.fingerprint,
    status: item.status,
    originalName: item.snapshot.scan.originalName,
    source: item.snapshot.scan.source,
    number: item.snapshot.question.number,
    context: questionContext(
      item.snapshot.question,
      questionsOf(item.snapshot.scan),
    ),
    oldAnswer: item.snapshot.question.tutoring?.result || {
      referenceAnswer: item.snapshot.question.referenceAnswer,
      explanation: item.snapshot.question.explanation,
    },
    proposal: item.proposal,
  };
}
export function proposal(
  store: FamilyStore,
  actor: string,
  batchId: string,
  id: string,
  body: Record<string, unknown>,
) {
  const item = readItem(store, batchId, id);
  const batch = readBatch(store, batchId);
  if (batch.revoked || batch.expiresAt <= Date.now())
    throw new HttpError(409, '批次已关闭或过期');
  if (item.status === 'applied' || item.status === 'rolled_back')
    throw new HttpError(409, '本题已处理，请重新创建批次');
  if (body.fingerprint !== item.fingerprint)
    throw new HttpError(409, '复核题目版本不匹配');
  if (
    Object.keys(body).some(
      (k) =>
        ![
          'fingerprint',
          'provider',
          'model',
          'summary',
          'knowledgePoints',
          'result',
        ].includes(k),
    )
  )
    throw new HttpError(400, '复核结果包含不支持的字段');
  if (
    !['codex', 'chatgpt'].includes(String(body.provider)) ||
    typeof body.model !== 'string' ||
    !body.model.trim() ||
    body.model.length > 120 ||
    typeof body.summary !== 'string' ||
    !body.summary.trim() ||
    body.summary.length > 4000 ||
    !Array.isArray(body.knowledgePoints) ||
    body.knowledgePoints.length > 30 ||
    body.knowledgePoints.some(
      (v) => typeof v !== 'string' || !v.trim() || v.length > 200,
    )
  )
    throw new HttpError(400, '请提交模型、修正说明及有效知识点');
  let result;
  try {
    result = validateTutoringResult([body.result]);
  } catch {
    throw new HttpError(400, '复核解答字段不完整或无效');
  }
  if (
    !result.transcribedPrompt ||
    (!result.referenceAnswer &&
      !(body.result as { uncertainties?: unknown[] })?.uncertainties?.length) ||
    !result.explanation
  )
    throw new HttpError(
      400,
      '请提供题干和解答；无法解答时必须明确列出缺失条件',
    );
  const p: ReviewProposal = {
    provider: body.provider as ReviewProposal['provider'],
    model: body.model.trim(),
    summary: body.summary.trim(),
    knowledgePoints: [...new Set(body.knowledgePoints as string[])],
    result,
  };
  // Ignore server-generated timestamps when recognizing a lost-response retry.
  const stable = (p: ReviewProposal) =>
    encoded({ ...p, result: { ...p.result, generatedAt: '' } });
  if (item.proposal && stable(item.proposal) === stable(p)) return item;
  const next: ReviewItem = {
    ...item,
    proposal: p,
    proposalHash: encoded(p),
    status: 'proposed',
  };
  saveItem(store, next);
  audit(store, actor, 'propose-review', `${batchId}/${id}`);
  return next;
}
function ensureIdle(store: FamilyStore, owner: string, scanId: string) {
  if (
    store.db
      .prepare(
        "SELECT 1 FROM scan_jobs WHERE owner=? AND scan_id=? AND status IN ('queued','processing')",
      )
      .get(owner, scanId)
  )
    throw new HttpError(409, '原题正在分析，请等待任务结束再应用或回退');
}
export function applyProposal(
  store: FamilyStore,
  actor: string,
  batchId: string,
  id: string,
  body: Record<string, unknown>,
) {
  return store.transaction(() => {
    if (
      body.updatePrompt !== undefined &&
      typeof body.updatePrompt !== 'boolean'
    )
      throw new HttpError(400, '题干更新选项无效');
    const item = readItem(store, batchId, id);
    if (!item.proposal || body.proposalHash !== item.proposalHash)
      throw new HttpError(409, '复核结果已经变化，请重新查看后应用');
    if (item.status === 'applied') return item;
    if (item.status !== 'proposed')
      throw new HttpError(409, '该复核结果不可应用');
    const { owner, scan, question, all } = getQuestion(
      store,
      item.accountId,
      item.scanId,
      item.questionId,
    );
    if (fingerprint(scan, question) !== item.fingerprint)
      throw new HttpError(409, '原题或原解析已被修改，未覆盖，请重新选题复核');
    ensureIdle(store, owner, scan.id);
    // A corrected transcription requires an explicit checked option; image
    // coordinates and the child's original writing are never replaced by AI.
    const result = item.proposal.result;
    const next: Question = {
      ...question,
      ...(body.updatePrompt ? { prompt: result.transcribedPrompt, promptKind: 'full' as const } : {}),
      referenceAnswer: result.referenceAnswer,
      explanation: result.explanation,
      knowledgePoints: item.proposal.knowledgePoints,
      tutoring: {
        status: 'needs_review',
        result,
        review: {
          status: 'confirmed',
          reviewedAt: new Date().toISOString(),
          resultGeneratedAt: result.generatedAt,
        },
      },
    };
    const proposed = all.map((q) => (q.id === question.id ? next : q));
    const updated = {
      ...scan,
      revision: scan.revision + 1,
      structuredQuestions: proposed.map((q) => {
        if (q.id === question.id) return q;
        const old = all.find((before) => before.id === q.id)!;
        return encoded(questionContext(q, proposed)) ===
          encoded(questionContext(old, all))
          ? q
          : {
              ...q,
              confirmed: false,
              ...(q.tutoring
                ? { tutoring: { ...q.tutoring, status: 'stale' as const } }
                : {}),
            };
      }),
    };
    if (updated.structuredQuestions.some((q) => !q.confirmed))
      updated.confirmedAt = undefined;
    writeStoredScan(store, owner, updated, `admin-review:${actor}:${item.id}`);
    const saved: ReviewItem = {
      ...item,
      status: 'applied',
      appliedFingerprint: fingerprint(updated, next),
      appliedAt: new Date().toISOString(),
    };
    saveItem(store, saved);
    audit(store, actor, 'apply-review', `${batchId}/${id}`);
    return saved;
  });
}
export function rollbackProposal(
  store: FamilyStore,
  actor: string,
  batchId: string,
  id: string,
) {
  return store.transaction(() => {
    const item = readItem(store, batchId, id);
    if (item.status === 'rolled_back') return item;
    if (item.status !== 'applied')
      throw new HttpError(409, '本题尚未应用，不能回退');
    const { owner, scan, question, all } = getQuestion(
      store,
      item.accountId,
      item.scanId,
      item.questionId,
    );
    if (fingerprint(scan, question) !== item.appliedFingerprint)
      throw new HttpError(409, '应用后原题已有新修改，未覆盖，无法直接回退');
    ensureIdle(store, owner, scan.id);
    writeStoredScan(
      store,
      owner,
      {
        ...scan,
        revision: scan.revision + 1,
        structuredQuestions: all.map((q) =>
          q.id === question.id ? item.snapshot.question : q,
        ),
      },
      `admin-rollback:${actor}:${item.id}`,
    );
    const next: ReviewItem = { ...item, status: 'rolled_back' };
    saveItem(store, next);
    audit(store, actor, 'rollback-review', `${batchId}/${id}`);
    return next;
  });
}
