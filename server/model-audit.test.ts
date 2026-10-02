import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  statSync,
  utimesSync,
  symlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  captureModelMetadata,
  writeAttemptAudit,
  type ModelTrace,
  type AttemptAudit,
} from './model-audit';
import { FamilyStore } from './family-store';

let directory: string;
beforeEach(() => {
  mkdirSync('work', { recursive: true });
  directory = mkdtempSync(resolve('work/model-audit-'));
  vi.stubEnv('FAMILY_DATA_DIR', directory);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});
const record = (): AttemptAudit => ({
  jobId: randomUUID(),
  attempt: 1,
  kind: 'question',
  queuedAt: Date.now() - 3000,
  readyAt: Date.now() - 1000,
  startedAt: Date.now() - 500,
  endedAt: Date.now(),
  attemptMs: 500,
  outcome: 'succeeded',
  requestedModel: 'synthetic-model',
  returnedModel: 'synthetic-model-returned',
  requestId: 'req_synthetic-safe-1234',
  usage: { total_tokens: 77 },
  httpMs: 321,
});
it('whitelists metadata and omits secrets, arbitrary headers, text and invalid usage', () => {
  const trace: ModelTrace = {};
  captureModelMetadata(
    trace,
    {
      model: 'sk-secret',
      id: 'Bearer secret',
      usage: {
        total_tokens: 5,
        prompt_tokens: -1,
        completion_tokens: Infinity,
        reasoning_tokens: '100',
        anything: 'private',
      },
      prompt: 'private',
      image: 'private',
    },
    'https://secret.example/token',
  );
  expect(trace).toEqual({
    usage: { total_tokens: 5 },
    returnedModel: undefined,
    requestId: undefined,
  });
  captureModelMetadata(trace, {
    model: 'deepseek-flash',
    id: randomUUID(),
    usage: { completion_tokens_details: { reasoning_tokens: 8 } },
  });
  expect(trace.returnedModel).toBe('deepseek-flash');
  expect(trace.usage).toEqual({ reasoning_tokens: 8 });
});
it('publishes bounded private JSON, expires only audit files, and caps the current day', async () => {
  const value = record(),
    day = new Date(value.endedAt).toISOString().slice(0, 10),
    root = join(directory, 'model-audit'),
    today = join(root, day),
    old = join(root, '2000-01-01');
  mkdirSync(old, { recursive: true });
  mkdirSync(today, { recursive: true });
  writeFileSync(join(old, `${randomUUID()}-1.json`), '{}');
  writeFileSync(join(old, 'keep-unrelated.txt'), 'preserve');
  for (let i = 0; i < 1000; i++) {
    const path = join(today, `${randomUUID()}-1.json`);
    writeFileSync(path, '{}');
    utimesSync(path, 1, 1);
  }
  expect(
    await writeAttemptAudit({
      ...value,
      requestedModel: 'sk-hidden',
      provider: 'https://provider/secret',
    }),
  ).toBe(true);
  expect(readdirSync(today)).toHaveLength(1000);
  expect(readdirSync(old)).toEqual(['keep-unrelated.txt']);
  const path = join(today, `${value.jobId}-1.json`),
    saved = JSON.parse(readFileSync(path, 'utf8'));
  expect(saved).toMatchObject({
    schemaVersion: 1,
    jobId: value.jobId,
    httpMs: 321,
    outcome: 'succeeded',
  });
  expect(saved.requestedModel).toBeUndefined();
  expect(saved.provider).toBeUndefined();
  if (process.platform !== 'win32')
    expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(await writeAttemptAudit({ ...value, jobId: '../../not-a-job' })).toBe(
    false,
  );
});
it('refuses a symlink audit root and never writes into its target', async () => {
  const elsewhere = join(directory, 'elsewhere');
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(directory, 'model-audit'), 'junction');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  expect(await writeAttemptAudit(record())).toBe(false);
  expect(readdirSync(elsewhere)).toEqual([]);
  expect(warn).toHaveBeenCalled();
});
it('records only a controlled weakness rejection category, never arbitrary review text or another job kind', async () => {
  for (const [kind, code, expected] of [
    ['weakness', 'source_conditions', 'source_conditions'],
    ['weakness', 'private raw reason', undefined],
    ['question', 'source_conditions', undefined],
  ] as const) {
    const value = { ...record(), kind, weaknessRejection: code, reason: 'private review content', prompt: 'private question content' };
    expect(await writeAttemptAudit(value as AttemptAudit)).toBe(true);
    const saved = JSON.parse(readFileSync(join(directory, 'model-audit', new Date(value.endedAt).toISOString().slice(0, 10), value.jobId + '-1.json'), 'utf8'));
    expect(saved.weaknessRejection).toBe(expected); expect(JSON.stringify(saved)).not.toContain('private');
  }
});
it('backs up and verifies immutable audit files beside the database without schema changes', async () => {
  const db = new FamilyStore(join(directory, 'family.sqlite'));
  const schema = db.db
    .prepare('SELECT sql FROM sqlite_master ORDER BY name')
    .all();
  const value = record();
  expect(await writeAttemptAudit(value)).toBe(true);
  expect(
    db.db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all(),
  ).toEqual(schema);
  db.close();
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/backup-family.mjs')],
    {
      env: {
        NODE_ENV: 'test',
        SystemRoot: process.env.SystemRoot,
        FAMILY_DATA_DIR: directory,
        FAMILY_BACKUP_DIR: join(directory, 'backups'),
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    },
  );
  expect(result.status, result.stderr).toBe(0);
  const backup = join(
    directory,
    'backups',
    readdirSync(join(directory, 'backups'))[0],
  );
  const manifest = JSON.parse(
    readFileSync(join(backup, 'manifest.json'), 'utf8'),
  );
  expect(manifest.files).toHaveLength(2);
  for (const file of manifest.files) {
    expect(existsSync(join(backup, file.path))).toBe(true);
    expect(
      createHash('sha256')
        .update(readFileSync(join(backup, file.path)))
        .digest('hex'),
    ).toBe(file.sha256);
  }
  expect(
    manifest.files.some((f: { path: string }) =>
      f.path.startsWith('model-audit/'),
    ),
  ).toBe(true);
});
