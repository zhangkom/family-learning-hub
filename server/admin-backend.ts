import { getFamilyStore, type FamilyStore } from './family-store';
import {
  currentUser,
  HttpError,
  json,
  readJson,
  sameOrigin,
  updateAccountCredentials,
} from './family-backend';
import {
  accountInfo,
  accountStudents,
  accounts,
  allQuestions,
  applyProposal,
  audit,
  createBatch,
  createReviewToken,
  externalItem,
  getQuestion,
  isAdmin,
  pageParams,
  proposal,
  readBatch,
  reviewToken,
  rollbackProposal,
} from './admin-service';
import { readScanFile } from './scan-files';
import { cropQuestionImage, cropQuestionImages } from './question-crop';
import { questionsOf } from './mobile-service';
import { REVIEW_GUIDE } from '../lib/admin';
import { cloudPhotoResponse } from './cloud-photos';

function administrator(
  request: Request,
  store: FamilyStore,
  allowPassword = false,
) {
  const user = currentUser(request, store);
  if (!user) throw new HttpError(401, '请登录管理员账号');
  if (!isAdmin(store, user.id))
    throw new HttpError(403, '当前账号没有平台管理权限');
  const mustChangePassword = Boolean(
    store.db
      .prepare(
        'SELECT must_change_password FROM platform_admins WHERE account_id=?',
      )
      .get(user.id)?.must_change_password,
  );
  if (mustChangePassword && !allowPassword)
    throw new HttpError(428, '请先更换管理员初始密码');
  return { ...user, mustChangePassword };
}
const imageResponse = (bytes: Uint8Array, type = 'image/jpeg') =>
  new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
