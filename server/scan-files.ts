import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  lstat,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { emptyFamily, type FamilyState } from '../lib/family-state';
import { buildReviewDates } from '../lib/learning';
import type { ScanRecord } from '../lib/scans';
import type { FamilyStore } from './family-store';
import { HttpError } from './family-backend';

export function readStoredScan(
  store: FamilyStore,
  owner: string,
  id: string,
): ScanRecord | null {
  const row = store.db
    .prepare('SELECT body FROM scan_documents WHERE owner=? AND id=?')
    .get(owner, id);
  return row ? JSON.parse(String(row.body)) : null;
}
// Call within a transaction when changing a revision or a job. SQLite is the
// authority after import; record.json remains a compatibility/backup projection.
export function writeStoredScan(
  store: FamilyStore,
  owner: string,
  record: ScanRecord,
  actor: string,
) {
  const body = JSON.stringify(record);
  store.db
    .prepare(
      'INSERT INTO scan_documents VALUES (?,?,?) ON CONFLICT(owner,id) DO UPDATE SET body=excluded.body',
    )
    .run(owner, record.id, body);
  store.db
    .prepare('INSERT OR IGNORE INTO scan_versions VALUES (?,?,?,?,?,?)')
    .run(owner, record.id, record.revision || 0, body, actor, Date.now());
  return record;
}

