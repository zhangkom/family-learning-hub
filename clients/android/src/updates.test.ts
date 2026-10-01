import { describe, expect, it, vi, afterEach } from 'vitest';
import { checkRelease, parseRelease, eligibleDelta } from './updates';
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

describe('optional delta metadata', () => {
  const delta = { format: 'zai-copy-v1', fromVersionCode: 7, baseBytes: 7000000, baseSha256: 'b'.repeat(64),
    bytes: 200000, sha256: 'c'.repeat(64), downloadUrl: `${familyWebsite}downloads/android/family-learning-7-to-8-${'c'.repeat(16)}.zaidelta.gz` };
  const manifest = { ...valid, versionCode: 8, deltas: [delta] };
  it('offers a compatible baseline and preserves full APK fallback', () => {
    const parsed = parseRelease(manifest);
    expect(eligibleDelta(parsed, 7)).toEqual(delta);
    expect(eligibleDelta(parsed, 6)).toBeUndefined();
    expect(parsed.downloadUrl).toBe(valid.downloadUrl);
  });
  it.each([
    { format: 'unknown' }, { fromVersionCode: 6 }, { fromVersionCode: 8 }, { baseBytes: 0 },
    { baseBytes: 300000000 }, { baseSha256: 'bad' }, { bytes: 6000000 }, { bytes: -1 },
    { sha256: 'bad' }, { downloadUrl: 'https://evil.example/patch.gz' },
    { downloadUrl: `${delta.downloadUrl}?token=abc` }, { downloadUrl: delta.downloadUrl.replace('-to-8-', '-to-9-') },
  ])('ignores incompatible delta while retaining verified full metadata %j', (change) => {
    expect(parseRelease({ ...manifest, deltas: [{ ...delta, ...change }] }).deltas).toEqual([]);
  });
  it('bounds metadata entries and ignores malformed objects', () => {
    expect(parseRelease({ ...manifest, deltas: Array(5).fill(delta) }).deltas).toEqual([]);
    expect(parseRelease({ ...manifest, deltas: [null, 'garbage', {}] }).deltas).toEqual([]);
  });
});
