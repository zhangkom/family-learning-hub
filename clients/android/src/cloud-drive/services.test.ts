import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FamilyApi } from '../api';
import { createDriveServices } from './services';
import type { OriginalPhoto } from '../photo-processing';
import type { CloudPhoto } from './types';
const bridge = vi.hoisted(() => ({ pickOriginals: vi.fn(), readCloudOriginalUpload: vi.fn(), listOriginalBatches: vi.fn(), resumeOriginalBatch: vi.fn(), forgetOriginalBatch: vi.fn(), getOriginalBatch: vi.fn(), cancelOriginalBatch: vi.fn(), downloadCloudOriginal: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'android' } }));
vi.mock('../photo-processing', () => bridge);
const scope = { owner: 'family-a', studentId: 'student-a' }, signal = new AbortController().signal;
const original = { originalId: '11111111-1111-4111-8111-111111111111', originalName: 'IMG_20261002 作业.PNG', studentId: scope.studentId, bytes: 12, mime: 'image/png', sha256: 'a'.repeat(64) } as OriginalPhoto;
const api = new FamilyApi('https://123.207.232.151/family-learning/api/mobile/v1', 'synthetic-only');
const photo = { id: '22222222-2222-4222-8222-222222222222', originalName: '合成.png', mimeType: 'image/png', size: 12, sha256: 'a'.repeat(64) } as CloudPhoto;
beforeEach(() => { for (const mock of Object.values(bridge)) mock.mockReset(); });
describe('native cloud adapter contract', () => {
  it('picks metadata with cloud purpose and acknowledges only when caller persists it', async () => {
    bridge.pickOriginals.mockResolvedValue({ batchId: 'batch-a', originals: [original], failures: [], cancelled: false });
    const result = await createDriveServices(api).pick!(scope, 100, signal);
    expect(bridge.pickOriginals).toHaveBeenCalledWith(scope.owner, scope.studentId, 100, { purpose: 'cloud-original', signal });
    expect(result.items[0].source.kind).toBe('native'); expect(result.items[0].id).toBe(original.originalId); expect(bridge.readCloudOriginalUpload).not.toHaveBeenCalled(); expect(bridge.forgetOriginalBatch).not.toHaveBeenCalled();
    expect(result.items[0].name).toBe(original.originalName);
    await result.acknowledge!(); expect(bridge.forgetOriginalBatch).toHaveBeenCalledWith(scope.owner, scope.studentId, 'batch-a');
  });
  it('uses explicit folder range mode and keeps distinct IDs with the same original filename', async () => {
    bridge.pickOriginals.mockResolvedValue({ batchId: 'range', originals: [original, { ...original, originalId: '22222222-2222-4222-8222-222222222222' }], failures: [], cancelled: false });
    const result = await createDriveServices(api).pick!(scope, 200, signal, true);
    expect(bridge.pickOriginals).toHaveBeenCalledWith(scope.owner, scope.studentId, 200, { purpose: 'cloud-original', folderRange: true, signal });
    expect(result.items.map(item => item.name)).toEqual([original.originalName, original.originalName]);
    expect(result.items[0].id).not.toBe(result.items[1].id);
  });
  it('opens the gallery range picker without changing original names or starting upload', async () => {
    bridge.pickOriginals.mockResolvedValue({ batchId: 'album-range', originals: [original], failures: [], cancelled: false });
    const result = await createDriveServices(api).pick!(scope, 200, signal, false, true);
    expect(bridge.pickOriginals).toHaveBeenCalledWith(scope.owner, scope.studentId, 200, { purpose: 'cloud-original', albumRange: true, signal });
    expect(result.items[0].name).toBe(original.originalName);
    expect(bridge.readCloudOriginalUpload).not.toHaveBeenCalled();
  });
  it('recovers completed batches and preserves stable original IDs', async () => {
    bridge.listOriginalBatches.mockResolvedValue({ batches: [{ batchId: 'complete', studentId: scope.studentId, purpose: 'cloud-original', state: 'completed', createdAt: 1 }] });
    bridge.resumeOriginalBatch.mockResolvedValue({ batchId: 'complete', originals: [original], failures: [], cancelled: false });
    const result = await createDriveServices(api).recover!(scope, 100, signal);
    expect(result.items[0].id).toBe(original.originalId); expect(bridge.resumeOriginalBatch).toHaveBeenCalledWith(scope.owner, scope.studentId, 'complete', { purpose: 'cloud-original', signal }); expect(bridge.forgetOriginalBatch).not.toHaveBeenCalled();
  });
  it('preserves failed batches until explicit discard, then cancels/forgets only that scope', async () => {
    bridge.listOriginalBatches.mockResolvedValue({ batches: [{ batchId: 'broken', studentId: scope.studentId, purpose: 'cloud-original', state: 'ready', createdAt: 1 }] });
    bridge.resumeOriginalBatch.mockResolvedValue({ batchId: 'broken', originals: [original], failures: [{ index: 1, originalId: 'missing', message: 'cache missing' }], cancelled: false });
    bridge.getOriginalBatch.mockResolvedValue({ state: 'ready' }); const result = await createDriveServices(api).recover!(scope, 100, signal);
    expect(result.acknowledge).toBeUndefined(); expect(result.items).toHaveLength(1); expect(bridge.cancelOriginalBatch).not.toHaveBeenCalled();
    await result.discardRecovery!(); expect(bridge.cancelOriginalBatch).toHaveBeenCalledWith(scope.owner, scope.studentId, 'broken'); expect(bridge.forgetOriginalBatch).toHaveBeenCalledWith(scope.owner, scope.studentId, 'broken');
  });
  it('offers explicit cleanup for a lost picker and rejects a foreign-child batch', async () => {
    bridge.listOriginalBatches.mockResolvedValue({ batches: [{ batchId: 'selecting', studentId: scope.studentId, purpose: 'cloud-original', state: 'selecting', createdAt: 1 }] });
    const result = await createDriveServices(api).recover!(scope, 100, signal); expect(result.items).toHaveLength(0); expect(result.discardRecovery).toBeTypeOf('function'); expect(bridge.resumeOriginalBatch).not.toHaveBeenCalled();
    bridge.listOriginalBatches.mockResolvedValue({ batches: [{ batchId: 'foreign', studentId: 'student-b', purpose: 'cloud-original', state: 'ready', createdAt: 1 }] });
    await expect(createDriveServices(api).recover!(scope, 100, signal)).rejects.toThrow('所属孩子不匹配');
  });
  it('accepts Android save only on saved:true and keeps exact file route/hash/size', async () => {
    const services = createDriveServices(api); bridge.downloadCloudOriginal.mockResolvedValueOnce({ cancelled: true, saved: false });
    await expect(services.download(photo, signal)).rejects.toMatchObject({ name: 'AbortError' });
    bridge.downloadCloudOriginal.mockResolvedValueOnce({ cancelled: false, saved: false }); await expect(services.download(photo, signal)).rejects.toThrow('未保存');
    bridge.downloadCloudOriginal.mockResolvedValueOnce({ cancelled: false, saved: true }); await services.download(photo, signal);
    expect(bridge.downloadCloudOriginal).toHaveBeenLastCalledWith({ base: api.base, token: api.token, path: `/cloud-photos/${photo.id}/file`, name: photo.originalName, mime: photo.mimeType, bytes: photo.size, sha256: photo.sha256 }, signal);
  });
});
