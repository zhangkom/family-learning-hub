import { Buffer } from 'node:buffer';
import type {
  CloudDocument,
  CloudPhoto,
  CloudPhotoFolders,
  PhotoArchive,
} from '../lib/cloud-photos';
import { scanSubjects } from '../lib/scans';
import { HttpError, json } from './family-backend';
import type { FamilyStore } from './family-store';
import { cloudHash, CLOUD_FAMILY_BYTES } from './cloud-photo-files';

const visible =
  'NOT EXISTS (SELECT 1 FROM cloud_photo_replacements r WHERE r.old_id=p.id)';
function studentExists(
  store: FamilyStore,
  account: string,
  student: string | null,
) {
  if (
    !student ||
    !store.db
      .prepare('SELECT 1 FROM students WHERE account_id=? AND id=?')
      .get(account, student)
  )
    throw new HttpError(404, '学生不存在');
  return student;
}
function limitOf(params: URLSearchParams) {
  const limit = Number(params.get('limit') ?? 30);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new HttpError(400, '分页数量须为1至100');
  return limit;
}
function cursorOf(params: URLSearchParams, scope: string) {
  if (!params.has('cursor')) return null;
  try {
    const raw = params.get('cursor')!;
    if (raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const cursor = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      !Array.isArray(cursor) ||
      cursor.length !== 3 ||
      cursor[0] !== scope ||
      typeof cursor[1] !== 'string' ||
      typeof cursor[2] !== 'string'
    )
      throw new Error();
    return cursor.slice(1) as [string, string];
  } catch {
    throw new HttpError(400, '分页标识无效，请刷新列表');
  }
}
const encode = (scope: string, first: string, second: string) =>
  Buffer.from(JSON.stringify([scope, first, second])).toString('base64url');

export function photoArchive(
  store: FamilyStore,
  account: string,
  photoId: string,
): PhotoArchive | undefined {
  const row = store.db
    .prepare(
      `SELECT h.*, d.title,d.subject,(SELECT count(*) FROM homework_pages hp JOIN cloud_photos p ON p.id=hp.photo_id WHERE hp.document_id=d.id AND ${visible}) page_count FROM homework_pages h JOIN homework_documents d ON d.id=h.document_id JOIN cloud_photos p ON p.id=h.photo_id WHERE h.photo_id=? AND d.account_id=? AND p.account_id=d.account_id AND p.student_id=d.student_id`,
    )
    .get(photoId, account);
  if (!row) return undefined;
  return {
    documentId: String(row.document_id),
    title: String(row.title),
    subject: row.subject as PhotoArchive['subject'],
    pageNumber: Number(row.page_number),
    pageCount: Number(row.page_count),
    revision: Number(row.revision),
    ...(row.paper_page_number ? { paperPageNumber: Number(row.paper_page_number) } : {}),
    ...(row.paper_page_count ? { paperPageCount: Number(row.paper_page_count) } : {}),
    ...(row.page_role ? { pageRole: row.page_role as PhotoArchive['pageRole'] } : {}),
    ...(row.duplicate_of_photo_id
      ? { duplicateOfPhotoId: String(row.duplicate_of_photo_id) }
      : {}),
  };
}
export function archivedPhoto(
  store: FamilyStore,
  account: string,
  photo: CloudPhoto,
): CloudPhoto {
  const archive = photoArchive(store, account, photo.id);
  return archive ? { ...photo, archive } : photo;
}
export function foldersResponse(
  request: Request,
  store: FamilyStore,
  account: string,
) {
  const params = new URL(request.url).searchParams;
  const student = studentExists(store, account, params.get('studentId'));
  if (!params.has('subject')) {
    const rows = store.db
      .prepare(
        `SELECT d.subject,count(DISTINCT d.id) document_count,count(*) photo_count FROM homework_documents d JOIN homework_pages h ON h.document_id=d.id JOIN cloud_photos p ON p.id=h.photo_id WHERE d.account_id=? AND d.student_id=? AND ${visible} GROUP BY d.subject ORDER BY d.subject`,
      )
      .all(account, student);
    const unclassified = store.db
      .prepare(
        `SELECT count(*) n FROM cloud_photos p WHERE p.account_id=? AND p.student_id=? AND ${visible} AND NOT EXISTS (SELECT 1 FROM homework_pages h WHERE h.photo_id=p.id)`,
      )
      .get(account, student);
    const result: CloudPhotoFolders = {
      subjects: rows.map((r) => ({
        subject: r.subject as PhotoArchive['subject'],
        documentCount: Number(r.document_count),
        photoCount: Number(r.photo_count),
      })),
      unclassifiedCount: Number(unclassified?.n || 0),
    };
    return json(result);
  }
  const subject = params.get('subject')!;
  if (!scanSubjects.includes(subject as never))
    throw new HttpError(400, '学科无效');
  const limit = limitOf(params),
    scope = cloudHash(JSON.stringify([account, student, subject, 'documents'])),
    after = cursorOf(params, scope);
  const rows = store.db
    .prepare(
      `SELECT d.*,count(*) page_count FROM homework_documents d JOIN homework_pages h ON h.document_id=d.id JOIN cloud_photos p ON p.id=h.photo_id WHERE d.account_id=? AND d.student_id=? AND d.subject=? AND ${visible} ${after ? 'AND (d.created_at>? OR (d.created_at=? AND d.id>?))' : ''} GROUP BY d.id ORDER BY d.created_at,d.id LIMIT ?`,
    )
    .all(
      account,
      student,
      subject,
      ...(after ? [after[0], after[0], after[1]] : []),
      limit + 1,
    );
  const documents: CloudDocument[] = rows
    .slice(0, limit)
    .map((r) => ({
      id: String(r.id),
      title: String(r.title),
      subject: r.subject as CloudDocument['subject'],
      pageCount: Number(r.page_count),
      revision: Number(r.revision),
      createdAt: String(r.created_at),
    }));
  const last = documents.at(-1);
  return json({
    documents,
    nextCursor:
      rows.length > limit && last
        ? encode(scope, last.createdAt, last.id)
        : null,
  });
}

