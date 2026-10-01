import { afterEach, describe, expect, it, vi } from 'vitest';
import { FamilyApi } from '../api';
import type { Scan } from '../types';
import { beginCamera, stageCamera, restoredCamera, listCameraResults, cancelCamera, clearUnfinishedCamera } from './camera-handoff';
import { listPhotoDeliveries, savePhotoDelivery, removeDamagedPhotoDelivery, type PhotoDelivery } from './delivery';
const uuid = '11111111-1111-1111-1111-111111111111', outputId = '22222222-2222-2222-2222-222222222222';
const identity = [1,0,0,0,1,0,0,0,1] as const;
const original = { schemaVersion: 1 as const, originalId: uuid, studentId: 'a', sha256: 'a'.repeat(64), bytes: 100,
  mime: 'image/png' as const, width: 900, height: 1200, uprightWidth: 900, uprightHeight: 1200, orientation: 1,
  originalUri: 'file:///private/original', previewUri: 'file:///private/preview.jpg', createdAt: 1 };
const processing = { schemaVersion: 1 as const, algorithmVersion: 'android-photo-v1' as const, originalId: uuid, studentId: 'a', outputId,
  sourceSha256: original.sha256, sha256: 'b'.repeat(64), bytes: 4, mime: 'image/jpeg' as const, width: 900, height: 1200,
  sourceWidth: 900, sourceHeight: 1200, decodedWidth: 900, decodedHeight: 1200, exifOrientation: 1,
  sourceSpace: 'exif-upright-normalized-edges' as const, outputSpace: 'normalized-edges' as const, corners: [0,0,1,0,1,1,0,1] as const,
  quarterTurns: 0, enhancement: 'none' as const, maxEdge: 3072, jpegQuality: 94, sourceToOutput: identity, outputToSource: identity, createdAt: 2,
  quality: { advisoryOnly: true as const, warnings: [], laplacianVariance: 80, darkFraction: .01, backgroundRange: 20, percentile10: 100, percentile90: 240 } };
const delivery: PhotoDelivery = { record: { version: 1, id: outputId, owner: 'owner', studentId: 'a', policy: 'processed-only', confirmedAt: 2,
  original, prepared: { ...processing, uri: `file:///private/${outputId}.jpg` } },
  upload: { file: new Blob(['test'], { type: 'image/jpeg' }), name: '题图.jpg', processing, sourceKind: 'processed-photo' } };
const scan: Scan = { id: 'scan', studentId: 'a', sourceKind: 'processed-photo', processing, mimeType: 'image/jpeg', size: 4,
  createdAt: '2026-10-01T12:00:00Z', revision: 1, questions: [], status: 'ready', source: '', subject: '', originalName: '题图.jpg' };
