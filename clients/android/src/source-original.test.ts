import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FamilyApi } from './api';
import { loadSourceOriginal } from './source-original';

const mock = vi.hoisted(() => ({ photo: vi.fn(), blob: vi.fn(), local: vi.fn(), read: vi.fn(), decode: vi.fn(), native: vi.fn() }));
vi.mock('./cloud-drive/api', () => ({ createCloudApi: () => ({ photo: mock.photo, blob: mock.blob }) }));
vi.mock('./photo-processing', () => ({ getOriginal: mock.local, readCloudOriginalUpload: mock.read, photoProcessingAvailable: mock.native }));
vi.mock('./question-images', () => ({ decodeQuestionImage: mock.decode }));
const api = new FamilyApi('https://synthetic.invalid', 'synthetic'), photo = { id: 'photo', clientRequestId: 'local-id', studentId: 'student-a', sha256: 'hash', size: 4 };
beforeEach(() => { vi.resetAllMocks(); mock.photo.mockResolvedValue(photo); mock.native.mockReturnValue(true); mock.decode.mockResolvedValue({ url: 'blob:test', width: 2, height: 2 }); });
describe('explicit original-page reading', () => {
  it('reuses only a verified matching local original without downloading', async () => {
    const file = new Blob(['same']); mock.local.mockResolvedValue({ studentId: 'student-a', sha256: 'hash', bytes: 4 }); mock.read.mockResolvedValue({ file });
    const signal = new AbortController().signal;
    await loadSourceOriginal(api, 'family-a', 'student-a', 'photo', signal);
    expect(mock.local).toHaveBeenCalledWith('family-a', 'local-id'); expect(mock.blob).not.toHaveBeenCalled(); expect(mock.decode).toHaveBeenCalledWith(file, signal);
  });
  it.each([{ studentId: 'student-b', sha256: 'hash', bytes: 4 }, { studentId: 'student-a', sha256: 'different', bytes: 4 }])('never displays a mismatched local original', async original => {
    mock.local.mockResolvedValue(original); const file = new Blob(['cloud']); mock.blob.mockResolvedValue(file);
    const signal = new AbortController().signal; await loadSourceOriginal(api, 'family-a', 'student-a', 'photo', signal);
    expect(mock.read).not.toHaveBeenCalled(); expect(mock.blob).toHaveBeenCalledWith(photo, true, signal); expect(mock.decode).toHaveBeenCalledWith(file, signal);
  });
  it('cancellation during local lookup does not start a cloud request', async () => {
    const abort = new AbortController(); mock.local.mockImplementation(() => { abort.abort(); throw new Error('cancelled'); });
    await expect(loadSourceOriginal(api, 'family-a', 'student-a', 'photo', abort.signal)).rejects.toThrow(); expect(mock.blob).not.toHaveBeenCalled(); expect(mock.decode).not.toHaveBeenCalled();
  });
  it('surfaces metadata or file failures without decoding unverified content', async () => {
    mock.photo.mockRejectedValue(new Error('学生不匹配')); await expect(loadSourceOriginal(api, 'family-a', 'student-a', 'photo', new AbortController().signal)).rejects.toThrow('学生不匹配');
    expect(mock.local).not.toHaveBeenCalled(); expect(mock.decode).not.toHaveBeenCalled();
    mock.photo.mockResolvedValue(photo); mock.native.mockReturnValue(false); mock.blob.mockRejectedValue(new Error('原图完整性校验失败'));
    await expect(loadSourceOriginal(api, 'family-a', 'student-a', 'photo', new AbortController().signal)).rejects.toThrow('原图完整性'); expect(mock.decode).not.toHaveBeenCalled();
  });
});
