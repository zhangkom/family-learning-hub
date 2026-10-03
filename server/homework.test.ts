import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, mkdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FamilyStore } from './family-store';
import { cloudHash } from './cloud-photo-files';
import { cloudPhotoResponse } from './cloud-photos';
import { foldersResponse } from './homework-archive';
import {
  homeworkScanId,
  importHomeworkManifest,
  type HomeworkManifest,
} from './homework-import';
import { readStoredScan, scanDirectory, writeStoredScan } from './scan-files';
import { mobileScan, reviewMobileScan } from './mobile-service';
import { sharp } from './sharp';
import type {
  CloudPhoto,
  CloudPhotoPage,
  CloudDocument,
} from '../lib/cloud-photos';

let store: FamilyStore,
  directory: string,
  photos: CloudPhoto[],
  manifest: HomeworkManifest;
const sha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const q = (
  id: string,
  classification: 'wrong' | 'focus' | 'both' | 'pending' = 'wrong',
) => ({
  id,
  number: id,
  subject: '物理' as const,
  prompt: '合成题干，见原题示意图。',
  diagram: '',
  knowledgePoints: [],
  regions: [
    {
      id: id + '-stem',
      kind: 'stem' as const,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    },
  ],
  answerSteps: [],
  uncertainties: classification === 'pending' ? ['后页缺失'] : [],
  confirmed: classification !== 'pending',
  paperMark: {
    classification,
    ruleIds:
      classification === 'wrong'
        ? ['R01']
        : classification === 'focus'
          ? ['R06']
          : classification === 'both'
            ? ['R01', 'R06', 'R08']
            : ['R09'],
    evidence: [
      {
        text: '合成纸面标记依据',
        region: { x: 0, y: 0, width: 0.1, height: 0.1 },
      },
    ],
  },
});
const request = (path: string) =>
  new Request('https://family.example/family-learning/api/mobile/v1/' + path);
