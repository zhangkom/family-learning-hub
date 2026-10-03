import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { FamilyStore } from './family-store';
import { handleMobile } from './mobile-backend';
import { readStoredScan, saveScan, writeStoredScan, scanDirectory } from './scan-files';
import * as scanFiles from './scan-files';
import { sharp } from './sharp';
import * as docx from './worksheet-docx';
import { worksheetSourceFingerprint } from './worksheet-export';
import type { ScanRecord } from '../lib/scans';
import type { Question } from '../lib/mobile';
import type { WorksheetBlock } from '../lib/worksheet';

let directory: string, store: FamilyStore, server: Server, api: string, student: string, sibling: string, record: ScanRecord;
const token = '8'.repeat(64), foreign = '9'.repeat(64);
const blocks: WorksheetBlock[] = [
  { kind: 'paragraph', inlines: [{ text: '合成排版题：计算这个分数，结合配图说明。' }] },
  { kind: 'equation', math: { kind: 'fraction', numerator: { kind: 'text', text: '1' }, denominator: { kind: 'text', text: '2' } } },
  { kind: 'figure', widthMm: 50, drawing: { width: 200, height: 100, description: '已核对的合成线段', elements: [{ kind: 'line', x1: 20, y1: 50, x2: 180, y2: 50 }, { kind: 'label', x: 20, y: 35, text: 'A' }] } },
];
const answerBlocks: WorksheetBlock[] = [{ kind: 'paragraph', inlines: [{ text: 'APPENDIX_ONLY_SYNTHETIC_ANSWER' }] }];
function unzip(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes), files = new Map<string, Buffer>(); let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18), nameLength = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28), start = offset + 30 + nameLength + extra;
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString();
    files.set(name, inflateRawSync(buffer.subarray(start, start + size))); offset = start + size;
  }
  return files;
}
async function call(path: string, body: unknown, auth = token, method = 'POST') {
  if (new URL(api).hostname !== '127.0.0.1') throw new Error('Only loopback tests permitted');
  return fetch(api + path, { method, headers: { Authorization: 'Bearer ' + auth, Origin: 'https://localhost', 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }) as Promise<Omit<Response, 'json'> & { json(): Promise<{ readyCount: number; items: { reasons: string[] }[] }> }>;
}
const current = () => readStoredScan(store, store.scanOwner('a'), record.id)!;
const selection = () => ({ studentId: student, selections: [{ scanId: record.id, questionId: 'q', revision: current().revision }] });
const prepareBody = (extra = {}) => ({ studentId: student, scanId: record.id, questionId: 'q', revision: current().revision,
  sourceFingerprint: worksheetSourceFingerprint(current(), current().structuredQuestions![0]), blocks, answerBlocks, answerSpaceMm: 25, verificationNote: '逐项对照合成原件核对题干、原生公式、配图标记与参考答案。', ...extra });
async function prepare(extra = {}) { const response = await call('worksheets/prepare', prepareBody(extra)); const data = await response.json(); expect(response.status, JSON.stringify(data)).toBe(200); }
beforeEach(async () => {
  mkdirSync('work', { recursive: true }); directory = mkdtempSync(resolve('work/worksheet-http-')); store = new FamilyStore(join(directory, 'family.sqlite'));
  vi.stubEnv('FAMILY_DATA_DIR', directory); vi.stubEnv('FAMILY_MOBILE_ORIGINS', 'https://localhost');
  for (const [id, t] of [['a', token], ['b', foreign]]) { store.db.prepare('INSERT INTO accounts VALUES (?,?,?,?)').run(id, id, 'synthetic-no-login', Date.now()); store.db.prepare('INSERT INTO mobile_sessions VALUES (?,?,?,?,?)').run(createHash('sha256').update(t).digest('hex'), id, Date.now() + 600000, 'synthetic', Date.now()); }
  student = store.addStudent('a', '合成学生').id; sibling = store.addStudent('a', '同家庭另一学生').id;
  const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#fff' } }).png().toBuffer();
  const question: Question = { id: 'q', number: '7(2)', subject: '数学', prompt: '合成待排版原题', diagram: '完整图', promptKind: 'full', confirmed: true, wrongBook: { savedAt: '2026-01-01T00:00:00Z' }, knowledgePoints: [], uncertainties: [], regions: [{ id: 'r', kind: 'stem', x: 0, y: 0, width: 1, height: 1 }], answerSteps: [{ id: 'answer', order: 1, text: 'PRIVATE_STUDENT_WORK_NOT_IN_EXERCISE', author: 'student', regionIds: [], crossedOut: false, uncertain: false }] };
  record = { id: randomUUID(), studentId: student, subject: '数学', source: '合成来源试卷', originalName: 'synthetic.png', mimeType: 'image/png', size: png.length, createdAt: new Date().toISOString(), revision: 1, status: 'ready', structuredQuestions: [question] } as ScanRecord;
  await saveScan(store.scanOwner('a'), record, png, store);
  server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const path = new URL(request.url!, api).pathname.split('/api/mobile/v1/')[1];
    const controller = new AbortController(); response.on('close', () => { if (!response.writableFinished) controller.abort(); });
    const result = await handleMobile(new Request(api + path, { method: request.method, signal: controller.signal, headers: request.headers as Record<string, string>, ...(request.method === 'GET' ? {} : { body: Buffer.concat(chunks) }) }), path.split('?')[0].split('/'), store);
    response.writeHead(result.status, Object.fromEntries(result.headers.entries())); response.end(Buffer.from(await result.arrayBuffer()));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port'); api = `http://127.0.0.1:${address.port}/family-learning/api/mobile/v1/`;
  vi.stubEnv('FAMILY_PUBLIC_ORIGIN', new URL(api).origin);
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); store.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); expect(directory.startsWith(resolve('work') + sep)).toBe(true); rmSync(directory, { recursive: true, force: true }); });

