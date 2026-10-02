import { assertScope, inScope, type CloudScope, type DriveStore, type UploadJob } from './types';

// Separate from scans/drafts. Tokens never enter this database.
function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('family-learning-cloud-drive', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('uploads', { keyPath: ['owner', 'studentId', 'id'] });
      store.createIndex('scope', ['owner', 'studentId']);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本机上传记录，请检查可用空间'));
  });
}
async function operation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('uploads', mode);
      const request = run(transaction.objectStore('uploads'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(new Error('本机上传记录保存失败，请检查可用空间'));
    });
  } finally { db.close(); }
}
export const driveStore: DriveStore = {
  async list(scope) {
    assertScope(scope);
    const rows = await operation<UploadJob[]>('readonly', store => store.index('scope').getAll([scope.owner, scope.studentId]));
    return rows.filter(row => inScope(row, scope)).sort((a, b) => a.createdAt - b.createdAt);
  },
  async put(job) {
    assertScope(job);
    if (!job.id || !Number.isSafeInteger(job.size) || job.size < 1) throw new Error('上传记录无效');
    await operation('readwrite', store => store.put(job));
  },
  async remove(scope: CloudScope, id: string) {
    assertScope(scope);
    await operation('readwrite', store => store.delete([scope.owner, scope.studentId, id]));
  },
};
