import { CLOUD_PHOTO_CAPABILITY } from '../lib/cloud-photos';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { FamilyStore } from './family-store';
import { handleFamily, type FamilyAction } from './family-backend';
import { handleMobile } from './mobile-backend';
import { saveScan, scanDirectory } from './scan-files';
import { emptyFamily } from '../lib/family-state';

const origin = 'https://family.example';
const activation = 'synthetic-admin-code-'.repeat(3);
let directory: string, store: FamilyStore;
const digest = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
const credentials = (username = 'new_family', password = '123456') => ({
  username,
  password,
});
function request(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  method?: string,
) {
  return new Request(origin + '/family-learning/api/mobile/v1/' + path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: {
      Origin: 'https://localhost',
      'Content-Type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const mobile = (
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  connection = store,
  method?: string,
) =>
  handleMobile(
    request(path, body, headers, method),
    path.split('?')[0].split('/'),
    connection,
  );
const web = (action: FamilyAction, body?: unknown, cookie = '') =>
  handleFamily(
    request(action, body, { Origin: origin, Cookie: cookie }),
    action,
    store,
  );
const count = (table: string) =>
  Number(store.db.prepare('SELECT count(*) AS n FROM ' + table).get()?.n);
async function register(
  username = 'new_family',
  password = '123456',
  headers = {},
) {
  const response = await mobile(
    'session/register',
    credentials(username, password),
    headers,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    token: string;
    user: { id: string; username: string };
    expiresAt: string;
  };
}
beforeEach(() => {
  mkdirSync('work', { recursive: true });
  directory = mkdtempSync(resolve('work/mobile-register-test-'));
  store = new FamilyStore(join(directory, 'family.sqlite'));
  vi.stubEnv('FAMILY_DATA_DIR', directory);
  vi.stubEnv('FAMILY_PUBLIC_ORIGIN', origin);
  vi.stubEnv('FAMILY_MOBILE_ORIGINS', 'https://localhost');
  vi.stubEnv('FAMILY_SETUP_TOKEN', activation);
  vi.stubEnv('FAMILY_REGISTRATION_ENABLED', 'true');
  vi.stubEnv('FAMILY_TRUST_PROXY', 'true');
});
afterEach(() => {
  store.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (
    !resolve(directory).startsWith(
      resolve('work') + sep + 'mobile-register-test-',
    )
  )
    throw new Error('Unsafe test cleanup');
  rmSync(directory, { recursive: true, force: true });
});

describe('ordinary mobile family registration', () => {
  it('reports a separate explicit registration gate and returns no account details', async () => {
    expect(await (await mobile('setup')).json()).toEqual({
      enabled: true,
      needsSetup: true,
      registrationEnabled: true,
      processedPhotoMetadataVersion: 1,
      questionReviewVersion: 1,
      learningSessionVersion: 1,
      cloudPhotos: CLOUD_PHOTO_CAPABILITY,
    });
    vi.stubEnv('FAMILY_REGISTRATION_ENABLED', 'false');
    const closed = await mobile('session/register', credentials());
    expect(closed.status).toBe(503);
    expect(await closed.json()).toMatchObject({
      code: 'REGISTRATION_DISABLED',
    });
    expect(count('accounts')).toBe(0);
    expect(count('limits')).toBe(0);
    vi.stubEnv('FAMILY_REGISTRATION_ENABLED', '');
    expect((await mobile('session/register', credentials())).status).toBe(503);
    vi.stubEnv('FAMILY_DATA_DIR', '');
    expect(
      await (await handleMobile(request('setup'), ['setup'])).json(),
    ).toEqual({
      enabled: false,
      needsSetup: false,
      registrationEnabled: false,
    });
  });

  it('accepts six digits, normalizes the username, hashes credentials and issues usable Bearer without a Cookie', async () => {
    const response = await mobile('session/register', {
      ...credentials(' New_Family '),
      owner: 'family',
      setupToken: activation,
      studentId: 'dabao',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://localhost',
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
    const saved = (await response.json()) as {
      token: string;
      user: { id: string; username: string };
      expiresAt: string;
    };
    expect(Object.keys(saved).sort()).toEqual(['expiresAt', 'token', 'user']);
    expect(saved.user.username).toBe('new_family');
    expect(saved.token).toMatch(/^[a-f0-9]{64}$/);
    expect(Date.parse(saved.expiresAt)).toBeGreaterThan(Date.now());
    expect(
      store.db.prepare('SELECT token FROM mobile_sessions').get()?.token,
    ).toBe(digest(saved.token));
    expect(
      store.db.prepare('SELECT password FROM accounts').get()?.password,
    ).not.toBe('123456');
    expect(store.scanOwner(saved.user.id)).toBe(saved.user.id);
    expect(count('legacy_owners')).toBe(0);
    expect(count('students')).toBe(0);
    expect(count('sessions')).toBe(0);
    const authenticated = { Authorization: 'Bearer ' + saved.token };
    expect((await mobile('session', undefined, authenticated)).status).toBe(
      200,
    );
    expect(
      await (await mobile('students', undefined, authenticated)).json(),
    ).toEqual({ students: [] });
    expect(await (await mobile('setup')).json()).toEqual({
      enabled: true,
      needsSetup: false,
      registrationEnabled: true,
      processedPhotoMetadataVersion: 1,
      questionReviewVersion: 1,
      learningSessionVersion: 1,
      cloudPhotos: CLOUD_PHOTO_CAPABILITY,
    });
    expect((await mobile('session/login', credentials())).status).toBe(200);
    const site = await web('login', credentials());
    expect(site.status).toBe(200);
    expect(site.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('never imports or moves unclaimed historical originals, and retains the old first-account setup gate', async () => {
    const id = randomUUID(),
      original = new Uint8Array([1, 2, 3, 4]);
    await saveScan(
      'family',
      {
        id,
        subject: '数学',
        source: '合成历史资料',
        originalName: 'synthetic.png',
        mimeType: 'image/png',
        size: original.length,
        status: 'needs_review',
        createdAt: new Date().toISOString(),
        fileUrl: '',
        revision: 0,
      },
      original,
    );
    const originalPath = join(scanDirectory('family', id), 'original');
    const hash = digest(readFileSync(originalPath));
    const created = await register();
    expect(
      (
        await mobile('scans/' + id, undefined, {
          Authorization: 'Bearer ' + created.token,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await mobile('scans?studentId=dabao', undefined, {
          Authorization: 'Bearer ' + created.token,
        })
      ).status,
    ).toBe(404);
    expect(count('scan_documents')).toBe(0);
    expect(count('legacy_owners')).toBe(0);
    expect(digest(readFileSync(originalPath))).toBe(hash);
    expect(
      (
        await mobile('session/setup', {
          ...credentials('legacy_admin'),
          setupToken: activation,
        })
      ).status,
    ).toBe(409);
  });

  it('keeps activation mandatory for historical ownership and allows ordinary registration after legacy setup', async () => {
    expect(
      (await mobile('session/setup', credentials('legacy_admin'))).status,
    ).toBe(403);
    const setup = await mobile('session/setup', {
      ...credentials('legacy_admin', 'old-long-family-password'),
      setupToken: activation,
    });
    expect(setup.status).toBe(200);
    const old = (await setup.json()) as { token: string; user: { id: string } };
    expect(store.scanOwner(old.user.id)).toBe('family');
    expect(store.students(old.user.id)).toHaveLength(2);
    const fresh = await register();
    expect(fresh.user.id).not.toBe(old.user.id);
    expect(store.students(fresh.user.id)).toEqual([]);
    expect(count('legacy_owners')).toBe(1);
    expect(
      (
        await mobile(
          'session/login',
          credentials('legacy_admin', 'old-long-family-password'),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await web(
          'login',
          credentials('legacy_admin', 'old-long-family-password'),
        )
      ).status,
    ).toBe(200);
  });

  it('isolates students, originals, review and web sync between two newly registered families', async () => {
    const a = await register('family_a'),
      b = await register('family_b');
    const aHeaders = { Authorization: 'Bearer ' + a.token },
      bHeaders = { Authorization: 'Bearer ' + b.token };
    const response = await mobile('students', { name: '合成学生' }, aHeaders);
    const student = ((await response.json()) as { student: { id: string } })
      .student;
    const id = randomUUID(),
      bytes = new Uint8Array([1, 2, 3]);
    await saveScan(
      a.user.id,
      {
        id,
        studentId: student.id,
        subject: '数学',
        source: '合成',
        originalName: 'test.png',
        mimeType: 'image/png',
        size: 3,
        status: 'needs_review',
        createdAt: new Date().toISOString(),
        fileUrl: '',
        revision: 0,
      },
      bytes,
      store,
    );
    expect(
      (await mobile('scans/' + id + '/file', undefined, aHeaders)).status,
    ).toBe(200);
    for (const path of [
      'scans/' + id,
      'scans/' + id + '/file',
      'scans?studentId=' + student.id,
    ])
      expect((await mobile(path, undefined, bHeaders)).status).toBe(404);
    expect(
      (
        await mobile(
          'scans/' + id + '/review',
          { revision: 0, questions: [] },
          bHeaders,
          store,
          'PUT',
        )
      ).status,
    ).toBe(404);
    expect(
      await (await mobile('students', undefined, bHeaders)).json(),
    ).toEqual({ students: [] });
    const records = emptyFamily();
    records.dabao.completed = ['synthetic-a'];
    store.merge(a.user.id, records);
    const loginB = await web('login', credentials('family_b'));
    const cookie = loginB.headers.get('set-cookie')!.split(';')[0];
    expect(await (await web('sync', undefined, cookie)).json()).toMatchObject({
      records: emptyFamily(),
    });
  });

  it('handles simultaneous normalized duplicates across database connections atomically', async () => {
    const second = new FamilyStore(join(directory, 'family.sqlite'));
    try {
      const replies = await Promise.all([
        mobile('session/register', credentials(' Duplicate ')),
        mobile('session/register', credentials('duplicate'), {}, second),
      ]);
      expect(replies.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      expect(await replies.find((r) => r.status === 409)!.json()).toEqual({
        error: '账号已存在，请登录或换一个账号',
        code: 'USERNAME_TAKEN',
      });
      expect(count('accounts')).toBe(1);
      expect(count('mobile_sessions')).toBe(1);
      expect(count('legacy_owners')).toBe(0);
    } finally {
      second.close();
    }
  });

  it('enforces password bounds, username shape and device name without leaking inputs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = [
      credentials('valid', '12345'),
      credentials('valid', 'x'.repeat(129)),
      credentials('含中文'),
      { username: 'valid', password: 123456 },
      { ...credentials(), deviceName: ['invalid'] },
    ];
    for (let i = 0; i < bad.length; i++) {
      const response = await mobile('session/register', bad[i], {
        'X-Real-IP': `192.0.2.${i + 1}`,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'INVALID_INPUT' });
    }
    expect(count('accounts')).toBe(0);
    expect(log).not.toHaveBeenCalled();
    const maximum = await register('maximum', 'x'.repeat(128));
    expect(maximum.token).toBeTruthy();
    expect(
      (await mobile('session/login', credentials('maximum', 'x'.repeat(128))))
        .status,
    ).toBe(200);
  });

  it('rejects cross-origin writes and wrong methods before rate-limit/account writes', async () => {
    expect(
      (
        await mobile('session/register', credentials(), {
          Origin: 'https://localhost.evil.example',
        })
      ).status,
    ).toBe(403);
    expect((await mobile('session/register')).status).toBe(405);
    expect(count('limits')).toBe(0);
    expect(count('accounts')).toBe(0);
    const preflight = await mobile(
      'session/register',
      undefined,
      {},
      store,
      'OPTIONS',
    );
    expect(preflight.status).toBe(204);
  });

  it('limits registration by trusted proxy address and ignores forwarded-for spoofing', async () => {
    for (let i = 0; i < 5; i++)
      expect(
        (
          await mobile('session/register', credentials('valid', 'short'), {
            'X-Real-IP': '192.0.2.1',
            'X-Forwarded-For': `198.51.100.${i}`,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await mobile('session/register', credentials(), {
          'X-Real-IP': '192.0.2.1',
          'X-Forwarded-For': '203.0.113.1',
        })
      ).status,
    ).toBe(429);
    expect(
      (
        await mobile('session/register', credentials(), {
          'X-Real-IP': '192.0.2.2',
        })
      ).status,
    ).toBe(200);
    expect(
      JSON.stringify(store.db.prepare('SELECT key FROM limits').all()),
    ).not.toContain('192.0.2.1');
  });

  it('does not trust address headers when proxy trust is disabled', async () => {
    vi.stubEnv('FAMILY_TRUST_PROXY', 'false');
    for (let i = 0; i < 5; i++)
      expect(
        (
          await mobile('session/register', credentials('valid', 'short'), {
            'X-Real-IP': `192.0.2.${i}`,
            'X-Forwarded-For': `198.51.100.${i}`,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await mobile('session/register', credentials(), {
          'X-Real-IP': '203.0.113.9',
        })
      ).status,
    ).toBe(429);
  });

  it('also limits aggregate registration attempts across addresses and account guessing across login/register', async () => {
    for (let i = 0; i < 30; i++)
      expect(
        (
          await mobile('session/register', credentials('valid', 'short'), {
            'X-Real-IP': `192.0.2.${i + 1}`,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await mobile('session/register', credentials(), {
          'X-Real-IP': '203.0.113.1',
        })
      ).status,
    ).toBe(429);
    store.db.prepare('DELETE FROM limits').run();
    await register('limited');
    for (let i = 0; i < 8; i++)
      expect(
        (await mobile('session/login', credentials('limited', 'wrong!')))
          .status,
      ).toBe(401);
    expect(
      (
        await mobile('session/register', credentials('limited'), {
          'X-Real-IP': '203.0.113.2',
        })
      ).status,
    ).toBe(429);
  });

  it('rolls back the account if session creation fails and never logs credentials', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.db.exec(
      "CREATE TRIGGER session_failure BEFORE INSERT ON mobile_sessions BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
    );
    expect((await mobile('session/register', credentials())).status).toBe(500);
    expect(count('accounts')).toBe(0);
    expect(count('legacy_owners')).toBe(0);
    expect(count('mobile_sessions')).toBe(0);
    expect(JSON.stringify(log.mock.calls)).not.toContain('123456');
    expect(JSON.stringify(log.mock.calls)).not.toContain(activation);
  });

  it('accepts a six-character web password change and invalidates old web and mobile sessions', async () => {
    const created = await register('changing', 'existing-long-password');
    const login = await web(
      'login',
      credentials('changing', 'existing-long-password'),
    );
    const oldCookie = login.headers.get('set-cookie')!.split(';')[0];
    const changed = await web(
      'password',
      { currentPassword: 'existing-long-password', password: '654321' },
      oldCookie,
    );
    expect(changed.status).toBe(200);
    expect(
      (
        await mobile('session', undefined, {
          Authorization: 'Bearer ' + created.token,
        })
      ).status,
    ).toBe(401);
    expect((await web('sync', undefined, oldCookie)).status).toBe(401);
    expect((await web('login', credentials('changing', '654321'))).status).toBe(
      200,
    );
    expect(
      (await mobile('session/login', credentials('changing', '654321'))).status,
    ).toBe(200);
    expect(
      (
        await mobile(
          'session/login',
          credentials('changing', 'existing-long-password'),
        )
      ).status,
    ).toBe(401);
  });
});
