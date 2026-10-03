import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { readScanFile, scanDirectory, writeStoredScan } from './scan-files';
import { FamilyStore } from './family-store';
import { handleMobile } from './mobile-backend';
import { publicLearning, type StoredLearning } from './learning-sessions';
import type { ScanRecord } from '../lib/scans';
let root: string, directory: string, record: ScanRecord;
const oldBytes = Buffer.from('immutable synthetic original'), revised = Buffer.from('complete synthetic revised question image');
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
beforeEach(async () => {
  await mkdir(resolve('work'), { recursive: true }); root = await mkdtemp(resolve('work/scan-image-revisions-')); vi.stubEnv('FAMILY_DATA_DIR', root);
  record = { id: randomUUID(), studentId: 'synthetic-student', subject: '数学', source: '合成验证', originalName: 'synthetic.jpg', mimeType: 'image/jpeg', size: oldBytes.length, status: 'ready', revision: 1, createdAt: '', fileUrl: '', sourcePage: { documentId: 'synthetic-doc', title: '合成资料', subject: '数学', revision: 1, pageNumber: 1, pageCount: 1, photoId: randomUUID(), scanSha256: digest(oldBytes) } };
  directory = scanDirectory('synthetic-owner', record.id); await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'original'), oldBytes);
});
afterEach(async () => { vi.unstubAllEnvs(); expect(root.startsWith(resolve('work') + sep)).toBe(true); await rm(root, { recursive: true, force: true }); });
describe('immutable scan originals and version-selected processing images', () => {
  it('serves only owned recorded hashes and publishes the exact learning snapshot image identity', async () => {
    const store = new FamilyStore(':memory:');
    try {
      vi.stubEnv('FAMILY_PUBLIC_ORIGIN', 'https://synthetic.example'); vi.stubEnv('FAMILY_MOBILE_ORIGINS', 'https://localhost');
      const token = 'c'.repeat(64); store.db.prepare('INSERT INTO accounts VALUES (?,?,?,?)').run('synthetic-owner', 'synthetic', 'unusable', Date.now());
      store.db.prepare('INSERT INTO mobile_sessions VALUES (?,?,?,?,?)').run(digest(Buffer.from(token)), 'synthetic-owner', Date.now() + 60000, 'synthetic', Date.now());
      store.db.prepare('INSERT INTO students VALUES (?,?,?,?,?,?)').run('synthetic-owner', record.studentId!, '合成学生', '', '', null);
      writeStoredScan(store, 'synthetic-owner', { ...record, revision: 0, sourcePage: undefined }, 'synthetic');
      writeStoredScan(store, 'synthetic-owner', record, 'synthetic');
      const current = { ...record, revision: 2, size: revised.length, sourcePage: { ...record.sourcePage!, scanSha256: digest(revised) } };
      await mkdir(join(directory, 'image-revisions')); await writeFile(join(directory, 'image-revisions', digest(revised) + '.jpg'), revised); writeStoredScan(store, 'synthetic-owner', current, 'synthetic');
      const call = (hash?: string, revision?: string) => {
        const query = new URLSearchParams(); if (hash !== undefined) query.set('sha256', hash); if (revision !== undefined) query.set('revision', revision);
        return handleMobile(new Request('https://synthetic.example/family-learning/api/mobile/v1/scans/' + record.id + '/file?' + query, { headers: { Origin: 'https://localhost', Authorization: 'Bearer ' + token } }), ['scans', record.id, 'file'], store);
      };
      expect(Buffer.from(await (await call()).arrayBuffer())).toEqual(revised);
      expect(Buffer.from(await (await call(digest(oldBytes))).arrayBuffer())).toEqual(oldBytes);
      expect((await call('0'.repeat(64))).status).toBe(404);
      expect(Buffer.from(await (await call(undefined, '0')).arrayBuffer())).toEqual(oldBytes);
      expect(Buffer.from(await (await call(digest(revised), '2')).arrayBuffer())).toEqual(revised);
      expect((await call(digest(revised), '1')).status).toBe(409);
      expect((await call(undefined, '999')).status).toBe(404);
      expect((await call(undefined, '-1')).status).toBe(400);
      const learning = publicLearning({ sourceRecord: record, tasks: [] } as unknown as StoredLearning);
      expect(learning.sourceImage).toMatchObject({ size: oldBytes.length, sourcePage: { scanSha256: digest(oldBytes) } });
    } finally { store.close(); }
  });
  it('reads the requested revision while keeping originals and old snapshots intact', async () => {
    const current = { ...record, revision: 2, size: revised.length, sourcePage: { ...record.sourcePage!, scanSha256: digest(revised) } };
    await mkdir(join(directory, 'image-revisions')); await writeFile(join(directory, 'image-revisions', digest(revised) + '.jpg'), revised);
    expect(await readScanFile('synthetic-owner', record.id, current)).toEqual(revised);
    expect(await readScanFile('synthetic-owner', record.id, record)).toEqual(oldBytes);
    expect(await readScanFile('synthetic-owner', record.id)).toEqual(oldBytes);
    expect(await readFile(join(directory, 'original'))).toEqual(oldBytes);
  });
  it('does not replace a missing or corrupt revision with the old original', async () => {
    const current = { ...record, size: revised.length, sourcePage: { ...record.sourcePage!, scanSha256: digest(revised) } };
    await expect(readScanFile('synthetic-owner', record.id, current)).rejects.toThrow('不匹配');
    await mkdir(join(directory, 'image-revisions')); await writeFile(join(directory, 'image-revisions', digest(revised) + '.jpg'), Buffer.alloc(revised.length));
    await expect(readScanFile('synthetic-owner', record.id, current)).rejects.toThrow('校验失败');
  });
  it('rejects arbitrary paths, mismatched record IDs and a linked revision directory', async () => {
    await expect(readScanFile('synthetic-owner', record.id, { ...record, id: randomUUID() })).rejects.toThrow('归属');
    await expect(readScanFile('synthetic-owner', record.id, { ...record, sourcePage: { ...record.sourcePage!, scanSha256: '../outside' } })).rejects.toThrow('校验值');
    const other = join(root, 'synthetic-linked-target'); await mkdir(other); await symlink(other, join(directory, 'image-revisions'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(readScanFile('synthetic-owner', record.id, record)).rejects.toThrow('目录无效');
  });
});
