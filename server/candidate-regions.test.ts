import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { sharp } from './sharp';
import { CandidateRunner } from './candidate-regions';
import { FamilyStore } from './family-store';
import { handleMobile } from './mobile-backend';
import { readStoredScan, scanDirectory, writeStoredScan } from './scan-files';
import type { CandidateRegions, MobileScan } from '../lib/mobile';

// Artificial glyphs only: this verifies geometry and isolation, not OCR accuracy.
async function sheet(columns = 1, count = 4, width = 1000, height = 1200) {
  let drawing = '';
  for (let col = 0; col < columns; col++)
    for (let q = 0; q < count; q++) {
      const x = 50 + (col * width) / columns;
      const y = 60 + (q * (height - 120)) / count;
      for (let line = 0; line < 3; line++)
        for (let a = 0; a < width / columns - 120; a += 17)
          drawing += `<rect x="${x + a}" y="${y + line * 27}" width="10" height="14" fill="#222"/>`;
    }
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${drawing}</svg>`,
    ),
  )
    .png()
    .toBuffer();
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('isolated geometric candidate worker', () => {
  it('finds ordered single/double-column blocks and preserves input bytes', async () => {
    for (const [columns, count, w, h] of [
      [1, 4, 1000, 1200],
      [2, 3, 1400, 1400],
      [1, 11, 900, 4300],
    ]) {
      const bytes = await sheet(columns, count, w, h),
        before = Buffer.from(bytes);
      const result = await new CandidateRunner().run(async () => bytes);
      expect(result.status).toBe('candidates');
      expect(result.image).toEqual({ width: w, height: h });
      expect(result.candidates).toHaveLength(columns * count);
      for (const [i, b] of result.candidates.entries()) {
        expect(b.order).toBe(i);
        expect(b.region.x + b.region.width).toBeLessThanOrEqual(1);
        expect(b.region.y + b.region.height).toBeLessThanOrEqual(1);
      }
      expect(bytes).toEqual(before);
    }
  });
  it('uses EXIF-oriented dimensions for all eight orientations', async () => {
    const png = await sheet();
    for (let orientation = 1; orientation <= 8; orientation++) {
      const jpg = await sharp(png)
        .jpeg()
        .withMetadata({ orientation })
        .toBuffer();
      const result = await new CandidateRunner().run(async () => jpg);
      expect(result.image).toEqual(
        orientation < 5
          ? { width: 1000, height: 1200 }
          : { width: 1200, height: 1000 },
      );
      const normalized = await sharp(jpg).rotate().png().toBuffer();
      const expected = await new CandidateRunner().run(async () => normalized);
      expect(result).toEqual(expected);
    }
  }, 15000);
  it('falls back for blank, dark and dense images and enforces decode/byte/pixel limits', async () => {
    for (const background of ['white', 'black']) {
      const bytes = await sharp({
        create: { width: 1000, height: 1400, channels: 3, background },
      })
        .png()
        .toBuffer();
      const r = await new CandidateRunner().run(async () => bytes);
      expect(r.status).toBe('manual_required');
      expect(r.candidates).toEqual([]);
    }
    const huge = await sharp({
      create: { width: 8001, height: 4000, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(
      new CandidateRunner().run(async () => huge),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      new CandidateRunner().run(async () => Buffer.from('%PDF broken')),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      new CandidateRunner().run(
        async () => new Uint8Array(8 * 1024 * 1024 + 1),
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it('has no wait queue, kills timed out children and releases the slot only after close', async () => {
    const runner = new CandidateRunner({
      timeoutMs: 250,
      source:
        "process.stdout.write(JSON.stringify({kind:'image',image:{width:10,height:20}})+'\\n');setInterval(()=>{},1000);",
    });
    const first = runner.run(async () => new Uint8Array());
    await expect(
      runner.run(async () => new Uint8Array()),
    ).rejects.toMatchObject({ status: 503 });
    expect(await first).toMatchObject({
      status: 'manual_required',
      warnings: expect.arrayContaining(['PROCESSING_TIMEOUT']),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const abort = new AbortController();
    const second = runner.run(async () => new Uint8Array(), abort.signal);
    abort.abort();
    await expect(second).rejects.toMatchObject({ status: 408 });
  });
  it('does not start a child after cancellation during file load or inherit application secrets', async () => {
    vi.stubEnv('FAMILY_AI_API_KEY', 'synthetic-secret');
    const source =
      "if(process.env.FAMILY_AI_API_KEY)process.exit(2);process.stdout.write(JSON.stringify({kind:'result',result:{algorithm:'layout-v1',coordinateSpace:'oriented-normalized',image:{width:10,height:10},status:'manual_required',candidates:[],warnings:['LAYOUT_ONLY']}})+'\\n');";
    const runner = new CandidateRunner({ source });
    let release!: (v: Uint8Array) => void;
    const signal = new AbortController();
    const cancelled = runner.run(
      () =>
        new Promise((done) => {
          release = done;
        }),
      signal.signal,
    );
    signal.abort();
    await expect(cancelled).rejects.toMatchObject({ status: 408 });
    release(new Uint8Array());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await runner.run(async () => new Uint8Array())).toMatchObject({
      status: 'manual_required',
    });
  });
  it.each([
    "throw Error('private-content')",
    "process.stdout.write('broken\\n')",
    "process.stdout.write('x'.repeat(70000))",
  ])('rejects crashed or invalid worker output safely', async (source) => {
    await expect(
      new CandidateRunner({ source }).run(async () => new Uint8Array()),
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe('candidate API ownership and non-mutation', () => {
  it('preserves original/manual questions, rejects stale revision and foreign access, and never calls AI', async () => {
    await mkdir('work', { recursive: true });
    const directory = await mkdtemp(resolve('work/candidate-api-'));
    const store = new FamilyStore(join(directory, 'family.sqlite'));
    vi.stubEnv('FAMILY_DATA_DIR', directory);
    vi.stubEnv('FAMILY_PUBLIC_ORIGIN', 'https://family.example');
    vi.stubEnv('FAMILY_MOBILE_ORIGINS', 'https://localhost');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const tokens = ['a'.repeat(64), 'b'.repeat(64)];
    for (let i = 0; i < 2; i++) {
      store.db
        .prepare('INSERT INTO accounts VALUES (?,?,?,?)')
        .run(`f${i}`, `family_${i}`, 'unusable', Date.now());
      store.db
        .prepare('INSERT INTO mobile_sessions VALUES (?,?,?,?,?)')
        .run(
          createHash('sha256').update(tokens[i]).digest('hex'),
          `f${i}`,
          Date.now() + 60000,
          'test',
          Date.now(),
        );
    }
    const student = store.addStudent('f0', '合成学生').id;
    const call = (
      path: string,
      body: unknown,
      token = tokens[0],
      origin = 'https://localhost',
    ) =>
      handleMobile(
        new Request(
          'https://family.example/family-learning/api/mobile/v1/' + path,
          {
            method: 'POST',
            headers: { Origin: origin, Authorization: 'Bearer ' + token },
            body: body instanceof FormData ? body : JSON.stringify(body),
          },
        ),
        path.split('/'),
        store,
      );
    try {
      const png = await sheet();
      const form = new FormData();
      form.set('studentId', student);
      form.set('source', 'synthetic');
      form.set('clientRequestId', randomUUID());
      form.set(
        'file',
        new File([new Uint8Array(png)], 'synthetic.png', { type: 'image/png' }),
      );
      const uploaded = await call('scans', form);
      expect(uploaded.status).toBe(201);
      const scan = ((await uploaded.json()) as { scan: MobileScan }).scan;
      const saved = readStoredScan(store, store.scanOwner('f0'), scan.id)!;
      saved.structuredQuestions = [
        {
          id: 'q1',
          subject: '物理',
          number: '1',
          prompt: '手工题干',
          diagram: '',
          knowledgePoints: [],
          uncertainties: [],
          confirmed: false,
          answerSteps: [],
          regions: [
            { id: 'r1', kind: 'stem', x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
          ],
        },
      ];
      writeStoredScan(store, store.scanOwner('f0'), saved, 'synthetic-review');
      const tables = () =>
        ['scan_documents', 'scan_versions', 'scan_jobs'].map((t) =>
          store.db.prepare(`SELECT * FROM ${t}`).all(),
        );
      const before = tables();
      const path = `scans/${scan.id}/candidate-regions`;
      expect((await call(path, { revision: scan.revision }, '')).status).toBe(
        401,
      );
      expect(
        (await call(path, { revision: scan.revision }, tokens[1])).status,
      ).toBe(404);
      expect(
        (
          await call(
            path,
            { revision: scan.revision },
            tokens[0],
            'https://evil.example',
          )
        ).status,
      ).toBe(403);
      expect((await call(path, { revision: -1 })).status).toBe(400);
      expect((await call(path, { revision: scan.revision + 1 })).status).toBe(
        409,
      );
      const response = await call(path, { revision: scan.revision });
      expect(response.status).toBe(200);
      const result = (await response.json()) as CandidateRegions;
      expect(result).toMatchObject({
        scanId: scan.id,
        revision: scan.revision,
        status: 'candidates',
      });
      expect(result.candidates).toHaveLength(4);
      expect(tables()).toEqual(before);
      expect(fetch).not.toHaveBeenCalled();
      expect(
        await readFile(
          join(scanDirectory(store.scanOwner('f0'), scan.id), 'original'),
        ),
      ).toEqual(png);
      for (let i = 0; i < 5; i++) store.allow('candidate-regions:f0', 6, 60000);
      expect((await call(path, { revision: scan.revision })).status).toBe(429);
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
