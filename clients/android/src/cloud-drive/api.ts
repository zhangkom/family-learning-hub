import { ApiError, FamilyApi, sessionExpiredEvent } from '../api';
import { assertReceipt, type CloudLimits, type CloudPage, type CloudPhoto, type UploadBytes, type UploadJob, type NameCheck, type ResolveName, type CloudPhotoFilter, type CloudFolders } from './types';

export async function sha256(file: Blob) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
}
export function cloudFilePath(photo: CloudPhoto) { return `/cloud-photos/${encodeURIComponent(photo.id)}/file`; }
export function createCloudApi(api: FamilyApi) {
  let cachedLimits: CloudLimits | undefined;
  const batches = new Map<string, string>();
  async function limits(signal?: AbortSignal): Promise<CloudLimits> {
    const setup = await api.request<{ cloudPhotos?: { version: number; maxFileBytes: number; maxBatchItems: number; mimeTypes: string[]; nameConflictVersion?: number; archiveVersion?: number } }>('/setup', 'GET', undefined, signal);
    const cap = setup.cloudPhotos;
    if (!cap || cap.version !== 1 || !Number.isSafeInteger(cap.maxFileBytes) || cap.maxFileBytes < 1 || !Number.isInteger(cap.maxBatchItems) || cap.maxBatchItems < 1 || !Array.isArray(cap.mimeTypes) || !cap.mimeTypes.length)
      throw new Error('服务器尚未开放图片云盘，请更新服务后重试');
    cachedLimits = { maxFileBytes: cap.maxFileBytes, maxBatch: cap.maxBatchItems, mimeTypes: cap.mimeTypes, nameConflictVersion: cap.nameConflictVersion, archiveVersion: cap.archiveVersion };
    return cachedLimits;
  }
  async function prepare(job: UploadJob, signal: AbortSignal, resolve?: ResolveName): Promise<UploadJob> {
    const cap = cachedLimits || await limits(signal);
    if (cap.nameConflictVersion !== 1 || job.expectedCount > cap.maxBatch)
      throw new Error('服务器需要更新才能检查同名图片和接收整批上传，本机照片已保留');
    for (;;) {
      signal.throwIfAborted();
      const checked = await api.request<NameCheck>(`/cloud-photos/name?studentId=${encodeURIComponent(job.studentId)}&name=${encodeURIComponent(job.name)}&clientRequestId=${encodeURIComponent(job.id)}`, 'GET', undefined, signal);
      if (!checked.name || !checked.suggestedName || !Number.isSafeInteger(checked.conflicts) || checked.conflicts < 0 || !/^[a-f\d]{64}$/.test(checked.token)) throw new Error('同名检查结果无效');
      if (checked.receipt) return job; // Retry the durable request identity; the upload verifies the complete receipt.
      job = { ...job, name: checked.name };
      if (!checked.conflicts) return { ...job, nameToken: undefined };
      if (job.nameToken === checked.token) return job;
      if (!resolve) throw new Error('云盘中已有同名图片，请选择覆盖或重命名');
      const choice = await resolve(checked, signal);
      signal.throwIfAborted();
      if (choice.action === 'replace') return { ...job, nameToken: checked.token };
      if (!choice.name.trim() || choice.name.length > 255 || /[\\/]/.test(choice.name) || Array.from(choice.name).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new Error('请输入有效的图片名称');
      job = { ...job, name: choice.name, nameToken: undefined };
    }
  }
  async function upload(job: UploadJob, bytes: UploadBytes, signal: AbortSignal) {
    const cap = cachedLimits || await limits(signal);
    if (job.size > cap.maxFileBytes || !cap.mimeTypes.includes(job.mimeType)) throw new Error('原图格式或大小超过云盘限制，请重新选择；不会自动压缩');
    let batchId = batches.get(job.clientBatchId);
    if (!batchId) {
      const { batch } = await api.request<{ batch: { id: string; studentId: string; clientBatchId: string; expectedCount: number } }>('/cloud-photo-batches', 'POST', {
        studentId: job.studentId, clientBatchId: job.clientBatchId, expectedCount: job.expectedCount,
      }, signal);
      if (!batch?.id || batch.studentId !== job.studentId || batch.clientBatchId !== job.clientBatchId || batch.expectedCount !== job.expectedCount)
        throw new Error('云端批次归属不匹配，尚未上传原图');
      batchId = batch.id; batches.set(job.clientBatchId, batchId);
    }
    signal.throwIfAborted();
    const form = new FormData();
    form.set('studentId', job.studentId); form.set('batchId', batchId); form.set('clientRequestId', job.id);
    form.set('sha256', bytes.sha256); form.set('file', bytes.file, job.name);
    form.set('nameAction', job.nameToken ? 'replace' : 'check');
    if (job.nameToken) form.set('nameToken', job.nameToken);
    const { photo } = await api.request<{ photo: CloudPhoto }>('/cloud-photos', 'POST', form, signal);
    assertReceipt(photo, job, bytes.sha256);
    // Server sanitizes the displayed filename; identity and content fields remain exact.
    if (photo.batchId !== batchId || !photo.originalName) throw new Error('云端原图回执不一致，记录已保留');
    return photo;
  }
  async function list(studentId: string, cursor?: string, signal?: AbortSignal, filter?: CloudPhotoFilter) {
    const data = await api.request<CloudPage>(`/cloud-photos?studentId=${encodeURIComponent(studentId)}&limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}${filter?.documentId ? `&documentId=${encodeURIComponent(filter.documentId)}` : ''}${filter?.unclassified ? '&unclassified=1' : ''}`, 'GET', undefined, signal);
    if (!Array.isArray(data.photos) || data.photos.some(photo => photo.studentId !== studentId || !photo.id)) throw new Error('云图所属孩子不匹配，请刷新');
    if (filter?.documentId && data.photos.some(photo => photo.archive?.documentId !== filter.documentId)) throw new Error('作业页归属已变化，请返回重新选择');
    if (filter?.unclassified && data.photos.some(photo => photo.archive)) throw new Error('图片分类已变化，请刷新');
    return data;
  }
  async function folders(studentId: string, subject?: string, cursor?: string, signal?: AbortSignal) {
    const data = await api.request<CloudFolders>(`/cloud-photo-folders?studentId=${encodeURIComponent(studentId)}${subject ? `&subject=${encodeURIComponent(subject)}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, 'GET', undefined, signal);
    if (subject ? !Array.isArray(data.documents) || data.documents.some(doc => doc.subject !== subject || !doc.id || !doc.title) : !Array.isArray(data.subjects) || !Number.isSafeInteger(data.unclassifiedCount)) throw new Error('作业目录读取不完整，请刷新');
    return data;
  }
  async function photo(id: string, studentId: string, signal: AbortSignal) {
    const data = await api.request<{ photo: CloudPhoto }>(`/cloud-photos/${encodeURIComponent(id)}?studentId=${encodeURIComponent(studentId)}`, 'GET', undefined, signal);
    if (!data.photo || data.photo.id !== id || data.photo.studentId !== studentId) throw new Error('原件不属于当前学生，请返回重新读取');
    return data.photo;
  }
  async function blob(photo: CloudPhoto, original: boolean, signal: AbortSignal) {
    const controller = new AbortController(), abort = () => controller.abort(signal.reason);
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const path = `${original ? cloudFilePath(photo) : `/cloud-photos/${encodeURIComponent(photo.id)}/thumbnail`}?studentId=${encodeURIComponent(photo.studentId)}`;
      const response = await fetch(`${api.base}${path}`, { headers: { Authorization: `Bearer ${api.token}` }, signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
      if (response.status === 401) window.dispatchEvent(new CustomEvent(sessionExpiredEvent, { detail: { base: api.base, token: api.token } }));
      if (!response.ok) throw new ApiError(`图片读取未完成（${response.status}）`, response.status);
      const file = await response.blob(); signal.throwIfAborted();
      if (original && (file.size !== photo.size || await sha256(file) !== photo.sha256)) throw new Error('原图完整性校验失败，未保存下载文件');
      return file;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }
  return { limits, list, folders, photo, upload, prepare, blob };
}
