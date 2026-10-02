import type { OriginalPhoto } from '../photo-processing';

export const BATCH_LIMIT = 100;
export type CloudScope = { owner: string; studentId: string };
export type CloudPhoto = {
  id: string; batchId: string; clientRequestId: string; studentId: string; originalName: string; mimeType: string;
  size: number; sha256: string; createdAt: string; source?: string;
};
export type CloudLimits = { maxFileBytes: number; mimeTypes: string[]; maxBatch: number };
export type OriginalSource =
  | { kind: 'web'; file?: Blob }
  | { kind: 'native'; original: OriginalPhoto };
export type UploadStatus = 'queued' | 'uploading' | 'paused' | 'failed' | 'completed';
export type UploadJob = CloudScope & {
  id: string; clientBatchId: string; expectedCount: number; name: string; size: number; mimeType: string; createdAt: number;
  source: OriginalSource; status: UploadStatus; message?: string; sha256?: string; receipt?: CloudPhoto;
};
export type PickedOriginal = { id?: string; name: string; size: number; mimeType: string; source: OriginalSource };
export type PickResult = { items: PickedOriginal[]; failures: string[]; cancelled?: boolean; acknowledge?: () => Promise<void>; discardRecovery?: () => Promise<void> };
export type UploadBytes = { file: Blob; sha256: string };
export type CloudPage = { photos: CloudPhoto[]; nextCursor?: string | null; storage?: { usedBytes: number; limitBytes: number } };
export interface DriveStore {
  list(scope: CloudScope): Promise<UploadJob[]>;
  put(job: UploadJob): Promise<void>;
  remove(scope: CloudScope, id: string): Promise<void>;
}
export interface DriveServices {
  native: boolean;
  limits(signal?: AbortSignal): Promise<CloudLimits>;
  list(studentId: string, cursor?: string, signal?: AbortSignal): Promise<CloudPage>;
  upload(job: UploadJob, bytes: UploadBytes, signal: AbortSignal): Promise<CloudPhoto>;
  read(job: UploadJob, signal: AbortSignal): Promise<UploadBytes>;
  preview(photo: CloudPhoto, signal: AbortSignal): Promise<Blob>;
  download(photo: CloudPhoto, signal: AbortSignal): Promise<void>;
  pick?(scope: CloudScope, limit: number, signal: AbortSignal): Promise<PickResult>;
  recover?(scope: CloudScope, limit: number, signal: AbortSignal): Promise<PickResult>;
}

export function assertScope(scope: CloudScope) {
  if (!scope.owner.trim() || !scope.studentId.trim()) throw new Error('请先选择账号和孩子');
}
export function inScope(job: CloudScope, scope: CloudScope) {
  return job.owner === scope.owner && job.studentId === scope.studentId;
}
export function assertReceipt(photo: CloudPhoto, job: UploadJob, sha256: string) {
  if (!photo?.id || !photo.batchId || photo.clientRequestId !== job.id || photo.studentId !== job.studentId || photo.size !== job.size || photo.sha256 !== sha256 || photo.mimeType !== job.mimeType)
    throw new Error('云端回执与原图不一致，记录已保留，请重试核对');
}