// Compatible with the private file layout recovered from the 2026-09-25 live build.
function scanRoot(owner: string) {
  const root = process.env.FAMILY_DATA_DIR;
  if (!root || !isAbsolute(root))
    throw new Error('Private storage path must be absolute');
  return join(root, createHash('sha256').update(owner).digest('hex'), 'scans');
}
export function scanDirectory(owner: string, id: string) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
  )
    throw new Error('Invalid scan ID');
  return join(scanRoot(owner), id);
}
async function atomicJson(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}
export async function readScan(
  owner: string,
  id: string,
  store?: FamilyStore,
): Promise<ScanRecord | null> {
  if (store) {
    const saved = readStoredScan(store, owner, id);
    if (saved) return saved;
  }
  try {
    const record: ScanRecord = JSON.parse(
      await readFile(join(scanDirectory(owner, id), 'record.json'), 'utf8'),
    );
    record.revision ||= 0;
    return store
      ? store.transaction(
          () =>
            readStoredScan(store, owner, id) ||
            writeStoredScan(store, owner, record, 'legacy-import'),
        )
      : record;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
export async function listScans(owner: string, store?: FamilyStore) {
  let ids: string[];
  try {
    ids = await readdir(scanRoot(owner));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') ids = [];
    else throw e;
  }
  if (store)
    ids.push(
      ...store.db
        .prepare('SELECT id FROM scan_documents WHERE owner=?')
        .all(owner)
        .map((row) => String(row.id)),
    );
  const result: ScanRecord[] = [];
  for (const id of [...new Set(ids)].filter((x) => /^[a-f0-9-]{36}$/.test(x))) {
    const scan = await readScan(owner, id, store);
    if (scan) result.push(scan);
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function saveScan(
  owner: string,
  record: ScanRecord,
  bytes: Uint8Array,
  store?: FamilyStore,
) {
  const directory = scanDirectory(owner, record.id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, 'original'), bytes, {
    mode: 0o600,
    flag: 'wx',
  });
  await atomicJson(join(directory, 'record.json'), record);
  if (store)
    store.transaction(() => writeStoredScan(store, owner, record, 'upload'));
}
/** Only recorded revisions of this already-authorized scan may select an image hash. */
export function scanImageRecord(store: FamilyStore, owner: string, current: ScanRecord, sha256: string | null, revision: string | null = null) {
  if (revision !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(revision) || !Number.isSafeInteger(Number(revision))) throw new HttpError(400, '题图历史版本无效');
    const row = Number(revision) === (current.revision || 0) ? null : store.db.prepare('SELECT body FROM scan_versions WHERE owner=? AND id=? AND revision=?').get(owner, current.id, Number(revision));
    const snapshot: ScanRecord | null = Number(revision) === (current.revision || 0) ? current : row ? JSON.parse(String(row.body)) : null;
    if (!snapshot) throw new HttpError(404, '题图历史版本不存在或不属于此资料');
    if (sha256 !== null && snapshot.sourcePage?.scanSha256 !== sha256) throw new HttpError(409, '题图校验值与历史版本不匹配');
    return snapshot;
  }
  if (sha256 === null) return current;
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new HttpError(400, '题图版本校验值无效');
  if (current.sourcePage?.scanSha256 === sha256) return current;
  const row = store.db.prepare("SELECT body FROM scan_versions WHERE owner=? AND id=? AND json_extract(body,'$.sourcePage.scanSha256')=? ORDER BY revision DESC LIMIT 1").get(owner, current.id, sha256);
  if (!row) throw new HttpError(404, '题图版本不存在或不属于此资料');
  return JSON.parse(String(row.body)) as ScanRecord;
}

export async function readScanFile(owner: string, id: string, record?: ScanRecord) {
  const directory = scanDirectory(owner, id), expected = record?.sourcePage?.scanSha256;
  if (record && record.id !== id) throw new HttpError(400, '题图版本归属不匹配');
  if (expected !== undefined && !/^[a-f0-9]{64}$/.test(expected)) throw new HttpError(400, '题图版本校验值无效');
  let file = join(directory, 'original');
  if (expected) {
    const revisions = join(directory, 'image-revisions');
    try {
      const state = await lstat(revisions);
      if (!state.isDirectory() || state.isSymbolicLink()) throw new HttpError(409, '题图版本目录无效，请联系维护人员');
      const candidate = join(revisions, expected + '.jpg');
      try { await lstat(candidate); file = candidate; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const state = await lstat(file);
  if (!state.isFile() || state.isSymbolicLink()) throw new HttpError(409, '题图文件无效，请联系维护人员');
  if (expected && (state.size !== record!.size || state.size > 32 * 1024 * 1024)) throw new HttpError(409, '题图版本大小不匹配，请重新恢复或联系维护人员');
  const bytes = await readFile(file);
  if (expected && createHash('sha256').update(bytes).digest('hex') !== expected) throw new HttpError(409, '题图版本校验失败，未改用旧题图');
  return bytes;
}
const locks = new Map<string, Promise<unknown>>();
export async function updateScan(
  owner: string,
  id: string,
  update: (record: ScanRecord) => ScanRecord,
  store?: FamilyStore,
) {
  const key = scanDirectory(owner, id);
  if (store) {
    await readScan(owner, id, store);
    const result = store.transaction(() => {
      const current = readStoredScan(store, owner, id);
      if (!current) throw new Error('Scan not found');
      const updated = update(current);
      if (updated === current) return current;
      return writeStoredScan(
        store,
        owner,
        { ...updated, revision: (current.revision || 0) + 1 },
        'web-review',
      );
    });
    await atomicJson(join(key, 'record.json'), result);
    return result;
  }
  const next = (locks.get(key) || Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const current = await readScan(owner, id);
      if (!current) throw new Error('Scan not found');
      const updated = update(current);
      if (updated === current) return current;
      const result = {
        ...updated,
        revision: (current.revision || 0) + 1,
      };
      await atomicJson(join(key, 'record.json'), result);
      return result;
    });
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}
export async function scanWrongRecords(
  owner: string,
  store?: FamilyStore,
): Promise<FamilyState> {
  const records = emptyFamily();
  for (const scan of await listScans(owner, store)) {
    if (!scan.confirmedAt) continue;
    const child = scan.studentId || scan.child || 'dabao';
    if (child !== 'dabao' && child !== 'xiaobao') continue;
    // Structured review is not a new independent attempt or an automatic wrong mark.
    if (scan.structuredQuestions) continue;
    for (const [index, question] of (
      scan.confirmedQuestions ||
      scan.questions ||
      []
    ).entries()) {
      if (!question.selected) continue;
      records[child].wrong.push({
        id: `${scan.id}-${index}`,
        questionId: `${scan.id}-${index}`,
        scanId: scan.id,
        subject: question.subject,
        knowledgePoint: question.knowledgePoint || '待确认',
        prompt: question.prompt || '待确认',
        answer: question.answer || '待确认',
        learnerAnswer: question.learnerAnswer || '待确认',
        source: `${scan.source} · ${question.number}`,
        status: '待重做',
        createdOn: scan.confirmedAt,
        reviewDates: buildReviewDates(new Date(scan.confirmedAt)),
      });
    }
  }
  return records;
}
