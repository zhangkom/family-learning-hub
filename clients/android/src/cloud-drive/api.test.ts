import { describe, expect, it, vi } from 'vitest';
import { FamilyApi } from '../api';
import { createCloudApi } from './api';
import type { UploadJob } from './types';
const digest = 'a'.repeat(64), signal = new AbortController().signal;
const job: UploadJob = { owner: 'synthetic', studentId: 'student-a', id: 'item-id', clientBatchId: 'batch-id', expectedCount: 2, name: '原图?.jpg', mimeType: 'image/jpeg', size: 3, status: 'queued', createdAt: 1, source: { kind: 'web', file: new Blob(['abc'], { type: 'image/jpeg' }) } };
describe('cloud API is independent of scans/AI', () => {
  it('gates unavailable servers before any photo upload', async () => {
    const api = new FamilyApi('https://synthetic.invalid', 'test'); const request = vi.spyOn(api, 'request').mockResolvedValue({});
    await expect(createCloudApi(api).upload(job, { file: new Blob(['abc']), sha256: digest }, signal)).rejects.toThrow('尚未开放');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('registers batch, sends only exact original multipart fields, permits server filename sanitizing', async () => {
    const api = new FamilyApi('https://synthetic.invalid', 'test'); const request = vi.spyOn(api, 'request');
    request.mockResolvedValueOnce({ cloudPhotos: { version: 1, maxFileBytes: 33554432, maxBatchItems: 100, mimeTypes: ['image/jpeg'] } });
    request.mockResolvedValueOnce({ batch: { id: 'server-batch', studentId: job.studentId, clientBatchId: job.clientBatchId, expectedCount: 2 } });
    const photo = { id: 'photo', batchId: 'server-batch', clientRequestId: job.id, studentId: job.studentId, originalName: '原图_.jpg', mimeType: job.mimeType, size: 3, sha256: digest };
    request.mockResolvedValueOnce({ photo });
    const cloud = createCloudApi(api), file = new Blob(['abc'], { type: 'image/jpeg' }); await cloud.upload(job, { file, sha256: digest }, signal);
    expect(request.mock.calls.map(call => call[0])).toEqual(['/setup', '/cloud-photo-batches', '/cloud-photos']);
    const body = request.mock.calls[2][2] as FormData; expect([...body.keys()]).toEqual(['studentId', 'batchId', 'clientRequestId', 'sha256', 'file']);
    expect(await (body.get('file') as Blob).text()).toBe('abc'); expect(body.get('clientRequestId')).toBe(job.id); expect(body.get('sha256')).toBe(digest);
  });
  it('rejects list data from another child', async () => {
    const api = new FamilyApi('https://synthetic.invalid', 'test'); vi.spyOn(api, 'request').mockResolvedValue({ photos: [{ id: 'foreign', studentId: 'student-b' }] });
    await expect(createCloudApi(api).list('student-a')).rejects.toThrow('所属孩子不匹配');
  });
});
