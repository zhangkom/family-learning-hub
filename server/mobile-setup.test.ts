import { CLOUD_PHOTO_CAPABILITY } from '../lib/cloud-photos';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { FamilyStore } from './family-store';
import { handleFamily } from './family-backend';
import { handleMobile } from './mobile-backend';

const site = 'https://family.example',
  password = 'synthetic-family-password',
  setupToken = 'synthetic-setup-token-'.repeat(3);
let directory: string, store: FamilyStore;
function request(path: string, body?: unknown, origin = 'https://localhost') {
  return new Request(site + '/family-learning/api/mobile/v1/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const details = (username = 'family') => ({ username, password, setupToken });
const mobile = (
  path: string,
  body?: unknown,
  origin?: string,
  connection = store,
) => handleMobile(request(path, body, origin), path.split('/'), connection);
const count = (table: string) =>
  Number(store.db.prepare('SELECT count(*) AS n FROM ' + table).get()?.n);
beforeEach(() => {
  mkdirSync('work', { recursive: true });
  directory = mkdtempSync(resolve('work/mobile-setup-test-'));
  store = new FamilyStore(join(directory, 'family.sqlite'));
  vi.stubEnv('FAMILY_DATA_DIR', directory);
  vi.stubEnv('FAMILY_SETUP_TOKEN', setupToken);
  vi.stubEnv('FAMILY_PUBLIC_ORIGIN', site);
  vi.stubEnv('FAMILY_MOBILE_ORIGINS', 'https://localhost');
  vi.stubEnv('FAMILY_REGISTRATION_ENABLED', 'false');
});
afterEach(() => {
  store.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (
    !resolve(directory).startsWith(resolve('work') + sep + 'mobile-setup-test-')
  )
    throw new Error('Unsafe fixture cleanup');
  rmSync(directory, { recursive: true, force: true });
});
describe('first-family setup from Android', () => {
  it('exposes only availability and setup state', async () => {
    const status = await mobile('setup');
    expect(status.status).toBe(200);
    expect(status.headers.get('cache-control')).toContain('no-store');
    expect(status.headers.get('access-control-allow-origin')).toBe(
      'https://localhost',
    );
    expect(await status.json()).toEqual({
      enabled: true,
      needsSetup: true,
      registrationEnabled: false,
      processedPhotoMetadataVersion: 1,
      cloudPhotos: CLOUD_PHOTO_CAPABILITY,
    });
    vi.stubEnv('FAMILY_DATA_DIR', '');
    const disabled = await handleMobile(request('setup'), ['setup']);
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toEqual({
      enabled: false,
      needsSetup: false,
      registrationEnabled: false,
    });
  });
  it('adopts legacy data and issues usable hashed Bearer credentials without a Cookie', async () => {
    const response = await mobile('session/setup', details(' Family_1 '));
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    const result = (await response.json()) as {
      token: string;
      user: { id: string; username: string };
      expiresAt: string;
    };
    expect(Object.keys(result).sort()).toEqual(['expiresAt', 'token', 'user']);
    expect(result.user.username).toBe('family_1');
    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
    expect(
      store.db.prepare('SELECT token FROM mobile_sessions').get()?.token,
    ).toBe(createHash('sha256').update(result.token).digest('hex'));
    expect(count('sessions')).toBe(0);
    expect(
      store.db
        .prepare('SELECT owner FROM legacy_owners WHERE account_id=?')
        .get(result.user.id)?.owner,
    ).toBe('family');
    expect(
      store.db.prepare('SELECT password FROM accounts').get()?.password,
    ).not.toContain(password);
    const authenticated = await handleMobile(
      new Request(site + '/family-learning/api/mobile/v1/students', {
        headers: { Authorization: 'Bearer ' + result.token },
      }),
      ['students'],
      store,
    );
    expect(authenticated.status).toBe(200);
    expect(
      ((await authenticated.json()) as { students: unknown[] }).students,
    ).toHaveLength(2);
    expect(await (await mobile('setup')).json()).toEqual({
      enabled: true,
      needsSetup: false,
      registrationEnabled: false,
      processedPhotoMetadataVersion: 1,
      cloudPhotos: CLOUD_PHOTO_CAPABILITY,
    });
    expect((await mobile('session/setup', details('another'))).status).toBe(
      409,
    );
    const webLogin = await handleFamily(
      request('login', { username: 'family_1', password }, site),
      'login',
      store,
    );
    expect(webLogin.status).toBe(200);
    expect(webLogin.headers.get('set-cookie')).toContain('HttpOnly');
  });
  it('rejects wrong codes and invalid credentials without returning or logging secrets', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const [body, status] of [
      [{ ...details(), setupToken: 'private-wrong-code' }, 403],
      [{ ...details(), password: 'short' }, 400],
      [{ ...details(), username: '汉字账号' }, 400],
      [{ ...details(), username: 'a' }, 400],
    ] as const) {
      const response = await mobile('session/setup', body);
      expect(response.status).toBe(status);
      const text = await response.text();
      for (const secret of [setupToken, password, 'private-wrong-code'])
        expect(text).not.toContain(secret);
    }
    expect(log).not.toHaveBeenCalled();
    expect(count('accounts')).toBe(0);
  });
  it('rejects malicious origins before creation or rate-limit writes', async () => {
    expect(
      (await mobile('setup', undefined, 'https://evil.example')).status,
    ).toBe(403);
    expect(
      (
        await mobile(
          'session/setup',
          details(),
          'https://localhost.evil.example',
        )
      ).status,
    ).toBe(403);
    expect(count('accounts')).toBe(0);
    expect(count('limits')).toBe(0);
  });
  it('allows exactly one concurrent creation across website and mobile database connections', async () => {
    const second = new FamilyStore(join(directory, 'family.sqlite'));
    try {
      const responses = await Promise.all([
        mobile('session/setup', details('phone')),
        handleFamily(
          request('setup', details('browser'), site),
          'setup',
          second,
        ),
      ]);
      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      expect(count('accounts')).toBe(1);
      expect(count('legacy_owners')).toBe(1);
      expect(count('sessions') + count('mobile_sessions')).toBe(1);
    } finally {
      second.close();
    }
  });
  it('shares the website setup rate limit', async () => {
    for (let i = 0; i < 30; i++) {
      const body = { ...details('attempt_' + i), setupToken: 'incorrect' };
      const response =
        i % 2
          ? await mobile('session/setup', body)
          : await handleFamily(request('setup', body, site), 'setup', store);
      expect(response.status).toBe(403);
    }
    expect((await mobile('session/setup', details())).status).toBe(429);
    expect(count('accounts')).toBe(0);
  });
  it('rolls back account creation if storing its mobile session fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.db.exec(
      "CREATE TRIGGER session_failure BEFORE INSERT ON mobile_sessions BEGIN SELECT RAISE(ABORT,'simulated session storage failure'); END",
    );
    expect((await mobile('session/setup', details())).status).toBe(500);
    expect(count('accounts')).toBe(0);
    expect(count('legacy_owners')).toBe(0);
    expect(JSON.stringify(log.mock.calls)).not.toContain(password);
    expect(JSON.stringify(log.mock.calls)).not.toContain(setupToken);
  });
});
