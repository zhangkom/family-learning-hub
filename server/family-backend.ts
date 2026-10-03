import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { Buffer } from 'node:buffer';
import { isIP } from 'node:net';
import { getFamilyStore, type FamilyStore } from './family-store';
import { validateFamily } from '../lib/family-state';
import { mergeFamily } from '../lib/family-state';
import { scanWrongRecords } from './scan-files';
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '../lib/account';

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
  return currentFamilySession(request, store)?.user || null;
}
export function currentFamilySession(request: Request, store: FamilyStore) {
  const token = sessionToken(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = store.db
    .prepare(
      'SELECT a.id,a.username,s.expires FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token=? AND s.expires>?',
    )
    .get(digest(token), Date.now());
  return row
    ? {
        user: { id: String(row.id), username: String(row.username) },
        expiresAt: new Date(Number(row.expires)).toISOString(),
      }
    : null;
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
export function passwordField(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length < MIN_PASSWORD_LENGTH ||
    value.length > MAX_PASSWORD_LENGTH
  )
    throw new HttpError(400, '密码请使用 6 至 128 个字符');
  return value;
}
export function issueFamilySession(
  user: FamilyUser,
  store: FamilyStore,
  present: (user: FamilyUser, expiresAt: string) => unknown = (account) => ({
    user: account,
  }),
) {
  const token = Buffer.from(randomBytes(32)).toString('hex');
  const expires = Date.now() + lifetime * 1000;
  store.db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
  store.db
    .prepare('INSERT INTO sessions VALUES (?,?,?)')
    .run(digest(token), user.id, expires);
  return json(present(user, new Date(expires).toISOString()), 200, {
    'Set-Cookie': cookie(token),
  });
}

export function logoutFamilySession(request: Request, store: FamilyStore) {
  store.db
    .prepare('DELETE FROM sessions WHERE token=?')
    .run(digest(sessionToken(request)));
  return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
}

export const familyNeedsSetup = (store: FamilyStore) =>
  !store.db.prepare('SELECT id FROM accounts LIMIT 1').get();

async function credentials(
  request: Request,
  store: FamilyStore,
  action: 'setup' | 'login' | 'register',
) {
  if (!store.allow(`auth:${action}`, 30, 15 * 60000))
    throw new HttpError(429, '尝试次数过多，请 15 分钟后再试');
  const body = await readJson(request, 8192);
  const username =
    typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  if (!/^[a-z0-9_-]{3,32}$/.test(username))
    throw new HttpError(400, '账号使用 3 至 32 位字母、数字、下划线或短横线');
  if (action !== 'login' && username === 'admin')
    throw new HttpError(400, 'admin为平台管理专用账号');
  const password = passwordField(body.password);
  if (!store.allow(`user:${username}`, 8, 15 * 60000))
    throw new HttpError(429, '该账号尝试次数过多，请 15 分钟后再试');
  return { body, username, password };
}

export const registrationEnabled = () =>
  process.env.FAMILY_REGISTRATION_ENABLED === 'true';

export class RegistrationError extends HttpError {
  constructor(
    status: number,
    message: string,
    public code: string,
  ) {
    super(status, message);
  }
}

export class AccountError extends HttpError {
  constructor(
    status: number,
    message: string,
    public code: string,
  ) {
    super(status, message);
  }
}

// Change credentials without changing the account ID or its learning data.
// Recheck session and credentials after the asynchronous password derivations.
export async function updateAccountCredentials(
  request: Request,
  store: FamilyStore,
  user: FamilyUser,
  action: 'username' | 'password',
  requireSession: () => void,
  complete: (user: FamilyUser) => Response,
) {
  if (request.method !== 'POST') throw new HttpError(405, '请求方式不支持');
  if (!store.allow(`password:${user.id}`, 8, 15 * 60000))
    throw new HttpError(429, '尝试次数过多，请 15 分钟后再试');
  const body = await readJson(request, 8192);
  const old = passwordField(body.currentPassword);
  const username =
    action === 'username'
      ? typeof body.username === 'string'
        ? body.username.trim().toLowerCase()
        : ''
      : user.username;
  if (!/^[a-z0-9_-]{3,32}$/.test(username))
    throw new HttpError(400, '用户名使用 3 至 32 位字母、数字、下划线或短横线');
  const next = action === 'password' ? passwordField(body.password) : undefined;
  const administrator = !!store.db
    .prepare('SELECT 1 FROM platform_admins WHERE account_id=?')
    .get(user.id);
  if (action === 'username' && (administrator || username === 'admin'))
    throw new HttpError(400, '平台管理员账号名称不可修改，admin为保留名称');
  if (administrator && next !== undefined && next.length < 12)
    throw new HttpError(400, '管理员密码至少需要12个字符');
  const row = store.db
    .prepare('SELECT username,password FROM accounts WHERE id=?')
    .get(user.id);
  if (!row) throw new HttpError(401, '登录已过期，请重新登录');
  const encoded = String(row.password);
  if (!(await verifyPassword(old, encoded)))
    throw new AccountError(400, '当前密码不正确', 'INVALID_CURRENT_PASSWORD');
  const hashed = next === undefined ? encoded : await hashPassword(next);
  return store.transaction(() => {
    requireSession();
    const current = store.db
      .prepare('SELECT username,password FROM accounts WHERE id=?')
      .get(user.id);
    if (
      !current ||
      current.password !== encoded ||
      current.username !== row.username
    )
      throw new HttpError(401, '账号信息已变更，请重新登录');
    const taken = store.db
      .prepare('SELECT id FROM accounts WHERE username=? AND id<>?')
      .get(username, user.id);
    if (taken)
      throw new AccountError(409, '用户名已被使用，请换一个', 'USERNAME_TAKEN');
    store.db
      .prepare('UPDATE accounts SET username=?,password=? WHERE id=?')
      .run(username, hashed, user.id);
    if (administrator && next !== undefined) {
      store.db
        .prepare(
          'UPDATE platform_admins SET must_change_password=0 WHERE account_id=?',
        )
        .run(user.id);
      store.db
        .prepare(
          'DELETE FROM review_tokens WHERE batch_id IN (SELECT id FROM review_batches WHERE admin_id=?)',
        )
        .run(user.id);
    }
    store.db.prepare('DELETE FROM sessions WHERE account_id=?').run(user.id);
    store.db
      .prepare('DELETE FROM mobile_sessions WHERE account_id=?')
      .run(user.id);
    return complete({ id: user.id, username });
  });
}

function registrationAddress(request: Request) {
  // Enable only behind a proxy that overwrites X-Real-IP (our loopback Nginx).
  // Never accept client-supplied X-Forwarded-For as a rate-limit identity.
  const value =
    process.env.FAMILY_TRUST_PROXY === 'true'
      ? request.headers.get('x-real-ip')?.trim() || ''
      : '';
  const version = isIP(value);
  if (!version) return 'untrusted';
  return version === 6 ? new URL(`http://[${value}]`).hostname : value;
}

// Ordinary registration never adopts the legacy owner or its student profiles.
// The caller enforces origin policy and supplies its own session response.
export async function registerFamily(
  request: Request,
  store: FamilyStore,
  complete: (user: FamilyUser, deviceName: string) => Response,
) {
  if (!registrationEnabled())
    throw new RegistrationError(
      503,
      '注册暂未开放，请稍后再试',
      'REGISTRATION_DISABLED',
    );
  if (
    !store.allow(
      `register:ip:${digest(registrationAddress(request))}`,
      5,
      15 * 60000,
    )
  )
    throw new HttpError(429, '注册尝试过于频繁，请 15 分钟后再试');
  const { body, username, password } = await credentials(
    request,
    store,
    'register',
  );
  if (
    body.deviceName !== undefined &&
    (typeof body.deviceName !== 'string' || body.deviceName.length > 100)
  )
    throw new HttpError(400, '设备名称格式不正确');
  const deviceName =
    typeof body.deviceName === 'string' && body.deviceName
      ? body.deviceName
      : '手机或平板';
  const hashed = await hashPassword(password);
  return store.transaction(() => {
    if (
      store.db.prepare('SELECT id FROM accounts WHERE username=?').get(username)
    )
      throw new RegistrationError(
        409,
        '账号已存在，请登录或换一个账号',
        'USERNAME_TAKEN',
      );
    const id = randomUUID();
    store.db
      .prepare('INSERT INTO accounts VALUES (?,?,?,?)')
      .run(id, username, hashed, Date.now());
    return complete({ id, username }, deviceName);
  });
}

// The caller checks its own origin policy. Both web and mobile share one setup
// limit, password derivation, legacy adoption rule and atomic first-account gate.
export async function setupFirstFamily(
  request: Request,
  store: FamilyStore,
  complete: (user: FamilyUser) => Response,
) {
  const { body, username, password } = await credentials(
    request,
    store,
    'setup',
  );
  const setupToken = process.env.FAMILY_SETUP_TOKEN || '';
  if (
    setupToken.length < 32 ||
    typeof body.setupToken !== 'string' ||
    !equal(body.setupToken, setupToken)
  )
    throw new HttpError(403, '家庭启用码不正确');
  const hashed = await hashPassword(password);
  return store.transaction(() => {
    if (!familyNeedsSetup(store))
      throw new HttpError(409, '家庭账号已创建，请直接登录');
    const id = randomUUID();
    store.db
      .prepare('INSERT INTO accounts VALUES (?,?,?,?)')
      .run(id, username, hashed, Date.now());
    store.db
      .prepare('INSERT INTO legacy_owners VALUES (?,?)')
      .run(id, 'family');
    return complete({ id, username });
  });
}

// Both cookie entry points share credential validation, throttling and the
// post-KDF credential check. The caller enforces its own origin/method policy.
export async function loginFamily(
  request: Request,
  store: FamilyStore,
  complete: (user: FamilyUser) => Response = (user) =>
    issueFamilySession(user, store),
) {
  const { username, password } = await credentials(request, store, 'login');
  const row = store.db
    .prepare('SELECT id,username,password FROM accounts WHERE username=?')
    .get(username);
  const encoded = row
    ? String(row.password)
    : `${'0'.repeat(32)}:${'0'.repeat(128)}`;
  const valid = await verifyPassword(password, encoded);
  if (
    !row ||
    !valid ||
    store.db
      .prepare('SELECT password FROM accounts WHERE id=? AND username=?')
      .get(row.id, username)?.password !== encoded
  )
    throw new HttpError(401, '账号或密码不正确');
  store.db.prepare('DELETE FROM limits WHERE key=?').run(`user:${username}`);
  return complete({ id: String(row.id), username: String(row.username) });
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
        needsSetup: familyNeedsSetup(store),
      });
    if (action === 'logout') {
      return logoutFamilySession(request, store);
    }
    if (action === 'setup') {
      if (request.method !== 'POST') throw new HttpError(405, '请求方式不支持');
      return await setupFirstFamily(request, store, (account) =>
        issueFamilySession(account, store),
      );
    }
    if (action === 'login') {
      return await loginFamily(request, store);
    }
    if (!user) throw new HttpError(401, '请先登录家庭账号');
    if (action === 'password') {
      return await updateAccountCredentials(
        request,
        store,
        user,
        'password',
        () => {
          if (currentUser(request, store)?.id !== user.id)
            throw new HttpError(401, '登录已过期，请重新登录');
        },
        (account) => issueFamilySession(account, store),
      );
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