function storage(): Storage {
  const entries = new Map<string, string>();
  return { get length() { return entries.size; }, clear: () => entries.clear(), getItem: key => entries.get(key) ?? null,
    key: i => [...entries.keys()][i] ?? null, setItem: (key, value) => { entries.set(key, value); }, removeItem: key => { entries.delete(key); } };
}
afterEach(() => vi.unstubAllGlobals());
describe('host handoff persistence', () => {
  it('binds a restored camera result to its original owner/student, never the current viewer', () => {
    const local = storage(), context = beginCamera('owner', 'a', 'camera', local);
    restoredCamera({ pluginId: 'Camera', methodName: 'takePhoto', success: true, data: { uri: '/camera/restored.jpg' } }, local);
    expect(listCameraResults('owner', 'a', local).results[0]).toMatchObject({ ...context, uri: '/camera/restored.jpg' });
    expect(listCameraResults('other', 'a', local).results).toEqual([]);
    expect(listCameraResults('owner', 'b', local).results).toEqual([]);
    expect(local.getItem('family-learning:pending-camera')).toBeNull();
  });
  it('allows explicit cancellation of a legacy context only by its owner', () => {
    const local = storage(); local.setItem('family-learning:pending-camera', JSON.stringify({ owner: 'owner', studentId: 'a' }));
    expect(() => clearUnfinishedCamera('other', local)).toThrow('另一个账号');
    expect(local.getItem('family-learning:pending-camera')).not.toBeNull();
    clearUnfinishedCamera('owner', local);
    expect(beginCamera('owner', 'a', 'gallery', local).studentId).toBe('a');
  });
  it('isolates broken/foreign camera records while preserving healthy results', () => {
    const local = storage(), context = beginCamera('owner', 'a', 'camera', local);
    stageCamera(context, { uri: '/camera/1.jpg' }, local);
    local.setItem('family-learning:camera-result-v1:corrupt', '{bad');
    local.setItem('family-learning:camera-result-v1:foreign', JSON.stringify({ owner: 'other', studentId: 'b' }));
    const result = listCameraResults('owner', 'a', local);
    expect(result.results).toHaveLength(1); expect(result.issues).toHaveLength(1); expect(result.issues[0]).toContain('无法确认归属');
    expect(local.getItem('family-learning:camera-result-v1:corrupt')).toBe('{bad');
  });
  it('an old cancellation does not erase the new capture request', () => {
    const local = storage(), old = beginCamera('owner', 'a', 'camera', local); cancelCamera(old, local);
    const current = beginCamera('owner', 'b', 'gallery', local); cancelCamera(old, local);
    expect(JSON.parse(local.getItem('family-learning:pending-camera')!).id).toBe(current.id);
    expect(() => restoredCamera({ pluginId: 'Camera', methodName: 'takePhoto', success: true, data: {} }, local)).toThrow('不匹配');
  });
  it('keeps healthy pending photos visible when another scoped record is damaged', () => {
    const local = storage(); savePhotoDelivery(delivery, local);
    const key = 'family-photo-delivery-v1:' + JSON.stringify(['owner', 'a', 'broken']); local.setItem(key, '{bad');
    local.setItem('family-photo-delivery-v1:' + JSON.stringify(['other', 'a', 'broken']), '{bad');
    const list = listPhotoDeliveries('owner', 'a', local);
    expect(list.records).toHaveLength(1); expect(list.issues).toHaveLength(1); expect(list.issues[0].message).toContain('原片没有被删除');
    expect(local.getItem(key)).toBe('{bad');
  });
  it('removes only the explicitly selected damaged key and safely labels non-string IDs', () => {
    const local = storage(); savePhotoDelivery(delivery, local);
    const key = 'family-photo-delivery-v1:' + JSON.stringify(['owner', 'a', { unexpected: true }]); local.setItem(key, '{bad');
    const issue = listPhotoDeliveries('owner', 'a', local).issues[0]; expect(issue.id).toBe('未知编号');
    expect(() => removeDamagedPhotoDelivery('other', 'a', issue.key, local)).toThrow('归属');
    expect(local.getItem(key)).toBe('{bad');
    removeDamagedPhotoDelivery('owner', 'a', issue.key, local);
    expect(local.getItem(key)).toBeNull(); expect(listPhotoDeliveries('owner', 'a', local).records).toHaveLength(1);
    expect(() => removeDamagedPhotoDelivery('owner', 'a', local.key(0)!, local)).toThrow('恢复正常');
  });
});
describe('processed upload protocol', () => {
  const api = new FamilyApi('https://family.invalid/api', 'synthetic');
  it('rejects unsupported servers before posting a photo', async () => {
    const fetcher = vi.fn(async () => Response.json({ enabled: true })); vi.stubGlobal('fetch', fetcher);
    await expect(api.uploadProcessed(delivery)).rejects.toThrow('尚未发送');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledWith('https://family.invalid/api/setup', expect.objectContaining({ method: 'GET' }));
  });
  it('sends only processed metadata with outputId idempotency and validates the acknowledgement', async () => {
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('/setup')) return Response.json({ processedPhotoMetadataVersion: 1 });
      const form = options.body as FormData;
      expect([...form.keys()].sort()).toEqual(['clientRequestId','file','processing','source','sourceKind','studentId']);
      expect(form.get('clientRequestId')).toBe(outputId); expect(form.get('sourceKind')).toBe('processed-photo');
      expect(form.get('processing')).toBe(JSON.stringify(processing));
      expect(form.get('processing')).not.toContain('file:'); expect(form.get('processing')).not.toContain('owner');
      return Response.json({ scan });
    }); vi.stubGlobal('fetch', fetcher);
    await expect(api.uploadProcessed(delivery)).resolves.toEqual({ scan });
  });
  it.each(['studentId', 'outputId', 'sha256', 'sourceToOutput'])('rejects a mismatched %s receipt', async field => {
    const bad = { ...processing, [field]: field === 'sourceToOutput' ? [2,0,0,0,1,0,0,0,1] : 'mismatch' };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/setup') ? Response.json({ processedPhotoMetadataVersion: 1 }) : Response.json({ scan: { ...scan, processing: bad } })));
    await expect(api.uploadProcessed(delivery)).rejects.toThrow('回执');
  });
  it('honors abort after capability check without sending the file', async () => {
    const abort = new AbortController();
    const fetcher = vi.fn(async () => { abort.abort(); return Response.json({ processedPhotoMetadataVersion: 1 }); }); vi.stubGlobal('fetch', fetcher);
    await expect(api.uploadProcessed(delivery, abort.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
