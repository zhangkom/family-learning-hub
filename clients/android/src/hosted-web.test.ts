import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules(); vi.stubEnv('VITE_FAMILY_WEB', 'true'); vi.stubEnv('VITE_WEB_BASE_PATH', '/family-learning');
  vi.stubGlobal('window', { location: { origin: 'https://family.example' }, dispatchEvent: vi.fn() });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const base = 'https://family.example/family-learning/api/family/workspace';
describe('hosted browser credentials', () => {
  it('restores the HttpOnly cookie without reading the Android vault or browser credentials', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ user: { id: 'family-a', username: 'parent' }, capabilities: { admin: false } })); vi.stubGlobal('fetch', fetch);
    const vault = { read: vi.fn(), clear: vi.fn() };
    const { restoreSession } = await import('./restore-session');
    expect(await restoreSession(vault)).toMatchObject({ base, token: 'web-cookie', user: { id: 'family-a' }, capabilities: { admin: false } });
    expect(vault.read).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0]).toMatchObject([base + '/session', { credentials: 'same-origin', headers: {}, redirect: 'error' }]);
  });
  it('returns a guest for an absent cookie but retains a retriable server failure', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: '请登录' }, { status: 401 })).mockResolvedValueOnce(Response.json({ error: '暂不可用' }, { status: 503 })); vi.stubGlobal('fetch', fetch);
    const { restoreSession } = await import('./restore-session');
    expect(await restoreSession()).toBeNull(); await expect(restoreSession()).rejects.toMatchObject({ status: 503 });
  });
  it('uses cookies for JSON, source images and Word, never sends the state marker as bearer', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ user: { id: 'a', username: 'parent' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0x50,0x4b,3,4]), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } })); vi.stubGlobal('fetch', fetch);
    const { FamilyApi } = await import('./api'); const api = new FamilyApi(base, 'web-cookie');
    expect((await api.login('parent','synthetic-only')).token).toBe('web-cookie');
    await api.image('s');
    const { readWorksheetBlob } = await import('./worksheet-save');
    await readWorksheetBlob(api, { studentId: 'a', selections: [], includeAnswers: false }, new AbortController().signal);
    for (const [, init] of fetch.mock.calls) { expect(init.credentials).toBe('same-origin'); expect(init.headers).not.toHaveProperty('Authorization'); }
  });
  it('rejects foreign-origin credentials and never fetches them', async () => {
    const { apiAuthentication } = await import('./hosted-web');
    for (const target of ['https://evil.example/api', base + '?x=1', base + '/']) expect(() => apiAuthentication(target, 'anything')).toThrow('本站');
  });
});
