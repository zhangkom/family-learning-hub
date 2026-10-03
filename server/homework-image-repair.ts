// Host-only, visually reviewed image repair. Originals and question identities stay immutable.
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Question } from '../lib/mobile';
import type { ScanRecord } from '../lib/scans';
import type { FamilyStore } from './family-store';
import { HttpError } from './family-backend';
import { compositeParts, type HomeworkPageInput } from './homework-import';
import {
  readScanFile,
  readStoredScan,
  scanDirectory,
  writeStoredScan,
} from './scan-files';
import { sharp } from './sharp';

type Part = NonNullable<HomeworkPageInput['sourceParts']>[number];
export type ImageRepairManifest = {
  version: 1;
  kind: 'question-image-repair';
  visualReview: 'codex-manual';
  requestId: string;
  actorAdminId: string;
  accountId: string;
  studentId: string;
  items: {
    scanId: string;
    questionId: string;
    expectedRevision: number;
    expectedSha256: string;
    mode: 'recompose' | 'append-original';
    reason: string;
    sourceParts: Part[];
  }[];
};
const digest = (v: string | Uint8Array) =>
  createHash('sha256').update(v).digest('hex');
function fail(message: string, status = 409): never {
  throw new HttpError(status, message);
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
function guards(store: FamilyStore, manifest: ImageRepairManifest) {
  if (
    !store.db
      .prepare('SELECT 1 FROM platform_admins WHERE account_id=?')
      .get(manifest.actorAdminId)
  )
    fail('需要现有管理员', 403);
  if (
    !store.db
      .prepare('SELECT 1 FROM students WHERE account_id=? AND id=?')
      .get(manifest.accountId, manifest.studentId)
  )
    fail('学生归属不符', 404);
}
function checkedScan(
  store: FamilyStore,
  manifest: ImageRepairManifest,
  item: ImageRepairManifest['items'][number],
) {
  const owner = store.scanOwner(manifest.accountId),
    scan = readStoredScan(store, owner, item.scanId);
  if (!scan || scan.deletedAt || scan.studentId !== manifest.studentId)
    fail('题图归属不符', 404);
  if (
    scan.revision !== item.expectedRevision ||
    scan.sourcePage?.scanSha256 !== item.expectedSha256
  )
    fail('题目已变化，请重新核对');
  if (
    store.db
      .prepare(
        "SELECT 1 FROM scan_jobs WHERE owner=? AND scan_id=? AND status IN ('queued','processing')",
      )
      .get(owner, scan.id)
  )
    fail('题目正在处理，请稍后修复');
  if (!scan.structuredQuestions?.some((q) => q.id === item.questionId))
    fail('目标题目不存在');
  if (scan.processing) fail('本机处理图需要单独核对，不能套用归档修复');
  return scan;
}
function checkSources(
  store: FamilyStore,
  manifest: ImageRepairManifest,
  parts: Part[],
) {
  for (const part of parts) {
    const row = store.db
      .prepare(
        'SELECT body FROM cloud_photos WHERE id=? AND account_id=? AND student_id=?',
      )
      .get(part.photoId, manifest.accountId, manifest.studentId);
    if (
      !row ||
      JSON.parse(String(row.body)).sha256 !== part.sha256 ||
      store.db
        .prepare('SELECT 1 FROM cloud_photo_replacements WHERE old_id=?')
        .get(part.photoId)
    )
      fail('来源原图已变化，请重新核对');
  }
}
export async function repairHomeworkImages(
  store: FamilyStore,
  manifest: ImageRepairManifest,
  dryRun = true,
) {
  if (
    !manifest ||
    manifest.version !== 1 ||
    manifest.kind !== 'question-image-repair' ||
    manifest.visualReview !== 'codex-manual' ||
    !uuid.test(manifest.requestId) ||
    !Array.isArray(manifest.items) ||
    !manifest.items.length ||
    manifest.items.length > 100
  )
    fail('修复清单无效', 400);
  guards(store, manifest);
  const fingerprint = digest(JSON.stringify(manifest));
  const receipt = () =>
    store.db
      .prepare(
        'SELECT fingerprint,body FROM homework_imports WHERE account_id=? AND request_id=?',
      )
      .get(manifest.accountId, manifest.requestId);
  const oldReceipt = receipt();
  if (oldReceipt) {
    if (oldReceipt.fingerprint !== fingerprint) fail('修复标识已用于另一清单');
    return { ...JSON.parse(String(oldReceipt.body)), replayed: true };
  }
  const seen = new Set<string>(),
    prepared: { before: ScanRecord; after: ScanRecord; bytes: Buffer }[] = [];
  let totalBytes = 0;
  for (const item of manifest.items) {
    if (
      !uuid.test(item.scanId) ||
      !hash.test(item.expectedSha256) ||
      !Number.isSafeInteger(item.expectedRevision) ||
      !['recompose', 'append-original'].includes(item.mode) ||
      typeof item.reason !== 'string' ||
      !item.reason.trim() ||
      item.reason.length > 2000 ||
      seen.has(item.scanId)
    )
      fail('修复条目无效', 400);
    seen.add(item.scanId);
    const before = checkedScan(store, manifest, item),
      owner = store.scanOwner(manifest.accountId);
    const original = await readScanFile(owner, before.id, before);
    if (!before.sourcePage || !item.sourceParts?.length)
      fail('修复必须保留来源');
    const page = {
      photoId:
        item.mode === 'append-original'
          ? item.sourceParts[0].photoId
          : before.sourcePage.photoId,
      sourceParts: item.sourceParts,
    } as HomeworkPageInput;
    const combined = await compositeParts(
      store,
      manifest.accountId,
      manifest.studentId,
      page,
    );
    let bytes = combined.bytes,
      parts = combined.sourceParts;
    let questions = structuredClone(before.structuredQuestions!);
    if (item.mode === 'recompose') {
      if (
        questions.length !== 1 ||
        questions[0].regions.length !== 1 ||
        questions[0].regions.some(
          (r) => r.x !== 0 || r.y !== 0 || r.width !== 1 || r.height !== 1,
        ) ||
        questions[0].sharedRegionIds?.length ||
        questions[0].parentQuestionId ||
        questions[0].paperMark?.evidence.some((e) => e.region)
      )
        fail('多题或局部证据坐标不能直接重组');
      questions[0].regions = [
        { ...questions[0].regions[0], x: 0, y: 0, width: 1, height: 1 },
      ];
    } else {
      // Keep every original pixel, rebase every existing box, then attach only to the selected question.
      const head = await sharp(original)
        .autoOrient()
        .resize({ width: 2000, withoutEnlargement: true })
        .png()
        .toBuffer();
      const hm = await sharp(head).metadata(),
        tm = await sharp(bytes).metadata();
      const width = Math.max(hm.width!, tm.width!),
        top = hm.height! + 16,
        height = top + tm.height!;
      if (width * height > 32_000_000 || height > 60000)
        fail('追加题图过大', 413);
      bytes = await sharp({
        create: { width, height, channels: 3, background: '#fff' },
      })
        .composite([
          { input: head, left: 0, top: 0 },
          { input: bytes, left: 0, top },
        ])
        .jpeg({ quality: 95 })
        .toBuffer();
      const rebase = <
        T extends { x: number; y: number; width: number; height: number },
      >(
        r: T,
      ): T => ({
        ...r,
        x: (r.x * hm.width!) / width,
        width: (r.width * hm.width!) / width,
        y: (r.y * hm.height!) / height,
        height: (r.height * hm.height!) / height,
      });
      questions = questions.map((q) => ({
        ...q,
        regions: q.regions.map(rebase),
        sourcePage: {
          ...(q.sourcePage || before.sourcePage!),
          ...((q.sourcePage || before.sourcePage!)?.sourceParts
            ? {
                sourceParts: (q.sourcePage ||
                  before.sourcePage!)!.sourceParts!.map((p) => ({
                  ...p,
                  composedRect: rebase(p.composedRect),
                })),
              }
            : {}),
        },
        ...(q.paperMark
          ? {
              paperMark: {
                ...q.paperMark,
                evidence: q.paperMark.evidence.map((e) =>
                  e.region ? { ...e, region: rebase(e.region) } : e,
                ),
              },
            }
          : {}),
      }));
      parts = parts.map((p) => ({
        ...p,
        composedRect: {
          x: (p.composedRect.x * tm.width!) / width,
          width: (p.composedRect.width * tm.width!) / width,
          y: (top + p.composedRect.y * tm.height!) / height,
          height: (p.composedRect.height * tm.height!) / height,
        },
      }));
      const target = questions.find((q) => q.id === item.questionId)!;
      parts.forEach((p, index) => {
        target.regions.push({
          id: `repair-${manifest.requestId}-${index}`,
          kind: 'figure',
          ...p.composedRect,
        });
      });
      target.sourcePage = {
        ...target.sourcePage!,
        sourceParts: [...(target.sourcePage?.sourceParts || []), ...parts],
      };
      parts = [
        ...(before.sourcePage.sourceParts || []).map((p) => ({
          ...p,
          composedRect: rebase(p.composedRect),
        })),
        ...parts,
      ];
    }
    if (
      !bytes.length ||
      bytes.length > 32 * 1024 * 1024 ||
      (totalBytes += bytes.length) > 256 * 1024 * 1024
    )
      fail('修复图片过大', 413);
    const sha = digest(bytes);
    if (sha === item.expectedSha256) fail('修复没有改变题图');
    const sourcePage = {
      ...before.sourcePage,
      scanSha256: sha,
      sourceParts: parts,
    };
    questions = questions.map(
      (q): Question => ({
        ...q,
        sourcePage: {
          ...(q.sourcePage || before.sourcePage!),
          scanSha256: sha,
          ...(item.mode === 'recompose' ? { sourceParts: parts } : {}),
        },
        ...(q.tutoring
          ? {
              tutoring: {
                ...q.tutoring,
                status: 'stale',
                error: '题图已补全，请重新复核原解析',
              },
            }
          : {}),
      }),
    );
    prepared.push({
      before,
      after: {
        ...before,
        sourcePage,
        structuredQuestions: questions,
        size: bytes.length,
        mimeType: 'image/jpeg',
        revision: before.revision + 1,
      },
      bytes,
    });
  }
  const result = {
    kind: manifest.kind,
    requestId: manifest.requestId,
    dryRun,
    replayed: false,
    items: prepared.map((p) => ({
      scanId: p.after.id,
      beforeSha256: p.before.sourcePage!.scanSha256,
      afterSha256: p.after.sourcePage!.scanSha256,
      beforeRevision: p.before.revision,
      afterRevision: p.after.revision,
      bytes: p.bytes.length,
    })),
  };
  store.transaction(() => {
    guards(store, manifest);
    if (receipt()) fail('修复已在另一进程完成，请重读回执');
    for (const [index, p] of prepared.entries()) {
      if (
        JSON.stringify(checkedScan(store, manifest, manifest.items[index])) !==
        JSON.stringify(p.before)
      )
        fail('资料已变化，请重新核对');
      checkSources(store, manifest, manifest.items[index].sourceParts);
    }
    if (dryRun) return;
    const owner = store.scanOwner(manifest.accountId);
    for (const p of prepared) {
      const directory = join(
        scanDirectory(owner, p.after.id),
        'image-revisions',
      );
      if (
        existsSync(directory) &&
        (lstatSync(directory).isSymbolicLink() ||
          !lstatSync(directory).isDirectory())
      )
        fail('修复目录不安全');
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const file = join(directory, p.after.sourcePage!.scanSha256 + '.jpg');
      if (existsSync(file)) {
        if (
          lstatSync(file).isSymbolicLink() ||
          !lstatSync(file).isFile() ||
          digest(readFileSync(file)) !== p.after.sourcePage!.scanSha256
        )
          fail('已有修复文件冲突');
      } else {
        // A failed/partial write must never occupy the immutable content-addressed name.
        const temporary = join(directory, '.repair-' + randomUUID() + '.tmp');
        let fd: number | undefined;
        try {
          fd = openSync(temporary, 'wx', 0o600);
          writeFileSync(fd, p.bytes);
          fsyncSync(fd);
          closeSync(fd);
          fd = undefined;
          if (
            digest(readFileSync(temporary)) !== p.after.sourcePage!.scanSha256
          )
            fail('临时题图校验失败');
          renameSync(temporary, file);
        } finally {
          if (fd !== undefined) closeSync(fd);
          rmSync(temporary, { force: true });
        }
      }
      writeStoredScan(
        store,
        owner,
        p.after,
        `admin:${manifest.actorAdminId}:image-repair:${manifest.requestId}`,
      );
    }
    store.db
      .prepare('INSERT INTO homework_imports VALUES (?,?,?,?,?)')
      .run(
        manifest.accountId,
        manifest.requestId,
        fingerprint,
        JSON.stringify(result),
        new Date().toISOString(),
      );
    store.db
      .prepare(
        'INSERT INTO admin_audit(actor_id,action,target,created_at) VALUES (?,?,?,?)',
      )
      .run(
        manifest.actorAdminId,
        'question-image-repair',
        JSON.stringify({
          accountId: manifest.accountId,
          studentId: manifest.studentId,
          requestId: manifest.requestId,
          items: manifest.items.map((i) => ({
            scanId: i.scanId,
            questionId: i.questionId,
            reason: i.reason,
          })),
        }),
        Date.now(),
      );
  });
  return result;
}
