import { Capacitor } from '@capacitor/core';
import type { FamilyApi } from '../api';
import type { OriginalPhoto } from '../photo-processing';
import { originalPhotoName } from '../photo-processing/original-name';
import { createCloudApi, cloudFilePath, sha256 } from './api';
import type { CloudScope, DriveServices, PickResult, UploadJob, ResolveName, ImportProgress } from './types';
import type { NativePhotoBatch } from '../photo-processing/batch';
import { ImageRequestGate, retryBusy } from './scheduler';

type BatchResult = { batchId: string; originals: OriginalPhoto[]; failures: { index: number; originalId: string; message: string }[]; cancelled: boolean; selectedCount?: number };
type NativeBridge = {
  pickOriginals(owner: string, studentId: string, limit: number, options: { purpose: 'cloud-original'; folderRange?: boolean; signal?: AbortSignal; onProgress?: (batch: NativePhotoBatch) => void }): Promise<BatchResult>;
  readCloudOriginalUpload(owner: string, photo: OriginalPhoto, signal?: AbortSignal): Promise<{ file: Blob; sha256: string; studentId: string }>;
  listOriginalBatches(owner: string, studentId: string, purpose: 'cloud-original'): Promise<{ batches: NativePhotoBatch[] }>;
  resumeOriginalBatch(owner: string, studentId: string, batchId: string, options: { signal?: AbortSignal; purpose?: 'cloud-original'; onProgress?: (batch: NativePhotoBatch) => void }): Promise<BatchResult>;
  forgetOriginalBatch(owner: string, studentId: string, batchId: string): Promise<void>;
  getOriginalBatch(owner: string, studentId: string, batchId: string): Promise<{ state: string }>;
  cancelOriginalBatch(owner: string, studentId: string, batchId: string): Promise<unknown>;
  downloadCloudOriginal(options: { base: string; token: string; path: string; name: string; mime: string; bytes: number; sha256: string }, signal?: AbortSignal): Promise<{ cancelled: boolean; saved: boolean }>;
};
async function nativeBridge() {
  // The companion native commit exports these methods from photo-processing/index.
  const bridge = await import('../photo-processing') as unknown as NativeBridge;
  if (typeof bridge.pickOriginals !== 'function' || typeof bridge.readCloudOriginalUpload !== 'function') throw new Error('请升级应用以使用系统批量选图');
  return bridge;
}
function fromNative(result: BatchResult, scope: CloudScope, bridge: NativeBridge): PickResult {
  if (result.originals.some(photo => photo.studentId !== scope.studentId)) throw new Error('原图所属孩子不匹配');
  const cancelledEmpty = result.cancelled && result.selectedCount === 0 && !result.originals.length && !result.failures.length;
  return { cancelled: result.cancelled, selectedCount: result.selectedCount, ...(result.batchId && (cancelledEmpty || !result.cancelled && !result.failures.length && (result.selectedCount === undefined || result.selectedCount === result.originals.length)) ? { acknowledge: () => bridge.forgetOriginalBatch(scope.owner, scope.studentId, result.batchId) } : {}),
    ...(result.batchId && result.failures.length ? { discardRecovery: () => discardBatch(bridge, scope, result.batchId) } : {}),
    failures: result.failures.map(f => `第 ${f.index + 1} 张未导入：${f.message}`), items: result.originals.map(original => ({
    id: original.originalId, name: originalPhotoName(original),
    size: original.bytes, mimeType: original.mime, source: { kind: 'native', original },
  })) };
}
async function discardBatch(bridge: NativeBridge, scope: CloudScope, batchId: string) {
  const current = await bridge.getOriginalBatch(scope.owner, scope.studentId, batchId);
  if (!['completed', 'cancelled'].includes(current.state)) await bridge.cancelOriginalBatch(scope.owner, scope.studentId, batchId);
  await bridge.forgetOriginalBatch(scope.owner, scope.studentId, batchId);
}
export function createDriveServices(api: FamilyApi, resolveName?: ResolveName): DriveServices {
  const cloud = createCloudApi(api), native = Capacitor.getPlatform() === 'android', gate = new ImageRequestGate();
  return {
    native, limits: cloud.limits, list: cloud.list, folders: cloud.folders, upload: (job, bytes, signal) => gate.run(() => retryBusy(() => cloud.upload(job, bytes, signal), signal), signal, 1),
    prepare: (job, signal) => cloud.prepare(job, signal, resolveName),
    async read(job: UploadJob, signal) {
      signal.throwIfAborted();
      if (job.source.kind === 'native') {
        const result = await (await nativeBridge()).readCloudOriginalUpload(job.owner, job.source.original, signal);
        if (result.studentId !== job.studentId) throw new Error('原图所属孩子不匹配');
        return result;
      }
      if (!job.source.file) throw new Error('本机原图不可用，请重新选择');
      const digest = await sha256(job.source.file); signal.throwIfAborted();
      return { file: job.source.file, sha256: digest };
    },
    preview: (photo, signal) => gate.run(() => retryBusy(() => cloud.blob(photo, false, signal), signal), signal),
    async download(photo, signal) {
      if (native) {
        const bridge = await nativeBridge();
        if (typeof bridge.downloadCloudOriginal !== 'function') throw new Error('此版本尚未接入原图保存，请更新应用');
        const result = await bridge.downloadCloudOriginal({ base: api.base, token: api.token, path: cloudFilePath(photo), name: photo.originalName, mime: photo.mimeType, bytes: photo.size, sha256: photo.sha256 }, signal);
        if (result.cancelled) throw new DOMException('已取消保存', 'AbortError');
        if (!result.saved) throw new Error('原图未保存，请重试');
      } else {
        const file = await cloud.blob(photo, true, signal); signal.throwIfAborted();
        const url = URL.createObjectURL(file), a = document.createElement('a'); a.href = url; a.download = photo.originalName; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    },
    ...(native ? {
      pendingImports: async (scope: CloudScope, signal: AbortSignal) => {
        const { batches } = await (await nativeBridge()).listOriginalBatches(scope.owner, scope.studentId, 'cloud-original');
        signal.throwIfAborted();
        if (batches.some(batch => batch.studentId !== scope.studentId || batch.purpose !== 'cloud-original')) throw new Error('相册记录所属孩子不匹配');
        return batches.filter(batch => batch.state !== 'cancelled').flatMap(batch => batch.items?.map(item => item.originalId) || []);
      },
      pick: async (scope: CloudScope, limit: number, signal: AbortSignal, folderRange = false, albumRange = false, progress?: (value: ImportProgress) => void) => {
        const bridge = await nativeBridge(); return fromNative(await bridge.pickOriginals(scope.owner, scope.studentId, limit, { purpose: 'cloud-original', signal, ...progressOption(progress), ...(folderRange ? { folderRange: true } : {}), ...(albumRange ? { albumRange: true } : {}) }), scope, bridge);
      },
      recover: async (scope: CloudScope, _limit: number, signal: AbortSignal, progress?: (value: ImportProgress) => void) => {
        const bridge = await nativeBridge();
        const { batches } = await bridge.listOriginalBatches(scope.owner, scope.studentId, 'cloud-original');
        signal.throwIfAborted();
        if (batches.some(batch => batch.studentId !== scope.studentId || batch.purpose !== 'cloud-original')) throw new Error('上次选图记录所属孩子不匹配');
        const ordered = batches.sort((a, b) => a.createdAt - b.createdAt);
        // Old empty cancellations must not repeatedly hide the real unfinished selection.
        for (const empty of ordered.filter(batch => batch.state === 'cancelled' && batch.items?.length === 0)) {
          await bridge.forgetOriginalBatch(scope.owner, scope.studentId, empty.batchId); signal.throwIfAborted();
        }
        const batch = ordered.find(batch => !(batch.state === 'cancelled' && batch.items?.length === 0));
        if (!batch) return { items: [], failures: [] };
        if (batch.state === 'selecting') return { items: [], failures: ['上次系统相册尚未返回，请完成选择；也可忽略这次未完成的选图。'], discardRecovery: () => discardBatch(bridge, scope, batch.batchId) };
        return fromNative(await bridge.resumeOriginalBatch(scope.owner, scope.studentId, batch.batchId, { signal, purpose: 'cloud-original', ...progressOption(progress) }), scope, bridge);
      },
    } : {}),
  };
}
function progressOption(progress?: (value: ImportProgress) => void) {
  return progress ? { onProgress: (batch: NativePhotoBatch) => progress({ total: batch.items.length, imported: batch.items.filter(item => item.status === 'imported').length, failed: batch.items.filter(item => item.status === 'failed').length }) } : {};
}
