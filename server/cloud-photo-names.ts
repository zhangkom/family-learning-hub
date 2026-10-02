import { createHash } from 'node:crypto';
import type { CloudPhoto } from '../lib/cloud-photos';
import { sanitizeOriginalDisplayName } from '../lib/upload-security';
import type { FamilyStore } from './family-store';
import { HttpError, json } from './family-backend';
import { MobileError, requireStudent } from './mobile-service';
import { cloudUuid } from './cloud-photo-files';

export function currentName(store: FamilyStore, account: string, student: string, name: string) {
  const photos = store.db.prepare(`SELECT body FROM cloud_photos WHERE account_id=? AND student_id=?
    AND json_extract(body,'$.originalName')=?
    AND NOT EXISTS (SELECT 1 FROM cloud_photo_replacements WHERE old_id=cloud_photos.id) ORDER BY id`)
    .all(account, student, name).map(row => JSON.parse(String(row.body)) as CloudPhoto);
  return { photos, token: createHash('sha256').update(JSON.stringify(photos.map(p => [p.id, p.sha256]))).digest('hex') };
}

export function validateNameChoice(named: ReturnType<typeof currentName>, action?: string, token?: string) {
  if (action !== undefined && !['check', 'replace'].includes(action)) throw new HttpError(400, '同名处理方式无效');
  if (token !== undefined && !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(400, '同名确认标识无效');
  if (named.photos.length && (action !== 'replace' || token !== named.token))
    throw new MobileError(409, '云盘中已有同名图片，请选择覆盖或重命名', 'CLOUD_NAME_CONFLICT');
  if (!named.photos.length && action === 'replace')
    throw new MobileError(409, '同名图片已变化，请重新确认', 'CLOUD_NAME_CONFLICT');
}

export function replaceNamedPhotos(store: FamilyStore, named: ReturnType<typeof currentName>, newId: string) {
  // Supersede only after the new original is durable. Preserve old bytes and receipts.
  for (const photo of named.photos)
    store.db.prepare('INSERT INTO cloud_photo_replacements VALUES (?,?)').run(photo.id, newId);
}

export function checkPhotoName(request: Request, store: FamilyStore, account: string) {
  const params = new URL(request.url).searchParams, student = requireStudent(store, account, params.get('studentId'));
  const input = params.get('name');
  if (!input || input.length > 1024) throw new HttpError(400, '请填写图片名称');
  const name = sanitizeOriginalDisplayName(input);
  const requestId = params.get('clientRequestId');
  if (requestId && !cloudUuid.test(requestId)) throw new HttpError(400, '上传标识无效');
  const row = requestId ? store.db.prepare('SELECT body FROM cloud_photos WHERE account_id=? AND request_id=?').get(account, requestId) : undefined;
  const receipt: CloudPhoto | undefined = row ? JSON.parse(String(row.body)) : undefined;
  if (receipt && receipt.studentId !== student.id) throw new HttpError(409, '上传记录所属孩子不匹配');
  const named = currentName(store, account, student.id, name);
  let suggestedName = name;
  if (named.photos.length) {
    const extension = /\.(?:jpe?g|png|webp)$/i.exec(name)?.[0] || '', stem = extension ? name.slice(0, -extension.length) : name;
    // Read only display names once rather than issuing one query per suffix.
    const used = new Set(store.db.prepare(`SELECT json_extract(body,'$.originalName') name FROM cloud_photos WHERE account_id=? AND student_id=?
      AND NOT EXISTS (SELECT 1 FROM cloud_photo_replacements WHERE old_id=cloud_photos.id)`).all(account, student.id).map(r => String(r.name)));
    for (let suffix = 1; ; suffix++) {
      const ending = `_${suffix}${extension}`;
      suggestedName = stem.slice(0, Math.max(1, 255 - ending.length)) + ending;
      if (!used.has(suggestedName)) break;
    }
  }
  return json({ name, conflicts: named.photos.length, token: named.token, suggestedName, ...(receipt ? { receipt } : {}) });
}