export function documentPhotosResponse(
  request: Request,
  store: FamilyStore,
  account: string,
) {
  const params = new URL(request.url).searchParams;
  const student = studentExists(store, account, params.get('studentId')),
    documentId = params.get('documentId');
  const doc = store.db
    .prepare(
      'SELECT 1 FROM homework_documents WHERE id=? AND account_id=? AND student_id=?',
    )
    .get(documentId, account, student);
  if (!doc) throw new HttpError(404, '作业资料不存在');
  if (params.has('unclassified')) throw new HttpError(400, '资料筛选不能重复');
  const limit = limitOf(params),
    scope = cloudHash(JSON.stringify([account, student, documentId, 'photos'])),
    after = cursorOf(params, scope);
  if (
    after &&
    (!/^\d+$/.test(after[0]) || !Number.isSafeInteger(Number(after[0])))
  )
    throw new HttpError(400, '分页标识无效');
  const rows = store.db
    .prepare(
      `SELECT p.body,h.page_number FROM homework_pages h JOIN cloud_photos p ON p.id=h.photo_id WHERE h.document_id=? AND p.account_id=? AND p.student_id=? AND ${visible} ${after ? 'AND h.page_number>?' : ''} ORDER BY h.page_number,p.id LIMIT ?`,
    )
    .all(
      documentId,
      account,
      student,
      ...(after ? [Number(after[0])] : []),
      limit + 1,
    );
  const photos = rows
    .slice(0, limit)
    .map((r) => archivedPhoto(store, account, JSON.parse(String(r.body))));
  const last = photos.at(-1);
  return json({
    photos,
    nextCursor:
      rows.length > limit && last
        ? encode(scope, String(last.archive!.pageNumber), last.id)
        : null,
    storage: {
      usedBytes: Number(
        store.db
          .prepare(
            'SELECT coalesce(sum(size),0) n FROM cloud_photos WHERE account_id=?',
          )
          .get(account)?.n || 0,
      ),
      limitBytes: CLOUD_FAMILY_BYTES,
    },
  });
}
