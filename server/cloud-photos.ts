import { createHash, randomUUID } from 'node:crypto';
import { join, dirname, resolve, sep } from 'node:path';
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import {
  createReadStream,
  mkdirSync,
  existsSync,
  lstatSync,
  copyFileSync,
  writeFileSync,
  rmSync,
  openSync,
  closeSync,
  fsyncSync,
  readFileSync,
} from 'node:fs';
import {
  CLOUD_PHOTO_CAPABILITY,
  type CloudPhoto,
  type CloudPhotoBatch,
  type CloudPhotoPage,
} from '../lib/cloud-photos';
import { sanitizeOriginalDisplayName } from '../lib/upload-security';
import type { FamilyStore } from './family-store';
import { HttpError, json, readJson } from './family-backend';
import { MobileError, requireStudent } from './mobile-service';
import {
  cloudHash,
  cloudUuid,
  cloudDirectory,
  cloudTempDirectory,
  hashFile,
  requireCloudSpace,
  CLOUD_FAMILY_BYTES,
  CLOUD_SERVICE_BYTES,
} from './cloud-photo-files';
import { receiveCloudPhoto } from './cloud-photo-multipart';
import { inspectCloudImage } from './cloud-image';
import { currentName, checkPhotoName, validateNameChoice, replaceNamedPhotos } from './cloud-photo-names';
import { publishDirectorySync } from '../scripts/atomic-directory-publish.mjs';

