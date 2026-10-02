import { photoPlugin } from './native-plugin';
import { getOriginal, photoProcessingAvailable, validateOriginal, type OriginalPhoto } from './index';

export type PhotoBatchPurpose = 'processed' | 'cloud-original';
// A native cloud batch stores a picker selection. The upload queue splits it into 200-item server batches.
const batchLimit = (value: PhotoBatchPurpose) => value === 'cloud-original' ? 2147483647 : 100;
export type NativePhotoBatch = {
  schemaVersion: 1; batchId: string; studentId: string; purpose: PhotoBatchPurpose;
  state: 'selecting' | 'ready' | 'completed' | 'cancelled'; limit: number; createdAt: number;
  items: { index: number; originalId: string; status: 'pending' | 'imported' | 'failed'; error?: string }[];
};
export type OriginalBatchResult = {
  batchId: string; originals: OriginalPhoto[];
  failures: { index: number; originalId: string; message: string }[]; cancelled: boolean;
};
export type OriginalBatchOptions = {
  purpose?: PhotoBatchPurpose; signal?: AbortSignal; onProgress?: (batch: NativePhotoBatch) => void;
};
type Scope = { owner: string; studentId: string };
type BatchScope = Scope & { batchId: string };
interface NativeBatches {
  pickOriginalBatch(input: Scope & { limit: number; purpose: PhotoBatchPurpose }): Promise<NativePhotoBatch>;
  getOriginalBatch(input: BatchScope): Promise<NativePhotoBatch>;
  listOriginalBatches(input: Scope & { purpose?: PhotoBatchPurpose }): Promise<{ batches: NativePhotoBatch[] }>;
  importBatchItem(input: BatchScope & { index: number }): Promise<{ batch: NativePhotoBatch; original?: OriginalPhoto }>;
  cancelOriginalBatch(input: BatchScope): Promise<NativePhotoBatch>;
  forgetOriginalBatch(input: BatchScope): Promise<void>;
}
const native = photoPlugin<NativeBatches>();
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/;
function scope(owner: string, studentId: string, batchId?: string) {
  if (!photoProcessingAvailable()) throw new Error('此设备尚未接入本地批量照片导入');
  if (!owner?.trim() || owner.length > 1024 || !studentId?.trim() || studentId.length > 200) throw new Error('请先选择账号和学生');
  if (batchId !== undefined && !uuid.test(batchId)) throw new Error('照片批次编号无效');
}
function purpose(value?: PhotoBatchPurpose) {
  if (value !== undefined && !['processed', 'cloud-original'].includes(value)) throw new Error('照片批次用途无效');
}
export function validatePhotoBatch(batch: NativePhotoBatch, studentId: string, batchId?: string) {
  if (!batch || batch.schemaVersion !== 1 || !uuid.test(batch.batchId) || (batchId !== undefined && batch.batchId !== batchId) ||
    batch.studentId !== studentId || !['processed', 'cloud-original'].includes(batch.purpose) ||
    !['selecting', 'ready', 'completed', 'cancelled'].includes(batch.state) ||
    !Number.isInteger(batch.limit) || batch.limit < 1 || batch.limit > batchLimit(batch.purpose) || !Number.isFinite(batch.createdAt) || batch.createdAt <= 0 ||
    !Array.isArray(batch.items) || batch.items.length > batch.limit ||
    batch.items.some((item, index) => item.index !== index || !uuid.test(item.originalId) || !['pending', 'imported', 'failed'].includes(item.status)) ||
    new Set(batch.items.map(item => item.originalId)).size !== batch.items.length ||
    (batch.state === 'completed' && batch.items.some(item => item.status !== 'imported')))
    throw new Error('照片批次记录或学生归属无效');
  return batch;
}
export async function pickOriginalBatch(owner: string, studentId: string, limit = 100, batchPurpose: PhotoBatchPurpose = 'processed') {
  scope(owner, studentId); purpose(batchPurpose);
  if (!Number.isInteger(limit) || limit < 1 || limit > batchLimit(batchPurpose)) throw new Error(`每批最多选择 ${batchLimit(batchPurpose)} 张照片`);
  const batch = validatePhotoBatch(await native.pickOriginalBatch({ owner, studentId, limit, purpose: batchPurpose }), studentId);
  if (batch.purpose !== batchPurpose || (batchPurpose === 'cloud-original' ? batch.limit < limit : batch.limit !== limit)) throw new Error('相册选择与请求的批次不匹配');
  return batch;
}
export async function getOriginalBatch(owner: string, studentId: string, batchId: string) {
  scope(owner, studentId, batchId);
  return validatePhotoBatch(await native.getOriginalBatch({ owner, studentId, batchId }), studentId, batchId);
}
export async function listOriginalBatches(owner: string, studentId: string, batchPurpose?: PhotoBatchPurpose) {
  scope(owner, studentId); purpose(batchPurpose);
  const result = await native.listOriginalBatches({ owner, studentId, purpose: batchPurpose });
  if (!Array.isArray(result.batches)) throw new Error('照片批次列表无效');
  for (const batch of result.batches) {
    validatePhotoBatch(batch, studentId);
    if (batchPurpose && batch.purpose !== batchPurpose) throw new Error('照片批次用途不匹配');
  }
  return result;
}
export async function cancelOriginalBatch(owner: string, studentId: string, batchId: string) {
  scope(owner, studentId, batchId);
  return validatePhotoBatch(await native.cancelOriginalBatch({ owner, studentId, batchId }), studentId, batchId);
}
/** Acknowledge only after durable application enqueue. Does not remove any original. */
export async function forgetOriginalBatch(owner: string, studentId: string, batchId: string) {
  scope(owner, studentId, batchId);
  await native.forgetOriginalBatch({ owner, studentId, batchId });
}
export async function importBatchItem(owner: string, studentId: string, batchId: string, index: number) {
  scope(owner, studentId, batchId);
  if (!Number.isInteger(index) || index < 0 || index >= 2147483647) throw new Error('照片序号无效');
  const result = await native.importBatchItem({ owner, studentId, batchId, index });
  validatePhotoBatch(result.batch, studentId, batchId);
  if (result.original) {
    validateOriginal(result.original);
    if (result.original.studentId !== studentId || result.original.originalId !== result.batch.items[index]?.originalId || result.batch.items[index]?.status !== 'imported')
      throw new Error('导入照片与学生或批次不匹配');
  }
  return result;
}
/** Metadata only: one native image decode at a time. No base64 and no multi-image Blob array. */
export async function resumeOriginalBatch(owner: string, studentId: string, batchId: string, options: OriginalBatchOptions = {}): Promise<OriginalBatchResult> {
  let batch = await getOriginalBatch(owner, studentId, batchId);
  purpose(options.purpose);
  if (options.purpose && batch.purpose !== options.purpose) throw new Error('照片批次用途不匹配');
  if (batch.state === 'selecting') throw new Error('上次系统相册尚未返回，可返回相册完成选择或取消该批次');
  const result: OriginalBatchResult = { batchId, originals: [], failures: [], cancelled: batch.state === 'cancelled' };
  options.onProgress?.(batch);
  for (const item of batch.items) {
    if (options.signal?.aborted) {
      if (batch.state !== 'cancelled') batch = await cancelOriginalBatch(owner, studentId, batchId);
      result.cancelled = true; options.onProgress?.(batch); break;
    }
    if (batch.state === 'cancelled' && item.status !== 'imported') continue;
    try {
      let original: OriginalPhoto | undefined;
      if (item.status === 'imported') original = await getOriginal(owner, item.originalId);
      else {
        const next = await importBatchItem(owner, studentId, batchId, item.index);
        batch = next.batch; original = next.original;
      }
      if (!original) throw new Error(batch.items[item.index]?.error || '照片尚未导入，可单张重试');
      if (original.studentId !== studentId) throw new Error('原片学生归属不匹配');
      result.originals.push(original);
    } catch (error) {
      result.failures.push({ index: item.index, originalId: item.originalId, message: error instanceof Error ? error.message : '照片导入失败，可重试' });
    }
    options.onProgress?.(batch);
  }
  if (options.signal?.aborted && !result.cancelled) {
    await cancelOriginalBatch(owner, studentId, batchId); result.cancelled = true;
  }
  return result;
}
export async function pickOriginals(owner: string, studentId: string, limit = 100, options: OriginalBatchOptions = {}): Promise<OriginalBatchResult> {
  options.signal?.throwIfAborted();
  const batch = await pickOriginalBatch(owner, studentId, limit, options.purpose);
  return resumeOriginalBatch(owner, studentId, batch.batchId, options);
}
