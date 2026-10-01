import type { Question } from './types';
// Processed photos keep references to native files; browser/legacy drafts retain the existing Blob store.
export { listPhotoDeliveries, recoverPhotoDelivery, removePhotoDelivery, removeDamagedPhotoDelivery } from './photo-processing/delivery';
export type { PhotoDeliveryRecord, PhotoDeliveryIssue } from './photo-processing/delivery';
export type Draft = {
  id: string;
  owner: string;
  studentId: string;
  source: string;
  name: string;
  file: Blob;
  createdAt: number;
};
function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('family-learning-capture', 2);
    request.onupgradeneeded = () => {
      for (const name of ['drafts', 'reviews'])
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error('无法保存本机草稿，请检查可用空间'));
  });
}
async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
  name = 'drafts',
) {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(name, mode);
      const request = operation(transaction.objectStore(name));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () =>
        reject(new Error('本机草稿保存未完成'));
    });
  } finally {
    db.close();
  }
}
export const drafts = {
  save: (draft: Draft) => transact('readwrite', (s) => s.put(draft)),
  remove: (id: string) => transact('readwrite', (s) => s.delete(id)),
  async list(owner: string) {
    return (await transact<Draft[]>('readonly', (s) => s.getAll()))
      .filter((d) => d.owner === owner)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
};
export type ReviewDraft = {
  id: string;
  revision: number;
  questions: Question[];
};
export const reviewDrafts = {
  read: (id: string) =>
    transact<ReviewDraft | undefined>('readonly', (s) => s.get(id), 'reviews'),
  save: (draft: ReviewDraft) =>
    transact('readwrite', (s) => s.put(draft), 'reviews'),
  remove: (id: string) => transact('readwrite', (s) => s.delete(id), 'reviews'),
};
