import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleFamily, type FamilyAction } from './family-backend';
import { FamilyStore } from './family-store';
import { emptyFamily } from '../lib/family-state';

let store: FamilyStore;
const origin = 'https://family.example';
const password = 'a-family-password-123';
function call(
  action: FamilyAction,
  body?: unknown,
  cookie = '',
  requestOrigin = origin,
) {
  return handleFamily(
    new Request(`${origin}/family-learning/api/family/${action}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        origin: requestOrigin,
        cookie,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    action,
    store,
  );
}
async function setup() {
  const response = await call('setup', {
    username: 'family',
    password,
    setupToken: 's'.repeat(48),
  });
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie')!.split(';')[0];
}
beforeEach(() => {
  store = new FamilyStore(':memory:');
  vi.stubEnv('FAMILY_SETUP_TOKEN', 's'.repeat(48));
  vi.stubEnv('FAMILY_PUBLIC_ORIGIN', origin);
});
afterEach(() => {
  store.close();
  vi.unstubAllEnvs();
});

describe('private family API', () => {
  it('requires the private activation code, only creates one account, and hashes credentials', async () => {
    expect(
      (
        await call('setup', {
          username: 'family',
          password,
          setupToken: 'wrong',
        })
      ).status,
    ).toBe(403);
    const cookie = await setup();
    expect(
      (
        await call('setup', {
          username: 'another',
          password,
          setupToken: 's'.repeat(48),
        })
      ).status,
    ).toBe(409);
    const row = store.db.prepare('SELECT password FROM accounts').get()!;
    expect(row.password).not.toContain(password);
    expect(
      store.db.prepare('SELECT token FROM sessions').get()?.token,
    ).not.toBe(cookie.split('=')[1]);
    const session = await call('session', undefined, cookie);
    expect(session.headers.get('cache-control')).toContain('no-store');
    expect(await session.json()).toMatchObject({
      user: { username: 'family' },
      needsSetup: false,
    });
  });
  it('rejects unauthenticated reads, forged platform headers and cross-origin writes', async () => {
    expect((await call('sync')).status).toBe(401);
    const cookie = await setup();
    expect(
      (
        await call(
          'sync',
          { records: emptyFamily() },
          cookie,
          'https://evil.example',
        )
      ).status,
    ).toBe(403);
    const forged = new Request(`${origin}/family-learning/api/family/sync`, {
      headers: {
        'oai-authenticated-user-id': 'family',
        'oai-authenticated-user-email': 'fake@example.com',
      },
    });
    expect((await handleFamily(forged, 'sync', store)).status).toBe(401);
  });
  it('uses the authenticated account, merges two sessions, and isolates other households', async () => {
    const a = await setup();
    const login = await call('login', { username: 'family', password });
    const b = login.headers.get('set-cookie')!.split(';')[0];
    const first = emptyFamily();
    first.xiaobao.completed = ['sheet-a'];
    const second = emptyFamily();
    second.dabao.completed = ['sheet-b'];
    await call('sync', { records: first, accountId: 'other' }, a);
    const response = await call('sync', { records: second }, b);
    expect(await response.json()).toMatchObject({
      records: {
        xiaobao: { completed: ['sheet-a'] },
        dabao: { completed: ['sheet-b'] },
      },
    });
    expect(store.read('other')).toEqual(emptyFamily());
    const account = store.db.prepare('SELECT * FROM accounts LIMIT 1').get()!;
    store.db
      .prepare('INSERT INTO accounts VALUES (?,?,?,?)')
      .run('other', 'other', account.password, Date.now());
    const other = await call('login', { username: 'other', password });
    const response2 = await call(
      'sync',
      undefined,
      other.headers.get('set-cookie')!.split(';')[0],
    );
    expect(await response2.json()).toMatchObject({ records: emptyFamily() });
  });
  it('does not save invalid imports and limits unauthenticated password guessing', async () => {
    const cookie = await setup();
    expect(
      (await call('sync', { records: { xiaobao: {} } }, cookie)).status,
    ).toBe(400);
    for (let i = 0; i < 8; i++)
      await call('login', { username: 'unknown', password });
    expect(
      (await call('login', { username: 'unknown', password })).status,
    ).toBe(429);
  });
  it('revokes old sessions on password change and expires logout cookies', async () => {
    const cookie = await setup();
    const updated = await call(
      'password',
      { currentPassword: password, password: 'replacement-password-456' },
      cookie,
    );
    expect(updated.status).toBe(200);
    expect((await call('sync', undefined, cookie)).status).toBe(401);
    const next = updated.headers.get('set-cookie')!.split(';')[0];
    expect((await call('sync', undefined, next)).status).toBe(200);
    const logout = await call('logout', {}, next);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await call('sync', undefined, next)).status).toBe(401);
  });
  it('rejects expired sessions even if the browser still holds a cookie', async () => {
    const cookie = await setup();
    const token = createHash('sha256')
      .update(cookie.split('=')[1])
      .digest('hex');
    store.db.prepare('UPDATE sessions SET expires=0 WHERE token=?').run(token);
    expect((await call('sync', undefined, cookie)).status).toBe(401);
  });
  it('persists committed records across database reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'family-hub-test-'));
    const path = join(dir, 'state.sqlite');
    let disk: FamilyStore | undefined;
    try {
      disk = new FamilyStore(path);
      disk.db
        .prepare('INSERT INTO accounts VALUES (?,?,?,?)')
        .run('a', 'family', 'test-hash', Date.now());
      const data = emptyFamily();
      data.dabao.completed = ['saved'];
      disk.merge('a', data);
      disk.close();
      disk = new FamilyStore(path);
      expect(disk.read('a').dabao.completed).toEqual(['saved']);
    } finally {
      disk?.close();
      for (const suffix of ['', '-wal', '-shm'])
        if (existsSync(path + suffix)) unlinkSync(path + suffix);
      rmdirSync(dir);
    }
  });
});
