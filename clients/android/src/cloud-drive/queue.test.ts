import { describe, expect, it, vi } from 'vitest';
import { UploadQueue } from './queue';
import type { CloudPhoto, CloudScope, DriveStore, PickedOriginal, UploadJob } from './types';

const scope = { owner: 'synthetic-family-a', studentId: 'student-a' }, digest = 'a'.repeat(64);
function memory() {
  const records = new Map<string, UploadJob>();
  const key = (s: CloudScope, id: string) => JSON.stringify([s.owner, s.studentId, id]);
  const store: DriveStore = {
    async list(s) { return [...records.values()].filter(j => j.owner === s.owner && j.studentId === s.studentId).map(j => structuredClone(j)); },
    async put(job) { records.set(key(job, job.id), structuredClone(job)); },
    async remove(s, id) { records.delete(key(s, id)); },
  }; return { store, records };
}
const item = (name = '合成原图.jpg'): PickedOriginal => ({ name, mimeType: 'image/jpeg', size: 3, source: { kind: 'web', file: new Blob(['abc'], { type: 'image/jpeg' }) } });
const receipt = (job: UploadJob): CloudPhoto => ({ id: 'server-' + job.id, batchId: job.clientBatchId, clientRequestId: job.id, studentId: job.studentId, originalName: job.name, mimeType: job.mimeType, size: job.size, sha256: digest, createdAt: '2026-10-02T00:00:00Z' });
function services() { return { read: vi.fn(async (job: UploadJob) => ({ file: (job.source as { file: Blob }).file, sha256: digest })), upload: vi.fn(async (job: UploadJob) => receipt(job)) }; }