function uuid(value: unknown) {
  if (typeof value !== 'string' || !cloudUuid.test(value.toLowerCase()))
    throw new HttpError(400, '上传标识须为UUID');
  return value.toLowerCase();
}
function stableId(account: string, kind: string, client: string) {
  const value = createHash('sha256')
    .update(`cloud-v1:${kind}:${account}:${client}`)
    .digest();
  value[6] = (value[6] & 15) | 80;
  value[8] = (value[8] & 63) | 128;
  const h = Buffer.from(value.subarray(0, 16)).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const conflict = () =>
  new MobileError(
    409,
    '上传标识已用于另一内容，请恢复原批次或创建新上传',
    'IDEMPOTENCY_CONFLICT',
  );
function count(
  store: FamilyStore,
  sql: string,
  ...values: (string | number)[]
) {
  return Number(store.db.prepare(sql).get(...values)?.n || 0);
}
function usage(store: FamilyStore, account: string) {
  return count(
    store,
    'SELECT COALESCE(sum(size),0) n FROM cloud_photos WHERE account_id=?',
    account,
  );
}
async function createBatch(
  request: Request,
  store: FamilyStore,
  account: string,
) {
  const body = await readJson(request, 4096);
  if (
    Object.keys(body).some(
      (k) => !['studentId', 'clientBatchId', 'expectedCount'].includes(k),
    ) ||
    !Number.isSafeInteger(body.expectedCount) ||
    Number(body.expectedCount) < 1
  )
    throw new HttpError(400, '图片数量须为正整数');
  const student = requireStudent(store, account, body.studentId),
    client = uuid(body.clientBatchId);
  const prior = store.db
    .prepare(
      'SELECT body FROM cloud_photo_batches WHERE account_id=? AND client_id=?',
    )
    .get(account, client);
  if (prior) {
    const batch: CloudPhotoBatch = JSON.parse(String(prior.body));
    if (
      batch.studentId !== student.id ||
      batch.expectedCount !== body.expectedCount
    )
      throw conflict();
    return json({ batch });
  }
  if (!store.allow(`cloud-batch:${account}`, 60, 3600000))
    throw new HttpError(429, '创建批次过于频繁，请稍后重试');
  const batch: CloudPhotoBatch = {
    id: stableId(account, 'batch', client),
    studentId: student.id,
    clientBatchId: client,
    expectedCount: Number(body.expectedCount),
    createdAt: new Date().toISOString(),
  };
  store.db
    .prepare('INSERT INTO cloud_photo_batches VALUES (?,?,?,?,?,?)')
    .run(
      batch.id,
      account,
      student.id,
      client,
      batch.expectedCount,
      JSON.stringify(batch),
    );
  return json({ batch }, 201);
}
export function ownedCloudPhoto(
  store: FamilyStore,
  account: string,
  id: string,
): CloudPhoto {
  if (!cloudUuid.test(id)) throw new HttpError(404, '图片不存在');
  const row = store.db
    .prepare('SELECT body FROM cloud_photos WHERE id=? AND account_id=?')
    .get(id, account);
  if (!row) throw new HttpError(404, '图片不存在');
  const photo: CloudPhoto = JSON.parse(String(row.body));
  requireStudent(store, account, photo.studentId);
  return photo;
}
// Keep derivatives small and reconstructible; no thumbnail files enter backups.
const thumbnails = new Map<string, Buffer>();
function cacheThumbnail(id: string, value: Buffer) {
  thumbnails.delete(id);
  thumbnails.set(id, value);
  let size = [...thumbnails.values()].reduce((n, b) => n + b.length, 0);
  while (size > 8 * 1024 * 1024 || thumbnails.size > 100) {
    const key = thumbnails.keys().next().value!;
    size -= thumbnails.get(key)!.length;
    thumbnails.delete(key);
  }
}
function removeStaging(path: string, parent: string) {
  if (
    dirname(resolve(path)) !== resolve(parent) ||
    !resolve(path).startsWith(resolve(parent) + sep)
  )
    throw new Error('Unsafe staging cleanup');
  rmSync(path, { recursive: true, force: true });
}
function durableFile(path: string) {
  const fd = openSync(path, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function durableDirectory(path: string) {
  if (process.platform !== 'win32') {
    const fd = openSync(path, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}
let uploading = false;
async function uploadPhoto(
  request: Request,
  store: FamilyStore,
  account: string,
) {
  if (uploading)
    throw new MobileError(503, '上传正忙，请稍后重试', 'UPLOAD_BUSY');
  uploading = true;
  let temp: string | undefined;
  try {
    requireCloudSpace(CLOUD_PHOTO_CAPABILITY.maxFileBytes);
    temp = cloudTempDirectory();
    const input = await receiveCloudPhoto(request, temp),
      fields = input.fields;
    const student = requireStudent(store, account, fields.studentId),
      requestId = uuid(fields.clientRequestId),
      batchId = uuid(fields.batchId);
    const batchRow = store.db
      .prepare(
        'SELECT body FROM cloud_photo_batches WHERE account_id=? AND id=?',
      )
      .get(account, batchId);
    if (!batchRow) throw new HttpError(404, '上传批次不存在');
    const batch: CloudPhotoBatch = JSON.parse(String(batchRow.body));
    if (batch.studentId !== student.id)
      throw new HttpError(400, '上传图片与批次的孩子不一致');
    if (!/^[a-f0-9]{64}$/.test(fields.sha256) || fields.sha256 !== input.sha256)
      throw new HttpError(400, '图片哈希不一致，请重新读取原图');
    const originalName = sanitizeOriginalDisplayName(input.filename);
    const fingerprint = cloudHash(
      JSON.stringify([
        student.id,
        batchId,
        originalName,
        input.mimeType,
        input.size,
        input.sha256,
      ]),
    );
    const previous = () => {
      const row = store.db
        .prepare(
          'SELECT fingerprint,body FROM cloud_photos WHERE account_id=? AND request_id=?',
        )
        .get(account, requestId);
      if (row && row.fingerprint !== fingerprint) throw conflict();
      return row ? (JSON.parse(String(row.body)) as CloudPhoto) : undefined;
    };
    const prior = previous();
    if (prior) return json({ photo: prior });
    const chosenName = () => {
      const named = currentName(store, account, student.id, originalName);
      validateNameChoice(named, fields.nameAction, fields.nameToken);
      return named;
    };
    chosenName();
    const enforceLimits = () => {
      if (
        count(
          store,
          'SELECT count(*) n FROM cloud_photos WHERE batch_id=?',
          batchId,
        ) >= batch.expectedCount
      )
        throw new MobileError(409, '本批上传数量已满', 'BATCH_LIMIT_REACHED');
      if (
        usage(store, account) + input.size > CLOUD_FAMILY_BYTES ||
        count(store, 'SELECT COALESCE(sum(size),0) n FROM cloud_photos') +
          input.size >
          CLOUD_SERVICE_BYTES
      )
        throw new MobileError(507, '云盘空间不足', 'STORAGE_QUOTA');
      requireCloudSpace(input.size);
    };
    enforceLimits();
    const image = await inspectCloudImage(
      input.path,
      input.mimeType,
      request.signal,
    );
    if (request.signal.aborted) throw new HttpError(408, '上传已取消');
    const photo: CloudPhoto = {
      id: stableId(account, 'photo', requestId),
      batchId,
      studentId: student.id,
      clientRequestId: requestId,
      originalName,
      mimeType: input.mimeType as CloudPhoto['mimeType'],
      size: input.size,
      sha256: input.sha256,
      width: image.width,
      height: image.height,
      orientation: image.orientation,
      createdAt: new Date().toISOString(),
    };
    const result = store.transaction(() => {
      const prior = previous();
      if (prior) return { photo: prior, created: false };
      const named = chosenName();
      enforceLimits();
      const parent = cloudDirectory(account),
        target = join(parent, photo.id);
      // Crash recovery: durable files may have been published before SQLite commit.
      if (existsSync(target)) {
        cloudDirectory(account, photo.id);
        const meta = join(target, 'record.json');
        if (lstatSync(meta).isSymbolicLink())
          throw new Error('Unsafe cloud metadata');
        const recovered: CloudPhoto = JSON.parse(readFileSync(meta, 'utf8'));
        if (
          cloudHash(
            JSON.stringify([
              recovered.studentId,
              recovered.batchId,
              recovered.originalName,
              recovered.mimeType,
              recovered.size,
              recovered.sha256,
            ]),
          ) !== fingerprint ||
          recovered.id !== photo.id ||
          recovered.clientRequestId !== requestId
        )
          throw conflict();
        if (hashFile(join(target, 'original')) !== input.sha256)
          throw new Error('Cloud original integrity failure');
        photo.createdAt = recovered.createdAt;
      } else {
        const staging = join(parent, '.pending-' + randomUUID());
        mkdirSync(staging, { mode: 0o700 });
        try {
          copyFileSync(input.path, join(staging, 'original'));
          writeFileSync(join(staging, 'record.json'), JSON.stringify(photo), {
            mode: 0o600,
            flag: 'wx',
          });
          durableFile(join(staging, 'original'));
          durableFile(join(staging, 'record.json'));
          durableDirectory(staging);
          publishDirectorySync(staging, target);
          durableDirectory(parent);
        } finally {
          if (existsSync(staging)) removeStaging(staging, parent);
        }
      }
      store.db
        .prepare('INSERT INTO cloud_photos VALUES (?,?,?,?,?,?,?,?,?)')
        .run(
          photo.id,
          account,
          student.id,
          batchId,
          requestId,
          fingerprint,
          photo.size,
          photo.createdAt,
          JSON.stringify(photo),
        );
      replaceNamedPhotos(store, named, photo.id);
      return { photo, created: true };
    });
    cacheThumbnail(photo.id, image.thumbnail);
    return json({ photo: result.photo }, result.created ? 201 : 200);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOSPC')
      throw new MobileError(503, '服务器空间不足，请稍后重试', 'STORAGE_LOW');
    throw error;
  } finally {
    try {
      if (temp) removeStaging(temp, dirname(temp));
    } finally {
      uploading = false;
    }
  }
}
function listPhotos(request: Request, store: FamilyStore, account: string) {
  const params = new URL(request.url).searchParams,
    student = requireStudent(store, account, params.get('studentId'));
  const limit = Number(params.get('limit') ?? 30);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new HttpError(400, '分页数量须为1至100');
  let after: string[] | undefined;
  if (params.has('cursor')) {
    try {
      const raw = params.get('cursor')!;
      if (raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw))
        throw new Error('Invalid cursor');
      const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
      if (
        !Array.isArray(c) ||
        c.length !== 4 ||
        c[0] !== cloudHash(account) ||
        c[1] !== student.id ||
        typeof c[2] !== 'string' ||
        !Number.isFinite(Date.parse(c[2])) ||
        typeof c[3] !== 'string' ||
        !cloudUuid.test(c[3])
      )
        throw new Error('Invalid cursor');
      after = [c[2], c[3]];
    } catch {
      throw new HttpError(400, '分页标识无效，请刷新列表');
    }
  }
  const rows = after
    ? store.db
        .prepare(
          'SELECT body FROM cloud_photos WHERE account_id=? AND student_id=? AND NOT EXISTS (SELECT 1 FROM cloud_photo_replacements WHERE old_id=cloud_photos.id) AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?',
        )
        .all(account, student.id, after[0], after[0], after[1], limit + 1)
    : store.db
        .prepare(
          'SELECT body FROM cloud_photos WHERE account_id=? AND student_id=? AND NOT EXISTS (SELECT 1 FROM cloud_photo_replacements WHERE old_id=cloud_photos.id) ORDER BY created_at DESC,id DESC LIMIT ?',
        )
        .all(account, student.id, limit + 1);
  const photos = rows
      .slice(0, limit)
      .map((r) => JSON.parse(String(r.body)) as CloudPhoto),
    last = photos.at(-1);
  const page: CloudPhotoPage = {
    photos,
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify([
              cloudHash(account),
              student.id,
              last.createdAt,
              last.id,
            ]),
          ).toString('base64url')
        : null,
    storage: {
      usedBytes: usage(store, account),
      limitBytes: CLOUD_FAMILY_BYTES,
    },
  };
  return json(page);
}
export async function cloudPhotoResponse(
  request: Request,
  parts: string[],
  store: FamilyStore,
  account: string,
) {
  if (
    parts[0] === 'cloud-photo-batches' &&
    parts.length === 1 &&
    request.method === 'POST'
  )
    return createBatch(request, store, account);
  if (parts[0] === 'cloud-photos' && parts.length === 1) {
    if (request.method === 'POST') return uploadPhoto(request, store, account);
    if (request.method === 'GET') return listPhotos(request, store, account);
  }
  if (parts[0] !== 'cloud-photos' || parts.length > 3)
    throw new HttpError(404, '接口不存在');
  if (request.method !== 'GET') throw new HttpError(405, '请求方式不支持');
  if (parts.length === 2 && parts[1] === 'name') return checkPhotoName(request, store, account);
  const photo = ownedCloudPhoto(store, account, parts[1]);
  if (parts.length === 2) return json({ photo });
  if (!['file', 'thumbnail'].includes(parts[2]))
    throw new HttpError(404, '接口不存在');
  const path = join(cloudDirectory(account, photo.id), 'original'),
    state = lstatSync(path);
  if (!state.isFile() || state.isSymbolicLink() || state.size !== photo.size)
    throw new Error('Cloud original unavailable');
  const headers = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length',
  };
  if (parts[2] === 'thumbnail') {
    let bytes = thumbnails.get(photo.id);
    if (!bytes) {
      bytes = (
        await inspectCloudImage(path, photo.mimeType, request.signal, false)
      ).thumbnail;
      cacheThumbnail(photo.id, bytes);
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        'Content-Type': 'image/jpeg',
        'Content-Length': String(bytes.length),
      },
    });
  }
  return new Response(
    Readable.toWeb(createReadStream(path)) as ReadableStream,
    {
      headers: {
        ...headers,
        'Content-Type': photo.mimeType,
        'Content-Length': String(photo.size),
        'Content-Disposition': `attachment; filename="photo.${photo.mimeType === 'image/jpeg' ? 'jpg' : photo.mimeType.split('/')[1]}"; filename*=UTF-8''${encodeURIComponent(photo.originalName).replace(/['()*]/g, (x) => '%' + x.charCodeAt(0).toString(16).toUpperCase())}`,
      },
    },
  );
}
