import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, existsSync, rmSync, type PathLike } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { publishDirectorySync } from '../scripts/atomic-directory-publish.mjs';

let root: string, staging: string, target: string;
const failure = (code: string) => Object.assign(new Error(`injected ${code}`), { code });
beforeEach(() => {
  mkdirSync(resolve('work'), { recursive: true }); root = mkdtempSync(resolve('work/atomic-publish-test-'));
  staging = join(root, '.pending'); target = join(root, 'published');
  mkdirSync(staging); writeFileSync(join(staging, 'original'), 'verified-original'); writeFileSync(join(staging, 'record.json'), '{"verified":true}');
});
afterEach(() => { expect(root.startsWith(resolve('work') + sep)).toBe(true); rmSync(root, { recursive: true, force: true }); });

describe('bounded Windows atomic directory publication', () => {
  it.each(['EPERM', 'EBUSY'])('recovers transient %s through a single successful rename with unchanged bytes', code => {
    let calls = 0; const wait = vi.fn(), rename = vi.fn((from: PathLike, to: PathLike) => { if (++calls <= 2) throw failure(code); renameSync(from, to); });
    publishDirectorySync(staging, target, { platform: 'win32', rename, wait });
    expect(calls).toBe(3); expect(wait.mock.calls).toEqual([[25], [50]]);
    expect(existsSync(staging)).toBe(false); expect(readFileSync(join(target, 'original'), 'utf8')).toBe('verified-original');
    expect(readFileSync(join(target, 'record.json'), 'utf8')).toBe('{"verified":true}');
  });
  it('still throws a persistent permission failure after at most 375ms scheduled wait', () => {
    const error = failure('EPERM'), rename = vi.fn(() => { throw error; }), wait = vi.fn();
    expect(() => publishDirectorySync(staging, target, { platform: 'win32', rename, wait })).toThrow(error);
    expect(rename).toHaveBeenCalledTimes(5); expect(wait.mock.calls).toEqual([[25], [50], [100], [200]]);
    expect(existsSync(target)).toBe(false); expect(readFileSync(join(staging, 'original'), 'utf8')).toBe('verified-original');
  });
  it.each(['ENOSPC', 'EACCES', 'EXDEV'])('does not retry %s or create a visible target', code => {
    const error = failure(code), rename = vi.fn(() => { throw error; }), wait = vi.fn();
    expect(() => publishDirectorySync(staging, target, { platform: 'win32', rename, wait })).toThrow(error);
    expect(rename).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled(); expect(existsSync(target)).toBe(false);
  });
  it('does not retry a busy error on other platforms', () => {
    const error = failure('EBUSY'), rename = vi.fn(() => { throw error; }), wait = vi.fn();
    expect(() => publishDirectorySync(staging, target, { platform: 'linux', rename, wait })).toThrow(error);
    expect(rename).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled();
  });
  it('never replaces an existing destination, including one appearing during a retry', () => {
    mkdirSync(target); writeFileSync(join(target, 'original'), 'existing-original');
    const rename = vi.fn(renameSync), wait = vi.fn();
    expect(() => publishDirectorySync(staging, target, { platform: 'win32', rename, wait })).toThrow('already exists');
    expect(rename).not.toHaveBeenCalled(); expect(wait).not.toHaveBeenCalled();
    expect(readFileSync(join(target, 'original'), 'utf8')).toBe('existing-original');
    const second = join(root, 'racing-target');
    const race = vi.fn((_from: PathLike, to: PathLike) => { mkdirSync(to); writeFileSync(join(String(to), 'original'), 'other-publisher'); throw failure('EBUSY'); });
    expect(() => publishDirectorySync(staging, second, { platform: 'win32', rename: race, wait })).toThrow('already exists');
    expect(race).toHaveBeenCalledTimes(1); expect(readFileSync(join(second, 'original'), 'utf8')).toBe('other-publisher');
  });
});

