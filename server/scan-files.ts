import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
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
): Promise<ScanRecord | null> {
  try {
    return JSON.parse(
      await readFile(join(scanDirectory(owner, id), 'record.json'), 'utf8'),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
export async function listScans(owner: string) {
  let ids: string[];
  try {
    ids = await readdir(scanRoot(owner));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const result: ScanRecord[] = [];
  for (const id of ids.filter((x) => /^[a-f0-9-]{36}$/.test(x))) {
    const scan = await readScan(owner, id);
    if (scan) result.push(scan);
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function saveScan(
  owner: string,
  record: ScanRecord,
  bytes: Uint8Array,
) {
  const directory = scanDirectory(owner, record.id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, 'original'), bytes, {
    mode: 0o600,
    flag: 'wx',
  });
  await atomicJson(join(directory, 'record.json'), record);
}
export function readScanFile(owner: string, id: string) {
  return readFile(join(scanDirectory(owner, id), 'original'));
}
const locks = new Map<string, Promise<unknown>>();
export async function updateScan(
  owner: string,
  id: string,
  update: (record: ScanRecord) => ScanRecord,
) {
  const key = scanDirectory(owner, id);
  const next = (locks.get(key) || Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const current = await readScan(owner, id);
      if (!current) throw new Error('Scan not found');
      const result = {
        ...update(current),
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
export async function scanWrongRecords(owner: string): Promise<FamilyState> {
  const records = emptyFamily();
  for (const scan of await listScans(owner)) {
    if (!scan.confirmedAt) continue;
    const child = scan.child || 'dabao';
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
