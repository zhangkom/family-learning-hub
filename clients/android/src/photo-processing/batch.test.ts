import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ native: {
  pickOriginalBatch: vi.fn(), getOriginalBatch: vi.fn(), listOriginalBatches: vi.fn(), importBatchItem: vi.fn(),
  cancelOriginalBatch: vi.fn(), forgetOriginalBatch: vi.fn(), getOriginal: vi.fn(), downloadCloudOriginal: vi.fn(), cancelCloudOriginalDownload: vi.fn(),
} }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => mocks.native, Capacitor: {
  getPlatform: () => 'android', isPluginAvailable: () => true, convertFileSrc: (value: string) => `https://localhost/${value}`,
} }));
import { cancelOriginalBatch, downloadCloudOriginal, forgetOriginalBatch, listOriginalBatches, pickOriginals, readCloudOriginalUpload, resumeOriginalBatch,
  type CloudOriginalDownloadOptions, type NativePhotoBatch, type OriginalPhoto } from './index';
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const original = (n: number): OriginalPhoto => ({ schemaVersion: 1, originalId: id(n), studentId: 'student', bytes: 4, sha256: 'a'.repeat(64),
  mime: 'image/png', width: 100, height: 100, uprightWidth: 100, uprightHeight: 100, orientation: 1,
  createdAt: 1, originalUri: `file:///private/${id(n)}/original`, previewUri: `file:///private/${id(n)}/preview.jpg` });
