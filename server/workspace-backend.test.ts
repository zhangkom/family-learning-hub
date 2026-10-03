import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { FamilyStore } from './family-store';
import { handleWorkspace, handleMobile } from './mobile-backend';
import { handleFamily } from './family-backend';
import { handleAdmin } from './admin-backend';

const origin = 'https://family.example';
const password = 'synthetic-family-password';
let store: FamilyStore;
type TestResponse = Omit<Response, 'json'> & {
  json(): Promise<{
    user: { id: string; username: string };
    token: string;
    capabilities: { admin: boolean; adminPasswordChangeRequired: boolean };
    student: { id: string; name: string; grade?: string };
    students: Array<{ id: string; name: string; grade?: string }>;
  }>;
};
function call(
  path: string,
  method = 'GET',
  body?: unknown,
  cookie = '',
  headers: Record<string, string> = {},
) {
  return handleWorkspace(
    new Request(`${origin}/family-learning/api/family/workspace/${path}`, {
      method,
      headers: {
        origin,
        cookie,
        'Content-Type': 'application/json',
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    path.split('?')[0].split('/'),
    store,
  ) as Promise<TestResponse>;
}
const cookieOf = (response: Response) =>
  response.headers.get('set-cookie')!.split(';')[0];
async function setup() {
  const response = await call('session/setup', 'POST', {
    username: 'family',
    password,
    setupToken: 's'.repeat(48),
  });
  expect(response.status).toBe(200);
  return { cookie: cookieOf(response), body: await response.json() };
}
function mobile(path: string, body?: unknown, token = '', cookie = '') {
  return handleMobile(
    new Request(`${origin}/family-learning/api/mobile/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        cookie,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    path.split('/'),
    store,
  ) as Promise<TestResponse>;
}
beforeEach(() => {
  store = new FamilyStore(':memory:');
  vi.stubEnv('FAMILY_PUBLIC_ORIGIN', origin);
  vi.stubEnv('FAMILY_SETUP_TOKEN', 's'.repeat(48));
  vi.stubEnv('FAMILY_REGISTRATION_ENABLED', 'true');
  vi.stubEnv('FAMILY_RECOGNITION_ENABLED', 'false');
  vi.stubEnv('FAMILY_AI_API_KEY', '');
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/family-learning');
});
afterEach(() => {
  store.close();
  vi.unstubAllEnvs();
});

describe('cookie workspace authentication and account contract', () => {
  it('exposes matching setup capabilities publicly, but requires a real cookie session for identity and records', async () => {
    const response = await call('setup');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(await (await mobile('setup')).json());
    expect(response.headers.get('cache-control')).toContain('no-store');
    for (const path of ['session', 'session/me', 'students']) {
      const denied = await call(path, 'GET', undefined, '', {
        Authorization: 'Bearer web-cookie',
        'oai-authenticated-user-id': 'admin',
      });
      expect(denied.status).toBe(401);
      expect(await denied.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
    }
    expect((await call('setup', 'POST', {})).status).toBe(405);
    vi.stubEnv('FAMILY_DATA_DIR', '');
    const disabled = await handleWorkspace(new Request(`${origin}/setup`), [
      'setup',
    ]);
    expect(await disabled.json()).toEqual({
      enabled: false,
      needsSetup: false,
      registrationEnabled: false,
    });
  });

  it('sets only HttpOnly scoped cookies and returns identity, expiry and DB-derived capabilities without a bearer', async () => {
    const response = await call('session/setup', 'POST', {
      username: 'family',
      password,
      setupToken: 's'.repeat(48),
    });
    const cookie = cookieOf(response),
      raw = cookie.split('=')[1],
      body = await response.json();
    expect(response.headers.get('set-cookie')).toMatch(
      /Path=\/family-learning\/; HttpOnly; SameSite=Strict; Max-Age=604800; Secure/,
    );
    expect(body).toEqual({
      user: { id: expect.any(String), username: 'family' },
      expiresAt: expect.any(String),
      capabilities: { admin: false, adminPasswordChangeRequired: false },
    });
    expect(JSON.stringify(body)).not.toContain(raw);
    expect(body).not.toHaveProperty('token');
    expect(store.db.prepare('SELECT token FROM sessions').get()?.token).toBe(
      createHash('sha256').update(raw).digest('hex'),
    );
    expect(
      store.db.prepare('SELECT count(*) n FROM mobile_sessions').get()?.n,
    ).toBe(0);
    const identity = await call('session/me', 'GET', undefined, cookie);
    expect(await identity.json()).toEqual(body);
    expect(identity.headers.get('access-control-allow-origin')).toBeNull();
    expect(identity.headers.get('set-cookie')).toBeNull();
    expect(
      (
        await call(
          'students',
          'POST',
          { name: '合成学生', grade: '高一' },
          cookie,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await call('session/setup', 'POST', {
          username: 'another',
          password,
          setupToken: 's'.repeat(48),
        })
      ).status,
    ).toBe(409);
  });

  it('rejects login/setup/register CSRF before issuing sessions or creating accounts, and blocks cookie writes/logout CSRF', async () => {
    const rejectedOrigins: Record<string, string>[] = [
      { origin: 'https://evil.example' },
      { origin: '' },
      { origin, 'sec-fetch-site': 'cross-site' },
    ];
    for (const path of ['session/setup', 'session/register', 'session/login']) {
      for (const headers of rejectedOrigins) {
        const response = await call(
          path,
          'POST',
          { username: 'family', password, setupToken: 's'.repeat(48) },
          '',
          headers,
        );
        expect(response.status).toBe(403);
        expect(response.headers.get('set-cookie')).toBeNull();
      }
      expect((await call(path)).status).toBe(405);
    }
    expect(store.db.prepare('SELECT count(*) n FROM accounts').get()?.n).toBe(
      0,
    );
    const { cookie } = await setup();
    for (const path of [
      'session/logout',
      'account/username',
      'account/password',
      'students',
    ]) {
      expect(
        (await call(path, 'POST', {}, cookie, { origin: 'https://localhost' }))
          .status,
      ).toBe(403);
    }
    expect((await call('session', 'GET', undefined, cookie)).status).toBe(200);
  });

  it('shares legacy cookie/admin authentication while keeping mobile bearer authentication isolated', async () => {
    const { cookie, body } = await setup();
    const native = await mobile('session/login', {
      username: 'family',
      password,
    });
    const token = (await native.json()).token;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(native.headers.get('set-cookie')).toBeNull();
    expect(
      (
        await call('session', 'GET', undefined, '', {
          Authorization: `Bearer ${token}`,
        })
      ).status,
    ).toBe(401);
    expect((await mobile('session', undefined, '', cookie)).status).toBe(401);
    expect((await mobile('session', undefined, token)).status).toBe(200);
    const legacy = await handleFamily(
      new Request(`${origin}/session`, { headers: { cookie } }),
      'session',
      store,
    );
    expect(await legacy.json()).toMatchObject({ user: body.user });
    store.db
      .prepare('INSERT INTO platform_admins VALUES (?,?,?)')
      .run(body.user.id, Date.now(), 1);
    expect(
      await (await call('session', 'GET', undefined, cookie)).json(),
    ).toMatchObject({
      capabilities: { admin: true, adminPasswordChangeRequired: true },
    });
    const admin = await handleAdmin(
      new Request(`${origin}/admin/session`, { headers: { cookie } }),
      ['session'],
      store,
    );
    expect(admin.status).toBe(200);
    expect(await admin.json()).toMatchObject({
      user: { id: body.user.id, mustChangePassword: true },
    });
    expect(
      (
        await handleAdmin(
          new Request(`${origin}/admin/overview`, { headers: { cookie } }),
          ['overview'],
          store,
        )
      ).status,
    ).toBe(428);
  });

  it('registers an isolated family with no legacy adoption or forged administrator grant and preserves mobile error codes', async () => {
    const first = await setup();
    const created = await call(
      'students',
      'POST',
      { name: '第一家庭学生' },
      first.cookie,
    );
    const studentId = (await created.json()).student.id;
    const response = await call('session/register', 'POST', {
      username: 'second',
      password,
      role: 'admin',
      admin: true,
    });
    expect(response.status).toBe(200);
    const secondCookie = cookieOf(response),
      second = await response.json();
    expect(second).not.toHaveProperty('token');
    expect(second.capabilities.admin).toBe(false);
    expect(
      store.db
        .prepare('SELECT 1 FROM legacy_owners WHERE account_id=?')
        .get(second.user.id),
    ).toBeUndefined();
    expect(
      (await (await call('students', 'GET', undefined, secondCookie)).json())
        .students,
    ).toEqual([]);
    expect(
      (
        await call(
          `scans?studentId=${studentId}`,
          'GET',
          undefined,
          secondCookie,
        )
      ).status,
    ).toBe(404);
    const duplicate = await call('session/register', 'POST', {
      username: 'second',
      password,
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: 'USERNAME_TAKEN' });
    expect(
      (await call('session/register', 'POST', { username: 'admin', password }))
        .status,
    ).toBe(400);
    vi.stubEnv('FAMILY_REGISTRATION_ENABLED', 'false');
    const disabled = await call('session/register', 'POST', {
      username: 'third',
      password,
    });
    expect(disabled.status).toBe(503);
    expect(await disabled.json()).toMatchObject({
      code: 'REGISTRATION_DISABLED',
    });
  });

  it('rotates cookie sessions on username/password changes, revokes all old web/native sessions and preserves account/student IDs', async () => {
    const first = await setup();
    const student = (
      await (
        await call('students', 'POST', { name: '保留的合成学生' }, first.cookie)
      ).json()
    ).student;
    const native = (
      await (
        await mobile('session/login', { username: 'family', password })
      ).json()
    ).token;
    const secondCookie = cookieOf(
      await call('session/login', 'POST', { username: 'family', password }),
    );
    const changed = await call(
      'account/username',
      'POST',
      { currentPassword: password, username: 'renamed' },
      first.cookie,
    );
    expect(changed.status).toBe(200);
    const renamedCookie = cookieOf(changed),
      renamed = await changed.json();
    expect(renamedCookie).not.toBe(first.cookie);
    expect(renamed.user).toEqual({
      id: first.body.user.id,
      username: 'renamed',
    });
    expect(renamed).not.toHaveProperty('token');
    for (const cookie of [first.cookie, secondCookie])
      expect((await call('session', 'GET', undefined, cookie)).status).toBe(
        401,
      );
    expect((await mobile('session', undefined, native)).status).toBe(401);
    expect(
      (await (await call('students', 'GET', undefined, renamedCookie)).json())
        .students,
    ).toContainEqual(student);
    const changedPassword = await call(
      'account/password',
      'POST',
      { currentPassword: password, password: 'new-synthetic-password' },
      renamedCookie,
    );
    expect(changedPassword.status).toBe(200);
    expect(
      (await call('session', 'GET', undefined, renamedCookie)).status,
    ).toBe(401);
    expect(
      (await call('session', 'GET', undefined, cookieOf(changedPassword)))
        .status,
    ).toBe(200);
    expect(
      (await call('session/login', 'POST', { username: 'renamed', password }))
        .status,
    ).toBe(401);
    expect(
      (
        await call('session/login', 'POST', {
          username: 'renamed',
          password: 'new-synthetic-password',
        })
      ).status,
    ).toBe(200);
  });

  it('rechecks a revoked cookie after asynchronous password verification and never mutates credentials', async () => {
    const { cookie, body } = await setup();
    const before = store.db
      .prepare('SELECT username,password FROM accounts WHERE id=?')
      .get(body.user.id);
    const pending = call(
      'account/password',
      'POST',
      { currentPassword: password, password: 'unauthorized-change' },
      cookie,
    );
    store.db.prepare('DELETE FROM sessions').run();
    const result = await pending;
    expect(result.status).toBe(401);
    expect(result.headers.get('set-cookie')).toBeNull();
    expect(
      store.db
        .prepare('SELECT username,password FROM accounts WHERE id=?')
        .get(body.user.id),
    ).toEqual(before);
  });

  it('retains administrator password requirements and derives the capability from the current database', async () => {
    const { cookie, body } = await setup();
    store.db
      .prepare('INSERT INTO platform_admins VALUES (?,?,?)')
      .run(body.user.id, Date.now(), 1);
    expect(
      (
        await call(
          'account/username',
          'POST',
          { currentPassword: password, username: 'other-name' },
          cookie,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          'account/password',
          'POST',
          { currentPassword: password, password: 'short123' },
          cookie,
        )
      ).status,
    ).toBe(400);
    const changed = await call(
      'account/password',
      'POST',
      { currentPassword: password, password: 'admin-long-new-password' },
      cookie,
    );
    expect(changed.status).toBe(200);
    const nextCookie = cookieOf(changed);
    expect(await changed.json()).toMatchObject({
      capabilities: { admin: true, adminPasswordChangeRequired: false },
    });
    expect(
      (
        await handleAdmin(
          new Request(`${origin}/overview`, {
            headers: { cookie: nextCookie },
          }),
          ['overview'],
          store,
        )
      ).status,
    ).toBe(200);
  });

  it('expires and logs out only the selected cookie without revoking other browser or mobile sessions', async () => {
    const first = await setup();
    const second = cookieOf(
      await call('session/login', 'POST', { username: 'family', password }),
    );
    const token = (
      await (
        await mobile('session/login', { username: 'family', password })
      ).json()
    ).token;
    const loggedOut = await call('session/logout', 'POST', {}, first.cookie);
    expect(loggedOut.status).toBe(200);
    expect(loggedOut.headers.get('set-cookie')).toContain('family_session=;');
    expect(loggedOut.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await call('session', 'GET', undefined, first.cookie)).status).toBe(
      401,
    );
    expect((await call('session', 'GET', undefined, second)).status).toBe(200);
    expect((await mobile('session', undefined, token)).status).toBe(200);
    store.db.prepare('UPDATE sessions SET expires=0').run();
    expect((await call('session', 'GET', undefined, second)).status).toBe(401);
    expect((await call('session/logout', 'POST', {})).status).toBe(200);
  });
});
