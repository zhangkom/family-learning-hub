import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  symlinkSync,
  copyFileSync,
  statfsSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { FamilyStore } from './family-store';
import { handleMobile } from './mobile-backend';
import { sharp } from './sharp';
import { CandidateRunner } from './candidate-regions';
import {
  cloudHash,
  CLOUD_FAMILY_BYTES,
  CLOUD_SERVICE_BYTES,
} from './cloud-photo-files';
import {
  CLOUD_PHOTO_CAPABILITY,
  type CloudPhotoPage,
} from '../lib/cloud-photos';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, statfsSync: vi.fn(actual.statfsSync) };
});

let root: string,
  data: string,
  temp: string,
  store: FamilyStore,
  account: string,
  child: string,
  otherAccount: string,
  otherChild: string;
const token = 'a'.repeat(64),
  otherToken = 'b'.repeat(64),
  api = 'https://learning.test/family-learning/api/mobile/v1/';
const hash = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
beforeEach(() => {
  mkdirSync(resolve('work'), { recursive: true });
  root = mkdtempSync(resolve('work/cloud-photo-test-'));
  data = join(root, 'data');
  temp = join(root, 'temp', 'cloud-photos');
  mkdirSync(data);
  vi.stubEnv('FAMILY_DATA_DIR', data);
  vi.stubEnv('FAMILY_CLOUD_TEMP_DIR', temp);
  vi.stubEnv('FAMILY_PUBLIC_ORIGIN', 'https://learning.test');
  vi.stubEnv('FAMILY_MOBILE_ORIGINS', 'https://localhost');
  store = new FamilyStore(join(data, 'family.sqlite'));
  account = randomUUID();
  otherAccount = randomUUID();
  for (const [id, session] of [
    [account, token],
    [otherAccount, otherToken],
  ]) {
    store.db
      .prepare('INSERT INTO accounts VALUES (?,?,?,?)')
      .run(id, id, 'unused synthetic password', Date.now());
    store.db
      .prepare('INSERT INTO mobile_sessions VALUES (?,?,?,?,?)')
      .run(hash(session), id, Date.now() + 3600000, 'synthetic', Date.now());
  }
  child = store.addStudent(account, '合成孩子').id;
  otherChild = store.addStudent(otherAccount, '另一家庭合成孩子').id;
});
afterEach(() => {
  store.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (dirnameRoot(root) !== resolve('work'))
    throw new Error('Unsafe test cleanup');
  rmSync(root, { recursive: true, force: true });
});
function dirnameRoot(path: string) {
  return resolve(path, '..');
}
function call(
  path: string,
  body?: unknown,
  session = token,
  method = body === undefined ? 'GET' : 'POST',
) {
  return handleMobile(
    new Request(api + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + session,
        Origin: 'https://localhost',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    path.split('?')[0].split('/'),
    store,
  );
}
async function batch(
  expectedCount = 1,
  studentId = child,
  clientBatchId = randomUUID(),
  session = token,
) {
  const response = await call(
    'cloud-photo-batches',
    { studentId, clientBatchId, expectedCount },
    session,
  );
  expect(response.status).toBe(201);
  return (await response.text().then(JSON.parse)).batch;
}
async function jpeg(orientation = 1) {
  return sharp({
    create: { width: 60, height: 40, channels: 3, background: '#abddff' },
  })
    .jpeg()
    .withMetadata({ orientation })
    .toBuffer();
}
async function upload(
  bytes: Uint8Array,
  batchId: string,
  options: {
    requestId?: string;
    studentId?: string;
    mime?: string;
    name?: string;
    digest?: string;
    session?: string;
    extra?: boolean;
    handle?: typeof handleMobile;
  } = {},
) {
  const form = new FormData();
  form.set('studentId', options.studentId ?? child);
  form.set('batchId', batchId);
  form.set('clientRequestId', options.requestId ?? randomUUID());
  form.set('sha256', options.digest ?? hash(bytes));
  form.set(
    'file',
    new Blob([new Uint8Array(bytes)], { type: options.mime ?? 'image/jpeg' }),
    options.name ?? '合成原片.jpg',
  );
  if (options.extra) form.append('studentId', child);
  return (options.handle ?? handleMobile)(
    new Request(api + 'cloud-photos', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + (options.session ?? token),
        Origin: 'https://localhost',
      },
      body: form,
    }),
    ['cloud-photos'],
    store,
  );
}
async function photo(
  bytes = undefined as Uint8Array | undefined,
  student = child,
) {
  const b = await batch(100, student),
    response = await upload(bytes ?? (await jpeg()), b.id, {
      studentId: student,
    });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.text().then(JSON.parse)).photo;
}

