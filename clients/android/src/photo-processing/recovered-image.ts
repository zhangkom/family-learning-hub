import { questionImageHash, questionImageIdentity, type QuestionImageRecord } from '../question-image-identity';

export type ImageScan = QuestionImageRecord;
type SavedImage = { key: string; schemaVersion: 1; fingerprint: string; sha256: string; file: Blob };
const databaseName = 'family-learning-recovered-question-images';
const supported = ['image/jpeg', 'image/png', 'image/webp'];

function identity(owner: string, scan: ImageScan) {
  if (!owner || !scan.id || !scan.studentId || !Number.isSafeInteger(scan.size) || scan.size < 1 ||
      scan.size > 32 * 1024 * 1024 || !supported.includes(scan.mimeType) ||
      (scan.processing && scan.processing.studentId !== scan.studentId) ||
      (questionImageHash(scan) !== undefined && !/^[a-f\d]{64}$/.test(questionImageHash(scan)!)))
    throw new Error('题图归属或文件信息不完整，请刷新题目后重试');
  // Original files remain immutable; scanSha256 identifies a newer derived question image.
  return { key: JSON.stringify([owner, scan.studentId, scan.id]),
    fingerprint: questionImageIdentity(scan) };
}
async function digest(file: Blob, scan: ImageScan, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!(file instanceof Blob) || file.size !== scan.size || file.type !== scan.mimeType)
    throw new Error('题图文件与记录不匹配，请重新恢复');
  const bytes = await file.arrayBuffer(); signal.throwIfAborted();
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  signal.throwIfAborted();
  if (questionImageHash(scan) && sha !== questionImageHash(scan)) throw new Error('题图校验失败，请重新恢复');
  return sha;
}
function operation<T>(mode: IDBTransactionMode, signal: AbortSignal, run: (store: IDBObjectStore) => IDBRequest<T>) {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    let db: IDBDatabase | undefined, transaction: IDBTransaction | undefined, settled = false;
    const finish = (error?: unknown, result?: T) => {
      if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', aborted); db?.close();
      if (error) reject(error); else resolve(result as T);
    };
    const stopped = (error: unknown) => { try { transaction?.abort(); } catch { /* already completed */ } finish(error); };
    const aborted = () => stopped(signal.reason || new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => stopped(new Error('本机题图存储暂时无法打开，请稍后重试')), 15000);
    signal.addEventListener('abort', aborted, { once: true });
    const storageError = () => finish(new Error('本机题图保存或读取失败，请检查手机可用空间后重试'));
    try {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (settled) { request.transaction?.abort(); return; }
        request.result.createObjectStore('images', { keyPath: 'key' });
      };
      request.onerror = storageError;
      request.onblocked = () => stopped(new Error('本机题图存储正在占用，请关闭其他页面后重试'));
      request.onsuccess = () => {
        db = request.result;
        if (settled || signal.aborted) { db.close(); if (!settled) aborted(); return; }
        db.onversionchange = () => db?.close();
        try {
          transaction = db.transaction('images', mode);
          const item = run(transaction.objectStore('images'));
          transaction.oncomplete = () => finish(undefined, item.result);
          transaction.onerror = transaction.onabort = storageError;
        } catch { stopped(new Error('本机题图保存或读取失败，请检查手机可用空间后重试')); }
      };
    } catch { storageError(); }
  });
}

/** Private WebView storage, partitioned by server/account/student. No tokens or network access. */
export const recoveredImages = {
  validate(owner: string, scan: ImageScan) { identity(owner, scan); },
  verify(scan: ImageScan, file: Blob, signal: AbortSignal) { return digest(file, scan, signal); },
  async read(owner: string, scan: ImageScan, signal: AbortSignal): Promise<Blob | undefined> {
    const id = identity(owner, scan);
    const saved = await operation<SavedImage | undefined>('readonly', signal, store => store.get(id.key));
    if (!saved) return undefined;
    if (saved.fingerprint !== id.fingerprint) {
      // Reuse pre-version caches only when their actual digest matches the current image.
      const legacy = JSON.stringify([scan.size, scan.mimeType, scan.processing?.sha256 || null]);
      if (saved.fingerprint !== legacy || !questionImageHash(scan) && scan.imageRevision !== undefined || questionImageHash(scan) && saved.sha256 !== questionImageHash(scan)) return undefined;
    }
    if (saved.schemaVersion !== 1 || saved.key !== id.key ||
        typeof saved.sha256 !== 'string' || !/^[a-f\d]{64}$/.test(saved.sha256))
      throw new Error('已保存的本机题图与当前记录不匹配，请重新恢复');
    if (await digest(saved.file, scan, signal) !== saved.sha256) throw new Error('已保存的本机题图校验失败，请重新恢复');
    return saved.file;
  },
  async save(owner: string, scan: ImageScan, file: Blob, signal: AbortSignal) {
    const id = identity(owner, scan), sha256 = await digest(file, scan, signal);
    signal.throwIfAborted();
    await operation('readwrite', signal, store => store.put({ ...id, schemaVersion: 1, sha256, file } satisfies SavedImage));
  },
};
