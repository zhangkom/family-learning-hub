import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sharp } from './sharp';
import { validatePhotoProcessing } from './photo-processing';
import type { PhotoProcessing } from '../lib/photo-processing';
import type { MobileScan } from '../lib/mobile';
import { FamilyStore } from './family-store';
import { handleMobile } from './mobile-backend';
import { readStoredScan, scanDirectory } from './scan-files';

const digest = (v: Uint8Array | string) =>
  createHash('sha256').update(v).digest('hex');
const rotations = [
  [1, 0, 0, 0, 1, 0, 0, 0, 1],
  [0, -1, 1, 1, 0, 0, 0, 0, 1],
  [-1, 0, 1, 0, -1, 1, 0, 0, 1],
  [0, 1, 0, -1, 0, 1, 0, 0, 1],
];
async function fixture(
  student = 'student',
  orientation = 1,
  turns = 0,
  background = 'white',
) {
  let width = orientation >= 5 ? 384 : 256,
    height = orientation >= 5 ? 256 : 384;
  if (turns % 2) [width, height] = [height, width];
  const bytes = await sharp({
    create: { width, height, channels: 3, background },
  })
    .jpeg()
    .toBuffer();
  const p: PhotoProcessing = {
    schemaVersion: 1,
    algorithmVersion: 'android-photo-v1',
    originalId: randomUUID(),
    studentId: student,
    outputId: randomUUID(),
    sourceSha256: 'a'.repeat(64),
    sha256: digest(bytes),
    bytes: bytes.length,
    mime: 'image/jpeg',
    width,
    height,
    sourceWidth: orientation >= 5 ? 768 : 512,
    sourceHeight: orientation >= 5 ? 512 : 768,
    exifOrientation: orientation,
    decodedWidth: 256,
    decodedHeight: 384,
    sourceSpace: 'exif-upright-normalized-edges',
    outputSpace: 'normalized-edges',
    corners: [0, 0, 1, 0, 1, 1, 0, 1],
    quarterTurns: turns,
    enhancement: 'none',
    jpegQuality: 94,
    maxEdge: 1024,
    sourceToOutput: [...rotations[turns]],
    outputToSource: [...rotations[(4 - turns) % 4]],
    quality: {
      advisoryOnly: true,
      warnings: ['small-output'],
      laplacianVariance: 0,
      darkFraction: 0,
      backgroundRange: 0,
      percentile10: 255,
      percentile90: 255,
    },
    createdAt: Date.now(),
  };
  return { bytes, p };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('processed photo contract', () => {
  it('accepts direction/rotation mappings and canonicalizes field order without claiming source verification', async () => {
    for (let orientation = 1; orientation <= 8; orientation++)
      for (let turns = 0; turns < 4; turns++) {
        const { bytes, p } = await fixture('student', orientation, turns);
        const reversed = Object.fromEntries(Object.entries(p).reverse());
        expect(
          await validatePhotoProcessing(
            JSON.stringify(reversed),
            'processed-photo',
            'student',
            bytes,
            'image/jpeg',
          ),
        ).toEqual(p);
      }
    expect(
      await validatePhotoProcessing(
        null,
        null,
        'student',
        new Uint8Array(),
        'image/jpeg',
      ),
    ).toBeUndefined();
  });
  it.each([
    ['uri', 'file:///private'],
    ['owner', 'other-family'],
    ['unknown', true],
    ['studentId', 'different-student'],
    ['bytes', 0],
    ['sha256', 'b'.repeat(64)],
    ['sourceSha256', 'bad'],
    ['width', 255],
    ['height', 400],
    ['mime', 'image/png'],
    ['sourceSpace', 'raw'],
    ['quarterTurns', 1],
    ['exifOrientation', 9],
    ['decodedWidth', 8195],
    ['sourceWidth', 50001],
    ['jpegQuality', 89],
    ['maxEdge', 255],
    ['createdAt', -1],
    ['sourceToOutput', [1, 0, 0, 0, 0, 0, 0, 0, 1]],
    ['outputToSource', [2, 0, 0, 0, 2, 0, 0, 0, 1]],
    ['corners', [0, 0, 1, 1, 1, 0, 0, 1]],
    ['algorithmVersion', 'unapproved'],
  ])(
    'rejects untrusted %s and does not repair dishonest metadata',
    async (key, value) => {
      const { bytes, p } = await fixture();
      await expect(
        validatePhotoProcessing(
          JSON.stringify({ ...p, [String(key)]: value }),
          'processed-photo',
          'student',
          bytes,
          'image/jpeg',
        ),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
  it('rejects nested unknowns, non-finite transforms, mismatched output encoding, and truncated image bodies', async () => {
    const { bytes, p } = await fixture();
    for (const quality of [
      { ...p.quality, uri: 'private' },
      { ...p.quality, darkFraction: 2 },
      { ...p.quality, warnings: ['secret'] },
      { ...p.quality, percentile10: 300 },
    ])
      await expect(
        validatePhotoProcessing(
          JSON.stringify({ ...p, quality }),
          'processed-photo',
          'student',
          bytes,
          'image/jpeg',
        ),
      ).rejects.toMatchObject({ status: 400 });
    await expect(
      validatePhotoProcessing(
        JSON.stringify({
          ...p,
          sourceToOutput: [Infinity, 0, 0, 0, 1, 0, 0, 0, 1],
        }),
        'processed-photo',
        'student',
        bytes,
        'image/jpeg',
      ),
    ).rejects.toMatchObject({ status: 400 });
    const png = await sharp(bytes).png().toBuffer();
    await expect(
      validatePhotoProcessing(
        JSON.stringify({ ...p, bytes: png.length, sha256: digest(png) }),
        'processed-photo',
        'student',
        png,
        'image/jpeg',
      ),
    ).rejects.toMatchObject({ status: 400 });
    const truncated = bytes.subarray(0, Math.floor(bytes.length * 0.8));
    await expect(
      validatePhotoProcessing(
        JSON.stringify({
          ...p,
          bytes: truncated.length,
          sha256: digest(truncated),
        }),
        'processed-photo',
        'student',
        truncated,
        'image/jpeg',
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      validatePhotoProcessing(
        null,
        'processed-photo',
        'student',
        bytes,
        'image/jpeg',
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      validatePhotoProcessing(
        JSON.stringify(p),
        null,
        'student',
        bytes,
        'image/jpeg',
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('accepts an inset crop and verifies its output dimensions and inverse transform', async () => {
    const { p } = await fixture();
    const bytes = await sharp({
      create: { width: 128, height: 192, channels: 3, background: 'white' },
    })
      .jpeg()
      .toBuffer();
    Object.assign(p, {
      width: 128,
      height: 192,
      bytes: bytes.length,
      sha256: digest(bytes),
      corners: [0.25, 0.25, 0.75, 0.25, 0.75, 0.75, 0.25, 0.75],
      sourceToOutput: [2, 0, -0.5, 0, 2, -0.5, 0, 0, 1],
      outputToSource: [0.5, 0, 0.25, 0, 0.5, 0.25, 0, 0, 1],
    });
    expect(
      await validatePhotoProcessing(
        JSON.stringify(p),
        'processed-photo',
        'student',
        bytes,
        'image/jpeg',
      ),
    ).toEqual(p);
  });
});

describe('processed photo storage and retry integrity', () => {
  let store: FamilyStore,
    directory: string,
    student: string,
    otherStudent: string;
  const token = 'a'.repeat(64),
    foreign = 'b'.repeat(64);
  beforeEach(() => {
    mkdirSync('work', { recursive: true });
    directory = mkdtempSync(resolve('work/processed-photo-'));
    store = new FamilyStore(join(directory, 'family.sqlite'));
    vi.stubEnv('FAMILY_DATA_DIR', directory);
    vi.stubEnv('FAMILY_PUBLIC_ORIGIN', 'https://family.example');
    vi.stubEnv('FAMILY_MOBILE_ORIGINS', 'https://localhost');
    vi.stubGlobal('fetch', vi.fn());
    for (const [account, t] of [
      ['family', token],
      ['foreign', foreign],
    ]) {
      store.db
        .prepare('INSERT INTO accounts VALUES (?,?,?,?)')
        .run(account, account, 'unusable', Date.now());
      store.db
        .prepare('INSERT INTO mobile_sessions VALUES (?,?,?,?,?)')
        .run(digest(t), account, Date.now() + 60000, 'test', Date.now());
    }
    student = store.addStudent('family', '合成学生').id;
    otherStudent = store.addStudent('family', '合成学生二').id;
  });
  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const call = (
    path: string,
    body?: unknown,
    bearer = token,
    method = body === undefined ? 'GET' : 'POST',
  ) =>
    handleMobile(
      new Request(
        'https://family.example/family-learning/api/mobile/v1/' + path,
        {
          method,
          headers: {
            Origin: 'https://localhost',
            Authorization: 'Bearer ' + bearer,
          },
          ...(body === undefined
            ? {}
            : { body: body instanceof FormData ? body : JSON.stringify(body) }),
        },
      ),
      path.split('/'),
      store,
    );
  function form(
    p: PhotoProcessing,
    bytes: Uint8Array,
    key = p.outputId,
    processed = true,
  ) {
    const f = new FormData();
    f.set('studentId', p.studentId);
    f.set('source', 'synthetic');
    f.set('clientRequestId', key);
    f.set(
      'file',
      new File([new Uint8Array(bytes)], 'processed.jpg', {
        type: 'image/jpeg',
      }),
    );
    if (processed) {
      f.set('sourceKind', 'processed-photo');
      f.set('processing', JSON.stringify(p));
    }
    return f;
  }
  it('returns a persisted receipt and protects processed bytes/metadata through retry, review and separate families', async () => {
    const { p, bytes } = await fixture(student),
      key = p.outputId;
    const setup = await call('setup');
    expect(await setup.json()).toMatchObject({
      processedPhotoMetadataVersion: 1,
    });
    const response = await call('scans', form(p, bytes, key));
    expect(response.status).toBe(201);
    const { scan } = (await response.json()) as { scan: MobileScan };
    expect(scan).toMatchObject({
      studentId: student,
      sourceKind: 'processed-photo',
      processing: p,
    });
    const retry = await call('scans', form(p, bytes, key));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      scan: { id: scan.id, processing: p },
    });
    const reordered = form(p, bytes, key);
    reordered.set(
      'processing',
      JSON.stringify(Object.fromEntries(Object.entries(p).reverse())),
    );
    expect((await call('scans', reordered)).status).toBe(200);
    for (const altered of [
      { ...p, outputId: randomUUID() },
      { ...p, createdAt: p.createdAt + 1 },
      { ...p, studentId: otherStudent },
    ])
      expect((await call('scans', form(altered, bytes, key))).status).toBe(409);
    const black = await fixture(student, 1, 0, 'black');
    expect((await call('scans', form(black.p, black.bytes, key))).status).toBe(
      409,
    );
    expect((await call('scans', form(p, bytes, key, false))).status).toBe(409);
    expect(
      (await call('scans', form(p, bytes, randomUUID()), foreign)).status,
    ).toBe(404);
    const saved = await call(
      `scans/${scan.id}/review`,
      { revision: scan.revision, questions: [] },
      token,
      'PUT',
    );
    expect(saved.status).toBe(200);
    expect((await saved.json()) as unknown).toMatchObject({
      scan: { sourceKind: 'processed-photo', processing: p },
    });
    const record = readStoredScan(store, store.scanOwner('family'), scan.id)!;
    expect(record.processing).toEqual(p);
    const stored = join(
      scanDirectory(store.scanOwner('family'), scan.id),
      'original',
    );
    expect(readFileSync(stored)).toEqual(bytes);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      store.db.prepare('SELECT count(*) AS n FROM scan_jobs').get()?.n,
    ).toBe(0);
    expect(
      store.db.prepare('SELECT count(*) AS n FROM scan_uploads').get()?.n,
    ).toBe(1);
  });
  it('keeps legacy uploads unlabeled and rejects extra/duplicate multipart fields before storage', async () => {
    const { p, bytes } = await fixture(student);
    const legacy = await call('scans', form(p, bytes, randomUUID(), false));
    expect(legacy.status).toBe(201);
    const body = (await legacy.json()) as { scan: MobileScan };
    expect(body.scan.processing).toBeUndefined();
    expect(body.scan.sourceKind).toBeUndefined();
    for (const [key, value] of [
      ['owner', 'other'],
      ['uri', 'file:///local'],
      ['studentId', student],
      ['processing', '{}'],
    ]) {
      const f = form(p, bytes);
      f.append(key, value);
      expect((await call('scans', f)).status).toBe(400);
    }
    expect(
      store.db.prepare('SELECT count(*) AS n FROM scan_uploads').get()?.n,
    ).toBe(1);
  });
});
