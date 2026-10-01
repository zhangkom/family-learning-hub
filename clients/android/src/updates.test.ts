import { describe, expect, it, vi, afterEach } from 'vitest';
import { checkRelease, parseRelease } from './updates';
import { familyWebsite } from './release';
const valid = { channel: 'release', version: '0.3.0', versionCode: 5, bytes: 7000000,
  sha256: 'a'.repeat(64), downloadUrl: `${familyWebsite}downloads/android/family-learning-0.3.0-release-1234567.apk`,
  notes: '历史说明', changelog: '新的更新说明' };
afterEach(() => vi.unstubAllGlobals());
describe('public update metadata', () => {
  it('reads Android version code and current release notes', () => {
    expect(parseRelease(valid)).toMatchObject({ versionCode: 5, notes: '新的更新说明' });
  });
  it.each([
    { downloadUrl: 'https://evil.example/update.apk' },
    { downloadUrl: valid.downloadUrl.replace('https:', 'http:') },
    { downloadUrl: `${valid.downloadUrl}?token=private` },
    { downloadUrl: `${familyWebsite}downloads/android/latest.apk` },
    { downloadUrl: valid.downloadUrl.replace('123.207.232.151', '123.207.232.151.evil.example') },
    { sha256: 'bad' }, { bytes: 0 }, { bytes: 300000000 }, { versionCode: 1.5 },
    { versionCode: undefined }, { channel: 'debug' }, { version: 'invalid' },
  ])('rejects invalid or redirected package metadata %j', (change) => {
    expect(() => parseRelease({ ...valid, ...change })).toThrow();
  });
  it('never sends account credentials and refuses HTTP redirects', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => valid });
    vi.stubGlobal('fetch', fetch);
    await checkRelease();
    const options = fetch.mock.calls[0][1];
    expect(options).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error' });
    expect(options.headers).toBeUndefined();
  });
  it('surfaces a unavailable server instead of claiming already up to date', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(checkRelease()).rejects.toThrow('暂时无法检查更新');
  });
});
