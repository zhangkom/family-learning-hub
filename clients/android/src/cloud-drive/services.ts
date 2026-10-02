import { Capacitor } from '@capacitor/core';
import type { FamilyApi } from '../api';
import type { OriginalPhoto } from '../photo-processing';
import { createCloudApi, cloudFilePath, sha256 } from './api';
import type { CloudScope, DriveServices, PickResult, UploadJob } from './types';
import { ImageRequestGate, retryBusy } from './scheduler';

type BatchResult = { batchId: string; originals: OriginalPhoto[]; failures: { index: number; originalId: string; message: string }[]; cancelled: boolean };
type NativeBridge = {
  pickOriginals(owner: string, studentId: string, limit: number, options: { purpose: 'cloud-original'; signal?: AbortSignal }): Promise<BatchResult>;
  readCloudOriginalUpload(owner: string, photo: OriginalPhoto, signal?: AbortSignal): Promise<{ file: Blob; sha256: string; studentId: string }>;
  listOriginalBatches(owner: string, studentId: string, purpose: 'cloud-original'): Promise<{ batches: { batchId: string; studentId: string; purpose: string; state: string; createdAt: number }[] }>;
  resumeOriginalBatch(owner: string, studentId: string, batchId: string, options: { signal?: AbortSignal }): Promise<BatchResult>;
  forgetOriginalBatch(owner: string, studentId: string, batchId: string): Promise<void>;
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
  return { cancelled: result.cancelled, ...(result.batchId && !result.failures.length ? { acknowledge: () => bridge.forgetOriginalBatch(scope.owner, scope.studentId, result.batchId) } : {}), failures: result.failures.map(f => `第 ${f.index + 1} 张未导入：${f.message}`), items: result.originals.map(original => ({
    id: original.originalId, name: `原图-${original.originalId}.${original.mime === 'image/png' ? 'png' : original.mime === 'image/webp' ? 'webp' : 'jpg'}`,
    size: original.bytes, mimeType: original.mime, source: { kind: 'native', original },
  })) };
}
export function createDriveServices(api: FamilyApi): DriveServices {
  const cloud = createCloudApi(api), native = Capacitor.getPlatform() === 'android', gate = new ImageRequestGate();
  return {
    native, limits: cloud.limits, list: cloud.list, upload: (job, bytes, signal) => gate.run(() => cloud.upload(job, bytes, signal), signal, 1),
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
      pick: async (scope: CloudScope, limit: number, signal: AbortSignal) => {
        const bridge = await nativeBridge(); return fromNative(await bridge.pickOriginals(scope.owner, scope.studentId, limit, { purpose: 'cloud-original', signal }), scope, bridge);
      },
      recover: async (scope: CloudScope, _limit: number, signal: AbortSignal) => {
        const bridge = await nativeBridge();
        const { batches } = await bridge.listOriginalBatches(scope.owner, scope.studentId, 'cloud-original');
        signal.throwIfAborted();
        if (batches.some(batch => batch.studentId !== scope.studentId || batch.purpose !== 'cloud-original')) throw new Error('上次选图记录所属孩子不匹配');
        const batch = batches.sort((a, b) => a.createdAt - b.createdAt).find(batch => batch.state !== 'selecting');
        if (!batch) return { items: [], failures: [] };
        return fromNative(await bridge.resumeOriginalBatch(scope.owner, scope.studentId, batch.batchId, { signal }), scope, bridge);
      },
    } : {}),
  };
}
