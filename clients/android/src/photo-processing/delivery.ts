import { getOriginal, readConfirmedUpload, validateOriginal, validatePrepared, type OriginalPhoto, type PreparedPhoto } from './index';

/** Local recovery record only. Never POST this object: it contains private paths and account identity. */
export type PhotoDeliveryRecord = {
  version: 1; id: string; owner: string; studentId: string; confirmedAt: number;
  policy: 'processed-only'; original: OriginalPhoto; prepared: PreparedPhoto;
};
export type PhotoDelivery = {
  record: PhotoDeliveryRecord;
  upload: Awaited<ReturnType<typeof readConfirmedUpload>> & { sourceKind: 'processed-photo' };
};

export function validateDeliveryRecord(record: PhotoDeliveryRecord, owner: string, studentId: string) {
  if (record.version !== 1 || !owner.trim() || !studentId.trim() || record.owner !== owner || record.studentId !== studentId ||
      record.policy !== 'processed-only' || !Number.isFinite(record.confirmedAt) || record.confirmedAt <= 0)
    throw new Error('待提交照片归属不匹配');
  validateOriginal(record.original); validatePrepared(record.prepared);
  if (record.id !== record.prepared.outputId || record.original.studentId !== studentId || record.prepared.studentId !== studentId ||
      record.original.originalId !== record.prepared.originalId || record.original.sha256 !== record.prepared.sourceSha256 ||
      record.original.uprightWidth !== record.prepared.sourceWidth || record.original.uprightHeight !== record.prepared.sourceHeight ||
      record.original.orientation !== record.prepared.exifOrientation)
    throw new Error('处理结果与原片不匹配');
}

/** Rechecks owner/student/source binding before reading processed bytes. Does not read or upload original bytes. */
export async function recoverPhotoDelivery(record: PhotoDeliveryRecord, owner: string, studentId: string, signal?: AbortSignal): Promise<PhotoDelivery> {
  signal?.throwIfAborted(); validateDeliveryRecord(record, owner, studentId);
  const current = await getOriginal(owner, record.original.originalId);
  if (current.studentId !== studentId || current.sha256 !== record.original.sha256 || current.originalUri !== record.original.originalUri)
    throw new Error('本机原片记录已变化，请重新处理');
  // Native outputs are siblings of this account's immutable original. A persisted reference must not escape that directory.
  if (record.prepared.uri !== current.originalUri.slice(0, current.originalUri.lastIndexOf('/') + 1) + record.prepared.outputId + '.jpg')
    throw new Error('处理图不在当前原片的本机目录内');
  const upload = await readConfirmedUpload(record.prepared, true, signal);
  signal?.throwIfAborted();
  return { record, upload: { ...upload, sourceKind: 'processed-photo' } };
}

export async function buildPhotoDelivery(owner: string, original: OriginalPhoto, prepared: PreparedPhoto, confirmed: boolean,
  signal?: AbortSignal): Promise<PhotoDelivery> {
  if (confirmed !== true) throw new Error('请先预览并确认处理后的照片');
  const record: PhotoDeliveryRecord = { version: 1, id: prepared.outputId, owner, studentId: original.studentId,
    policy: 'processed-only', confirmedAt: Date.now(), original: { ...original }, prepared: { ...prepared } };
  return recoverPhotoDelivery(record, owner, original.studentId, signal);
}

const prefix = 'family-photo-delivery-v1:';
function key(owner: string, studentId: string, id: string) { return prefix + JSON.stringify([owner, studentId, id]); }

/** Persist references to durable native files, not duplicate image blobs in WebView storage. Quota errors propagate. */
export function savePhotoDelivery(delivery: PhotoDelivery, storage: Storage = localStorage) {
  const r = delivery.record;
  validateDeliveryRecord(r, r.owner, r.studentId);
  storage.setItem(key(r.owner, r.studentId, r.id), JSON.stringify(r));
}

export function listPhotoDeliveries(owner: string, studentId: string, storage: Storage = localStorage): PhotoDeliveryRecord[] {
  if (!owner.trim() || !studentId.trim()) throw new Error('请先选择账号和学生');
  const results: PhotoDeliveryRecord[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (!k?.startsWith(prefix)) continue;
    let scope: unknown;
    try { scope = JSON.parse(k.slice(prefix.length)); } catch { continue; }
    if (!Array.isArray(scope) || scope[0] !== owner || scope[1] !== studentId) continue;
    const r = JSON.parse(storage.getItem(k) || 'null') as PhotoDeliveryRecord;
    if (!r) throw new Error('本机待提交记录损坏，请从原片重新处理');
    validateDeliveryRecord(r, owner, studentId);
    if (r.id !== scope[2]) throw new Error('本机待提交记录编号不匹配');
    results.push(r);
  }
  return results.sort((a, b) => b.confirmedAt - a.confirmedAt);
}

/** Host calls only after a verified server acknowledgement or an explicit discard. Keeps all native originals. */
export function removePhotoDelivery(owner: string, studentId: string, id: string, storage: Storage = localStorage) {
  storage.removeItem(key(owner, studentId, id));
}
