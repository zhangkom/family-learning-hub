import { DatabaseSync, backup } from 'node:sqlite';
import {
  mkdirSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  renameSync,
  rmSync,
  chmodSync,
  lstatSync,
} from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

if (!process.env.FAMILY_DATA_DIR)
  throw new Error('FAMILY_DATA_DIR is required');
const root = resolve(process.env.FAMILY_DATA_DIR);
const directory = process.env.FAMILY_BACKUP_DIR
  ? resolve(process.env.FAMILY_BACKUP_DIR)
  : join(root, 'backups');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const name = `family-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const staging = join(directory, `.pending-${randomUUID()}`);
mkdirSync(staging, { mode: 0o700 });
const manifest = { version: 1, createdAt: new Date().toISOString(), files: [] };
function record(relative) {
  const target = join(staging, relative);
  if (process.platform !== 'win32') chmodSync(target, 0o600);
  manifest.files.push({
    path: relative,
    sha256: createHash('sha256').update(readFileSync(target)).digest('hex'),
  });
}
// Metadata is replaced atomically by the app, and originals are immutable.
for (const owner of readdirSync(root).filter((x) => /^[a-f0-9]{64}$/.test(x))) {
  const scans = join(root, owner, 'scans');
  if (!existsSync(scans)) continue;
  for (const id of readdirSync(scans).filter((x) =>
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x),
  )) {
    const metadata = join(scans, id, 'record.json');
    if (!existsSync(metadata)) continue;
    const content = readFileSync(metadata);
    JSON.parse(content.toString('utf8'));
    const relative = `${owner}/scans/${id}`;
    mkdirSync(join(staging, relative), { recursive: true, mode: 0o700 });
    writeFileSync(join(staging, relative, 'record.json'), content, {
      mode: 0o600,
    });
    copyFileSync(
      join(scans, id, 'original'),
      join(staging, relative, 'original'),
    );
    record(`${relative}/record.json`);
    record(`${relative}/original`);
  }
}
// Private, immutable attempt metadata only; never copy unrelated directories,
// temporary files or symlinks. Old application versions safely ignore these files.
const auditRoot = join(root, 'model-audit');
if (existsSync(auditRoot)) {
  const state = lstatSync(auditRoot);
  if (!state.isDirectory() || state.isSymbolicLink())
    throw new Error('Unsafe model audit root');
  for (const day of readdirSync(auditRoot, { withFileTypes: true })) {
    if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
    const source = join(auditRoot, day.name);
    for (const file of readdirSync(source, { withFileTypes: true })) {
      if (!file.isFile() || !/^[a-f0-9-]{36}-[1-3]\.json$/.test(file.name))
        continue;
      const input = join(source, file.name);
      try {
        const stat = lstatSync(input);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192)
          throw new Error('Invalid model audit file');
        const content = readFileSync(input);
        JSON.parse(content.toString('utf8'));
        const relative = `model-audit/${day.name}/${file.name}`;
        mkdirSync(join(staging, 'model-audit', day.name), {
          recursive: true,
          mode: 0o700,
        });
        writeFileSync(join(staging, relative), content, { mode: 0o600 });
        record(relative);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error; // Retention may remove an old immutable audit concurrently.
      }
    }
  }
}
const database = join(root, 'family.sqlite');
if (existsSync(database)) {
  const target = join(staging, 'family.sqlite');
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    await backup(db, target);
  } finally {
    db.close();
  }
  const check = new DatabaseSync(target, { readOnly: true });
  try {
    if (check.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok')
      throw new Error('Backup integrity check failed');
  } finally {
    check.close();
  }
  record('family.sqlite');
}
writeFileSync(
  join(staging, 'manifest.json'),
  JSON.stringify(manifest, null, 2),
  { mode: 0o600 },
);
renameSync(staging, join(directory, name));
const backups = readdirSync(directory)
  .filter((x) => /^family-\d{4}-\d{2}-\d{2}T[\dZ-]+$/.test(x))
  .sort()
  .reverse();
for (const old of backups.slice(30)) {
  const target = resolve(directory, old);
  if (
    !target.startsWith(directory + sep) ||
    !/^family-\d{4}-\d{2}-\d{2}T[\dZ-]+$/.test(old)
  )
    throw new Error('Unsafe backup retention target');
  rmSync(target, { recursive: true });
}
console.log(
  `Verified private backup: ${name}, ${manifest.files.length} files (database, scan originals/metadata and model audits).`,
);
