import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as filesystem from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FamilyStore } from './family-store';
import { cloudDirectory } from './cloud-photo-files';
import { sharp } from './sharp';
import {
  readScanFile,
  readStoredScan,
  saveScan,
  scanDirectory,
  writeStoredScan,
} from './scan-files';
import type { ScanRecord } from '../lib/scans';
import {
  repairHomeworkImages,
  type ImageRepairManifest,
} from './homework-image-repair';
vi.mock('node:fs', { spy: true });
let store: FamilyStore,
  directory: string,
  scan: ScanRecord,
  plan: ImageRepairManifest,
  original: Buffer;
const digest = (x: Uint8Array) => createHash('sha256').update(x).digest('hex');
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'prism-image-repair-'));
  vi.stubEnv('FAMILY_DATA_DIR', directory);
  store = new FamilyStore(':memory:');
  store.db
    .prepare('INSERT INTO accounts VALUES (?,?,?,?)')
    .run('a', 'synthetic', 'unused', 1);
  store.db.prepare('INSERT INTO platform_admins VALUES (?,?,0)').run('a', 1);
  store.db
    .prepare('INSERT INTO students VALUES (?,?,?,?,?,?)')
    .run('a', 'child', '合成学生', '高二', '2026-10-03', null);
  const batchId = randomUUID(),
    photoId = randomUUID();
  store.db
    .prepare('INSERT INTO cloud_photo_batches VALUES (?,?,?,?,?,?)')
    .run(batchId, 'a', 'child', randomUUID(), 1, '{}');
  original = await sharp({
    create: { width: 200, height: 200, channels: 3, background: 'red' },
  })
    .jpeg()
    .toBuffer();
  const sourceBytes = await sharp({
    create: { width: 200, height: 200, channels: 3, background: 'blue' },
  })
    .jpeg()
    .toBuffer();
  const photo = {
    id: photoId,
    batchId,
    studentId: 'child',
    clientRequestId: randomUUID(),
    originalName: 'synthetic.jpg',
    mimeType: 'image/jpeg',
    size: sourceBytes.length,
    sha256: digest(sourceBytes),
    width: 200,
    height: 200,
    orientation: 1,
    createdAt: '2026-10-03',
  };
  store.db
    .prepare('INSERT INTO cloud_photos VALUES (?,?,?,?,?,?,?,?,?)')
    .run(
      photoId,
      'a',
      'child',
      batchId,
      photo.clientRequestId,
      photo.sha256,
      photo.size,
      photo.createdAt,
      JSON.stringify(photo),
    );
  await mkdir(
    join(
      directory,
      digest(new TextEncoder().encode('a')),
      'cloud-photos',
      photoId,
    ),
    { recursive: true },
  );
  await writeFile(join(cloudDirectory('a', photoId), 'original'), sourceBytes);
  scan = {
    id: randomUUID(),
    studentId: 'child',
    subject: '物理',
    source: '合成卷',
    originalName: 'synthetic.jpg',
    mimeType: 'image/jpeg',
    size: original.length,
    createdAt: '2026-10-03',
    fileUrl: '',
    status: 'ready',
    revision: 1,
    sourcePage: {
      photoId,
      documentId: randomUUID(),
      title: '合成卷',
      subject: '物理',
      pageNumber: 1,
      pageCount: 1,
      revision: 1,
      originalSha256: photo.sha256,
      rotationClockwise: 0,
      scanSha256: digest(original),
    },
    structuredQuestions: [
      {
        id: randomUUID(),
        number: '1',
        subject: '物理',
        prompt: '合成题',
        diagram: '',
        knowledgePoints: [],
        answerSteps: [],
        uncertainties: [],
        confirmed: true,
        regions: [
          { id: 'stem', kind: 'stem', x: 0, y: 0, width: 1, height: 1 },
        ],
        wrongBook: { savedAt: '2026-10-02' },
      },
    ],
  };
  await saveScan('a', scan, original, store);
  plan = {
    version: 1,
    kind: 'question-image-repair',
    visualReview: 'codex-manual',
    requestId: randomUUID(),
    actorAdminId: 'a',
    accountId: 'a',
    studentId: 'child',
    items: [
      {
        scanId: scan.id,
        questionId: scan.structuredQuestions![0].id,
        expectedRevision: 1,
        expectedSha256: digest(original),
        mode: 'recompose',
        reason: '合成可复现：补齐蓝色区域',
        sourceParts: [
          {
            photoId,
            sha256: photo.sha256,
            rotationClockwise: 0,
            role: 'question',
            rect: { x: 0, y: 0, width: 1, height: 1 },
          },
        ],
      },
    ],
  };
});
afterEach(async () => {
  vi.restoreAllMocks();
  store.close();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

it('dry run writes nothing; apply preserves originals, IDs, wrongbook history and historical reads, then replays exactly', async () => {
  const preview = await repairHomeworkImages(store, plan);
  expect(readStoredScan(store, 'a', scan.id)).toEqual(scan);
  expect(existsSync(join(scanDirectory('a', scan.id), 'image-revisions'))).toBe(
    false,
  );
  const applied = await repairHomeworkImages(store, plan, false),
    current = readStoredScan(store, 'a', scan.id)!;
  expect(applied.items).toEqual(preview.items);
  expect(current.revision).toBe(2);
  expect(current.structuredQuestions![0].id).toBe(
    scan.structuredQuestions![0].id,
  );
  expect(current.structuredQuestions![0].wrongBook).toEqual(
    scan.structuredQuestions![0].wrongBook,
  );
  expect(await readFile(join(scanDirectory('a', scan.id), 'original'))).toEqual(
    original,
  );
  expect(await readScanFile('a', scan.id, scan)).toEqual(original);
  expect(digest(await readScanFile('a', scan.id, current))).toBe(
    current.sourcePage!.scanSha256,
  );
  expect((await repairHomeworkImages(store, plan, false)).replayed).toBe(true);
  expect(store.db.prepare('SELECT COUNT(*) n FROM admin_audit').get()?.n).toBe(
    1,
  );
  await expect(
    repairHomeworkImages(
      store,
      { ...plan, items: [{ ...plan.items[0], reason: 'changed' }] },
      false,
    ),
  ).rejects.toThrow('另一清单');
});
it('append keeps every original question box aligned and attaches the continuation only to its target', async () => {
  scan.structuredQuestions!.push({
    ...structuredClone(scan.structuredQuestions![0]),
    id: randomUUID(),
    number: '2',
    regions: [
      { id: 'stem2', kind: 'stem', x: 0.1, y: 0.5, width: 0.6, height: 0.4 },
    ],
  });
  store.transaction(() => writeStoredScan(store, 'a', scan, 'fixture'));
  plan.items[0].mode = 'append-original';
  await repairHomeworkImages(store, plan, false);
  const after = readStoredScan(store, 'a', scan.id)!;
  expect(after.structuredQuestions).toHaveLength(2);
  expect(after.structuredQuestions![0].regions).toHaveLength(2);
  expect(after.structuredQuestions![1].regions).toHaveLength(1);
  const first = after.structuredQuestions![0].regions[0],
    second = after.structuredQuestions![1].regions[0];
  expect(second.y / first.height).toBeCloseTo(0.5);
  expect(second.height / first.height).toBeCloseTo(0.4);
  const extra = after.structuredQuestions![0].regions[1];
  expect(extra.y).toBeGreaterThan(first.height);
  const metadata = await sharp(
    await readScanFile('a', scan.id, after),
  ).metadata();
  expect(metadata.height).toBe(416);
});
it('refuses stale revision and cross-student source; no record or image version is created', async () => {
  await expect(
    repairHomeworkImages(
      store,
      { ...plan, items: [{ ...plan.items[0], expectedRevision: 0 }] },
      false,
    ),
  ).rejects.toThrow('已变化');
  const photo = plan.items[0].sourceParts[0];
  store.db
    .prepare('INSERT INTO students VALUES (?,?,?,?,?,?)')
    .run('a', 'other', '合成其他学生', '', '2026-10-03', null);
  store.db
    .prepare('UPDATE cloud_photos SET student_id=? WHERE id=?')
    .run('other', photo.photoId);
  await expect(repairHomeworkImages(store, plan, false)).rejects.toThrow(
    '不属于',
  );
  expect(readStoredScan(store, 'a', scan.id)).toEqual(scan);
  expect(existsSync(join(scanDirectory('a', scan.id), 'image-revisions'))).toBe(
    false,
  );
});
it('refuses direct recomposition of a scan with multiple question coordinates', async () => {
  scan.structuredQuestions!.push({
    ...structuredClone(scan.structuredQuestions![0]),
    id: randomUUID(),
  });
  store.transaction(() => writeStoredScan(store, 'a', scan, 'fixture'));
  await expect(repairHomeworkImages(store, plan, false)).rejects.toThrow(
    '多题',
  );
});
it('a second append retains and rebases previously linked pieces for every question', async () => {
  plan.items[0].mode = 'append-original';
  await repairHomeworkImages(store, plan, false);
  const previous = readStoredScan(store, 'a', scan.id)!;
  const previousPart =
    previous.structuredQuestions![0].sourcePage!.sourceParts![0];
  const next = {
    ...plan,
    requestId: randomUUID(),
    items: [
      {
        ...plan.items[0],
        expectedRevision: previous.revision,
        expectedSha256: previous.sourcePage!.scanSha256!,
      },
    ],
  };
  await repairHomeworkImages(store, next, false);
  const current = readStoredScan(store, 'a', scan.id)!;
  expect(current.sourcePage!.sourceParts).toHaveLength(2);
  expect(current.structuredQuestions![0].sourcePage!.sourceParts).toHaveLength(
    2,
  );
  const retained = current.sourcePage!.sourceParts![0];
  expect(retained.rect).toEqual(previousPart.rect);
  expect(retained.composedRect.y).toBeCloseTo(
    (previousPart.composedRect.y * 416) / 632,
  );
  expect(current.structuredQuestions![0].regions).toHaveLength(3);
});
it('rechecks source ownership at commit after asynchronous composition', async () => {
  store.db
    .prepare('INSERT INTO students VALUES (?,?,?,?,?,?)')
    .run('a', 'changed', '合成其他学生', '', '2026-10-03', null);
  const transaction = store.transaction.bind(store);
  vi.spyOn(store, 'transaction').mockImplementationOnce((fn) => {
    store.db
      .prepare('UPDATE cloud_photos SET student_id=? WHERE id=?')
      .run('changed', plan.items[0].sourceParts[0].photoId);
    return transaction(fn);
  });
  await expect(repairHomeworkImages(store, plan, false)).rejects.toThrow(
    '来源原图已变化',
  );
  expect(readStoredScan(store, 'a', scan.id)).toEqual(scan);
  expect(existsSync(join(scanDirectory('a', scan.id), 'image-revisions'))).toBe(
    false,
  );
});
it('a failed durable write never publishes a partial immutable file and can be retried', async () => {
  const preview = await repairHomeworkImages(store, plan);
  vi.spyOn(filesystem, 'fsyncSync').mockImplementationOnce(() => {
    throw new Error('synthetic disk failure');
  });
  await expect(repairHomeworkImages(store, plan, false)).rejects.toThrow(
    'synthetic disk failure',
  );
  expect(readStoredScan(store, 'a', scan.id)).toEqual(scan);
  expect(
    existsSync(
      join(
        scanDirectory('a', scan.id),
        'image-revisions',
        preview.items[0].afterSha256 + '.jpg',
      ),
    ),
  ).toBe(false);
  const applied = await repairHomeworkImages(store, plan, false);
  expect(applied.items).toEqual(preview.items);
});
