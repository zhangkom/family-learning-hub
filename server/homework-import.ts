// Host-only, explicit visual-review manifest importer. No public write route.
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import {
  CLOUD_PHOTO_CAPABILITY,
  type CloudPhoto,
  type QuestionSourcePage,
} from '../lib/cloud-photos';
import { type Question, validateQuestions } from '../lib/mobile';
import { questionContext } from '../lib/question-context';
import { scanSubjects, type ScanRecord } from '../lib/scans';
import { HttpError } from './family-backend';
import type { FamilyStore } from './family-store';
import { cloudDirectory, cloudUuid } from './cloud-photo-files';
import { photoArchive } from './homework-archive';
import { questionsOf } from './mobile-service';
import { readStoredScan, scanDirectory, writeStoredScan } from './scan-files';
import { sharp } from './sharp';

type MarkInput = Pick<
  NonNullable<Question['paperMark']>,
  'classification' | 'ruleIds' | 'evidence'
>;
type QuestionInput = Omit<Question, 'paperMark' | 'sourcePage'> & {
  paperMark: MarkInput;
  sourcePage?: Pick<QuestionSourcePage, 'majorNumber' | 'subNumber'>;
};
export type HomeworkPageInput = {
  photoId: string;
  sha256: string;
  documentId: string;
  title: string;
  subject: (typeof scanSubjects)[number];
  pageNumber: number;
  paperPageNumber?: number;
  paperPageCount?: number;
  pageRole?: 'questions' | 'answer-sheet';
  expectedArchiveRevision: number;
  classificationEvidence: string;
  duplicateOfPhotoId?: string;
  rotationClockwise?: 0 | 90 | 180 | 270;
  existingScanId?: string;
  existingScanSha256?: string;
  expectedScanRevision?: number;
  scanKey?: string;
  sourceParts?: Omit<
    NonNullable<QuestionSourcePage['sourceParts']>[number],
    'composedRect'
  >[];
  questions?: QuestionInput[];
};
export type HomeworkManifest = {
  version: 1;
  requestId: string;
  actorAdminId: string;
  accountId: string;
  studentId: string;
  visualReview: 'codex-manual';
  pages: HomeworkPageInput[];
};
const digest = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
function fail(message: string, status = 400): never {
  throw new HttpError(status, message);
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !cloudUuid.test(value))
    fail('资料标识须为小写UUID');
  return value;
}
function short(value: unknown, name: string, max = 200): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    value.split('').some((char) => char.charCodeAt(0) < 9)
  )
    fail(`${name}无效`);
  return value.trim();
}
function revision(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    fail('必须填写预期资料版本');
  return Number(value);
}
function exactStudent(store: FamilyStore, account: string, student: string) {
  if (
    !store.db
      .prepare('SELECT 1 FROM students WHERE account_id=? AND id=?')
      .get(account, student)
  )
    fail('学生归属不存在，不能使用兼容默认值', 404);
}
function adminExists(store: FamilyStore, id: string) {
  if (
    !store.db
      .prepare('SELECT 1 FROM platform_admins WHERE account_id=?')
      .get(id)
  )
    fail('必须指定现有管理员作为审计操作者', 403);
}
function photoOf(
  store: FamilyStore,
  account: string,
  student: string,
  id: string,
): CloudPhoto {
  const row = store.db
    .prepare(
      'SELECT body FROM cloud_photos WHERE id=? AND account_id=? AND student_id=?',
    )
    .get(id, account, student);
  if (!row) fail('原图不属于指定账号和学生', 404);
  if (
    store.db
      .prepare('SELECT 1 FROM cloud_photo_replacements WHERE old_id=?')
      .get(id)
  )
    fail('原图已经被替换，请核对当前图片', 409);
  return JSON.parse(String(row.body));
}
export function homeworkScanId(account: string, photoId: string) {
  const h = digest(`homework-page-v1:${account}:${photoId}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function checkedBytes(path: string, expected: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('原件文件类型无效', 409);
  if (stat.size < 1 || stat.size > CLOUD_PHOTO_CAPABILITY.maxFileBytes)
    fail('题图文件须为1字节至32MiB，超出手机恢复限制', 413);
  const bytes = readFileSync(path);
  if (digest(bytes) !== expected) fail('原件校验值不一致', 409);
  return bytes;
}
async function checkedImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > CLOUD_PHOTO_CAPABILITY.maxFileBytes)
    fail('题图文件超过32MiB，不能保存为手机无法恢复的题图', 413);
  const meta = await sharp(bytes, {
    limitInputPixels: CLOUD_PHOTO_CAPABILITY.maxPixels,
  }).metadata();
  if (
    !['jpeg', 'png', 'webp'].includes(meta.format || '') ||
    !meta.width ||
    !meta.height ||
    meta.width * meta.height > CLOUD_PHOTO_CAPABILITY.maxPixels ||
    (meta.pages || 1) > 1
  )
    fail('题图必须是3200万像素以内的单帧JPEG、PNG或WebP图片', 413);
  return meta;
}
async function orientedBytes(original: Buffer, photo: CloudPhoto, angle = 0) {
  await checkedImage(original);
  if ((!photo.orientation || photo.orientation === 1) && angle === 0)
    return original;
  const image = sharp(original, {
    limitInputPixels: CLOUD_PHOTO_CAPABILITY.maxPixels,
  })
    .autoOrient()
    .rotate(angle);
  if (photo.mimeType === 'image/jpeg')
    return image.jpeg({ quality: 98 }).toBuffer();
  if (photo.mimeType === 'image/webp')
    return image.webp({ lossless: true }).toBuffer();
  return image.png().toBuffer();
}
function markOf(value: unknown): MarkInput {
  if (!value || typeof value !== 'object') fail('缺少纸面标记判断依据');
  const mark = value as MarkInput;
  if (!['wrong', 'focus', 'both', 'pending'].includes(mark.classification))
    fail('收录分类无效');
  if (
    !Array.isArray(mark.ruleIds) ||
    !mark.ruleIds.length ||
    mark.ruleIds.length > 9 ||
    mark.ruleIds.some((r) => !/^R0[1-9]$/.test(r))
  )
    fail('收录规则编号无效');
  const wrong = mark.ruleIds.some((r) =>
      ['R01', 'R02', 'R03', 'R04'].includes(r),
    ),
    focus = mark.ruleIds.some((r) => ['R06', 'R07'].includes(r));
  if (
    (mark.classification === 'wrong' && !wrong) ||
    (mark.classification === 'focus' && !focus) ||
    (mark.classification === 'both' &&
      !(wrong && focus && mark.ruleIds.includes('R08'))) ||
    (mark.classification === 'pending' && !mark.ruleIds.includes('R09'))
  )
    fail('分类与收录规则不符');
  if (
    !Array.isArray(mark.evidence) ||
    !mark.evidence.length ||
    mark.evidence.length > 30
  )
    fail('每题必须给出可核对的可见标记依据');
  const evidence = mark.evidence.map((e) => {
    const text = short(e?.text, '标记依据', 2000);
    if (!e.region) return { text };
    const { x, y, width, height } = e.region;
    if (
      ![x, y, width, height].every(
        (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1,
      ) ||
      width <= 0 ||
      height <= 0 ||
      x + width > 1.000000001 ||
      y + height > 1.000000001
    )
      fail('标记区域超出原图');
    return { text, region: { x, y, width, height } };
  });
  return {
    classification: mark.classification,
    ruleIds: [...new Set(mark.ruleIds)],
    evidence,
  };
}
type Prepared = {
  page: HomeworkPageInput;
  photo: CloudPhoto;
  scanId: string;
  scan?: ScanRecord;
  bytes?: Buffer;
  scanHash?: string;
  questions?: Question[];
  marks?: MarkInput[];
  sourceParts?: QuestionSourcePage['sourceParts'];
};
function sourceOf(
  store: FamilyStore,
  account: string,
  item: Prepared,
): QuestionSourcePage {
  const parts = item.sourceParts || item.scan?.sourcePage?.sourceParts;
  return {
    ...photoArchive(store, account, item.photo.id)!,
    photoId: item.photo.id,
    rotationClockwise: item.page.rotationClockwise ?? 0,
    originalSha256: item.photo.sha256,
    ...(item.scanHash ? { scanSha256: item.scanHash } : {}),
    ...(parts
      ? {
          sourceParts: parts.map((part) => {
            // Re-read after all classifications in this transaction; a source may
            // have been unclassified when its pixels were prepared.
            const archive = photoArchive(store, account, part.photoId);
            return {
              ...part,
              ...(archive
                ? {
                    title: archive.title,
                    paperPageNumber: archive.paperPageNumber,
                    pageRole: archive.pageRole,
                  }
                : {}),
            };
          }),
        }
      : {}),
  };
}

async function compositeParts(
  store: FamilyStore,
  account: string,
  student: string,
  page: HomeworkPageInput,
) {
  const parts = page.sourceParts!;
  if (
    !Array.isArray(parts) ||
    !parts.length ||
    parts.length > 16 ||
    !parts.some((p) => p.photoId === page.photoId)
  )
    fail('组合题图必须包含本原页，且不超过16个来源区域');
  const tiles: {
    bytes: Buffer;
    width: number;
    height: number;
    top: number;
    part: (typeof parts)[number];
  }[] = [];
  let totalHeight = 0,
    maxWidth = 0;
  for (const part of parts) {
    uuid(part.photoId);
    const photo = photoOf(store, account, student, part.photoId);
    if (
      part.sha256 !== photo.sha256 ||
      ![0, 90, 180, 270].includes(part.rotationClockwise) ||
      !['material', 'question', 'answer', 'figure'].includes(part.role)
    )
      fail('组合题图片段来源无效');
    const { x, y, width, height } = part.rect || {};
    if (
      ![x, y, width, height].every(
        (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1,
      ) ||
      width <= 0 ||
      height <= 0 ||
      x + width > 1.000000001 ||
      y + height > 1.000000001
    )
      fail('组合题图区域超出来源页');
    const original = checkedBytes(
      join(cloudDirectory(account, part.photoId), 'original'),
      part.sha256,
    );
    const oriented = await orientedBytes(
      original,
      photo,
      part.rotationClockwise,
    );
    const meta = await sharp(oriented).metadata();
    const left = Math.floor(x * meta.width!),
      top = Math.floor(y * meta.height!);
    const bytes = await sharp(oriented)
      .extract({
        left,
        top,
        width: Math.min(meta.width! - left, Math.ceil(width * meta.width!)),
        height: Math.min(meta.height! - top, Math.ceil(height * meta.height!)),
      })
      .resize({ width: 2000, withoutEnlargement: true })
      .png()
      .toBuffer();
    const tile = await sharp(bytes).metadata();
    const archive = photoArchive(store, account, photo.id);
    tiles.push({
      bytes,
      width: tile.width!,
      height: tile.height!,
      top: totalHeight,
      part: {
        ...part,
        originalName: photo.originalName,
        ...(archive
          ? {
              title: archive.title,
              paperPageNumber: archive.paperPageNumber,
              pageRole: archive.pageRole,
            }
          : {}),
      },
    });
    maxWidth = Math.max(maxWidth, tile.width!);
    totalHeight += tile.height! + 16;
    if (maxWidth * totalHeight > 32_000_000)
      fail('组合题图超过3200万像素，请拆分并保留完整关联');
    if (totalHeight > 65535)
      fail('组合题图高度超过JPEG限制，请重新安排完整来源区域', 413);
  }
  totalHeight -= 16;
  const bytes = await sharp({
    create: {
      width: maxWidth,
      height: totalHeight,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite(tiles.map((t) => ({ input: t.bytes, left: 0, top: t.top })))
    .jpeg({ quality: 95 })
    .toBuffer();
  return {
    bytes,
    sourceParts: tiles.map((t) => ({
      ...t.part,
      composedRect: {
        x: 0,
        y: t.top / totalHeight,
        width: t.width / maxWidth,
        height: t.height / totalHeight,
      },
    })),
  };
}

/** dryRun validates all guards and rolls back metadata; it never writes scan files. */
export async function importHomeworkManifest(
  store: FamilyStore,
  value: HomeworkManifest,
  dryRun = true,
) {
  if (!value || value.version !== 1 || value.visualReview !== 'codex-manual')
    fail('仅接受逐图视觉核对的版本1清单');
  const account = short(value.accountId, '家庭标识'),
    student = short(value.studentId, '学生标识'),
    actor = short(value.actorAdminId, '审计操作者');
  uuid(value.requestId);
  adminExists(store, actor);
  exactStudent(store, account, student);
  if (
    !Array.isArray(value.pages) ||
    !value.pages.length ||
    value.pages.length > 5000
  )
    fail('清单页数无效');
  const fingerprint = digest(JSON.stringify(value));
  const receipt = () =>
    store.db
      .prepare(
        'SELECT fingerprint,body FROM homework_imports WHERE account_id=? AND request_id=?',
      )
      .get(account, value.requestId);
  const previous = receipt();
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      fail('本次导入标识已用于不同清单', 409);
    return { ...JSON.parse(String(previous.body)), replayed: true };
  }
  const photoIds = new Set<string>(),
    slots = new Set<string>(),
    prepared: Prepared[] = [],
    documentSpecs = new Map<string, string>();
  let preparedBytes = 0;
  for (const raw of value.pages) {
    const page = { ...raw };
    uuid(page.photoId);
    uuid(page.documentId);
    revision(page.expectedArchiveRevision);
    page.title = short(page.title, '作业名称');
    page.classificationEvidence = short(
      page.classificationEvidence,
      '分卷依据',
      4000,
    );
    if (
      !scanSubjects.includes(page.subject) ||
      !Number.isSafeInteger(page.pageNumber) ||
      page.pageNumber < 1 ||
      page.pageNumber > 10000
    )
      fail('学科或页序无效');
    if (
      page.rotationClockwise !== undefined &&
      ![0, 90, 180, 270].includes(page.rotationClockwise)
    )
      fail('旋转角度无效');
    for (const n of [page.paperPageNumber, page.paperPageCount]) {
      if (n !== undefined && (!Number.isSafeInteger(n) || n < 1 || n > 10000))
        fail('纸面页码无效');
    }
    if (
      page.paperPageNumber &&
      page.paperPageCount &&
      page.paperPageNumber > page.paperPageCount
    )
      fail('纸面页码超过页数');
    if (
      page.pageRole !== undefined &&
      !['questions', 'answer-sheet'].includes(page.pageRole)
    )
      fail('原页类型无效');
    if (
      photoIds.has(page.photoId) ||
      slots.has(`${page.documentId}:${page.pageNumber}`)
    )
      fail('清单图片或作业内页序重复');
    photoIds.add(page.photoId);
    slots.add(`${page.documentId}:${page.pageNumber}`);
    const spec = JSON.stringify([page.title, page.subject]);
    if (
      documentSpecs.has(page.documentId) &&
      documentSpecs.get(page.documentId) !== spec
    )
      fail('同一作业名称或科目不一致');
    documentSpecs.set(page.documentId, spec);
    const photo = photoOf(store, account, student, page.photoId);
    if (page.sha256 !== photo.sha256 || !/^[a-f0-9]{64}$/.test(page.sha256))
      fail('清单与云盘原件校验不一致', 409);
    if (page.duplicateOfPhotoId) {
      uuid(page.duplicateOfPhotoId);
      if (page.duplicateOfPhotoId === page.photoId)
        fail('重复拍摄不能指向自身');
      photoOf(store, account, student, page.duplicateOfPhotoId);
      if (page.questions !== undefined)
        fail('重复拍摄仅归档，请在对应原页收题');
    }
    if (page.scanKey) uuid(page.scanKey);
    const scanId = page.existingScanId
      ? uuid(page.existingScanId)
      : homeworkScanId(
          account,
          photo.id + (page.scanKey ? ':' + page.scanKey : ''),
        );
    const scan =
      readStoredScan(store, store.scanOwner(account), scanId) || undefined;
    const item: Prepared = { page, photo, scanId, scan };
    if (page.questions !== undefined || page.existingScanId) {
      // Even an explicit legacy scan link must point to an intact existing
      // cloud original, never just a stale database row.
      const original = checkedBytes(
        join(cloudDirectory(account, photo.id), 'original'),
        page.sha256,
      );
      revision(page.expectedScanRevision);
      if (page.existingScanId && !scan) fail('指定的既有扫描不存在', 404);
      if (
        scan &&
        (scan.deletedAt || (scan.studentId || scan.child) !== student)
      )
        fail('既有扫描学生不一致或已删除', 409);
      if (scan?.sourcePage && scan.sourcePage.photoId !== photo.id)
        fail('既有扫描已关联其他原页，需单独核对重复关系', 409);
      if (page.existingScanId) {
        if (page.sourceParts) fail('不能用新的组合题图覆盖旧扫描原件');
        if (
          !page.existingScanSha256 ||
          !/^[a-f0-9]{64}$/.test(page.existingScanSha256)
        )
          fail('关联旧扫描必须校验其现存原件');
        item.bytes = checkedBytes(
          join(scanDirectory(store.scanOwner(account), scanId), 'original'),
          page.existingScanSha256,
        );
      } else if (page.sourceParts) {
        const combined = await compositeParts(store, account, student, page);
        item.bytes = combined.bytes;
        item.sourceParts = combined.sourceParts;
      } else {
        item.bytes = await orientedBytes(
          original,
          photo,
          page.rotationClockwise,
        );
      }
      await checkedImage(item.bytes);
      preparedBytes += item.bytes.length;
      if (preparedBytes > 256 * 1024 * 1024)
        fail('单次收录处理图超过256MiB，请拆成多个可重试清单', 413);
      item.scanHash = digest(item.bytes);
      const existingOriginal = join(
        scanDirectory(store.scanOwner(account), scanId),
        'original',
      );
      if (existsSync(existingOriginal))
        checkedBytes(existingOriginal, item.scanHash);
      if (
        scan?.sourcePage?.scanSha256 &&
        scan.sourcePage.scanSha256 !== item.scanHash
      )
        fail('题图处理版本已变化，不能套用旧坐标', 409);
      if (page.questions !== undefined) {
        if (!Array.isArray(page.questions) || page.questions.length > 100)
          fail('每页题目数量无效');
        item.marks = page.questions.map((q) => markOf(q.paperMark));
        try {
          item.questions = validateQuestions(page.questions);
        } catch (error) {
          fail((error as Error).message);
        }
        for (const q of item.questions) {
          if (
            q.subject !== page.subject ||
            !q.regions.some((r) => r.kind === 'stem')
          )
            fail('每题必须关联本科题干区域');
          if (page.questions[item.questions.indexOf(q)].tutoring)
            fail('不能通过收录清单伪造AI复核结果');
          if (
            item.marks[item.questions.indexOf(q)].classification ===
              'pending' &&
            (q.confirmed || !q.uncertainties.length)
          )
            fail('待确认题必须保留未确认状态与具体疑点');
          const old =
            scan && questionsOf(scan).find((existing) => existing.id === q.id);
          if (
            item.marks[item.questions.indexOf(q)].classification ===
              'pending' &&
            (old?.wrongBook || old?.focusBook)
          )
            fail(
              '已收录题改为待确认存在冲突，请先人工核对原收藏；本次未覆盖',
              409,
            );
        }
      }
    }
    prepared.push(item);
  }
  const now = new Date().toISOString();
  let result:
    | {
        requestId: string;
        pages: {
          photoId: string;
          documentId: string;
          pageNumber: number;
          archiveRevision: number;
          scanId?: string;
          scanRevision?: number;
          questions?: number;
        }[];
        dryRun: boolean;
        replayed: boolean;
      }
    | undefined;
  const dryRollback = Symbol('dry-run');
  try {
    store.transaction(() => {
      adminExists(store, actor);
      exactStudent(store, account, student);
      if (receipt()) fail('本次导入已在其他进程完成，请重试读取回执', 409);
      // Validate every source and optimistic version before changing any rows.
      for (const item of prepared) {
        const { page, scanId } = item;
        photoOf(store, account, student, page.photoId);
        for (const part of item.sourceParts || [])
          photoOf(store, account, student, part.photoId);
        const old = store.db
          .prepare('SELECT revision FROM homework_pages WHERE photo_id=?')
          .get(page.photoId);
        if (Number(old?.revision || 0) !== page.expectedArchiveRevision)
          fail('原页分类已更新，请重新核对清单', 409);
        const doc = store.db
          .prepare('SELECT * FROM homework_documents WHERE id=?')
          .get(page.documentId);
        if (
          doc &&
          (doc.account_id !== account ||
            doc.student_id !== student ||
            doc.subject !== page.subject ||
            doc.title !== page.title)
        )
          fail('作业标识已属于另一分类，请核对', 409);
        const occupied = store.db
          .prepare(
            'SELECT photo_id FROM homework_pages WHERE document_id=? AND page_number=?',
          )
          .get(page.documentId, page.pageNumber);
        if (
          occupied &&
          occupied.photo_id !== page.photoId &&
          !photoIds.has(String(occupied.photo_id))
        )
          fail('该作业页序已被另一张照片占用', 409);
        if (item.bytes) {
          const current = readStoredScan(
            store,
            store.scanOwner(account),
            scanId,
          );
          if (
            (current?.revision ?? 0) !== page.expectedScanRevision ||
            Boolean(current) !== Boolean(item.scan)
          )
            fail('题目已被其他设备修改，请重新核对', 409);
          if (
            store.db
              .prepare(
                "SELECT 1 FROM scan_jobs WHERE owner=? AND scan_id=? AND status IN ('queued','processing')",
              )
              .get(store.scanOwner(account), scanId)
          )
            fail('题目正在处理中，请稍后重试', 409);
        }
      }
      // Remove only associations (never original files), permitting atomic page reordering.
      const affected = new Set<string>();
      for (const item of prepared) {
        const old = store.db
          .prepare('SELECT document_id FROM homework_pages WHERE photo_id=?')
          .get(item.photo.id);
        if (old) affected.add(String(old.document_id));
        store.db
          .prepare('DELETE FROM homework_pages WHERE photo_id=?')
          .run(item.photo.id);
      }
      for (const item of prepared) {
        const p = item.page;
        store.db
          .prepare(
            'INSERT OR IGNORE INTO homework_documents VALUES (?,?,?,?,?,?,?)',
          )
          .run(
            p.documentId,
            account,
            student,
            p.subject,
            p.title,
            0,
            item.photo.createdAt,
          );
        store.db
          .prepare(
            'INSERT INTO homework_pages (photo_id,document_id,page_number,revision,evidence,duplicate_of_photo_id,paper_page_number,paper_page_count,page_role) VALUES (?,?,?,?,?,?,?,?,?)',
          )
          .run(
            p.photoId,
            p.documentId,
            p.pageNumber,
            p.expectedArchiveRevision + 1,
            p.classificationEvidence,
            p.duplicateOfPhotoId ?? null,
            p.paperPageNumber ?? null,
            p.paperPageCount ?? null,
            p.pageRole ?? null,
          );
        affected.add(p.documentId);
      }
      for (const id of affected)
        store.db
          .prepare(
            'UPDATE homework_documents SET revision=revision+1 WHERE id=?',
          )
          .run(id);
      const results: NonNullable<typeof result>['pages'] = [];
      for (const item of prepared) {
        const p = item.page,
          sourcePage = sourceOf(store, account, item);
        const receiptPage: NonNullable<typeof result>['pages'][number] = {
          photoId: p.photoId,
          documentId: p.documentId,
          pageNumber: p.pageNumber,
          archiveRevision: sourcePage.revision,
        };
        if (item.bytes) {
          const owner = store.scanOwner(account),
            directory = scanDirectory(owner, item.scanId),
            original = join(directory, 'original');
          if (!dryRun) {
            mkdirSync(directory, { recursive: true, mode: 0o700 });
            if (existsSync(original)) checkedBytes(original, item.scanHash!);
            else
              writeFileSync(original, item.bytes, { flag: 'wx', mode: 0o600 });
          }
          const current = item.scan;
          const before = current ? questionsOf(current) : [];
          const merged = new Map(before.map((q) => [q.id, q]));
          for (const [index, q] of (item.questions || []).entries()) {
            const old = merged.get(q.id),
              mark = item.marks![index],
              origin = p.questions![index].sourcePage;
            const wrong = ['wrong', 'both'].includes(mark.classification),
              focus = ['focus', 'both'].includes(mark.classification);
            merged.set(q.id, {
              ...q,
              ...(q.referenceAnswer === undefined && old?.referenceAnswer
                ? { referenceAnswer: old.referenceAnswer }
                : {}),
              ...(q.explanation === undefined && old?.explanation
                ? { explanation: old.explanation }
                : {}),
              sourcePage: {
                ...sourcePage,
                ...(origin?.majorNumber
                  ? { majorNumber: short(origin.majorNumber, '大题号', 100) }
                  : {}),
                ...(origin?.subNumber
                  ? { subNumber: short(origin.subNumber, '小题号', 100) }
                  : {}),
              },
              paperMark: {
                ...mark,
                reviewedAt: now,
                reviewedBy: 'codex-manual',
                independentAssessment: false,
              },
              ...(old?.wrongBook || wrong
                ? { wrongBook: old?.wrongBook || { savedAt: now } }
                : {}),
              ...(old?.focusBook || focus
                ? { focusBook: old?.focusBook || { savedAt: now } }
                : {}),
              ...(old?.tutoring ? { tutoring: old.tutoring } : {}),
            });
          }
          const after = [...merged.values()];
          const context = (q: Question, all: Question[]) =>
            JSON.stringify({
              ...questionContext(q, all),
              confirmed: q.confirmed,
              uncertainties: q.uncertainties,
              referenceAnswer: q.referenceAnswer,
              explanation: q.explanation,
            });
          const questions = after.map((q) => ({
            ...q,
            ...(q.tutoring &&
            before.some(
              (old) =>
                old.id === q.id && context(old, before) !== context(q, after),
            )
              ? {
                  tutoring: {
                    ...q.tutoring,
                    status: 'stale' as const,
                    error: '题目内容或选框经重新核对，请复核旧解析',
                  },
                }
              : {}),
            sourcePage: {
              ...sourcePage,
              ...(q.sourcePage?.majorNumber
                ? { majorNumber: q.sourcePage.majorNumber }
                : {}),
              ...(q.sourcePage?.subNumber
                ? { subNumber: q.sourcePage.subNumber }
                : {}),
            },
          }));
          const record: ScanRecord = {
            ...(current || {
              id: item.scanId,
              studentId: student,
              subject: p.subject,
              source: p.title,
              originalName: item.photo.originalName,
              mimeType: item.sourceParts ? 'image/jpeg' : item.photo.mimeType,
              size: item.bytes.length,
              createdAt: item.photo.createdAt,
              fileUrl: `/family-learning/api/mobile/v1/scans/${item.scanId}/file`,
            }),
            source: p.title,
            subject: p.subject,
            sourcePage,
            structuredQuestions: questions,
            revision: (current?.revision || 0) + 1,
            status:
              questions.length && questions.every((q) => q.confirmed)
                ? 'ready'
                : 'needs_review',
          };
          writeStoredScan(
            store,
            owner,
            record,
            `admin:${actor}:homework:${value.requestId}`,
          );
          receiptPage.scanId = record.id;
          receiptPage.scanRevision = record.revision;
          receiptPage.questions = item.questions?.length || 0;
        }
        results.push(receiptPage);
      }
      result = {
        requestId: value.requestId,
        pages: results,
        dryRun,
        replayed: false,
      };
      if (dryRun) throw dryRollback;
      store.db
        .prepare('INSERT INTO homework_imports VALUES (?,?,?,?,?)')
        .run(
          account,
          value.requestId,
          fingerprint,
          JSON.stringify(result),
          now,
        );
      store.db
        .prepare(
          'INSERT INTO admin_audit(actor_id,action,target,created_at) VALUES (?,?,?,?)',
        )
        .run(
          actor,
          'homework-import',
          JSON.stringify({
            accountId: account,
            studentId: student,
            requestId: value.requestId,
            photoIds: prepared.map((i) => i.photo.id),
          }),
          Date.now(),
        );
    });
  } catch (error) {
    if (error !== dryRollback) throw error;
  }
  return result!;
}
