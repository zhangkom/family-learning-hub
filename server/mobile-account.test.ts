import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { FamilyStore } from './family-store';
import { handleMobile } from './mobile-backend';
import { handleFamily, hashPassword } from './family-backend';
import { emptyFamily } from '../lib/family-state';

let store: FamilyStore;
const origin = 'https://family.example';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const token = 'a'.repeat(64),
  otherToken = 'b'.repeat(64),
  cookieToken = 'c'.repeat(64);
function call(
  path: string,
  body?: unknown,
  bearer = token,
  method?: string,
  originValue = 'https://localhost',
) {
  return handleMobile(
    new Request(origin + '/family-learning/api/mobile/v1/' + path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: {
        Origin: originValue,
        Authorization: 'Bearer ' + bearer,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    path.split('/'),
    store,
  );
}
beforeEach(async () => {
  store = new FamilyStore(':memory:');
  vi.stubEnv('FAMILY_PUBLIC_ORIGIN', origin);
  vi.stubEnv('FAMILY_MOBILE_ORIGINS', 'https://localhost');
  const password = await hashPassword('123456');
  for (const [id, name, t] of [
    ['family-a', 'family_a', token],
    ['family-b', 'family_b', otherToken],
  ]) {
    store.db
      .prepare('INSERT INTO accounts VALUES (?,?,?,?)')
      .run(id, name, password, Date.now());
    store.db
      .prepare('INSERT INTO mobile_sessions VALUES (?,?,?,?,?)')
      .run(hash(t), id, Date.now() + 60000, 'test', Date.now());
  }
  store.db
    .prepare('INSERT INTO sessions VALUES (?,?,?)')
    .run(hash(cookieToken), 'family-a', Date.now() + 60000);
});
afterEach(() => {
  store.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('mobile account settings', () => {
  it('renames the login while preserving family ID, students, scan ownership and learning records', async () => {
    const student = store.addStudent('family-a', '合成孩子');
    const records = emptyFamily();
    store.merge('family-a', records);
    store.db
      .prepare('INSERT INTO legacy_owners VALUES (?,?)')
      .run('family-a', 'family');
    const students = store.students('family-a');
    store.db.prepare('INSERT INTO scan_documents VALUES (?,?,?)').run(
      'family',
      'synthetic-scan',
      JSON.stringify({
        studentId: student.id,
        originalName: 'synthetic.png',
      }),
    );
    const scan = store.db.prepare('SELECT * FROM scan_documents').all();
    const response = await call('account/username', {
      username: ' New_Name ',
      currentPassword: '123456',
      accountId: 'family-b',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toContain('no-store');
    const changed = (await response.json()) as {
      token: string;
      user: { id: string; username: string };
    };
    expect(changed.user).toEqual({ id: 'family-a', username: 'new_name' });
    expect(changed.token).toMatch(/^[a-f0-9]{64}$/);
    expect(changed.token).not.toBe(token);
    expect((await call('session', undefined, changed.token)).status).toBe(200);
    expect((await call('session')).status).toBe(401);
    expect(
      store.db
        .prepare('SELECT * FROM sessions WHERE account_id=?')
        .all('family-a'),
    ).toHaveLength(0);
    expect(store.scanOwner('family-a')).toBe('family');
    expect(store.students('family-a')).toEqual(students);
    expect(store.read('family-a')).toEqual(records);
    expect(store.db.prepare('SELECT * FROM scan_documents').all()).toEqual(
      scan,
    );
    expect(
      (
        await call('session/login', {
          username: 'family_a',
          password: '123456',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call('session/login', {
          username: 'new_name',
          password: '123456',
        })
      ).status,
    ).toBe(200);
    expect((await call('session', undefined, otherToken)).status).toBe(200);
  });

  it('changes a six-character password, revokes all own old sessions and retains another family', async () => {
    store.db
      .prepare('INSERT INTO mobile_sessions VALUES (?,?,?,?,?)')
      .run(
        hash('d'.repeat(64)),
        'family-a',
        Date.now() + 60000,
        'other phone',
        Date.now(),
      );
    const response = await call('account/password', {
      currentPassword: '123456',
      password: '654321',
    });
    expect(response.status).toBe(200);
    const changed = (await response.json()) as {
      token: string;
      user: { id: string; username: string };
    };
    expect(changed.user).toEqual({ id: 'family-a', username: 'family_a' });
    expect((await call('session', undefined, changed.token)).status).toBe(200);
    expect((await call('session', undefined, 'd'.repeat(64))).status).toBe(401);
    expect(
      (
        await call('session/login', {
          username: 'family_a',
          password: '123456',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call('session/login', {
          username: 'family_a',
          password: '654321',
        })
      ).status,
    ).toBe(200);
    const webLogin = await handleFamily(
      new Request(origin, {
        method: 'POST',
        headers: { Origin: origin },
        body: JSON.stringify({ username: 'family_a', password: '654321' }),
      }),
      'login',
      store,
    );
    expect(webLogin.status).toBe(200);
    expect((await call('session', undefined, otherToken)).status).toBe(200);
  });

  it('keeps sessions and credentials after a wrong current password or a username collision', async () => {
    const before = store.db.prepare('SELECT * FROM accounts ORDER BY id').all();
    const wrong = await call('account/password', {
      currentPassword: 'wrongpass',
      password: '654321',
    });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({
      code: 'INVALID_CURRENT_PASSWORD',
    });
    const duplicate = await call('account/username', {
      currentPassword: '123456',
      username: ' FAMILY_B ',
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: 'USERNAME_TAKEN' });
    expect(
      store.db.prepare('SELECT * FROM accounts ORDER BY id').all(),
    ).toEqual(before);
    expect((await call('session')).status).toBe(200);
    expect(store.db.prepare('SELECT * FROM sessions').all()).toHaveLength(1);
  });

  it('rejects unauthenticated, forged Cookie, disallowed origin and wrong-method changes', async () => {
    const body = { currentPassword: '123456', username: 'new_name' };
    expect((await call('account/username', body, '')).status).toBe(401);
    expect(
      (
        await call(
          'account/username',
          body,
          token,
          undefined,
          'https://evil.example',
        )
      ).status,
    ).toBe(403);
    expect(
      (await call('account/username', undefined, token, 'GET')).status,
    ).toBe(405);
    const cookieOnly = new Request(origin, {
      method: 'POST',
      headers: { Cookie: 'family_session=' + cookieToken },
      body: JSON.stringify(body),
    });
    expect(
      (await handleMobile(cookieOnly, ['account', 'username'], store)).status,
    ).toBe(401);
    expect(
      (await call('account/username', { ...body, extra: 'x'.repeat(8192) }))
        .status,
    ).toBe(413);
  });

  it('validates fields without accepting another account ID and shares a per-account attempt limit', async () => {
    for (const username of ['ab', '有空格', 'a'.repeat(33), ['valid']])
      expect(
        (
          await call('account/username', {
            currentPassword: '123456',
            username,
          })
        ).status,
      ).toBe(400);
    for (const password of ['12345', 'a'.repeat(129), 123456, null])
      expect(
        (
          await call('account/password', {
            currentPassword: '123456',
            password,
          })
        ).status,
      ).toBe(400);
    const limited = await call('account/password', {
      currentPassword: '123456',
      password: '654321',
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(
      (
        await call(
          'account/username',
          { currentPassword: '123456', username: 'other_name' },
          otherToken,
        )
      ).status,
    ).toBe(200);
  });

  it('allows only one of concurrent changes made with the same old credentials', async () => {
    const results = await Promise.all([
      call('account/password', {
        currentPassword: '123456',
        password: 'newpass1',
      }),
      call('account/password', {
        currentPassword: '123456',
        password: 'newpass2',
      }),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 401,
    ]);
    expect(
      store.db
        .prepare('SELECT * FROM mobile_sessions WHERE account_id=?')
        .all('family-a'),
    ).toHaveLength(1);
  });

  it('arbitrates concurrent username collisions without changing the losing family', async () => {
    const results = await Promise.all([
      call('account/username', {
        currentPassword: '123456',
        username: 'shared_name',
      }),
      call(
        'account/username',
        { currentPassword: '123456', username: 'shared_name' },
        otherToken,
      ),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    expect(
      store.db
        .prepare('SELECT * FROM accounts WHERE username=?')
        .all('shared_name'),
    ).toHaveLength(1);
    const loser = results[0].status === 409 ? token : otherToken;
    expect((await call('session', undefined, loser)).status).toBe(200);
  });

  it('rejects a session revoked while a change is in flight', async () => {
    const pending = call('account/password', {
      currentPassword: '123456',
      password: '654321',
    });
    store.db
      .prepare('DELETE FROM mobile_sessions WHERE token=?')
      .run(hash(token));
    expect((await pending).status).toBe(401);
    expect(
      (
        await call('session/login', {
          username: 'family_a',
          password: '123456',
        })
      ).status,
    ).toBe(200);
  });

  it('rolls back the credential and session deletions if issuing a replacement token fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = store.db.prepare('SELECT * FROM accounts ORDER BY id').all();
    store.db.exec(
      "CREATE TRIGGER reject_session BEFORE INSERT ON mobile_sessions BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    const response = await call('account/username', {
      currentPassword: '123456',
      username: 'new_name',
    });
    expect(response.status).toBe(500);
    expect(
      store.db.prepare('SELECT * FROM accounts ORDER BY id').all(),
    ).toEqual(before);
    expect((await call('session')).status).toBe(200);
    expect(store.db.prepare('SELECT * FROM sessions').all()).toHaveLength(1);
  });
});
