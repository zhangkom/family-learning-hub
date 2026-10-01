import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { Buffer } from 'node:buffer';
import { getFamilyStore, type FamilyStore } from './family-store';
import { validateFamily } from '../lib/family-state';
import { mergeFamily } from '../lib/family-state';
import { scanWrongRecords } from './scan-files';

const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(Buffer.from(key))),
    );
  });
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const equal = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
const cookieName = 'family_session';
const lifetime = 7 * 24 * 3600;
export type FamilyUser = { id: string; username: string };
export type FamilyAction =
  | 'session'
  | 'setup'
  | 'login'
  | 'logout'
  | 'password'
  | 'sync';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function json(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}
export async function readBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '提交内容为空');
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, '提交内容过大');
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}
export async function readJson(
  request: Request,
  limit: number,
): Promise<Record<string, unknown>> {
  const bytes = await readBody(request, limit);
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new HttpError(400, '提交内容格式不正确');
  }
}
export function sameOrigin(request: Request) {
  const expected =
    process.env.FAMILY_PUBLIC_ORIGIN ||
    (process.env.NODE_ENV !== 'production' ? new URL(request.url).origin : '');
  if (
    !expected ||
    request.headers.get('origin') !== expected ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    throw new HttpError(403, '请从本站页面提交');
}
export function sessionToken(request: Request) {
  return (
    request.headers
      .get('cookie')
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) || ''
  );
}
export function currentUser(
  request: Request,
  store: FamilyStore,
): FamilyUser | null {
  const token = sessionToken(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = store.db
    .prepare(
      'SELECT a.id,a.username FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token=? AND s.expires>?',
    )
    .get(digest(token), Date.now());
  return row ? { id: String(row.id), username: String(row.username) } : null;
}
function cookie(token: string, maxAge = lifetime) {
  const path = `${process.env.NEXT_PUBLIC_BASE_PATH || '/family-learning'}/`;
  const secure =
    process.env.NODE_ENV === 'production' ||
    process.env.FAMILY_PUBLIC_ORIGIN?.startsWith('https:');
  return `${cookieName}=${token}; Path=${path}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
export async function hashPassword(password: string) {
  const salt = Buffer.from(randomBytes(16)).toString('hex');
  const hash = await derive(password, salt);
  return `${salt}:${Buffer.from(hash).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [salt, hash] = encoded.split(':');
  const actual = await derive(password, salt);
  return (
    hash?.length === 128 && timingSafeEqual(actual, Buffer.from(hash, 'hex'))
  );
}
function passwordField(value: unknown) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128)
    throw new HttpError(400, '密码请使用 12 至 128 个字符');
  return value;
}
function issueSession(user: FamilyUser, store: FamilyStore) {
  const token = Buffer.from(randomBytes(32)).toString('hex');
  store.db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
  store.db
    .prepare('INSERT INTO sessions VALUES (?,?,?)')
    .run(digest(token), user.id, Date.now() + lifetime * 1000);
  return json({ user }, 200, { 'Set-Cookie': cookie(token) });
}

