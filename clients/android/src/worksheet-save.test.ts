import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FamilyApi, sessionExpiredEvent } from './api';
import { readWorksheetBlob, saveWorksheet, verifiedWorksheetPreview } from './worksheet-save';
import type { WorksheetExportInput, WorksheetPreview } from '../../../lib/worksheet';

const mocks = vi.hoisted(() => ({ native: false, available: true, export: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mocks.native, isPluginAvailable: () => mocks.available }, registerPlugin: () => ({ exportWorksheet: mocks.export, cancelExport: mocks.cancel }) }));
const api = new FamilyApi('https://synthetic.invalid/api', 'synthetic-token');
const input: WorksheetExportInput = { studentId: 'a', selections: [{ scanId: 's', questionId: 'q', revision: 1 }], includeAnswers: false };
const preview: WorksheetPreview = { totalCount: 1, readyCount: 0, items: [{ scanId: 's', questionId: 'q', revision: 1, ready: false, reasons: ['尚未打印核对'], subject: '物理', stars: 3, sourceTitle: '合成', originalNumber: '1', sourceFingerprint: 'synthetic' }] };
const bytes = new Uint8Array([0x50,0x4b,3,4,1,2,3,4]);
const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
beforeEach(() => { mocks.native = false; mocks.available = true; mocks.export.mockReset(); mocks.cancel.mockClear(); });
afterEach(() => vi.unstubAllGlobals());
describe('worksheet download contract', () => {
  it('requires an exact preview for every chosen revision, never silently dropping an unready question', () => {
    expect(verifiedWorksheetPreview(input, preview)).toBe(preview);
    expect(() => verifiedWorksheetPreview(input, { ...preview, items: [] })).toThrow('不一致');
    expect(() => verifiedWorksheetPreview(input, { ...preview, items: [{ ...preview.items[0], revision: 2 }] })).toThrow('不一致');
    expect(() => verifiedWorksheetPreview(input, { ...preview, readyCount: 1 })).toThrow('不一致');
  });
  it('downloads DOCX bytes through authenticated POST without credentials in the URL', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'content-type': mime, 'content-length': String(bytes.length) } })); vi.stubGlobal('fetch', fetch);
    const blob = await readWorksheetBlob(api, input, new AbortController().signal);
    expect(blob.size).toBe(bytes.length); expect(fetch.mock.calls[0][0]).toBe('https://synthetic.invalid/api/worksheets/export');
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', headers: { Authorization: 'Bearer synthetic-token' } });
  });
  it('rejects HTML, corrupt DOCX, oversized bytes, checksum mismatch and 409 JSON', async () => {
    for (const response of [new Response('html', { headers: { 'content-type': 'text/html' } }), new Response('bad zip', { headers: { 'content-type': mime } }), new Response(bytes, { headers: { 'content-type': mime, 'content-length': String(65*1024*1024) } }), new Response(bytes, { headers: { 'content-type': mime, 'x-content-sha256': 'a'.repeat(64) } }), new Response('{"error":"原题已更新"}', { status: 409 })]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response)); await expect(readWorksheetBlob(api, input, new AbortController().signal)).rejects.toThrow();
    }
  });
  it('uses the native save-location workflow without a JS Blob or external token URL, and handles cancellation', async () => {
    mocks.native = true; mocks.export.mockResolvedValue({ saved: false, cancelled: true });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await saveWorksheet(api, input, new AbortController().signal)).toBe('cancelled'); expect(fetch).not.toHaveBeenCalled();
    expect(mocks.export.mock.calls[0][0]).toMatchObject({ base: api.base, token: api.token, body: JSON.stringify(input), name: '错题练习卷.docx' });
    expect(mocks.export.mock.calls[0][0].base).not.toContain(api.token);
  });
  it('cancels the exact native job when closing or switching student and rejects a stale success', async () => {
    mocks.native = true; let finish: (value: { saved: boolean; cancelled: boolean }) => void = () => {};
    mocks.export.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const abort = new AbortController(), result = saveWorksheet(api, input, abort.signal); abort.abort(); finish({ saved: true, cancelled: false });
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.cancel.mock.calls[0][0].requestId).toBe(mocks.export.mock.calls[0][0].requestId);
  });
  it('requires an upgraded APK when native saving is unavailable', async () => {
    mocks.native = true; mocks.available = false; await expect(saveWorksheet(api, input, new AbortController().signal)).rejects.toThrow('升级 APK');
  });
  it('routes browser and native expired authentication through the matching session only', async () => {
    const dispatchEvent = vi.fn(); vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"会话已过期"}', { status: 401 })));
    await expect(readWorksheetBlob(api, input, new AbortController().signal)).rejects.toThrow('会话已过期');
    expect(dispatchEvent.mock.calls[0][0].type).toBe(sessionExpiredEvent);
    expect(dispatchEvent.mock.calls[0][0].detail).toEqual({ base: api.base, token: api.token });
    mocks.native = true; mocks.export.mockRejectedValue(Object.assign(new Error('登录已过期'), { code: 'WORKSHEET_UNAUTHORIZED' }));
    await expect(saveWorksheet(api, input, new AbortController().signal)).rejects.toThrow('登录已过期');
    expect(dispatchEvent.mock.calls[1][0].detail).toEqual({ base: api.base, token: api.token });
  });
});