describe('cloud original upload queue', () => {
  it('keeps 500 selections in one upload and restores every ID before continuing', async () => {
    const { store } = memory(), api = services(), queue = new UploadQueue(scope, store, api); await queue.load();
    await queue.add(Array.from({ length: 500 }, (_, i) => item(`${i}.jpg`)));
    expect(api.read).not.toHaveBeenCalled(); expect(api.upload).not.toHaveBeenCalled();
    const saved = queue.snapshot().jobs;
    const groups = [...new Set(saved.map(j => j.clientBatchId))];
    expect(groups.map(id => saved.filter(j => j.clientBatchId === id).length)).toEqual([500]);
    expect(groups.map(id => saved.find(j => j.clientBatchId === id)!.expectedCount)).toEqual([500]);
    queue.dispose(); const restored = new UploadQueue(scope, store, api); await restored.load();
    expect(restored.snapshot().jobs.map(j => [j.id, j.clientBatchId])).toEqual(saved.map(j => [j.id, j.clientBatchId]));
    await restored.add([item()]); expect((await store.list(scope)).length).toBe(501);
    await restored.start(); expect(api.upload).toHaveBeenCalledTimes(501);
    expect(restored.snapshot().jobs.every(j => j.status === 'completed')).toBe(true);
  });
  it('starts a new total after previous completed selections, retaining pending progress during recovery', async () => {
    const { store } = memory(), api = services(), queue = new UploadQueue(scope, store, api); await queue.load();
    await queue.add(Array.from({ length: 5 }, () => item())); await queue.start();
    await queue.add(Array.from({ length: 500 }, () => item()));
    expect(queue.snapshot().jobs).toHaveLength(500); expect(queue.snapshot().jobs.every(j => j.status === 'queued')).toBe(true);
    await queue.start(); await queue.add([item()], false); expect(queue.snapshot().jobs).toHaveLength(501);
  });
  it('reads/sends serially, releases web blobs only after verified receipts', async () => {
    const { store } = memory(), api = services(), queue = new UploadQueue(scope, store, api); let live = 0, peak = 0;
    api.read.mockImplementation(async job => { peak = Math.max(peak, ++live); return { file: (job.source as { file: Blob }).file, sha256: digest }; });
    api.upload.mockImplementation(async job => { await Promise.resolve(); live--; return receipt(job); });
    await queue.load(); await queue.add([item('1.jpg'), item('2.jpg'), item('3.jpg')]); await queue.start();
    expect(peak).toBe(1); expect(queue.snapshot().jobs.every(j => j.status === 'completed')).toBe(true);
    expect((await store.list(scope)).every(j => !('file' in j.source))).toBe(true);
  });
  it('keeps failure bytes and retries the same IDs after a lost receipt and reload without auto upload', async () => {
    const { store } = memory(), api = services(), queue = new UploadQueue(scope, store, api);
    api.upload.mockRejectedValueOnce(new Error('response lost')); await queue.load(); await queue.add([item()]); await queue.start();
    const before = queue.snapshot().jobs[0]; expect(before.status).toBe('failed'); expect('file' in before.source).toBe(true); queue.dispose();
    const restored = new UploadQueue(scope, store, api); await restored.load(); expect(api.upload).toHaveBeenCalledTimes(1);
    await restored.start(); const after = restored.snapshot().jobs[0]; expect(after.id).toBe(before.id); expect(after.clientBatchId).toBe(before.clientBatchId); expect(after.status).toBe('completed');
  });
  it('stop aborts the active upload and does not start later files; resume keeps IDs', async () => {
    const { store } = memory(), api = services(); let started!: () => void;
    const active = new Promise<void>(resolve => { started = resolve; });
    const upload = vi.fn(async (job: UploadJob, _bytes: unknown, signal: AbortSignal) => {
      started(); return await new Promise<CloudPhoto>((resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
    });
    const queue = new UploadQueue(scope, store, { read: api.read, upload }); await queue.load(); await queue.add([item('1.jpg'), item('2.jpg')]);
    const running = queue.start(); await active; queue.stop(); await running;
    expect(upload).toHaveBeenCalledTimes(1); expect(queue.snapshot().jobs.map(j => j.status)).toEqual(['paused', 'queued']);
    expect(queue.snapshot().running).toBe(false);
  });
  it('retains a verified completion arriving after stop but never sends next file', async () => {
    const { store } = memory(), api = services(); const queue = new UploadQueue(scope, store, api);
    api.upload.mockImplementation(async job => { queue.stop(); return receipt(job); });
    await queue.load(); await queue.add([item('1.jpg'), item('2.jpg')]); await queue.start();
    expect(queue.snapshot().jobs.map(j => j.status)).toEqual(['completed', 'queued']); expect(api.upload).toHaveBeenCalledTimes(1);
  });
  it('rejects mismatched receipts and changed source bytes without clearing local originals', async () => {
    const { store } = memory(), api = services(), queue = new UploadQueue(scope, store, api);
    api.upload.mockImplementation(async job => ({ ...receipt(job), studentId: 'other' })); await queue.load(); await queue.add([item()]); await queue.start();
    expect(queue.snapshot().jobs[0].status).toBe('failed'); expect('file' in queue.snapshot().jobs[0].source).toBe(true);
    api.read.mockResolvedValue({ file: new Blob(['modified'], { type: 'image/jpeg' }), sha256: digest }); await queue.start();
    expect(api.upload).toHaveBeenCalledTimes(1); expect(queue.snapshot().jobs[0].message).toMatch(/已变化/);
  });
  it('scope changes isolate pending records and closing during reading prevents upload', async () => {
    const { store } = memory(), api = services(), queue = new UploadQueue(scope, store, api);
    api.read.mockImplementation(async job => { queue.dispose(); return { file: (job.source as { file: Blob }).file, sha256: digest }; });
    await queue.load(); await queue.add([item()]); await queue.start(); expect(api.upload).not.toHaveBeenCalled();
    for (const other of [{ ...scope, studentId: 'student-b' }, { ...scope, owner: 'synthetic-family-b' }]) {
      const isolated = new UploadQueue(other, store, services()); await isolated.load(); expect(isolated.snapshot().jobs).toEqual([]);
    }
    expect((await store.list(scope))[0].status).toBe('paused');
  });
  it('stops on expired authentication, preserving later files', async () => {
    const { store } = memory(), api = services(), queue = new UploadQueue(scope, store, api);
    api.upload.mockRejectedValue(Object.assign(new Error('session expired'), { status: 401 }));
    await queue.load(); await queue.add([item('1.jpg'), item('2.jpg')]); await queue.start(); expect(api.upload).toHaveBeenCalledTimes(1); expect(queue.snapshot().jobs[1].status).toBe('queued');
  });
  it('native recovery repeats stable IDs without duplicate queue rows', async () => {
    const { store } = memory(), queue = new UploadQueue(scope, store, services()); await queue.load();
    await queue.add([{ ...item(), id: 'stable-id' }]); await queue.add([{ ...item(), id: 'stable-id' }]); expect(queue.snapshot().jobs.length).toBe(1);
  });
  it('persists the chosen name before upload and retries a changed name conflict without losing progress', async () => {
    const { store } = memory(), api = services();
    let calls = 0;
    const prepare = vi.fn(async (job: UploadJob) => ({ ...job, name: ++calls === 1 ? '同名_1.jpg' : '同名_2.jpg' }));
    api.upload.mockImplementationOnce(async job => { expect((await store.list(scope))[0].name).toBe(job.name); throw Object.assign(new Error('race'), { code: 'CLOUD_NAME_CONFLICT' }); });
    const queue = new UploadQueue(scope, store, { ...api, prepare }); await queue.load(); await queue.add([item()]); await queue.start();
    expect(prepare).toHaveBeenCalledTimes(2); expect(api.read).toHaveBeenCalledTimes(1);
    expect(queue.snapshot().jobs[0]).toMatchObject({ name: '同名_2.jpg', status: 'completed' });
  });
  it('stops while waiting for a name decision without reading or uploading later photos', async () => {
    const { store } = memory(), api = services(); let ready!: () => void;
    const waiting = new Promise<void>(resolve => { ready = resolve; });
    const prepare = (_job: UploadJob, signal: AbortSignal) => new Promise<UploadJob>((_resolve, reject) => { ready(); signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
    const queue = new UploadQueue(scope, store, { ...api, prepare }); await queue.load(); await queue.add([item(), item()]);
    const running = queue.start(); await waiting; queue.stop(); await running;
    expect(api.read).not.toHaveBeenCalled(); expect(api.upload).not.toHaveBeenCalled();
    expect(queue.snapshot().jobs.map(j => j.status)).toEqual(['paused', 'queued']);
  });
});
