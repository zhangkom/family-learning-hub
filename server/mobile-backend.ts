import { createHash, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  currentUser,
  familyNeedsSetup,
  setupFirstFamily,
  registerFamily,
  registrationEnabled,
  RegistrationError,
  AccountError,
  updateAccountCredentials,
  passwordField,
  HttpError,
  json,
  readJson,
  sameOrigin,
  verifyPassword,
  type FamilyUser,
} from './family-backend';
import { getFamilyStore, type FamilyStore } from './family-store';
import { listScans, readScanFile } from './scan-files';
import {
  MobileError,
  mobileScan,
  ownedScan,
  requireStudent,
  reviewMobileScan,
  uploadMobileScan,
} from './mobile-service';
import { recognitionEnabled } from './model-gateway';
import { enqueueRecognition, enqueueExplanation } from './scan-jobs';
import { setWrongBook, wrongBookItems } from './question-learning';
import { candidateRegions } from './candidate-regions';
import { CLOUD_PHOTO_CAPABILITY } from '../lib/cloud-photos';
import { cloudPhotoResponse } from './cloud-photos';
import { analysisProgress } from './analysis-progress';
import { reviewTutoring } from './tutoring-review';
import type { ScanRecord } from '../lib/scans';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const codes: Record<number, string> = {
  400: 'INVALID_INPUT',
  401: 'UNAUTHENTICATED',
  403: 'ORIGIN_DENIED',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  408: 'REQUEST_TIMEOUT',
  409: 'REVISION_CONFLICT',
  413: 'TOO_LARGE',
  429: 'RATE_LIMITED',
  503: 'UNAVAILABLE',
};
function cors(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  const allowed = [
    process.env.FAMILY_PUBLIC_ORIGIN || '',
    ...(process.env.FAMILY_MOBILE_ORIGINS || '').split(','),
  ]
    .map((s) => s.trim())
    .filter((s) => {
      try {
        const u = new URL(s);
        return (
          u.origin === s &&
          (u.protocol === 'https:' ||
            (u.protocol === 'http:' &&
              ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))
        );
      } catch {
        return false;
      }
    });
  if (!allowed.includes(origin) || origin === 'null' || origin === '*')
    throw new HttpError(403, '此客户端来源未获允许');
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
  };
}
function bearer(request: Request, store: FamilyStore) {
  const match = request.headers
    .get('authorization')
    ?.match(/^Bearer ([a-f0-9]{64})$/);
  if (!match) throw new HttpError(401, '请登录家庭账号');
  const token = hash(match[1]);
  const row = store.db
    .prepare(
      'SELECT a.id,a.username,s.expires FROM mobile_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token=? AND s.expires>?',
    )
    .get(token, Date.now());
  if (!row) throw new HttpError(401, '登录已过期，请重新登录');
  return {
    token,
    user: { id: String(row.id), username: String(row.username) },
    expiresAt: new Date(Number(row.expires)).toISOString(),
  };
}
async function login(request: Request, store: FamilyStore) {
  if (!store.allow('auth:mobile-login', 30, 15 * 60000))
    throw new HttpError(429, '尝试次数过多，请稍后再试');
  const body = await readJson(request, 8192);
  const username =
    typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  if (
    !/^[a-z0-9_-]{3,32}$/.test(username) ||
    (body.deviceName !== undefined &&
      (typeof body.deviceName !== 'string' || body.deviceName.length > 100))
  )
    throw new HttpError(400, '账号或密码格式不正确');
  const password = passwordField(body.password);
  if (!store.allow(`user:${username}`, 8, 15 * 60000))
    throw new HttpError(429, '该账号尝试次数过多，请 15 分钟后再试');
  const row = store.db
    .prepare('SELECT id,username,password FROM accounts WHERE username=?')
    .get(username);
  const valid = await verifyPassword(
    password,
    row ? String(row.password) : `${'0'.repeat(32)}:${'0'.repeat(128)}`,
  );
  if (
    !row ||
    !valid ||
    store.db
      .prepare('SELECT password FROM accounts WHERE id=? AND username=?')
      .get(row.id, username)?.password !== row.password
  )
    throw new HttpError(401, '账号或密码不正确');
  return issueMobileSession(
    { id: String(row.id), username: String(row.username) },
    store,
    String(body.deviceName || '手机或平板'),
  );
}
function issueMobileSession(
  user: FamilyUser,
  store: FamilyStore,
  deviceName = '手机或平板',
) {
  const token = Buffer.from(randomBytes(32)).toString('hex'),
    expires = Date.now() + 7 * 86400000;
  store.db
    .prepare('DELETE FROM mobile_sessions WHERE expires<=?')
    .run(Date.now());
  store.db
    .prepare('DELETE FROM limits WHERE key=?')
    .run(`user:${user.username}`);
  store.db
    .prepare('INSERT INTO mobile_sessions VALUES (?,?,?,?,?)')
    .run(hash(token), user.id, expires, deviceName, Date.now());
  return json({
    token,
    user,
    expiresAt: new Date(expires).toISOString(),
  });
}
async function dispatch(
  request: Request,
  parts: string[],
  store: FamilyStore,
  user: FamilyUser,
) {
  const method = request.method;
  const present = (record: ScanRecord) => ({ ...mobileScan(record),
    analysis: analysisProgress(store, user.id, record.id, recognitionEnabled()) });
  if (['cloud-photos', 'cloud-photo-batches'].includes(parts[0]))
    return cloudPhotoResponse(request, parts, store, user.id);
  if (parts.length === 1 && parts[0] === 'wrong-book') {
    if (method !== 'GET') throw new HttpError(405, '请求方式不支持');
    return json({
      items: await wrongBookItems(
        store,
        user.id,
        new URL(request.url).searchParams.get('studentId'),
      ),
    });
  }
  if (parts.length === 1 && parts[0] === 'students') {
    if (method === 'GET') return json({ students: store.students(user.id) });
    if (method !== 'POST') throw new HttpError(405, '请求方式不支持');
    const body = await readJson(request, 8192);
    if (
      typeof body.name !== 'string' ||
      !body.name.trim() ||
      body.name.length > 60 ||
      (body.grade !== undefined &&
        (typeof body.grade !== 'string' || body.grade.length > 80))
    )
      throw new HttpError(400, '请填写 1 至 60 字姓名及有效年级');
    try {
      return json(
        {
          student: store.addStudent(
            user.id,
            body.name.trim(),
            typeof body.grade === 'string' ? body.grade.trim() : undefined,
          ),
        },
        201,
      );
    } catch (e) {
      if ((e as Error).message.startsWith('每个家庭'))
        throw new HttpError(400, (e as Error).message);
      throw e;
    }
  }
  if (parts[0] !== 'scans') throw new HttpError(404, '接口不存在');
  const owner = store.scanOwner(user.id);
  if (parts.length === 1) {
    if (method === 'GET') {
      const studentId = new URL(request.url).searchParams.get('studentId');
      if (!studentId) throw new HttpError(400, '请选择学生');
      requireStudent(store, user.id, studentId);
      const scans = (await listScans(owner, store))
        .filter(
          (s) =>
            !s.deletedAt && (s.studentId || s.child || 'dabao') === studentId,
        )
        .map(present);
      return json({ scans, recognition: recognitionEnabled() });
    }
    if (method !== 'POST') throw new HttpError(405, '请求方式不支持');
    const result = await uploadMobileScan(request, store, user.id);
    return json(
      { scan: present(result.record) },
      result.created ? 201 : 200,
    );
  }
  const record = await ownedScan(store, user.id, parts[1]);
  if (
    parts.length === 5 &&
    parts[2] === 'questions' &&
    ['wrong-book', 'explain', 'analysis-review'].includes(parts[4])
  ) {
    if (method !== 'POST') throw new HttpError(405, '请求方式不支持');
    if (!store.allow(`question-action:${user.id}`, 60, 60000))
      throw new HttpError(429, '操作过于频繁，请稍后再试');
    const body = await readJson(request, parts[4] === 'analysis-review' ? 65536 : 8192);
    if (parts[4] === 'analysis-review') return json({ scan: present(await reviewTutoring(store, user.id, record.id, parts[3], body)) });
    if (parts[4] === 'wrong-book')
      return json({
        scan: present(
          await setWrongBook(store, user.id, record.id, parts[3], body),
        ),
      });
    return json(
      {
        scan: present(
          enqueueExplanation(
            store,
            user.id,
            record.id,
            parts[3],
            body.revision,
          ),
        ),
      },
      202,
    );
  }
  if (parts.length === 2 && method === 'GET')
    return json({ scan: present(record) });
  if (parts.length !== 3) throw new HttpError(404, '接口不存在');
  if (parts[2] === 'candidate-regions' && method === 'POST') {
    const body = await readJson(request, 8192);
    return json(
      await candidateRegions(
        store,
        user.id,
        record.id,
        body.revision,
        request.signal,
      ),
    );
  }
  if (parts[2] === 'file' && method === 'GET') {
    return new Response(new Uint8Array(await readScanFile(owner, record.id)), {
      headers: {
        'Content-Type': record.mimeType,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(record.originalName)}`,
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  }
  if (parts[2] === 'recognize' && method === 'POST') {
    const body = await readJson(request, 8192);
    return json(
      {
        scan: present(
          enqueueRecognition(store, user.id, record.id, body.revision),
        ),
      },
      202,
    );
  }
  if (parts[2] === 'review' && method === 'PUT') {
    if (!store.allow(`review:${user.id}`, 120, 60000))
      throw new HttpError(429, '保存过于频繁，请稍后再试');
    const body = await readJson(request, 2 * 1024 * 1024);
    return json({
      scan: present(await reviewMobileScan(store, user.id, record.id, body)),
    });
  }
  throw new HttpError(405, '请求方式不支持');
}
async function handle(
  request: Request,
  parts: string[],
  web: boolean,
  injected?: FamilyStore,
) {
  let headers: Record<string, string> = {};
  try {
    if (!web) headers = cors(request);
    if (!web && request.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: { ...headers, 'Cache-Control': 'no-store' },
      });
    if (
      !web &&
      parts.join('/') === 'setup' &&
      request.method === 'GET' &&
      !injected &&
      !process.env.FAMILY_DATA_DIR
    )
      return json(
        { enabled: false, needsSetup: false, registrationEnabled: false },
        200,
        headers,
      );
    if (!injected && !process.env.FAMILY_DATA_DIR)
      throw new HttpError(503, '私人学习空间尚未配置');
    const store = injected || getFamilyStore();
    let response: Response;
    if (!web && parts.join('/') === 'setup') {
      if (request.method !== 'GET') throw new HttpError(405, '请求方式不支持');
      response = json({
        enabled: true,
        needsSetup: familyNeedsSetup(store),
        registrationEnabled: registrationEnabled(),
        processedPhotoMetadataVersion: 1,
        questionReviewVersion: 1,
        cloudPhotos: CLOUD_PHOTO_CAPABILITY,
      });
    } else if (!web && parts.join('/') === 'session/register') {
      if (request.method !== 'POST') throw new HttpError(405, '请求方式不支持');
      response = await registerFamily(request, store, (user, deviceName) =>
        issueMobileSession(user, store, deviceName),
      );
    } else if (!web && parts.join('/') === 'session/setup') {
      if (request.method !== 'POST') throw new HttpError(405, '请求方式不支持');
      response = await setupFirstFamily(request, store, (user) =>
        issueMobileSession(user, store),
      );
    } else if (
      !web &&
      parts.join('/') === 'session/login' &&
      request.method === 'POST'
    )
      response = await login(request, store);
    else if (web) {
      const user = currentUser(request, store);
      if (!user) throw new HttpError(401, '请先登录家庭账号');
      if (request.method !== 'GET') sameOrigin(request);
      response = await dispatch(request, parts, store, user);
    } else {
      const session = bearer(request, store);
      if (parts.join('/') === 'session' && request.method === 'GET')
        response = json({ user: session.user, expiresAt: session.expiresAt });
      else if (
        parts.join('/') === 'session/logout' &&
        request.method === 'POST'
      ) {
        store.db
          .prepare('DELETE FROM mobile_sessions WHERE token=?')
          .run(session.token);
        response = json({ ok: true });
      } else if (
        parts.length === 2 &&
        parts[0] === 'account' &&
        (parts[1] === 'username' || parts[1] === 'password')
      ) {
        response = await updateAccountCredentials(
          request,
          store,
          session.user,
          parts[1],
          () => {
            bearer(request, store);
          },
          (account) => issueMobileSession(account, store),
        );
      } else response = await dispatch(request, parts, store, session.user);
    }
    for (const [key, value] of Object.entries(headers))
      response.headers.set(key, value);
    return response;
  } catch (e) {
    if (e instanceof HttpError)
      return json(
        {
          error: e.message,
          code:
            e instanceof MobileError ||
            e instanceof RegistrationError ||
            e instanceof AccountError
              ? e.code
              : codes[e.status] || 'REQUEST_FAILED',
        },
        e.status,
        headers,
      );
    console.error(
      'Mobile request failed:',
      e instanceof Error ? e.name : 'unknown',
    );
    return json(
      { error: '处理暂时失败，原件与已保存资料仍保留', code: 'INTERNAL_ERROR' },
      500,
      headers,
    );
  }
}
export const handleMobile = (
  request: Request,
  parts: string[],
  store?: FamilyStore,
) => handle(request, parts, false, store);
export const handleWorkspace = (
  request: Request,
  parts: string[],
  store?: FamilyStore,
) => handle(request, parts, true, store);
