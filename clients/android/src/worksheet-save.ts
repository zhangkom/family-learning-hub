import { Capacitor, registerPlugin } from '@capacitor/core';
import { ApiError, sessionExpiredEvent, type FamilyApi } from './api';
import type { WorksheetExportInput, WorksheetPreview } from '../../../lib/worksheet';

const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const maxBytes = 64 * 1024 * 1024;
const native = registerPlugin<{
  exportWorksheet(input: { base: string; token: string; body: string; requestId: string; name: string }): Promise<{ saved: boolean; cancelled: boolean }>;
  cancelExport(input: { requestId: string }): Promise<void>;
}>('WorksheetExport');

export function verifiedWorksheetPreview(input: WorksheetExportInput, preview: WorksheetPreview) {
  const selections = new Map(input.selections.map(item => [`${item.scanId}/${item.questionId}`, item]));
  if (!Array.isArray(preview.items) || preview.items.length !== selections.size || preview.totalCount !== selections.size || new Set(preview.items.map(item => `${item.scanId}/${item.questionId}`)).size !== selections.size || preview.items.some(item => selections.get(`${item.scanId}/${item.questionId}`)?.revision !== item.revision || typeof item.ready !== 'boolean' || !Array.isArray(item.reasons)) || preview.readyCount !== preview.items.filter(item => item.ready).length) throw new Error('打印检查结果与所选题目不一致，请刷新后重试');
  return preview;
}
function expired(api: FamilyApi) { window.dispatchEvent(new CustomEvent(sessionExpiredEvent, { detail: { base: api.base, token: api.token } })); }

export async function readWorksheetBlob(api: FamilyApi, input: WorksheetExportInput, signal: AbortSignal) {
  const response = await fetch(api.base + '/worksheets/export', { method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { Authorization: `Bearer ${api.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
  if (response.status === 401) expired(api);
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new ApiError(data.error || 'Word 生成未完成，请重新检查所选题目', response.status); }
  if (response.headers.get('content-type')?.split(';')[0].trim() !== mime) throw new Error('返回内容不是 Word 文档，请重试');
  const expected = Number(response.headers.get('content-length') || -1);
  if (expected === 0 || expected > maxBytes) throw new Error('文档为空或超过 64 MiB，请减少导出题目');
  const chunks: Uint8Array<ArrayBuffer>[] = []; let bytes = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error('当前浏览器不支持文档下载，请升级应用或浏览器');
  try { while (true) { signal.throwIfAborted(); const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > maxBytes) throw new Error('文档超过 64 MiB，请减少导出题目'); chunks.push(new Uint8Array(item.value)); } }
  catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  signal.throwIfAborted();
  if (!bytes || expected >= 0 && bytes !== expected) throw new Error('Word 下载不完整，请重试');
  const blob = new Blob(chunks, { type: mime }), magic = new Uint8Array(await blob.slice(0,4).arrayBuffer());
  if (magic[0] !== 0x50 || magic[1] !== 0x4b || magic[2] !== 3 || magic[3] !== 4) throw new Error('Word 文件校验失败，请重试');
  const expectedSha = response.headers.get('x-content-sha256');
  if (expectedSha) { const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), value => value.toString(16).padStart(2,'0')).join(''); if (hash !== expectedSha) throw new Error('Word 文件校验失败，请重试'); }
  signal.throwIfAborted(); return blob;
}

export async function saveWorksheet(api: FamilyApi, input: WorksheetExportInput, signal: AbortSignal) {
  signal.throwIfAborted(); const name = '错题练习卷.docx';
  if (Capacitor.isNativePlatform()) {
    if (!Capacitor.isPluginAvailable('WorksheetExport')) throw new Error('请升级 APK 后使用 Word 保存');
    const requestId = crypto.randomUUID(), cancel = () => { void native.cancelExport({ requestId }).catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const result = await native.exportWorksheet({ base: api.base, token: api.token, body: JSON.stringify(input), requestId, name }); signal.throwIfAborted();
      if (typeof result.saved !== 'boolean' || typeof result.cancelled !== 'boolean' || result.saved === result.cancelled) throw new Error('未取得 Word 保存结果，请检查所选保存位置');
      return result.saved ? 'saved' : 'cancelled';
    } catch (e) { if ((e as { code?: string }).code === 'WORKSHEET_UNAUTHORIZED') expired(api); throw e; }
    finally { signal.removeEventListener('abort', cancel); }
  }
  const blob = await readWorksheetBlob(api, input, signal); signal.throwIfAborted();
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