beforeEach(async () => {
  store = new FamilyStore(':memory:');
  directory = await mkdtemp(join(tmpdir(), 'prism-homework-'));
  vi.stubEnv('FAMILY_DATA_DIR', directory);
  for (const account of ['admin', 'a', 'b'])
    store.db
      .prepare('INSERT INTO accounts VALUES (?,?,?,?)')
      .run(account, account, 'unused', 1);
  store.db
    .prepare('INSERT INTO platform_admins VALUES (?,?,0)')
    .run('admin', 1);
  for (const account of ['a', 'b'])
    store.db
      .prepare('INSERT INTO students VALUES (?,?,?,?,?,?)')
      .run(account, 'child', '合成学生', '高二', '2026-10-01', null);
  const batchId = randomUUID();
  store.db
    .prepare('INSERT INTO cloud_photo_batches VALUES (?,?,?,?,?,?)')
    .run(batchId, 'a', 'child', randomUUID(), 3, '{}');
  photos = [];
  for (let i = 0; i < 3; i++) {
    const bytes = await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 3,
        background: i === 0 ? '#ff0000' : '#0080ff',
      },
    })
      .jpeg()
      .toBuffer();
    const photo: CloudPhoto = {
      id: randomUUID(),
      batchId,
      studentId: 'child',
      clientRequestId: randomUUID(),
      originalName: `IMG_${i}.jpg`,
      mimeType: 'image/jpeg',
      size: bytes.length,
      sha256: sha(bytes),
      width: 120,
      height: 80,
      orientation: 1,
      createdAt: `2026-10-03T00:00:0${i}Z`,
    };
    store.db
      .prepare('INSERT INTO cloud_photos VALUES (?,?,?,?,?,?,?,?,?)')
      .run(
        photo.id,
        'a',
        'child',
        batchId,
        photo.clientRequestId,
        photo.sha256,
        photo.size,
        photo.createdAt,
        JSON.stringify(photo),
      );
    const dir = join(directory, cloudHash('a'), 'cloud-photos', photo.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'original'), bytes);
    photos.push(photo);
  }
  const documentId = randomUUID();
  manifest = {
    version: 1,
    requestId: randomUUID(),
    actorAdminId: 'admin',
    accountId: 'a',
    studentId: 'child',
    visualReview: 'codex-manual',
    pages: photos.slice(0, 2).map((p, i) => ({
      photoId: p.id,
      sha256: p.sha256,
      documentId,
      title: '物理暑假作业（三）',
      subject: '物理',
      pageNumber: i + 1,
      expectedArchiveRevision: 0,
      classificationEvidence: i ? '承接上一页题号' : '首部印刷作业名称',
    })),
  };
});
afterEach(async () => {
  store.close();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
describe('host-only homework archive', () => {
  it('keeps physical answer-sheet page numbers separate from archive order', async () => {
    manifest.pages[1].pageRole = 'answer-sheet';
    manifest.pages[1].paperPageNumber = 1;
    manifest.pages[1].paperPageCount = 4;
    await importHomeworkManifest(store, manifest, false);
    const response = await cloudPhotoResponse(
      request(
        `cloud-photos?studentId=child&documentId=${manifest.pages[0].documentId}`,
      ),
      ['cloud-photos'],
      store,
      'a',
    );
    const page = (await response!.json()) as CloudPhotoPage;
    expect(page.photos[1].archive).toMatchObject({
      pageNumber: 2,
      pageRole: 'answer-sheet',
      paperPageNumber: 1,
      paperPageCount: 4,
    });
    const next = {
      ...manifest,
      requestId: randomUUID(),
      pages: [
        {
          ...manifest.pages[0],
          expectedArchiveRevision: 1,
          paperPageNumber: 5,
          paperPageCount: 4,
        },
      ],
    };
    await expect(importHomeworkManifest(store, next, false)).rejects.toThrow(
      '纸面页码超过页数',
    );
  });
  it('dry run changes neither originals, metadata, scan files nor audit', async () => {
    manifest.pages[0].questions = [q('q1')];
    manifest.pages[0].expectedScanRevision = 0;
    const before = photos.map((p) =>
      readFileSync(
        join(directory, cloudHash('a'), 'cloud-photos', p.id, 'original'),
      ),
    );
    const result = await importHomeworkManifest(store, manifest);
    expect(result.dryRun).toBe(true);
    expect(
      store.db.prepare('SELECT count(*) n FROM homework_pages').get()?.n,
    ).toBe(0);
    expect(
      store.db.prepare('SELECT count(*) n FROM scan_documents').get()?.n,
    ).toBe(0);
    expect(
      store.db.prepare('SELECT count(*) n FROM admin_audit').get()?.n,
    ).toBe(0);
    expect(
      existsSync(
        join(scanDirectory('a', homeworkScanId('a', photos[0].id)), 'original'),
      ),
    ).toBe(false);
    expect(
      photos.map((p) =>
        readFileSync(
          join(directory, cloudHash('a'), 'cloud-photos', p.id, 'original'),
        ),
      ),
    ).toEqual(before);
  });
  it('imports metadata once, keeps file names/bytes and returns ordered paginated folders', async () => {
    await importHomeworkManifest(store, manifest, false);
    expect(
      (await importHomeworkManifest(store, manifest, false)).replayed,
    ).toBe(true);
    const root = await foldersResponse(
      request('cloud-photo-folders?studentId=child'),
      store,
      'a',
    ).json();
    expect(root).toEqual({
      subjects: [{ subject: '物理', documentCount: 1, photoCount: 2 }],
      unclassifiedCount: 1,
    });
    const docs = (await foldersResponse(
      request('cloud-photo-folders?studentId=child&subject=物理'),
      store,
      'a',
    ).json()) as { documents: CloudDocument[] };
    expect(docs.documents[0].title).toBe(manifest.pages[0].title);
    const prefix = `cloud-photos?studentId=child&documentId=${manifest.pages[0].documentId}&limit=1`;
    const first = (await (
      await cloudPhotoResponse(request(prefix), ['cloud-photos'], store, 'a')
    ).json()) as CloudPhotoPage;
    expect(first.photos[0].id).toBe(photos[0].id);
    expect(first.photos[0].archive!.pageNumber).toBe(1);
    const second = (await (
      await cloudPhotoResponse(
        request(prefix + '&cursor=' + first.nextCursor),
        ['cloud-photos'],
        store,
        'a',
      )
    ).json()) as CloudPhotoPage;
    expect(second.photos[0].id).toBe(photos[1].id);
    expect(second.nextCursor).toBeNull();
    const unclassified = (await (
      await cloudPhotoResponse(
        request('cloud-photos?studentId=child&unclassified=1'),
        ['cloud-photos'],
        store,
        'a',
      )
    ).json()) as CloudPhotoPage;
    expect(unclassified.photos.map((p: CloudPhoto) => p.id)).toEqual([
      photos[2].id,
    ]);
    expect(
      store.db.prepare('SELECT count(*) n FROM admin_audit').get()?.n,
    ).toBe(1);
    for (const p of photos)
      expect(
        sha(
          readFileSync(
            join(directory, cloudHash('a'), 'cloud-photos', p.id, 'original'),
          ),
        ),
      ).toBe(p.sha256);
  });
  it('rejects a non-admin, wrong student, foreign photos and another family reading folders', async () => {
    await expect(
      importHomeworkManifest(store, { ...manifest, actorAdminId: 'a' }, false),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      importHomeworkManifest(
        store,
        { ...manifest, studentId: 'unknown' },
        false,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      importHomeworkManifest(store, { ...manifest, accountId: 'b' }, false),
    ).rejects.toMatchObject({ status: 404 });
    await importHomeworkManifest(store, manifest, false);
    await expect(
      cloudPhotoResponse(
        request(
          `cloud-photos?studentId=child&documentId=${manifest.pages[0].documentId}`,
        ),
        ['cloud-photos'],
        store,
        'b',
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('fails the entire import on stale classification, occupied page or changed request', async () => {
    await importHomeworkManifest(store, manifest, false);
    await expect(
      importHomeworkManifest(
        store,
        { ...manifest, requestId: randomUUID() },
        false,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      importHomeworkManifest(
        store,
        { ...manifest, pages: [{ ...manifest.pages[0], title: 'changed' }] },
        false,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      importHomeworkManifest(
        store,
        {
          ...manifest,
          requestId: randomUUID(),
          pages: [
            {
              ...manifest.pages[0],
              photoId: photos[2].id,
              sha256: photos[2].sha256,
            },
          ],
        },
        false,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      store.db.prepare('SELECT count(*) n FROM homework_pages').get()?.n,
    ).toBe(2);
  });
  it('allows atomic page reorder without moving original files', async () => {
    await importHomeworkManifest(store, manifest, false);
    const next = {
      ...manifest,
      requestId: randomUUID(),
      pages: manifest.pages.map((p) => ({
        ...p,
        expectedArchiveRevision: 1,
        pageNumber: 3 - p.pageNumber,
      })),
    };
    await importHomeworkManifest(store, next, false);
    expect(
      store.db
        .prepare('SELECT photo_id FROM homework_pages ORDER BY page_number')
        .all()
        .map((r) => r.photo_id),
    ).toEqual([photos[1].id, photos[0].id]);
  });
  it('rejects mismatched original hash, invalid rule, and confirmed pending classification', async () => {
    manifest.pages[0].questions = [q('q1')];
    manifest.pages[0].expectedScanRevision = 0;
    await expect(
      importHomeworkManifest(
        store,
        {
          ...manifest,
          pages: [{ ...manifest.pages[0], sha256: '0'.repeat(64) }],
        },
        false,
      ),
    ).rejects.toMatchObject({ status: 409 });
    manifest.pages[0].questions[0].paperMark.ruleIds = ['R06'];
    await expect(
      importHomeworkManifest(store, manifest, false),
    ).rejects.toThrow('分类与收录规则不符');
    manifest.pages[0].questions = [{ ...q('q1', 'pending'), confirmed: true }];
    await expect(
      importHomeworkManifest(store, manifest, false),
    ).rejects.toThrow('待确认题');
  });
  it('collects wrong/focus/both once without inventing student answers or learning scores', async () => {
    manifest.pages[0].questions = [
      q('q1'),
      q('q2', 'focus'),
      q('q3', 'both'),
      q('q4', 'pending'),
    ];
    manifest.pages[0].expectedScanRevision = 0;
    const result = await importHomeworkManifest(store, manifest, false);
    const record = readStoredScan(store, 'a', result.pages[0].scanId!)!;
    expect(record.structuredQuestions).toHaveLength(4);
    const [wrong, focus, both, pending] = record.structuredQuestions!;
    expect(wrong.wrongBook).toBeTruthy();
    expect(wrong.focusBook).toBeUndefined();
    expect(focus.wrongBook).toBeUndefined();
    expect(focus.focusBook).toBeTruthy();
    expect(both.wrongBook).toBeTruthy();
    expect(both.focusBook).toBeTruthy();
    expect(pending.wrongBook).toBeUndefined();
    expect(pending.focusBook).toBeUndefined();
    expect(
      record.structuredQuestions?.every(
        (q) =>
          q.answerSteps.length === 0 &&
          q.paperMark?.independentAssessment === false,
      ),
    ).toBe(true);
    expect(
      store.db.prepare('SELECT count(*) n FROM learning_sessions').get()?.n,
    ).toBe(0);
    expect(store.db.prepare('SELECT count(*) n FROM learning').get()?.n).toBe(
      0,
    );
    expect(mobileScan(record).sourcePage?.photoId).toBe(photos[0].id);
    const before = wrong.wrongBook!.savedAt;
    const reviewed = await reviewMobileScan(store, 'a', record.id, {
      revision: record.revision,
      questions: record.structuredQuestions!.map((q) => ({
        ...q,
        focusBook: undefined,
        paperMark: undefined,
        sourcePage: undefined,
      })),
    });
    expect(reviewed.structuredQuestions![0].wrongBook?.savedAt).toBe(before);
    expect(reviewed.structuredQuestions![1].focusBook).toEqual(focus.focusBook);
    expect(reviewed.structuredQuestions![1].paperMark).toEqual(focus.paperMark);
  });
  it('blocks stale scan revisions and preserves original wrong-book timestamps on reimport', async () => {
    manifest.pages[0].questions = [q('q1')];
    manifest.pages[0].expectedScanRevision = 0;
    const first = await importHomeworkManifest(store, manifest, false);
    const scanId = first.pages[0].scanId!;
    const savedAt = readStoredScan(store, 'a', scanId)!.structuredQuestions![0]
      .wrongBook!.savedAt;
    const next = {
      ...manifest,
      requestId: randomUUID(),
      pages: manifest.pages.map((p) => ({ ...p, expectedArchiveRevision: 1 })),
    };
    await expect(
      importHomeworkManifest(store, next, false),
    ).rejects.toMatchObject({ status: 409 });
    next.pages[0].expectedScanRevision = 1;
    await importHomeworkManifest(store, next, false);
    expect(
      readStoredScan(store, 'a', scanId)!.structuredQuestions![0].wrongBook
        ?.savedAt,
    ).toBe(savedAt);
  });
  it('rotates a processing copy and refuses later rotation mismatches', async () => {
    manifest.pages[0].questions = [q('q1')];
    manifest.pages[0].expectedScanRevision = 0;
    manifest.pages[0].rotationClockwise = 90;
    const result = await importHomeworkManifest(store, manifest, false);
    const id = result.pages[0].scanId!;
    const meta = await sharp(
      readFileSync(join(scanDirectory('a', id), 'original')),
    ).metadata();
    expect([meta.width, meta.height]).toEqual([80, 120]);
    const record = readStoredScan(store, 'a', id)!;
    expect(record.sourcePage?.originalSha256).toBe(photos[0].sha256);
    expect(record.sourcePage?.rotationClockwise).toBe(90);
    await expect(
      importHomeworkManifest(
        store,
        {
          ...manifest,
          requestId: randomUUID(),
          pages: [
            {
              ...manifest.pages[0],
              expectedArchiveRevision: 1,
              expectedScanRevision: 1,
              rotationClockwise: 0,
            },
          ],
        },
        false,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('composes multiple actual source regions with traceable normalized coordinates', async () => {
    manifest.pages[0].questions = [q('q1')];
    manifest.pages[0].expectedScanRevision = 0;
    manifest.pages[0].scanKey = randomUUID();
    manifest.pages[0].sourceParts = photos.slice(0, 2).map((p, i) => ({
      photoId: p.id,
      sha256: p.sha256,
      rotationClockwise: 0,
      rect: { x: 0, y: 0, width: 1, height: 1 },
      role: i ? 'answer' : 'question',
    }));
    const result = await importHomeworkManifest(store, manifest, false);
    const id = result.pages[0].scanId!;
    const record = readStoredScan(store, 'a', id)!;
    expect(record.sourcePage?.sourceParts).toHaveLength(2);
    expect(record.sourcePage?.sourceParts![1].composedRect.y).toBeGreaterThan(
      0.5,
    );
    expect(
      (
        await sharp(
          readFileSync(join(scanDirectory('a', id), 'original')),
        ).metadata()
      ).height,
    ).toBe(176);
    expect(record.structuredQuestions![0].sourcePage?.sourceParts).toEqual(
      record.sourcePage?.sourceParts,
    );
  });
  it('marks duplicate originals without double-collecting, and refuses source page identity conflicts', async () => {
    manifest.pages[1].duplicateOfPhotoId = photos[0].id;
    await importHomeworkManifest(store, manifest, false);
    const page = (await (
      await cloudPhotoResponse(
        request('cloud-photos/' + photos[1].id),
        ['cloud-photos', photos[1].id],
        store,
        'a',
      )
    ).json()) as { photo: CloudPhoto };
    expect(page.photo.archive!.duplicateOfPhotoId).toBe(photos[0].id);
    const next = {
      ...manifest,
      requestId: randomUUID(),
      pages: [
        {
          ...manifest.pages[1],
          questions: [q('q1')],
          expectedScanRevision: 0,
          expectedArchiveRevision: 1,
        },
      ],
    };
    await expect(importHomeworkManifest(store, next, false)).rejects.toThrow(
      '重复拍摄仅归档',
    );
  });
  it('refuses to turn an existing collection into a pending item without manual conflict review', async () => {
    manifest.pages[0].questions = [q('q1')];
    manifest.pages[0].expectedScanRevision = 0;
    const first = await importHomeworkManifest(store, manifest, false);
    const before = readStoredScan(store, 'a', first.pages[0].scanId!)!;
    const next = {
      ...manifest,
      requestId: randomUUID(),
      pages: [
        {
          ...manifest.pages[0],
          expectedArchiveRevision: 1,
          expectedScanRevision: 1,
          questions: [q('q1', 'pending')],
        },
      ],
    };
    await expect(
      importHomeworkManifest(store, next, false),
    ).rejects.toMatchObject({ status: 409 });
    expect(readStoredScan(store, 'a', before.id)).toEqual(before);
    expect(
      store.db.prepare('SELECT count(*) n FROM homework_imports').get()?.n,
    ).toBe(1);
  });
  it('detects an incompatible existing scan file during dry run before any metadata writes', async () => {
    manifest.pages[0].questions = [q('q1')];
    manifest.pages[0].expectedScanRevision = 0;
    const dir = scanDirectory('a', homeworkScanId('a', photos[0].id));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'original'), 'different existing bytes');
    await expect(importHomeworkManifest(store, manifest)).rejects.toMatchObject(
      { status: 409 },
    );
    expect(
      store.db.prepare('SELECT count(*) n FROM homework_pages').get()?.n,
    ).toBe(0);
    expect(readFileSync(join(dir, 'original'), 'utf8')).toBe(
      'different existing bytes',
    );
  });
  it('requires an intact cloud original even when linking an existing scan', async () => {
    manifest.pages[0].questions = [q('q1')];
    manifest.pages[0].expectedScanRevision = 0;
    const first = await importHomeworkManifest(store, manifest, false);
    const id = first.pages[0].scanId!;
    await unlink(
      join(directory, cloudHash('a'), 'cloud-photos', photos[0].id, 'original'),
    );
    const next = {
      ...manifest,
      requestId: randomUUID(),
      pages: [
        {
          ...manifest.pages[0],
          existingScanId: id,
          existingScanSha256: photos[0].sha256,
          expectedArchiveRevision: 1,
          expectedScanRevision: 1,
        },
      ],
    };
    await expect(importHomeworkManifest(store, next, false)).rejects.toThrow();
    expect(readStoredScan(store, 'a', id)?.revision).toBe(1);
  });
  it('rejects files above the Android restoration limit before decoding or committing', async () => {
    manifest.pages[0].questions = [q('q1')];
    manifest.pages[0].expectedScanRevision = 0;
    await writeFile(
      join(directory, cloudHash('a'), 'cloud-photos', photos[0].id, 'original'),
      Buffer.alloc(32 * 1024 * 1024 + 1),
    );
    await expect(
      importHomeworkManifest(store, manifest, false),
    ).rejects.toMatchObject({ status: 413 });
    expect(
      store.db.prepare('SELECT count(*) n FROM scan_documents').get()?.n,
    ).toBe(0);
    expect(
      store.db.prepare('SELECT count(*) n FROM homework_pages').get()?.n,
    ).toBe(0);
  });
  it('rejects oversized composites and preserves physical metadata for parts classified in the same request', async () => {
    manifest.pages[0].questions = [q('q1')];
    manifest.pages[0].expectedScanRevision = 0;
    manifest.pages[1].pageRole = 'answer-sheet';
    manifest.pages[1].paperPageNumber = 2;
    manifest.pages[0].sourceParts = photos
      .slice(0, 2)
      .map((p, i) => ({
        photoId: p.id,
        sha256: p.sha256,
        rotationClockwise: 0,
        rect: { x: 0, y: 0, width: 1, height: 1 },
        role: i ? 'answer' : 'question',
      }));
    const first = await importHomeworkManifest(store, manifest, false);
    const parts = readStoredScan(store, 'a', first.pages[0].scanId!)!
      .sourcePage!.sourceParts!;
    expect(parts[1]).toMatchObject({
      title: manifest.pages[1].title,
      paperPageNumber: 2,
      pageRole: 'answer-sheet',
    });
    const large = await sharp({
      create: { width: 2000, height: 8000, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer();
    const photo = {
      ...photos[2],
      width: 2000,
      height: 8000,
      size: large.length,
      sha256: sha(large),
    };
    store.db
      .prepare('UPDATE cloud_photos SET size=?,body=? WHERE id=?')
      .run(photo.size, JSON.stringify(photo), photo.id);
    await writeFile(
      join(directory, cloudHash('a'), 'cloud-photos', photo.id, 'original'),
      large,
    );
    const next = {
      ...manifest,
      requestId: randomUUID(),
      pages: [
        {
          ...manifest.pages[0],
          photoId: photo.id,
          sha256: photo.sha256,
          pageNumber: 3,
          sourceParts: Array.from({ length: 2 }, () => ({
            photoId: photo.id,
            sha256: photo.sha256,
            rotationClockwise: 0 as const,
            rect: { x: 0, y: 0, width: 1, height: 1 },
            role: 'question' as const,
          })),
        },
      ],
    };
    await expect(importHomeworkManifest(store, next, false)).rejects.toThrow(
      '3200万像素',
    );
    expect(
      store.db.prepare('SELECT count(*) n FROM scan_documents').get()?.n,
    ).toBe(1);
  });
  it('keeps reviewed tutoring for provenance-only updates and invalidates it when shared parent content changes', async () => {
    manifest.pages[0].questions = [
      q('parent'),
      { ...q('child'), parentQuestionId: 'parent' },
    ];
    manifest.pages[0].expectedScanRevision = 0;
    const first = await importHomeworkManifest(store, manifest, false);
    const record = readStoredScan(store, 'a', first.pages[0].scanId!)!;
    const tutoring = {
      status: 'needs_review' as const,
      result: {
        transcribedPrompt: '合成题干',
        referenceAnswer: '1',
        explanation: '合成讲解',
        answerEvidence: [],
        errorHypotheses: [],
        uncertainties: [],
        generatedAt: '2026-10-01T00:00:00Z',
        needsReview: true as const,
      },
      review: {
        status: 'confirmed' as const,
        reviewedAt: '2026-10-02T00:00:00Z',
        resultGeneratedAt: '2026-10-01T00:00:00Z',
      },
    };
    record.structuredQuestions!.forEach((question) => {
      question.tutoring = tutoring;
      question.referenceAnswer = '1';
    });
    record.revision++;
    store.transaction(() =>
      writeStoredScan(store, 'a', record, 'synthetic-reviewed-answer'),
    );
    const next = {
      ...manifest,
      requestId: randomUUID(),
      pages: [
        {
          ...manifest.pages[0],
          expectedArchiveRevision: 1,
          expectedScanRevision: 2,
          paperPageNumber: 1,
          pageRole: 'questions' as const,
        },
      ],
    };
    await importHomeworkManifest(store, next, false);
    const unchanged = readStoredScan(store, 'a', record.id)!;
    expect(
      unchanged.structuredQuestions!.map((question) => question.tutoring),
    ).toEqual([tutoring, tutoring]);
    expect(unchanged.structuredQuestions![0].referenceAnswer).toBe('1');
    next.requestId = randomUUID();
    next.pages[0].expectedArchiveRevision = 2;
    next.pages[0].expectedScanRevision = 3;
    next.pages[0].questions = [
      { ...q('parent'), prompt: '共享题干的条件已修改' },
    ];
    await importHomeworkManifest(store, next, false);
    const changed = readStoredScan(store, 'a', record.id)!;
    expect(
      changed.structuredQuestions!.map((question) => question.tutoring?.status),
    ).toEqual(['stale', 'stale']);
    expect(changed.structuredQuestions![1].tutoring?.result).toEqual(
      tutoring.result,
    );
  });
  it('refuses fabricated tutoring review metadata in a collection manifest', async () => {
    manifest.pages[0].questions = [
      {
        ...q('q1'),
        tutoring: {
          status: 'needs_review',
          review: {
            status: 'confirmed',
            reviewedAt: '2026-10-01',
            resultGeneratedAt: '2026-10-01',
          },
        },
      },
    ];
    manifest.pages[0].expectedScanRevision = 0;
    await expect(
      importHomeworkManifest(store, manifest, false),
    ).rejects.toThrow('伪造AI复核');
    expect(
      store.db.prepare('SELECT count(*) n FROM scan_documents').get()?.n,
    ).toBe(0);
  });
});