let state: NativePhotoBatch;
beforeEach(() => {
  vi.resetAllMocks(); vi.unstubAllGlobals();
  state = { schemaVersion: 1, batchId: id(999), studentId: 'student', purpose: 'processed', state: 'ready', limit: 100, createdAt: 1,
    items: Array.from({ length: 100 }, (_, i) => ({ index: i, originalId: id(i), status: 'pending' })) };
  mocks.native.pickOriginalBatch.mockImplementation(async ({ limit }: { limit: number }) => { state.limit = Math.max(state.limit, limit); return structuredClone(state); });
  mocks.native.getOriginalBatch.mockImplementation(async () => structuredClone(state));
  mocks.native.cancelOriginalBatch.mockImplementation(async () => { state.state = 'cancelled'; return structuredClone(state); });
  mocks.native.importBatchItem.mockImplementation(async ({ index }: { index: number }) => {
    state.items[index].status = 'imported'; if (state.items.every(item => item.status === 'imported')) state.state = 'completed';
    return { batch: structuredClone(state), original: original(index) };
  });
  mocks.native.getOriginal.mockImplementation(async ({ originalId }: { originalId: string }) => original(Number(originalId.slice(-12))));
});
describe('durable sequential original batches', () => {
  it('imports and recovers all 450 cloud originals without applying the upload group size to selection', async () => {
    state.purpose = 'cloud-original'; state.limit = 450;
    state.items = Array.from({ length: 450 }, (_, i) => ({ index: i, originalId: id(i), status: 'pending' }));
    const result = await pickOriginals('owner', 'student', 200, { purpose: 'cloud-original' });
    expect(result.originals).toHaveLength(450); expect(result.failures).toEqual([]);
    expect(mocks.native.importBatchItem).toHaveBeenLastCalledWith({ owner: 'owner', studentId: 'student', batchId: state.batchId, index: 449 });
    mocks.native.importBatchItem.mockClear();
    const restored = await resumeOriginalBatch('owner', 'student', state.batchId, { purpose: 'cloud-original' });
    expect(restored.originals).toHaveLength(450); expect(mocks.native.importBatchItem).not.toHaveBeenCalled();
  });
  it('imports 100 metadata references with maximum concurrency one and no image reads', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    let active = 0, maximum = 0; const importer = mocks.native.importBatchItem.getMockImplementation()!;
    mocks.native.importBatchItem.mockImplementation(async (...args) => {
      active++; maximum = Math.max(maximum, active); await Promise.resolve();
      const result = await importer(...args); active--; return result;
    });
    const result = await pickOriginals('owner', 'student');
    expect(result.originals).toHaveLength(100); expect(result.failures).toEqual([]); expect(maximum).toBe(1);
    expect(fetcher).not.toHaveBeenCalled(); expect(mocks.native.forgetOriginalBatch).not.toHaveBeenCalled();
  });
  it('passes gallery range mode and rejects conflicting picker modes before opening a picker', async () => {
    await expect(pickOriginals('owner', 'student', 200, { folderRange: true, albumRange: true })).rejects.toThrow('一种相册');
    expect(mocks.native.pickOriginalBatch).not.toHaveBeenCalled();
    await pickOriginals('owner', 'student', 200, { albumRange: true });
    expect(mocks.native.pickOriginalBatch).toHaveBeenCalledWith({ owner: 'owner', studentId: 'student', limit: 200, purpose: 'processed', albumRange: true });
  });
  it.each([0, 2147483648, 1.5])('rejects invalid group parameter %s before picker', async limit => {
    await expect(pickOriginals('owner', 'student', limit)).rejects.toThrow('分组参数'); expect(mocks.native.pickOriginalBatch).not.toHaveBeenCalled();
  });
  it('imports all 450 processed photos selected by folder range and recovers without truncating', async () => {
    state.limit = 450; state.items = Array.from({ length: 450 }, (_, i) => ({ index: i, originalId: id(i), status: 'pending' }));
    const result = await pickOriginals('owner', 'student', 200, { folderRange: true });
    expect(mocks.native.pickOriginalBatch).toHaveBeenCalledWith({ owner: 'owner', studentId: 'student', limit: 200, purpose: 'processed', folderRange: true });
    expect(result.originals).toHaveLength(450); expect(result.failures).toEqual([]);
    expect((await resumeOriginalBatch('owner', 'student', state.batchId)).originals).toHaveLength(450);
  });
  it('reports one failed image and continues, while keeping completed originals for retry/recovery', async () => {
    const importer = mocks.native.importBatchItem.getMockImplementation()!;
    mocks.native.importBatchItem.mockImplementation(async (input: { index: number }) => {
      if (input.index !== 4) return importer(input);
      state.items[4].status = 'failed'; state.items[4].error = 'source unavailable'; return { batch: structuredClone(state) };
    });
    const result = await pickOriginals('owner', 'student');
    expect(result.originals).toHaveLength(99); expect(result.failures).toEqual([{ index: 4, originalId: id(4), message: 'source unavailable' }]);
    mocks.native.importBatchItem.mockImplementation(importer); mocks.native.getOriginal.mockClear();
    const restored = await resumeOriginalBatch('owner', 'student', state.batchId);
    expect(restored.originals).toHaveLength(100); expect(mocks.native.getOriginal).toHaveBeenCalledTimes(99);
    expect(state.state).toBe('completed');
  });
  it('recovers every completed item after a lost result without reimporting; only explicit ack removes batch', async () => {
    state.state = 'completed'; state.items.forEach(item => { item.status = 'imported'; });
    const result = await resumeOriginalBatch('owner', 'student', state.batchId);
    expect(result.originals).toHaveLength(100); expect(mocks.native.importBatchItem).not.toHaveBeenCalled();
    await forgetOriginalBatch('owner', 'student', state.batchId);
    expect(mocks.native.forgetOriginalBatch).toHaveBeenCalledWith({ owner: 'owner', studentId: 'student', batchId: state.batchId });
  });
  it('stops after the in-flight item on cancellation and preserves that original', async () => {
    const abort = new AbortController();
    const result = await pickOriginals('owner', 'student', 100, { signal: abort.signal, onProgress: batch => {
      if (batch.items[0].status === 'imported') abort.abort();
    } });
    expect(result.cancelled).toBe(true); expect(result.originals).toHaveLength(1);
    expect(mocks.native.importBatchItem).toHaveBeenCalledTimes(1); expect(state.state).toBe('ready');
    expect(mocks.native.cancelOriginalBatch).not.toHaveBeenCalled(); expect(result.selectedCount).toBe(100);
    const resumed = await resumeOriginalBatch('owner', 'student', state.batchId);
    expect(resumed.originals).toHaveLength(100); expect(state.state).toBe('completed');
  });
  it('returns picker cancellation without importing and can recover saved originals from a cancelled batch', async () => {
    state.state = 'cancelled'; state.items = [];
    expect(await pickOriginals('owner', 'student')).toMatchObject({ cancelled: true, originals: [], failures: [] });
    expect(mocks.native.importBatchItem).not.toHaveBeenCalled();
    await cancelOriginalBatch('owner', 'student', state.batchId);
  });
  it('enforces student and purpose boundaries before import or returning a list', async () => {
    await expect(resumeOriginalBatch('owner', 'other', state.batchId)).rejects.toThrow('归属');
    await expect(resumeOriginalBatch('owner', 'student', state.batchId, { purpose: 'cloud-original' })).rejects.toThrow('用途');
    mocks.native.listOriginalBatches.mockResolvedValue({ batches: [state] });
    await expect(listOriginalBatches('owner', 'student', 'cloud-original')).rejects.toThrow('用途');
    expect(mocks.native.importBatchItem).not.toHaveBeenCalled();
  });
  it('does not relabel a pending system selector as an empty success', async () => {
    state.state = 'selecting'; state.items = [];
    await expect(resumeOriginalBatch('owner', 'student', state.batchId)).rejects.toThrow('尚未返回');
  });
  it('reads one cloud original byte-identically, checks native student/hash, and omits legacy scan eligibility', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    const photo = { ...original(0), sha256 }; mocks.native.getOriginal.mockResolvedValue(photo);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
    const result = await readCloudOriginalUpload('owner', photo);
    expect(result).not.toHaveProperty('uploadEligibility'); expect(new Uint8Array(await result.file.arrayBuffer())).toEqual(bytes);
    mocks.native.getOriginal.mockResolvedValue({ ...photo, studentId: 'other' });
    await expect(readCloudOriginalUpload('owner', photo)).rejects.toThrow('归属');
  });
});
describe('native cloud save bridge', () => {
  const options: CloudOriginalDownloadOptions = { base: 'https://123.207.232.151/family-learning/api/mobile/v1', token: 'test-only-token',
    path: `/cloud-photos/${id(1)}/file`, name: '图.png', bytes: 4, sha256: 'a'.repeat(64), mime: 'image/png' };
  it('requires explicit native saved=true and does not mark picker cancellation successful', async () => {
    mocks.native.downloadCloudOriginal.mockResolvedValue({ saved: false, cancelled: true });
    expect(await downloadCloudOriginal(options)).toEqual({ saved: false, cancelled: true });
    mocks.native.downloadCloudOriginal.mockResolvedValue({ saved: true, cancelled: false });
    expect((await downloadCloudOriginal(options)).saved).toBe(true);
    expect(mocks.native.downloadCloudOriginal.mock.calls[0][0]).toMatchObject({ ...options, requestId: expect.any(String) });
  });
  it.each([
    { base: 'https://evil.test/family-learning/api/mobile/v1' }, { base: `${options.base}?token=x` },
    { path: '/cloud-photos/../session/file' }, { path: `${options.path}?token=x` }, { bytes: 33554433 }, { token: 'bad\r\nHeader' },
  ])('rejects unsafe transport before sending credentials: %j', async override => {
    await expect(downloadCloudOriginal({ ...options, ...override })).rejects.toThrow(); expect(mocks.native.downloadCloudOriginal).not.toHaveBeenCalled();
  });
  it('cancels only this native request ID and never sends bytes through the bridge', async () => {
    const abort = new AbortController(); let complete!: (value: { saved: boolean; cancelled: boolean }) => void;
    mocks.native.downloadCloudOriginal.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    mocks.native.cancelCloudOriginalDownload.mockResolvedValue(undefined);
    const pending = downloadCloudOriginal(options, abort.signal); abort.abort();
    expect(mocks.native.cancelCloudOriginalDownload).toHaveBeenCalledWith({ requestId: mocks.native.downloadCloudOriginal.mock.calls[0][0].requestId });
    complete({ saved: false, cancelled: true }); expect((await pending).cancelled).toBe(true);
  });
});