describe('backup publication fault injection', () => {
  it('runs the bundled backup as a relocated single file without a helper alongside it', async () => {
    const { build } = await import('vite');
    const outputDirectory = join(root, 'bundle'), relocated = join(root, 'relocated'), data = join(root, 'standalone-data'), backups = join(root, 'standalone-backups');
    await build({ configFile: false, logLevel: 'silent', build: { ssr: resolve('scripts/backup-family.mjs'), outDir: outputDirectory, emptyOutDir: false,
      rolldownOptions: { output: { entryFileNames: 'backup-family.mjs' } } } });
    mkdirSync(relocated); mkdirSync(data);
    const executable = join(relocated, 'backup-family.mjs'); renameSync(join(outputDirectory, 'backup-family.mjs'), executable);
    expect(readdirSync(relocated)).toEqual(['backup-family.mjs']);
    const output = spawnSync(process.execPath, [executable], { cwd: relocated, env: { ...process.env, FAMILY_DATA_DIR: data, FAMILY_BACKUP_DIR: backups }, encoding: 'utf8', timeout: 10000 });
    expect(output.status, output.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(backups, readdirSync(backups)[0], 'manifest.json'), 'utf8'))).toMatchObject({ version: 1, files: [] });
  });
  function backup(failures: number, code = 'EPERM') {
    const data = join(root, 'data'), backups = join(root, 'backups'), trace = join(root, 'trace.json'), preload = join(root, 'fault.mjs');
    mkdirSync(data); mkdirSync(backups);
    // Guard 31 valid old snapshots: a failed publication must never run retention.
    for (let i = 1; i <= 31; i++) { const prior = join(backups, `family-2025-01-${String(i).padStart(2, '0')}T00-00-00-000Z`); mkdirSync(prior); writeFileSync(join(prior, 'marker'), 'old'); }
    writeFileSync(preload, `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
      Object.defineProperty(process, 'platform', { value: 'win32' });
      let calls=0; const rename=fs.renameSync;
      fs.renameSync=(source,target)=>{ calls++; if(calls<=${failures}) throw Object.assign(new Error('Injected ${code}'),{code:'${code}'}); return rename(source,target); };
      syncBuiltinESMExports(); process.on('exit',()=>fs.writeFileSync(${JSON.stringify(trace)},JSON.stringify({calls})));
    `);
    const output = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, resolve('scripts/backup-family.mjs')], {
      env: { ...process.env, FAMILY_DATA_DIR: data, FAMILY_BACKUP_DIR: backups }, encoding: 'utf8', timeout: 10000,
    });
    expect(existsSync(trace), output.stderr || output.error?.message).toBe(true);
    return { output, backups, calls: JSON.parse(readFileSync(trace, 'utf8')).calls as number };
  }
  it('publishes a complete manifest after transient locking and only then rotates backups', () => {
    const { output, backups, calls } = backup(2); expect(output.status, output.stderr).toBe(0); expect(calls).toBe(3);
    const names = readdirSync(backups); expect(names.filter(x => x.startsWith('.pending-'))).toHaveLength(0); expect(names).toHaveLength(30);
    const latest = names.sort().at(-1)!; expect(JSON.parse(readFileSync(join(backups, latest, 'manifest.json'), 'utf8'))).toMatchObject({ version: 1, files: [] });
  });
  it('leaves existing snapshots untouched and no published receipt after persistent failure', () => {
    const { output, backups, calls } = backup(99); expect(output.status).not.toBe(0); expect(output.stderr).toContain('Injected EPERM'); expect(calls).toBe(5);
    const names = readdirSync(backups); expect(names.filter(x => x.startsWith('family-'))).toHaveLength(31); expect(names.filter(x => x.startsWith('.pending-'))).toHaveLength(1);
    expect(names.filter(x => x.startsWith('family-')).every(name => readFileSync(join(backups, name, 'marker'), 'utf8') === 'old')).toBe(true);
  });
  it('propagates storage failure immediately without publishing or rotating', () => {
    const { output, backups, calls } = backup(99, 'ENOSPC'); expect(output.status).not.toBe(0); expect(calls).toBe(1);
    expect(readdirSync(backups).filter(x => x.startsWith('family-'))).toHaveLength(31);
  });
});