describe('private cloud photo API', () => {
  it('advertises explicit limits, requires login/CORS and constrains owned batch creation', async () => {
    expect(
      (await (await call('setup')).text().then(JSON.parse)).cloudPhotos,
    ).toEqual(CLOUD_PHOTO_CAPABILITY);
    expect(
      (await call('cloud-photos?studentId=' + child, undefined, '')).status,
    ).toBe(401);
    expect(
      (
        await handleMobile(
          new Request(api + 'cloud-photos', {
            headers: {
              Origin: 'https://evil.test',
              Authorization: 'Bearer ' + token,
            },
          }),
          ['cloud-photos'],
          store,
        )
      ).status,
    ).toBe(403);
    for (const expectedCount of [0, 201, 1.5, '1'])
      expect(
        (
          await call('cloud-photo-batches', {
            studentId: child,
            clientBatchId: randomUUID(),
            expectedCount,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await call('cloud-photo-batches', {
          studentId: otherChild,
          clientBatchId: randomUUID(),
          expectedCount: 1,
        })
      ).status,
    ).toBe(404);
    const clientBatchId = randomUUID(),
      b = await batch(100, child, clientBatchId);
    const retry = await call('cloud-photo-batches', {
      studentId: child,
      clientBatchId: clientBatchId.toUpperCase(),
      expectedCount: 100,
    });
    expect(retry.status).toBe(200);
    expect((await retry.text().then(JSON.parse)).batch).toEqual(b);
    const changed = await call('cloud-photo-batches', {
      studentId: child,
      clientBatchId,
      expectedCount: 99,
    });
    expect(changed.status).toBe(409);
    expect((await changed.text().then(JSON.parse)).code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
  });
  it('preserves original bytes, UTF8 filename, EXIF and private download while creating no scan or model job', async () => {
    const model = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('No network expected'));
    const bytes = await jpeg(6),
      p = await photo(bytes);
    expect(p).toMatchObject({
      studentId: child,
      originalName: '合成原片.jpg',
      size: bytes.length,
      sha256: hash(bytes),
      width: 40,
      height: 60,
      orientation: 6,
    });
    const dir = join(data, cloudHash(account), 'cloud-photos', p.id);
    expect(readFileSync(join(dir, 'original'))).toEqual(bytes);
    expect(JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8'))).toEqual(
      p,
    );
    const original = await call('cloud-photos/' + p.id + '/file');
    expect(original.status).toBe(200);
    expect(Buffer.from(await original.arrayBuffer())).toEqual(bytes);
    expect(original.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''%E5%90%88",
    );
    expect(original.headers.get('cache-control')).toBe('private, no-store');
    expect(original.headers.get('x-content-type-options')).toBe('nosniff');
    const thumb = await call('cloud-photos/' + p.id + '/thumbnail'),
      metadata = await sharp(
        new Uint8Array(await thumb.arrayBuffer()),
      ).metadata();
    expect(thumb.headers.get('content-type')).toBe('image/jpeg');
    expect(metadata).toMatchObject({ width: 40, height: 60 });
    for (const table of ['scan_documents', 'scan_uploads', 'scan_jobs'])
      expect(store.db.prepare('SELECT count(*) n FROM ' + table).get()?.n).toBe(
        0,
      );
    expect(model).not.toHaveBeenCalled();
    expect(readdirSync(temp)).toEqual([]);
  });
  it('recovers a lost receipt, rejects identity conflicts and enforces batch completion independently of retry', async () => {
    const b = await batch(),
      bytes = await jpeg(),
      requestId = randomUUID();
    const first = (
      await (await upload(bytes, b.id, { requestId })).text().then(JSON.parse)
    ).photo;
    const retry = await upload(bytes, b.id, { requestId });
    expect(retry.status).toBe(200);
    expect((await retry.text().then(JSON.parse)).photo).toEqual(first);
    const conflict = await upload(bytes, b.id, {
      requestId,
      name: 'another.jpg',
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.text().then(JSON.parse)).code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
    const extra = await upload(bytes, b.id);
    expect(extra.status).toBe(409);
    expect((await extra.text().then(JSON.parse)).code).toBe(
      'BATCH_LIMIT_REACHED',
    );
    expect(
      store.db.prepare('SELECT count(*) n FROM cloud_photos').get()?.n,
    ).toBe(1);
  });
  it('recovers durable originals left before a database commit without overwriting them', async () => {
    const bytes = await jpeg(),
      b = await batch(),
      requestId = randomUUID();
    const p = (
      await (await upload(bytes, b.id, { requestId })).text().then(JSON.parse)
    ).photo;
    store.db.prepare('DELETE FROM cloud_photos WHERE id=?').run(p.id);
    expect(
      (await upload(bytes, b.id, { requestId, name: 'conflicting.jpg' }))
        .status,
    ).toBe(409);
    const retry = await upload(bytes, b.id, { requestId });
    expect(retry.status).toBe(201);
    expect((await retry.text().then(JSON.parse)).photo).toEqual(p);
  });
  it('rejects truncated, disguised, unsupported, hash-mismatched and duplicate-field uploads without persistence', async () => {
    const b = await batch(100),
      bytes = await jpeg();
    const cases = [
      await upload(bytes, b.id, { digest: '0'.repeat(64) }),
      await upload(bytes, b.id, { extra: true }),
      await upload(bytes, b.id, { mime: 'image/png' }),
      await upload(bytes, b.id, { mime: 'application/pdf' }),
      await upload(bytes.subarray(0, 80), b.id),
      await upload(new Uint8Array(), b.id),
    ];
    for (const response of cases)
      expect(response.status, await response.clone().text()).toBe(400);
    expect(
      store.db.prepare('SELECT count(*) n FROM cloud_photos').get()?.n,
    ).toBe(0);
    expect(readdirSync(temp)).toEqual([]);
  });
  it('enforces byte and decoded-pixel ceilings while accepting a 32 MiB original', async () => {
    const b = await batch(3),
      bytes = await jpeg();
    const padded = Buffer.alloc(32 * 1024 * 1024);
    padded.set(bytes);
    const response = await upload(padded, b.id);
    expect(response.status, await response.clone().text()).toBe(201);
    const p = (await response.text().then(JSON.parse)).photo;
    expect(p.size).toBe(padded.length);
    expect(p.sha256).toBe(hash(padded));
    const over = await upload(Buffer.alloc(32 * 1024 * 1024 + 1), b.id);
    expect(over.status).toBe(413);
    const huge = await sharp({
      create: { width: 8001, height: 4000, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    expect((await upload(huge, b.id, { mime: 'image/png' })).status).toBe(413);
    expect(readdirSync(temp)).toEqual([]);
  }, 30000);
  it('accepts a full 200-photo server group and requires the 201st photo to use another group', async () => {
    const b = await batch(200),
      bytes = await jpeg();
    for (let i = 0; i < 200; i++) {
      const response = await upload(bytes, b.id);
      expect(response.status, await response.clone().text()).toBe(201);
    }
    const extra = await upload(bytes, b.id);
    expect(extra.status).toBe(409);
    expect((await extra.text().then(JSON.parse)).code).toBe(
      'BATCH_LIMIT_REACHED',
    );
    expect(
      store.db.prepare('SELECT count(*) n FROM cloud_photos').get()?.n,
    ).toBe(200);
  }, 60000);
  it('upgrades an existing 100-photo database while preserving photos, foreign keys and upload receipts', async () => {
    const oldBatch = await batch(100), bytes = await jpeg(), requestId = randomUUID();
    const before = await upload(bytes, oldBatch.id, { requestId });
    const oldPhoto = (await before.text().then(JSON.parse)).photo;
    const oldSchema = String(store.db.prepare("SELECT sql FROM sqlite_schema WHERE name='cloud_photo_batches'").get()?.sql)
      .replace('CREATE TABLE cloud_photo_batches', 'CREATE TABLE old_cloud_batches')
      .replace('BETWEEN 1 AND 200', 'BETWEEN 1 AND 100');
    store.db.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE; ${oldSchema};
      INSERT INTO old_cloud_batches SELECT * FROM cloud_photo_batches;
      DROP TABLE cloud_photo_batches; ALTER TABLE old_cloud_batches RENAME TO cloud_photo_batches;
      COMMIT; PRAGMA foreign_keys=ON;`);
    store.close(); store = new FamilyStore(join(data, 'family.sqlite'));
    expect(store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(store.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
    const retry = await upload(bytes, oldBatch.id, { requestId });
    expect(retry.status).toBe(200);
    expect((await retry.text().then(JSON.parse)).photo).toEqual(oldPhoto);
    expect(await (await call('cloud-photos/' + oldPhoto.id + '/file')).arrayBuffer()).toEqual(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    await batch(200);
    store.close(); store = new FamilyStore(join(data, 'family.sqlite'));
    expect(store.db.prepare('SELECT count(*) n FROM cloud_photo_batches').get()?.n).toBe(2);
    expect(store.db.prepare('SELECT count(*) n FROM cloud_photos').get()?.n).toBe(1);
  });
  it('isolates other families, requires explicit child, and paginates without repeats or cursor crossover', async () => {
    const bytes = await jpeg(),
      secondChild = store.addStudent(account, '同家庭另一个孩子').id;
    const items = [await photo(bytes), await photo(bytes), await photo(bytes)];
    await photo(bytes, secondChild);
    for (const suffix of ['', '/file', '/thumbnail'])
      expect(
        (
          await call(
            'cloud-photos/' + items[0].id + suffix,
            undefined,
            otherToken,
          )
        ).status,
      ).toBe(404);
    expect((await call('cloud-photos')).status).toBe(404);
    const seen = new Set<string>();
    let cursor: string | null = null,
      firstCursor = '';
    do {
      const page: CloudPhotoPage = await (
        await call(
          'cloud-photos?studentId=' +
            child +
            '&limit=1' +
            (cursor ? '&cursor=' + cursor : ''),
        )
      )
        .text()
        .then(JSON.parse);
      expect(page.storage).toEqual({
        usedBytes: bytes.length * 4,
        limitBytes: CLOUD_FAMILY_BYTES,
      });
      for (const p of page.photos) {
        expect(seen.has(p.id)).toBe(false);
        seen.add(p.id);
      }
      cursor = page.nextCursor;
      if (cursor) firstCursor = cursor;
    } while (cursor);
    expect(seen.size).toBe(3);
    expect(
      (
        await call(
          'cloud-photos?studentId=' + secondChild + '&cursor=' + firstCursor,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          'cloud-photos?studentId=' + otherChild + '&cursor=' + firstCursor,
          undefined,
          otherToken,
        )
      ).status,
    ).toBe(400);
    expect(
      (await call('cloud-photos?studentId=' + child + '&limit=101')).status,
    ).toBe(400);
    const foreignBatch = await batch(1, otherChild, randomUUID(), otherToken);
    expect((await upload(bytes, foreignBatch.id)).status).toBe(404);
  });
  it('bounds upload concurrency and releases its slot and temporary files after abort', async () => {
    const abort = new AbortController();
    const request = new Request(api + 'cloud-photos', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'multipart/form-data; boundary=synthetic',
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('--synthetic\r\n'));
        },
      }),
      signal: abort.signal,
      duplex: 'half',
    } as RequestInit);
    const first = handleMobile(request, ['cloud-photos'], store);
    await new Promise((r) => setTimeout(r, 20));
    const b = await batch();
    const busy = await upload(await jpeg(), b.id);
    expect(busy.status).toBe(503);
    expect((await busy.text().then(JSON.parse)).code).toBe('UPLOAD_BUSY');
    abort.abort();
    expect((await first).status).toBe(408);
    expect(readdirSync(temp)).toEqual([]);
    expect((await upload(await jpeg(), b.id)).status).toBe(201);
  });
  it('waits for an existing candidate child without decoding two large images concurrently', async () => {
    const b = await batch(),
      bytes = await jpeg();
    const runner = new CandidateRunner({
      timeoutMs: 300,
      source:
        "process.stdout.write(JSON.stringify({kind:'image',image:{width:10,height:10}})+'\\n');setInterval(()=>{},1000);",
    });
    const detection = runner.run(async () => new Uint8Array());
    await expect(
      new CandidateRunner().run(async () => bytes),
    ).rejects.toMatchObject({ status: 503 });
    const uploading = upload(bytes, b.id);
    expect((await detection).status).toBe('manual_required');
    expect((await uploading).status).toBe(201);
  });
  it('serves 30 cold thumbnails with bounded processing and prioritizes a waiting upload', async () => {
    const p = await photo(),
      original = join(
        data,
        cloudHash(account),
        'cloud-photos',
        p.id,
        'original',
      );
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      const id = randomUUID(),
        item = { ...p, id, clientRequestId: randomUUID() },
        path = join(data, cloudHash(account), 'cloud-photos', id);
      mkdirSync(path);
      copyFileSync(original, join(path, 'original'));
      writeFileSync(join(path, 'record.json'), JSON.stringify(item));
      store.db
        .prepare('INSERT INTO cloud_photos VALUES (?,?,?,?,?,?,?,?,?)')
        .run(
          id,
          account,
          child,
          p.batchId,
          item.clientRequestId,
          'synthetic seeded receipt',
          item.size,
          item.createdAt,
          JSON.stringify(item),
        );
      ids.push(id);
    }
    vi.resetModules();
    const fresh = (await import('./mobile-backend')).handleMobile;
    const reads = ids.map((id) =>
      fresh(
        new Request(api + 'cloud-photos/' + id + '/thumbnail', {
          headers: { Authorization: 'Bearer ' + token },
        }),
        ['cloud-photos', id, 'thumbnail'],
        store,
      ),
    );
    const receipt = await upload(await jpeg(), p.batchId, { handle: fresh });
    expect(receipt.status, await receipt.clone().text()).toBe(201);
    const results = await Promise.all(reads);
    expect(
      results.map((x) => x.status),
      await results[0].clone().text(),
    ).toEqual(Array(30).fill(200));
    for (const result of results)
      expect(
        (await sharp(new Uint8Array(await result.arrayBuffer())).metadata())
          .format,
      ).toBe('jpeg');
  }, 40000);
  it('refuses low disk space before creating a temporary upload', async () => {
    const b = await batch(),
      state = statfsSync(data, { bigint: true });
    vi.mocked(statfsSync).mockReturnValueOnce({ ...state, bavail: BigInt(0) });
    const response = await upload(await jpeg(), b.id);
    expect(response.status).toBe(503);
    expect((await response.text().then(JSON.parse)).code).toBe('STORAGE_LOW');
    expect(
      store.db.prepare('SELECT count(*) n FROM cloud_photos').get()?.n,
    ).toBe(0);
  });
  it('enforces family and service quotas before another original is committed', async () => {
    const p = await photo();
    store.db
      .prepare('UPDATE cloud_photos SET size=? WHERE id=?')
      .run(CLOUD_FAMILY_BYTES, p.id);
    let result = await upload(await jpeg(), p.batchId);
    expect(result.status).toBe(507);
    expect((await result.text().then(JSON.parse)).code).toBe('STORAGE_QUOTA');
    store.db
      .prepare(
        'UPDATE cloud_photos SET account_id=?,student_id=?,size=? WHERE id=?',
      )
      .run(otherAccount, otherChild, CLOUD_SERVICE_BYTES, p.id);
    result = await upload(await jpeg(), p.batchId);
    expect(result.status).toBe(507);
  });
  it('rejects a symlink storage namespace and does not write outside it', async () => {
    const target = join(root, 'not-cloud');
    mkdirSync(target);
    symlinkSync(target, join(data, cloudHash(account)), 'junction');
    const response = await upload(await jpeg(), (await batch()).id);
    expect(response.status).toBe(500);
    expect(readdirSync(target)).toEqual([]);
  });
  it('backs up and restores cloud receipts and bytes, reuses backup-only immutable originals and preserves old snapshots', async () => {
    const bytes = await jpeg(),
      p = await photo(bytes),
      backups = join(root, 'backups');
    const backup = () => {
      const result = spawnSync(
        process.execPath,
        [resolve('scripts/backup-family.mjs')],
        {
          env: {
            NODE_ENV: 'test',
            SystemRoot: process.env.SystemRoot,
            FAMILY_DATA_DIR: data,
            FAMILY_BACKUP_DIR: backups,
          },
          encoding: 'utf8',
          windowsHide: true,
          timeout: 15000,
        },
      );
      expect(result.status, result.stderr).toBe(0);
      return join(
        backups,
        readdirSync(backups)
          .filter((n) => n.startsWith('family-'))
          .sort()
          .at(-1)!,
      );
    };
    const first = backup();
    await new Promise((r) => setTimeout(r, 5));
    const second = backup(),
      relative = join(cloudHash(account), 'cloud-photos', p.id, 'original');
    const manifest = JSON.parse(
      readFileSync(join(second, 'manifest.json'), 'utf8'),
    );
    expect(manifest.files).toHaveLength(3);
    for (const f of manifest.files)
      expect(hash(readFileSync(join(second, f.path)))).toBe(f.sha256);
    const restored = new FamilyStore(join(second, 'family.sqlite'));
    expect(
      JSON.parse(
        String(
          restored.db
            .prepare('SELECT body FROM cloud_photos WHERE id=?')
            .get(p.id)?.body,
        ),
      ),
    ).toEqual(p);
    restored.close();
    if (process.platform !== 'win32')
      expect(statSync(join(first, relative)).ino).toBe(
        statSync(join(second, relative)).ino,
      );
    expect(statSync(join(data, relative)).ino).not.toBe(
      statSync(join(second, relative)).ino,
    );
    rmSync(first, { recursive: true });
    writeFileSync(join(data, relative), 'simulated live-file damage');
    expect(readFileSync(join(second, relative))).toEqual(bytes);
  });
});