async function dispatchAdmin(
  request: Request,
  parts: string[],
  store: FamilyStore,
) {
  const path = parts.join('/'),
    url = new URL(request.url);
  const user = administrator(
    request,
    store,
    path === 'session' || path === 'password',
  );
  if (request.method !== 'GET') sameOrigin(request);
  if (path === 'session' && request.method === 'GET') return json({ user });
  if (path === 'password' && request.method === 'POST') {
    return updateAccountCredentials(
      request,
      store,
      user,
      'password',
      () => {
        administrator(request, store, true);
      },
      () => {
        store.db
          .prepare(
            'UPDATE platform_admins SET must_change_password=0 WHERE account_id=?',
          )
          .run(user.id);
        // Changing a password revokes desktop grants as well as web/mobile sessions.
        store.db
          .prepare(
            'DELETE FROM review_tokens WHERE batch_id IN (SELECT id FROM review_batches WHERE admin_id=?)',
          )
          .run(user.id);
        audit(store, user.id, 'change-admin-password', user.id);
        return json({ ok: true, loginRequired: true });
      },
    );
  }
  if (request.method === 'GET') {
    if (path === 'overview') {
      const n = (sql: string) => Number(store.db.prepare(sql).get()?.n || 0);
      return json({
        accounts: n('SELECT count(*) n FROM accounts'),
        users: n(
          'SELECT count(*) n FROM accounts WHERE id NOT IN (SELECT account_id FROM platform_admins)',
        ),
        administrators: n('SELECT count(*) n FROM platform_admins'),
        students: n('SELECT count(*) n FROM students'),
        questions: n(
          "SELECT sum(json_array_length(coalesce(json_extract(body,'$.structuredQuestions'),json_extract(body,'$.questions'),'[]'))) n FROM scan_documents WHERE json_extract(body,'$.deletedAt') IS NULL",
        ),
        cloudPhotos: n(
          'SELECT count(*) n FROM cloud_photos WHERE id NOT IN (SELECT old_id FROM cloud_photo_replacements)',
        ),
      });
    }
    if (path === 'accounts') {
      audit(store, user.id, 'list-accounts');
      return json(accounts(store, url));
    }
    if (path === 'questions') {
      audit(
        store,
        user.id,
        'list-questions',
        url.searchParams.get('accountId') || 'all',
      );
      return json(allQuestions(store, url));
    }
    if (parts[0] === 'accounts' && parts.length >= 2) {
      const id = parts[1],
        account = accountInfo(store, id);
      audit(store, user.id, 'read-account', id);
      if (parts.length === 2)
        return json({
          account,
          students: accountStudents(store, id),
          learning: store.read(id),
        });
      if (
        parts[2] === 'photos' &&
        parts.length === 5 &&
        ['file', 'thumbnail'].includes(parts[4])
      ) {
        const response = await cloudPhotoResponse(
          request,
          ['cloud-photos', parts[3], parts[4]],
          store,
          id,
        );
        administrator(request, store);
        audit(store, user.id, 'read-cloud-photo', `${id}/${parts[3]}`);
        return response;
      }
      const { page, limit, offset } = pageParams(url),
        collection = parts[2];
      const tables: Record<string, string> = {
        photos: 'cloud_photos',
        learning: 'learning_sessions',
        weakness: 'weakness_reports',
        scans: 'scan_documents',
      };
      const table = tables[collection];
      if (!table || parts.length !== 3) throw new HttpError(404, '内容不存在');
      const column = collection === 'scans' ? 'owner' : 'account_id',
        key = collection === 'scans' ? store.scanOwner(id) : id;
      const total = Number(
        store.db
          .prepare(`SELECT count(*) n FROM ${table} WHERE ${column}=?`)
          .get(key)?.n,
      );
      const items = store.db
        .prepare(
          `SELECT body FROM ${table} WHERE ${column}=? ORDER BY rowid DESC LIMIT ? OFFSET ?`,
        )
        .all(key, limit, offset)
        .map((row) => JSON.parse(String(row.body)));
      return json({ page, total, limit, items });
    }
    if (path === 'question-image') {
      const accountId = url.searchParams.get('accountId') || '',
        scanId = url.searchParams.get('scanId') || '',
        questionId = url.searchParams.get('questionId') || '';
      const { owner, scan, question, all } = getQuestion(
        store,
        accountId,
        scanId,
        questionId,
      );
      const bytes = await readScanFile(owner, scan.id, scan);
      const image = await cropQuestionImage(bytes, question, all);
      administrator(request, store);
      audit(
        store,
        user.id,
        'read-question-image',
        `${accountId}/${scan.id}/${questionId}`,
      );
      return imageResponse(image);
    }
    if (path === 'batches') {
      const { page, limit, offset } = pageParams(url);
      return json({
        page,
        limit,
        total: Number(
          store.db.prepare('SELECT count(*) n FROM review_batches').get()?.n,
        ),
        items: store.db
          .prepare(
            'SELECT id,title,created_at createdAt,expires_at expiresAt,revoked FROM review_batches ORDER BY created_at DESC,id LIMIT ? OFFSET ?',
          )
          .all(limit, offset),
      });
    }
    if (parts[0] === 'batches' && parts.length === 2) {
      audit(store, user.id, 'read-review-batch', parts[1]);
      return json(readBatch(store, parts[1]));
    }
    if (
      parts[0] === 'batches' &&
      parts[2] === 'items' &&
      parts[4] === 'image' &&
      parts.length === 5
    ) {
      const item = readBatch(store, parts[1]).items.find(
        (i) => i.id === parts[3],
      );
      if (!item) throw new HttpError(404, '题目不属于该批次');
      const bytes = await readScanFile(
        store.scanOwner(item.accountId),
        item.scanId,
        item.snapshot.scan,
      );
      const image = await cropQuestionImage(
        bytes,
        item.snapshot.question,
        questionsOf(item.snapshot.scan),
      );
      administrator(request, store);
      return imageResponse(image);
    }
    if (path === 'audit') {
      const { page, limit, offset } = pageParams(url);
      return json({
        page,
        limit,
        total: Number(
          store.db.prepare('SELECT count(*) n FROM admin_audit').get()?.n,
        ),
        items: store.db
          .prepare(
            'SELECT a.id,a.action,a.target,a.created_at createdAt,u.username actor FROM admin_audit a LEFT JOIN accounts u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT ? OFFSET ?',
          )
          .all(limit, offset),
      });
    }
  }
  if (request.method === 'POST') {
    if (!store.allow(`admin-write:${user.id}`, 100, 60000))
      throw new HttpError(429, '操作较频繁，请稍后再试');
    const body = await readJson(request, 512 * 1024);
    administrator(request, store);
    if (path === 'batches') return json(createBatch(store, user.id, body), 201);
    if (parts[0] === 'batches' && parts.length === 3) {
      if (parts[2] === 'token')
        return json(createReviewToken(store, user.id, parts[1]));
      if (parts[2] === 'revoke') {
        readBatch(store, parts[1]);
        store.transaction(() => {
          store.db
            .prepare('UPDATE review_batches SET revoked=1 WHERE id=?')
            .run(parts[1]);
          store.db
            .prepare('DELETE FROM review_tokens WHERE batch_id=?')
            .run(parts[1]);
          audit(store, user.id, 'close-review-batch', parts[1]);
        });
        return json({ ok: true });
      }
    }
    if (parts[0] === 'batches' && parts[2] === 'items' && parts.length === 5) {
      if (parts[4] === 'proposal')
        return json(proposal(store, user.id, parts[1], parts[3], body));
      if (parts[4] === 'apply')
        return json(applyProposal(store, user.id, parts[1], parts[3], body));
      if (parts[4] === 'rollback')
        return json(rollbackProposal(store, user.id, parts[1], parts[3]));
    }
  }
  throw new HttpError(404, '管理功能不存在');
}
async function dispatchReview(
  request: Request,
  parts: string[],
  store: FamilyStore,
) {
  // A batch grant is intentionally separate from account sessions and cannot
  // list users, choose extra questions, publish answers, or grant itself access.
  const token =
    request.headers
      .get('authorization')
      ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] || '';
  const access = reviewToken(store, token);
  if (!store.allow(`external-review:${access.batchId}`, 120, 60000))
    throw new HttpError(429, '请求过于频繁，请稍后重试');
  if (parts.join('/') === 'batch' && request.method === 'GET') {
    const batch = readBatch(store, access.batchId);
    return json({
      id: batch.id,
      title: batch.title,
      expiresAt: batch.expiresAt,
      instructions: REVIEW_GUIDE,
      imagePartsVersion: 1,
      items: batch.items.map((item) => ({
        id: item.id,
        number: item.snapshot.question.number,
        subject: item.snapshot.question.subject,
        status: item.status,
      })),
    });
  }
  if (parts[0] === 'items' && parts.length === 2 && request.method === 'GET')
    return json(externalItem(store, access.batchId, parts[1]));
  if (
    parts[0] === 'items' &&
    ['image', 'images'].includes(parts[2]) &&
    parts.length === 3 &&
    request.method === 'GET'
  ) {
    const item = readBatch(store, access.batchId).items.find(
      (i) => i.id === parts[1],
    );
    if (!item) throw new HttpError(404, '该题不属于本批次');
    const bytes = await readScanFile(
      store.scanOwner(item.accountId),
      item.scanId,
      item.snapshot.scan,
    );
    const part = new URL(request.url).searchParams.get('part');
    const images = parts[2] === 'images' || part !== null ? await cropQuestionImages(bytes, item.snapshot.question, questionsOf(item.snapshot.scan)) : undefined;
    if (part !== null && (!/^\d+$/.test(part) || !images?.[Number(part)])) throw new HttpError(404, '题图分片不存在');
    reviewToken(store, token);
    audit(
      store,
      access.actor,
      'external-read-image',
      `${access.batchId}/${item.id}`,
    );
    if (parts[2] === 'images') return json({ parts: images!.map((image, index) => ({ index, size: image.byteLength })) });
    return imageResponse(images ? images[Number(part)] : await cropQuestionImage(bytes, item.snapshot.question, questionsOf(item.snapshot.scan)));
  }
  if (
    parts[0] === 'items' &&
    parts[2] === 'proposal' &&
    parts.length === 3 &&
    request.method === 'POST'
  ) {
    const body = await readJson(request, 256 * 1024);
    reviewToken(store, token);
    const saved = proposal(store, access.actor, access.batchId, parts[1], body);
    return json({
      id: saved.id,
      status: saved.status,
      proposalHash: saved.proposalHash,
    });
  }
  throw new HttpError(404, '此复核授权不支持该操作');
}
async function handle(
  request: Request,
  parts: string[],
  external: boolean,
  supplied?: FamilyStore,
) {
  try {
    const store = supplied || getFamilyStore();
    return await (external
      ? dispatchReview(request, parts, store)
      : dispatchAdmin(request, parts, store));
  } catch (error) {
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    // No provider responses, private filenames or credentials in public errors.
    return json({ error: '处理暂时失败，已保存数据仍保留，请稍后重试' }, 500);
  }
}
export const handleAdmin = (
  request: Request,
  parts: string[],
  store?: FamilyStore,
) => handle(request, parts, false, store);
export const handleExternalReview = (
  request: Request,
  parts: string[],
  store?: FamilyStore,
) => handle(request, parts, true, store);