export async function handleFamily(
  request: Request,
  action: FamilyAction,
  injected?: FamilyStore,
): Promise<Response> {
  try {
    if (!injected && !process.env.FAMILY_DATA_DIR)
      return action === 'session'
        ? json({ enabled: false, user: null })
        : json({ error: '私人学习空间尚未配置' }, 503);
    const store = injected || getFamilyStore();
    const user = currentUser(request, store);
    if (request.method !== 'GET') sameOrigin(request);
    if (action === 'session')
      return json({
        enabled: true,
        user,
        needsSetup: !store.db.prepare('SELECT id FROM accounts LIMIT 1').get(),
      });
    if (action === 'logout') {
      store.db
        .prepare('DELETE FROM sessions WHERE token=?')
        .run(digest(sessionToken(request)));
      return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
    }
    if (action === 'setup' || action === 'login') {
      if (!store.allow(`auth:${action}`, 30, 15 * 60000))
        throw new HttpError(429, '尝试次数过多，请 15 分钟后再试');
      const body = await readJson(request, 8192);
      const username =
        typeof body.username === 'string'
          ? body.username.trim().toLowerCase()
          : '';
      if (!/^[a-z0-9_-]{3,32}$/.test(username))
        throw new HttpError(
          400,
          '账号使用 3 至 32 位字母、数字、下划线或短横线',
        );
      const password = passwordField(body.password);
      if (!store.allow(`user:${username}`, 8, 15 * 60000))
        throw new HttpError(429, '该账号尝试次数过多，请 15 分钟后再试');
      if (action === 'setup') {
        const setupToken = process.env.FAMILY_SETUP_TOKEN || '';
        if (
          setupToken.length < 32 ||
          typeof body.setupToken !== 'string' ||
          !equal(body.setupToken, setupToken)
        )
          throw new HttpError(403, '家庭启用码不正确');
        const hashed = await hashPassword(password);
        const account = store.transaction(() => {
          if (store.db.prepare('SELECT id FROM accounts LIMIT 1').get())
            throw new HttpError(409, '家庭账号已创建，请直接登录');
          const id = randomUUID();
          store.db
            .prepare('INSERT INTO accounts VALUES (?,?,?,?)')
            .run(id, username, hashed, Date.now());
          store.db
            .prepare('INSERT INTO legacy_owners VALUES (?,?)')
            .run(id, 'family');
          return { id, username };
        });
        return issueSession(account, store);
      }
      const row = store.db
        .prepare('SELECT id,username,password FROM accounts WHERE username=?')
        .get(username);
      // Run the same KDF even for an unknown account.
      const encoded = row
        ? String(row.password)
        : `${'0'.repeat(32)}:${'0'.repeat(128)}`;
      const valid = await verifyPassword(password, encoded);
      if (!row || !valid) throw new HttpError(401, '账号或密码不正确');
      store.db
        .prepare('DELETE FROM limits WHERE key=?')
        .run(`user:${username}`);
      return issueSession(
        { id: String(row.id), username: String(row.username) },
        store,
      );
    }
    if (!user) throw new HttpError(401, '请先登录家庭账号');
    if (action === 'password') {
      if (!store.allow(`password:${user.id}`, 8, 15 * 60000))
        throw new HttpError(429, '尝试次数过多，请稍后再试');
      const body = await readJson(request, 8192);
      const old = passwordField(body.currentPassword),
        next = passwordField(body.password);
      const encoded = String(
        store.db
          .prepare('SELECT password FROM accounts WHERE id=?')
          .get(user.id)?.password,
      );
      if (!(await verifyPassword(old, encoded)))
        throw new HttpError(401, '当前密码不正确');
      const hashed = await hashPassword(next);
      store.transaction(() => {
        store.db
          .prepare('UPDATE accounts SET password=? WHERE id=?')
          .run(hashed, user.id);
        store.db
          .prepare('DELETE FROM sessions WHERE account_id=?')
          .run(user.id);
        store.db
          .prepare('DELETE FROM mobile_sessions WHERE account_id=?')
          .run(user.id);
      });
      return issueSession(user, store);
    }
    if (action === 'sync') {
      const savedScans = process.env.FAMILY_DATA_DIR
        ? await scanWrongRecords(store.scanOwner(user.id), store)
        : undefined;
      if (request.method === 'GET')
        return json({
          user,
          records: savedScans
            ? mergeFamily(store.read(user.id), savedScans)
            : store.read(user.id),
        });
      if (!store.allow(`sync:${user.id}`, 120, 60000))
        throw new HttpError(429, '同步请求过于频繁，请稍后重试');
      const body = await readJson(request, 8 * 1024 * 1024);
      let records;
      try {
        records = validateFamily(body.records);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      try {
        records = store.merge(
          user.id,
          savedScans ? mergeFamily(records, savedScans) : records,
        );
      } catch (e) {
        if ((e as Error).message.startsWith('记录过多'))
          throw new HttpError(413, (e as Error).message);
        throw e;
      }
      return json({ user, records });
    }
    return json({ error: '接口不存在' }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(
      'Family request failed:',
      e instanceof Error ? e.name : 'unknown',
    );
    return json({ error: '保存暂时失败，请稍后重试；本机记录仍保留' }, 500);
  }
}
