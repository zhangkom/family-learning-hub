import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FamilyApi } from '../api';
import type { ImageScan } from './recovered-image';

const cache = vi.hoisted(() => ({ validate: vi.fn(), read: vi.fn(), save: vi.fn(), verify: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web' } }));
vi.mock('../hosted-web', () => ({ isHostedWeb: true }));
vi.mock('./index', () => ({ getOriginal: vi.fn(), readConfirmedUpload: vi.fn() }));
vi.mock('./recovered-image', () => ({ recoveredImages: cache }));
vi.mock('../question-images', () => ({ decodeQuestionImage: vi.fn(async () => ({ url: 'blob:synthetic' })) }));
import { loadReviewImage } from './review-image';
const scan = { id: 'scan-a', studentId: 'student-a', size: 3, mimeType: 'image/png', imageRevision: 2 } as ImageScan;
const file = new Blob(['abc'], { type: 'image/png' });
beforeEach(() => { vi.clearAllMocks(); cache.read.mockResolvedValue(undefined); cache.save.mockResolvedValue(undefined); });
describe('browser local-first question images', () => {
  it('uses the exact saved browser image without a server roundtrip', async () => {
    cache.read.mockResolvedValue(file); const image = vi.fn(), api = { image } as unknown as FamilyApi;
    expect(await loadReviewImage(api, 'site|family-a', scan, true, new AbortController().signal)).toEqual({ file, source: 'local' });
    expect(image).not.toHaveBeenCalled(); expect(cache.read).toHaveBeenCalledWith('site|family-a', scan, expect.any(AbortSignal));
  });
  it('automatically replaces a corrupt cache and persists verified downloaded bytes', async () => {
    cache.read.mockRejectedValue(new Error('cache corrupted')); const image = vi.fn().mockResolvedValue(file);
    expect(await loadReviewImage({ image } as unknown as FamilyApi, 'site|family-a', scan, true, new AbortController().signal)).toEqual({ file, source: 'local' });
    expect(image).toHaveBeenCalledWith(scan.id, expect.any(AbortSignal), undefined, 2);
    expect(cache.save).toHaveBeenCalledWith('site|family-a', scan, file, expect.any(AbortSignal));
  });
  it('honors local-only callers and reports failed recovery for the UI retry control', async () => {
    const image = vi.fn().mockRejectedValue(new TypeError('offline')), api = { image } as unknown as FamilyApi;
    await expect(loadReviewImage(api, 'site|family-a', scan, false, new AbortController().signal)).rejects.toThrow('尚未保存'); expect(image).not.toHaveBeenCalled();
    await expect(loadReviewImage(api, 'site|family-a', scan, true, new AbortController().signal)).rejects.toThrow('无法连接题图服务'); expect(cache.save).not.toHaveBeenCalled();
  });
});
