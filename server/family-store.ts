import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  emptyFamily,
  mergeFamily,
  validateFamily,
  type FamilyState,
} from '../lib/family-state';

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
      CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, resets INTEGER NOT NULL);`);
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