describe('worksheet authenticated loopback HTTP workflow', () => {
  it('previews readiness, saves verified native layout, exports blank exercise and opt-in answer appendix', async () => {
    expect((await (await call('worksheets/preview', selection())).json()).readyCount).toBe(0);
    expect((await call('worksheets/export', selection())).status).toBe(409);
    await prepare(); const preview = await (await call('worksheets/preview', selection())).json(); expect(preview.readyCount).toBe(1);
    const response = await call('worksheets/export', selection()); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store'); expect(response.headers.get('content-type')).toContain('wordprocessingml');
    const files = unzip(new Uint8Array(await response.arrayBuffer())), xml = files.get('word/document.xml')!.toString();
    expect(xml).toContain('<m:f>'); expect(xml).toContain('7(2)'); expect(xml).toContain('合成来源试卷'); expect(xml).not.toContain('APPENDIX_ONLY'); expect(xml).not.toContain('PRIVATE_STUDENT_WORK');
    expect(files.has('word/header1.xml')).toBe(true); expect(files.get('word/footer1.xml')!.toString()).toContain('NUMPAGES'); expect(files.has('word/media/figure1.png')).toBe(true);
    const withAnswers = await call('worksheets/export', { ...selection(), includeAnswers: true }); expect(withAnswers.status).toBe(200);
    expect(unzip(new Uint8Array(await withAnswers.arrayBuffer())).get('word/document.xml')!.toString()).toContain('APPENDIX_ONLY_SYNTHETIC_ANSWER');
  });
  it('rejects foreign accounts, sibling students, stale versions and duplicate selections', async () => {
    expect((await call('worksheets/preview', selection(), foreign)).status).toBe(404);
    expect((await call('worksheets/prepare', prepareBody(), foreign)).status).toBe(404);
    expect((await call('worksheets/preview', { ...selection(), studentId: sibling })).status).toBe(404);
    expect((await call('worksheets/prepare', prepareBody({ studentId: sibling }))).status).toBe(404);
    expect((await call('worksheets/preview', { ...selection(), selections: [{ ...selection().selections[0], revision: 0 }] })).status).toBe(409);
    expect((await call('worksheets/preview', { ...selection(), selections: [...selection().selections, ...selection().selections] })).status).toBe(400);
    expect((await call('worksheets/prepare', prepareBody({ sourceFingerprint: '0'.repeat(64) }))).status).toBe(409);
    expect((await call('worksheets/preview', selection(), token, 'GET')).status).toBe(405);
  });
  it('binds photographs to owned current scan bytes, exports only the requested crop, and exposes digest headers', async () => {
    const photo = { kind: 'sourcePhoto', crop: { x: 0.2, y: 0.1, width: 0.4, height: 0.3 }, description: '合成无批注实验照片', widthMm: 60 };
    const read = vi.spyOn(scanFiles, 'readScanFile');
    expect((await call('worksheets/prepare', prepareBody({ blocks: [photo] }), foreign)).status).toBe(404);
    expect((await call('worksheets/prepare', prepareBody({ blocks: [photo], studentId: sibling }))).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
    for (const forbidden of ['path', 'url', 'base64', 'scanId', 'sourceImage']) expect((await call('worksheets/prepare', prepareBody({ blocks: [{ ...photo, [forbidden]: 'other-source' }] }))).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
    expect((await call('worksheets/prepare', prepareBody({ blocks: [{ ...photo, crop: { ...photo.crop, x: 0.9 } }] }))).status).toBe(400);
    await prepare({ blocks: [photo] });
    const response = await call('worksheets/export', selection()); expect(response.status).toBe(200);
    expect(response.headers.get('access-control-expose-headers')).toContain('X-Content-SHA256');
    const bytes = Buffer.from(await response.arrayBuffer()); expect(createHash('sha256').update(bytes).digest('hex')).toBe(response.headers.get('x-content-sha256'));
    const png = unzip(bytes).get('word/media/figure1.png')!, meta = await sharp(png).metadata(); expect([meta.width, meta.height]).toEqual([120, 90]);
    const original = readFileSync(join(scanDirectory(store.scanOwner('a'), record.id), 'original'));
    expect(await sharp(png).raw().toBuffer()).toEqual(await sharp(original).extract({ left: 60, top: 30, width: 120, height: 90 }).raw().toBuffer());
    const privateResponse = await call('worksheets/export', selection(), foreign); expect(privateResponse.status).toBe(404); expect(privateResponse.headers.get('content-disposition')).toBeNull();
  });
  it('fails safely on missing or changed photo bytes and releases the render slot for a later retry', async () => {
    const photo = { kind: 'sourcePhoto', crop: { x: 0, y: 0, width: 1, height: 1 }, description: '合成照片', widthMm: 60 };
    const path = join(scanDirectory(store.scanOwner('a'), record.id), 'original'), bytes = readFileSync(path);
    const before = current(); store.transaction(() => writeStoredScan(store, store.scanOwner('a'), { ...before, revision: before.revision + 1,
      sourcePage: { photoId: 'photo', documentId: 'doc', title: '合成照片试卷', subject: '数学', pageNumber: 1, pageCount: 1, revision: 1, scanSha256: createHash('sha256').update(bytes).digest('hex') } }, 'synthetic-versioned'));
    unlinkSync(path);
    expect((await call('worksheets/prepare', prepareBody({ blocks: [photo] }))).status).toBe(409);
    writeFileSync(path, bytes); await prepare({ blocks: [photo] });
    const tampered = Buffer.from(bytes); tampered[tampered.length - 10] ^= 1; writeFileSync(path, tampered);
    const failed = await call('worksheets/export', selection()); expect(failed.status).toBe(409); expect(failed.headers.get('content-disposition')).toBeNull();
    writeFileSync(path, bytes); expect((await call('worksheets/export', selection())).status).toBe(200);
    unlinkSync(path); expect((await call('worksheets/export', selection())).status).toBe(409);
  });
  it('loads no source photograph until it owns the account render slot', async () => {
    const photo = { kind: 'sourcePhoto', crop: { x: 0, y: 0, width: 1, height: 1 }, description: '合成照片', widthMm: 60 };
    await prepare({ blocks: [photo] }); let release!: () => void, entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const read = vi.spyOn(scanFiles, 'readScanFile');
    vi.spyOn(docx, 'buildWorksheetDocx').mockImplementationOnce(async () => { entered(); await gate; throw new Error('Synthetic interruption'); });
    const first = call('worksheets/export', selection()); await ready; read.mockClear();
    expect((await call('worksheets/export', selection())).status).toBe(429);
    expect((await call('worksheets/prepare', prepareBody({ blocks: [photo] }))).status).toBe(429); expect(read).not.toHaveBeenCalled();
    release(); expect((await first).status).toBe(500); expect((await call('worksheets/export', selection())).status).toBe(200);
  });
  it('reads the selected repaired image version rather than the immutable earlier original', async () => {
    const photo = { kind: 'sourcePhoto', crop: { x: 0, y: 0, width: 0.5, height: 0.5 }, description: '修订后的合成照片', widthMm: 60 };
    const replacement = await sharp({ create: { width: 160, height: 120, channels: 3, background: '#254ac7' } }).png().toBuffer(), sha = createHash('sha256').update(replacement).digest('hex');
    const folder = join(scanDirectory(store.scanOwner('a'), record.id), 'image-revisions'); mkdirSync(folder); writeFileSync(join(folder, sha + '.jpg'), replacement);
    const before = current(); store.transaction(() => writeStoredScan(store, store.scanOwner('a'), { ...before, size: replacement.length, revision: before.revision + 1,
      sourcePage: { photoId: 'photo', documentId: 'doc', title: '合成修订照片', subject: '数学', pageNumber: 1, pageCount: 1, revision: 2, scanSha256: sha } }, 'synthetic-image-revision'));
    await prepare({ blocks: [photo] });
    const response = await call('worksheets/export', selection()); expect(response.status).toBe(200);
    const png = unzip(new Uint8Array(await response.arrayBuffer())).get('word/media/figure1.png')!;
    expect(await sharp(png).raw().toBuffer()).toEqual(await sharp(replacement).extract({ left: 0, top: 0, width: 80, height: 60 }).raw().toBuffer());
    unlinkSync(join(folder, sha + '.jpg'));
    const unavailable = await call('worksheets/export', selection()); expect(unavailable.status).toBe(409); expect(unavailable.headers.get('content-disposition')).toBeNull();
  });
  it('rejects source byte budgets before reading any photograph or rendering', async () => {
    await prepare({ blocks: [{ kind: 'sourcePhoto', crop: { x: 0, y: 0, width: 1, height: 1 }, description: '合成照片', widthMm: 60 }] });
    const before = current(), next = { ...before, size: 129 * 1024 * 1024, revision: before.revision + 1 };
    next.structuredQuestions![0].worksheet!.sourceFingerprint = worksheetSourceFingerprint(next, next.structuredQuestions![0]);
    store.transaction(() => writeStoredScan(store, store.scanOwner('a'), next, 'worksheet-review:synthetic-budget'));
    const read = vi.spyOn(scanFiles, 'readScanFile'), build = vi.spyOn(docx, 'buildWorksheetDocx');
    const response = await call('worksheets/export', selection()); expect(response.status).toBe(413);
    expect(read).not.toHaveBeenCalled(); expect(build).not.toHaveBeenCalled();
  });
  it('preserves verified layout and fingerprint across manual star changes and old-client writes, but rejects content changes', async () => {
    await prepare(); const fingerprint = current().structuredQuestions![0].worksheet!.sourceFingerprint;
    const stars = await call(`scans/${record.id}/questions/q/difficulty`, { studentId: student, revision: current().revision, stars: 5 }); expect(stars.status).toBe(200);
    expect(worksheetSourceFingerprint(current(), current().structuredQuestions![0])).toBe(fingerprint);
    const q = { ...current().structuredQuestions![0], worksheet: { blocks: [{ kind: 'paragraph', inlines: [{ text: 'FORGED' }] }] } };
    expect((await call(`scans/${record.id}/review`, { revision: current().revision, questions: [q] }, token, 'PUT')).status).toBe(200);
    expect(current().structuredQuestions![0].worksheet!.blocks).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'equation' })]));
    expect((await (await call('worksheets/preview', selection())).json()).readyCount).toBe(1);
    expect((await call(`scans/${record.id}/review`, { revision: current().revision, questions: [{ ...q, prompt: '原题条件已更改' }] }, token, 'PUT')).status).toBe(200);
    expect((await (await call('worksheets/preview', selection())).json()).readyCount).toBe(0); expect((await call('worksheets/export', selection())).status).toBe(409);
  });
  it('never returns a generated private document after a concurrent source edit', async () => {
    await prepare(); const build = docx.buildWorksheetDocx;
    vi.spyOn(docx, 'buildWorksheetDocx').mockImplementationOnce(async input => {
      const result = await build(input), before = current();
      store.transaction(() => writeStoredScan(store, store.scanOwner('a'), { ...before, revision: before.revision + 1, structuredQuestions: before.structuredQuestions!.map(q => ({ ...q, prompt: '并发修改的原题' })) }, 'synthetic-concurrent-edit'));
      return result;
    });
    const response = await call('worksheets/export', selection()); expect(response.status).toBe(409); expect(response.headers.get('content-type')).toContain('json'); expect(response.headers.get('content-disposition')).toBeNull();
  });
  it('does not turn summary or pending material into a printable question without independent layout and material checks', async () => {
    const before = current(); store.transaction(() => writeStoredScan(store, store.scanOwner('a'), { ...before, revision: before.revision + 1, structuredQuestions: before.structuredQuestions!.map(q => ({ ...q, prompt: '题目定位摘要：合成题', promptKind: 'summary', paperMark: { classification: 'pending', ruleIds: ['R09'], evidence: [{ text: '合成缺字待补' }], reviewedAt: '', reviewedBy: 'codex-manual', independentAssessment: false } })) }, 'synthetic-pending'));
    expect((await call('worksheets/export', selection())).status).toBe(409);
    await prepare(); const preview = await (await call('worksheets/preview', selection())).json(); expect(preview.readyCount).toBe(0); expect(preview.items[0].reasons.join(' ')).toContain('待补全');
    expect((await call('worksheets/export', selection())).status).toBe(409);
  });
  it('rejects oversize figures and aggregate render budgets before rendering without silently dropping selected questions', async () => {
    const figure = blocks[2]; if (figure.kind !== 'figure') throw new Error('Synthetic figure missing');
    expect((await call('worksheets/prepare', prepareBody({ blocks: [{ ...figure, widthMm: 165, drawing: { ...figure.drawing, width: 50, height: 2000, elements: [{ kind: 'line', x1: 10, y1: 10, x2: 20, y2: 20 }] } }] }))).status).toBe(400);
    await prepare(); const before = current(), base = before.structuredQuestions![0];
    const questions = Array.from({ length: 31 }, (_, i): Question => ({ ...base, id: 'many-' + i, number: String(i + 1), worksheet: { ...base.worksheet!, blocks: Array.from({ length: 10 }, () => figure) } }));
    const next = { ...before, revision: before.revision + 1, structuredQuestions: questions };
    for (const q of questions) q.worksheet!.sourceFingerprint = worksheetSourceFingerprint(next, q);
    store.transaction(() => writeStoredScan(store, store.scanOwner('a'), next, 'worksheet-review:synthetic-fixture'));
    const build = vi.spyOn(docx, 'buildWorksheetDocx');
    const response = await call('worksheets/export', { studentId: student, selections: questions.map(q => ({ scanId: record.id, questionId: q.id, revision: next.revision })) });
    expect(response.status).toBe(413); expect(build).not.toHaveBeenCalled();
  });
  it('rejects concurrent rendering for the same account and releases the slot on failure', async () => {
    await prepare(); let release!: () => void, entered!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(docx, 'buildWorksheetDocx').mockImplementationOnce(async () => { entered(); await gate; throw new Error('Synthetic renderer failed'); });
    const first = call('worksheets/export', selection()); await enteredPromise;
    expect((await call('worksheets/export', selection())).status).toBe(429); release(); expect((await first).status).toBe(500);
    expect((await call('worksheets/export', selection())).status).toBe(200);
  });
  it('propagates an HTTP disconnect into rendering and releases the in-flight slot', async () => {
    await prepare(); let entered!: () => void, aborted!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), cancelled = new Promise<void>(resolve => { aborted = resolve; });
    vi.spyOn(docx, 'buildWorksheetDocx').mockImplementationOnce(input => new Promise((_resolve, reject) => {
      entered(); input.signal!.addEventListener('abort', () => { aborted(); reject(new Error('Synthetic render cancelled')); }, { once: true });
    }));
    const controller = new AbortController();
    const pending = fetch(api + 'worksheets/export', { method: 'POST', signal: controller.signal, headers: { Authorization: 'Bearer ' + token, Origin: 'https://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify(selection()) }).catch(error => error);
    await started; controller.abort(); await pending; await cancelled;
    expect((await call('worksheets/export', selection())).status).toBe(200);
  });
});
