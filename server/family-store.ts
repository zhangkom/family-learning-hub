import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Student } from '../lib/mobile';
import { CLOUD_PHOTO_CAPABILITY } from '../lib/cloud-photos';
import {
  emptyFamily,
  mergeFamily,
  validateFamily,
  type FamilyState,
} from '../lib/family-state';

const cloudBatchTable = (name: 'cloud_photo_batches' | 'cloud_photo_batches_upgrade') =>
  `CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), student_id TEXT NOT NULL, client_id TEXT NOT NULL, expected_count INTEGER NOT NULL CHECK(expected_count BETWEEN 1 AND ${CLOUD_PHOTO_CAPABILITY.maxBatchItems}), body TEXT NOT NULL, UNIQUE(account_id,client_id), FOREIGN KEY(account_id,student_id) REFERENCES students(account_id,id));`;

function upgradeCloudPhotoBatches(db: DatabaseSync) {
  const needsUpgrade = () => /expected_count\s+BETWEEN\s+1\s+AND\s+100\b/i.test(String(db.prepare("SELECT sql FROM sqlite_schema WHERE name='cloud_photo_batches'").get()?.sql));
  if (!needsUpgrade()) return;
  // Disable foreign keys before the transaction so replacing the parent table
  // preserves every cloud_photos reference. Recheck after acquiring the lock.
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
  try {
    if (needsUpgrade()) {
      db.exec(cloudBatchTable('cloud_photo_batches_upgrade'));
      db.exec(`INSERT INTO cloud_photo_batches_upgrade SELECT * FROM cloud_photo_batches;
        DROP TABLE cloud_photo_batches;
        ALTER TABLE cloud_photo_batches_upgrade RENAME TO cloud_photo_batches;`);
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Cloud photo batch migration failed integrity validation');
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.exec('PRAGMA foreign_keys=ON'); }
}

export class FamilyStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS legacy_owners (account_id TEXT UNIQUE NOT NULL REFERENCES accounts(id), owner TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS learning (account_id TEXT PRIMARY KEY REFERENCES accounts(id), body TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, resets INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mobile_sessions (token TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL, device_name TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS students (account_id TEXT NOT NULL REFERENCES accounts(id), id TEXT NOT NULL, name TEXT NOT NULL, grade TEXT, created_at TEXT NOT NULL, legacy_child TEXT, PRIMARY KEY(account_id,id));
      CREATE TABLE IF NOT EXISTS scan_documents (owner TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(owner,id));
      CREATE TABLE IF NOT EXISTS scan_versions (owner TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(owner,id,revision));
      CREATE TABLE IF NOT EXISTS scan_uploads (account_id TEXT NOT NULL REFERENCES accounts(id), request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, scan_id TEXT NOT NULL, PRIMARY KEY(account_id,request_id));
      ${cloudBatchTable('cloud_photo_batches')}
      CREATE TABLE IF NOT EXISTS cloud_photos (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), student_id TEXT NOT NULL, batch_id TEXT NOT NULL REFERENCES cloud_photo_batches(id), request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(account_id,request_id), FOREIGN KEY(account_id,student_id) REFERENCES students(account_id,id));
      CREATE INDEX IF NOT EXISTS cloud_photos_page ON cloud_photos(account_id,student_id,created_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS cloud_photos_batch ON cloud_photos(batch_id);
      CREATE TABLE IF NOT EXISTS scan_jobs (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), owner TEXT NOT NULL, student_id TEXT NOT NULL, scan_id TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT, error TEXT, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS scan_jobs_ready ON scan_jobs(status,available_at,lease_until);
      CREATE UNIQUE INDEX IF NOT EXISTS scan_jobs_active ON scan_jobs(owner,scan_id) WHERE status IN ('queued','processing');`);
    upgradeCloudPhotoBatches(this.db);
    // Null denotes the original whole-page recognition task. Older workers must
    // not consume queued question jobs when rolling back; cancel them first.
    if (
      !this.db
        .prepare('PRAGMA table_info(scan_jobs)')
        .all()
        .some((column) => column.name === 'question_id')
    )
      this.db.exec('ALTER TABLE scan_jobs ADD COLUMN question_id TEXT');
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  read(accountId: string): FamilyState {
    const row = this.db
      .prepare('SELECT body FROM learning WHERE account_id=?')
      .get(accountId);
    return row ? validateFamily(JSON.parse(String(row.body))) : emptyFamily();
  }
  merge(accountId: string, incoming: FamilyState): FamilyState {
    return this.transaction(() => {
      const records = mergeFamily(this.read(accountId), incoming);
      this.db
        .prepare(
          'INSERT INTO learning VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at',
        )
        .run(accountId, JSON.stringify(records), Date.now());
      return records;
    });
  }
  allow(key: string, max: number, windowMs: number) {
    return this.transaction(() => {
      const now = Date.now();
      this.db.prepare('DELETE FROM limits WHERE resets < ?').run(now);
      this.db
        .prepare(
          'INSERT INTO limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',
        )
        .run(key, now + windowMs);
      return (
        Number(
          this.db.prepare('SELECT count FROM limits WHERE key=?').get(key)
            ?.count,
        ) <= max
      );
    });
  }
  close() {
    this.db.close();
  }
  scanOwner(accountId: string) {
    return String(
      this.db
        .prepare('SELECT owner FROM legacy_owners WHERE account_id=?')
        .get(accountId)?.owner || accountId,
    );
  }
  students(accountId: string): Student[] {
    // Only the account adopting the original family gets the legacy profiles.
    if (
      this.db
        .prepare('SELECT 1 FROM legacy_owners WHERE account_id=?')
        .get(accountId)
    ) {
      for (const [id, name] of [
        ['dabao', '大宝'],
        ['xiaobao', '小宝'],
      ]) {
        this.db
          .prepare('INSERT OR IGNORE INTO students VALUES (?,?,?,?,?,?)')
          .run(accountId, id, name, null, new Date().toISOString(), id);
      }
    }
    return this.db
      .prepare(
        'SELECT * FROM students WHERE account_id=? ORDER BY created_at,id',
      )
      .all(accountId)
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        createdAt: String(row.created_at),
        ...(row.grade ? { grade: String(row.grade) } : {}),
        ...(row.legacy_child
          ? { legacyChildId: String(row.legacy_child) as 'dabao' | 'xiaobao' }
          : {}),
      }));
  }
  addStudent(accountId: string, name: string, grade?: string): Student {
    this.students(accountId);
    return this.transaction(() => {
      if (
        Number(
          this.db
            .prepare('SELECT count(*) AS n FROM students WHERE account_id=?')
            .get(accountId)?.n,
        ) >= 30
      )
        throw new Error('每个家庭最多添加 30 名学生');
      const student = {
        id: randomUUID(),
        name,
        ...(grade ? { grade } : {}),
        createdAt: new Date().toISOString(),
      };
      this.db
        .prepare('INSERT INTO students VALUES (?,?,?,?,?,NULL)')
        .run(accountId, student.id, name, grade || null, student.createdAt);
      return student;
    });
  }
}

let singleton: FamilyStore | undefined;
export function getFamilyStore() {
  if (!process.env.FAMILY_DATA_DIR)
    throw new Error('Private storage is not configured');
  if (!singleton) {
    const directory = resolve(process.env.FAMILY_DATA_DIR);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = resolve(directory, 'family.sqlite');
    singleton = new FamilyStore(path);
    if (process.platform !== 'win32') chmodSync(path, 0o600);
  }
  return singleton;
}
