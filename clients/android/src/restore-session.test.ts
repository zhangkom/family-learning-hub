import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { restoreSession } from './restore-session';

const stored = { base: 'https://example.test/api', token: 'synthetic-token' };
function vault(value = JSON.stringify(stored)) {
  return { read: vi.fn(async () => value), clear: vi.fn(async () => {}) };
}
describe('restoring a saved login', () => {
  it('keeps the token on network and server failures so retry can recover', async () => {
    for (const failure of [new TypeError('Failed to fetch'), new ApiError('Unavailable', 503), new ApiError('Origin denied', 403)]) {
      const store = vault();
      await expect(restoreSession(store, async () => { throw failure; })).rejects.toBe(failure);
      expect(store.clear).not.toHaveBeenCalled();
      const user = { id: 'server-family', username: 'test-family' };
      expect(await restoreSession(store, async () => ({ user }))).toEqual({ ...stored, user });
    }
  });
  it('clears an expired or revoked token', async () => {
    const store = vault();
    await expect(restoreSession(store, async () => { throw new ApiError('Expired', 401); })).rejects.toMatchObject({ status: 401 });
    expect(store.clear).toHaveBeenCalledOnce();
  });
  it('rejects corrupt or unsafe saved credentials before making a request', async () => {
    for (const input of ['{broken', JSON.stringify({ ...stored, token: '' }), JSON.stringify({ ...stored, base: 'https://user:password@example.test/api' })]) {
      const store = vault(input), lookup = vi.fn();
      await expect(restoreSession(store, lookup)).rejects.toMatchObject({ status: 401 });
      expect(lookup).not.toHaveBeenCalled();
      expect(store.clear).toHaveBeenCalledOnce();
    }
  });
});
