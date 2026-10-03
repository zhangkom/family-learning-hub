import { describe, expect, it, vi } from 'vitest';
import { FamilyApi } from '../api';
import { createCloudApi } from './api';
import type { UploadJob } from './types';
const digest = 'a'.repeat(64), signal = new AbortController().signal;
const job: UploadJob = { owner: 'synthetic', studentId: 'student-a', id: 'item-id', clientBatchId: 'batch-id', expectedCount: 2, name: '原图?.jpg', mimeType: 'image/jpeg', size: 3, status: 'queued', createdAt: 1, source: { kind: 'web', file: new Blob(['abc'], { type: 'image/jpeg' }) } };
describe('cloud API is independent of scans/AI', () => {
  it('binds original metadata to the requested student and exact source page', async () => {
    const api = new FamilyApi('https://synthetic.invalid', 'test'), request = vi.spyOn(api, 'request');
    const photo = { id: 'source-photo', studentId: 'student-a' }; request.mockResolvedValueOnce({ photo });
    expect(await createCloudApi(api).photo('source-photo', 'student-a', signal)).toEqual(photo);
    expect(request.mock.calls[0][0]).toBe('/cloud-photos/source-photo?studentId=student-a');
    request.mockResolvedValueOnce({ photo: { ...photo, studentId: 'student-b' } });
    await expect(createCloudApi(api).photo('source-photo', 'student-a', signal)).rejects.toThrow('不属于当前学生');
    request.mockResolvedValueOnce({ photo: { ...photo, id: 'other-photo' } });
    await expect(createCloudApi(api).photo('source-photo', 'student-a', signal)).rejects.toThrow('不属于当前学生');
  });
  it('binds folder pages to the requested document and preserves the server page order', async () => {
    const api = new FamilyApi('https://synthetic.invalid', 'test'), request = vi.spyOn(api, 'request');
    const photos = [2, 3].map(pageNumber => ({ id: `photo-${pageNumber}`, studentId: 'student-a', archive: { documentId: 'homework-a', pageNumber } }));
    request.mockResolvedValueOnce({ photos, nextCursor: 'next-page' });
    expect((await createCloudApi(api).list('student-a', 'start-page', signal, { documentId: 'homework-a' })).photos).toEqual(photos);
    expect(request.mock.calls[0][0]).toContain('documentId=homework-a');
    expect(request.mock.calls[0][0]).toContain('cursor=start-page');
    request.mockResolvedValueOnce({ photos });
    await expect(createCloudApi(api).list('student-a', undefined, signal, { documentId: 'different' })).rejects.toThrow('作业页归属');
    request.mockResolvedValueOnce({ photos });
    await expect(createCloudApi(api).list('student-a', undefined, signal, { unclassified: true })).rejects.toThrow('图片分类已变化');
  });
  it('rejects a subject folder response that contains another subject', async () => {
    const api = new FamilyApi('https://synthetic.invalid', 'test');
    vi.spyOn(api, 'request').mockResolvedValue({ documents: [{ id: 'physics', title: '物理寒假作业3', subject: '物理' }] });
    await expect(createCloudApi(api).folders('student-a', '生物', undefined, signal)).rejects.toThrow('目录读取不完整');
  });
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
    const body = request.mock.calls[2][2] as FormData; expect([...body.keys()]).toEqual(['studentId', 'batchId', 'clientRequestId', 'sha256', 'file', 'nameAction']);
    expect(body.get('nameAction')).toBe('check');
    expect(await (body.get('file') as Blob).text()).toBe('abc'); expect(body.get('clientRequestId')).toBe(job.id); expect(body.get('sha256')).toBe(digest);
  });
  it('rejects list data from another child', async () => {
    const api = new FamilyApi('https://synthetic.invalid', 'test'); vi.spyOn(api, 'request').mockResolvedValue({ photos: [{ id: 'foreign', studentId: 'student-b' }] });
    await expect(createCloudApi(api).list('student-a')).rejects.toThrow('所属孩子不匹配');
  });
  it('waits for an explicit choice, rechecks edited names and persists the exact overwrite token', async () => {
    const api = new FamilyApi('https://synthetic.invalid', 'test'), request = vi.spyOn(api, 'request');
    const check = { name: '原图.jpg', conflicts: 1, token: 'b'.repeat(64), suggestedName: '原图_2.jpg' };
    request.mockResolvedValueOnce({ cloudPhotos: { version: 1, maxFileBytes: 33554432, maxBatchItems: Number.MAX_SAFE_INTEGER, nameConflictVersion: 1, mimeTypes: ['image/jpeg'] } });
    request.mockResolvedValueOnce(check).mockResolvedValueOnce({ ...check, name: '自己编辑.jpg', conflicts: 0 });
    const cloud = createCloudApi(api), choose = vi.fn(async () => ({ action: 'rename' as const, name: '自己编辑.jpg' }));
    const renamed = await cloud.prepare(job, signal, choose);
    expect(renamed.name).toBe('自己编辑.jpg'); expect(renamed.nameToken).toBeUndefined(); expect(choose).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.every(call => call[1] === 'GET')).toBe(true);
    request.mockResolvedValueOnce(check);
    const replaced = await cloud.prepare(job, signal, async () => ({ action: 'replace' }));
    expect(replaced).toMatchObject({ name: '原图.jpg', nameToken: check.token });
    request.mockResolvedValueOnce(check);
    const noPrompt = vi.fn(); await cloud.prepare(replaced, signal, noPrompt); expect(noPrompt).not.toHaveBeenCalled();
  });
  it('recognizes a previously accepted request before asking about its filename again', async () => {
    const api = new FamilyApi('https://synthetic.invalid', 'test'), request = vi.spyOn(api, 'request');
    request.mockResolvedValueOnce({ cloudPhotos: { version: 1, maxFileBytes: 33554432, maxBatchItems: Number.MAX_SAFE_INTEGER, nameConflictVersion: 1, mimeTypes: ['image/jpeg'] } });
    request.mockResolvedValueOnce({ name: job.name, conflicts: 1, token: 'a'.repeat(64), suggestedName: 'unused.jpg', receipt: { id: 'already-uploaded' } });
    const choose = vi.fn(); expect(await createCloudApi(api).prepare(job, signal, choose)).toEqual(job); expect(choose).not.toHaveBeenCalled();
  });
});
