import {
  mkdir,
  lstat,
  readdir,
  writeFile,
  rename,
  unlink,
  rmdir,
} from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type ModelTrace = {
  provider?: string;
  requestedModel?: string;
  returnedModel?: string;
  requestId?: string;
  upstreamStatus?: number;
  usage?: Record<string, number>;
  readOriginalMs?: number;
  cropMs?: number;
  httpMs?: number;
  parseValidationMs?: number;
};
export type ModelFailureCode =
  | 'UPSTREAM_AUTH'
  | 'UPSTREAM_RATE_LIMIT'
  | 'UPSTREAM_QUOTA'
  | 'UPSTREAM_REQUEST'
  | 'UPSTREAM_SERVER'
  | 'MODEL_TIMEOUT'
  | 'MODEL_NETWORK'
  | 'MODEL_OUTPUT'
  | 'LOCAL_QUOTA'
  | 'LOCAL_VALIDATION'
  | 'INTERNAL_ERROR';
export type AttemptAudit = ModelTrace & {
  jobId: string;
  attempt: number;
  kind: 'question' | 'page' | 'learning' | 'weakness';
  queuedAt: number;
  readyAt: number;
  startedAt: number;
  endedAt: number;
  attemptMs: number;
  outcome: 'succeeded' | 'retry_queued' | 'failed' | 'discarded';
  failureCode?: ModelFailureCode;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const filePattern = /^[a-f0-9-]{36}-[1-3]\.json$/;
const phases = [
  'readOriginalMs',
  'cropMs',
  'httpMs',
  'parseValidationMs',
] as const;
const usageKeys = [
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'input_tokens',
  'output_tokens',
  'reasoning_tokens',
  'cached_tokens',
  'prompt_cache_hit_tokens',
  'prompt_cache_miss_tokens',
] as const;
function identifier(value: unknown): string | undefined {
  return typeof value === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,95}$/.test(value) &&
    !/^(sk-|bearer|token|secret|api[-_]?key)/i.test(value) &&
    !value.includes('://')
    ? value
    : undefined;
}
function requestId(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 100) return undefined;
  return uuid.test(value) ||
    /^(req_|req-|chatcmpl-|resp_)[a-zA-Z0-9_-]{8,80}$/.test(value)
    ? value
    : undefined;
}
export function captureModelMetadata(
  trace: ModelTrace | undefined,
  value: unknown,
  headerId?: string | null,
) {
  if (!trace) return;
  const data =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  trace.returnedModel = identifier(data.model);
  trace.requestId = requestId(headerId) || requestId(data.id);
  const usage =
    data.usage && typeof data.usage === 'object'
      ? (data.usage as Record<string, unknown>)
      : {};
  const clean: Record<string, number> = {};
  for (const key of usageKeys) {
    const v = usage[key];
    if (
      typeof v === 'number' &&
      Number.isSafeInteger(v) &&
      v >= 0 &&
      v <= 1_000_000_000
    )
      clean[key] = v;
  }
  for (const [container, key] of [
    ['completion_tokens_details', 'reasoning_tokens'],
    ['output_tokens_details', 'reasoning_tokens'],
    ['prompt_tokens_details', 'cached_tokens'],
    ['input_tokens_details', 'cached_tokens'],
  ]) {
    const v = (usage[container] as Record<string, unknown> | undefined)?.[key];
    if (
      typeof v === 'number' &&
      Number.isSafeInteger(v) &&
      v >= 0 &&
      v <= 1_000_000_000
    )
      clean[key] = v;
  }
  if (Object.keys(clean).length) trace.usage = clean;
}
export async function measurePhase<T>(
  trace: ModelTrace | undefined,
  phase: (typeof phases)[number],
  action: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await action();
  } finally {
    if (trace) trace[phase] = (trace[phase] || 0) + performance.now() - start;
  }
}
export function measureValidation<T>(
  trace: ModelTrace | undefined,
  action: () => T,
): T {
  const start = performance.now();
  try {
    return action();
  } finally {
    if (trace)
      trace.parseValidationMs =
        (trace.parseValidationMs || 0) + performance.now() - start;
  }
}

async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('Unsafe audit directory');
}
const rounded = (v: number) => Math.round(Math.max(0, v) * 100) / 100;
// Immutable, atomically published files; never serialize an error/record/prompt object.
// A failed audit write must not repeat a paid inference or discard its saved result.
export async function writeAttemptAudit(value: AttemptAudit): Promise<boolean> {
  let temporary: string | undefined;
  try {
    const root = process.env.FAMILY_DATA_DIR;
    if (
      !root ||
      !isAbsolute(root) ||
      !uuid.test(value.jobId) ||
      ![1, 2, 3].includes(value.attempt)
    )
      throw new Error('Invalid audit location');
    const trace: ModelTrace = {};
    captureModelMetadata(trace, {
      model: value.returnedModel,
      id: value.requestId,
      usage: value.usage,
    });
    const clean = {
      schemaVersion: 1,
      jobId: value.jobId,
      attempt: value.attempt,
      kind: value.kind,
      queuedAt: new Date(value.queuedAt).toISOString(),
      readyAt: new Date(value.readyAt).toISOString(),
      startedAt: new Date(value.startedAt).toISOString(),
      endedAt: new Date(value.endedAt).toISOString(),
      queueMs: rounded(value.startedAt - value.queuedAt),
      readyWaitMs: rounded(value.startedAt - value.readyAt),
      attemptMs: rounded(value.attemptMs),
      outcome: value.outcome,
      ...(value.failureCode ? { failureCode: value.failureCode } : {}),
      provider:
        typeof value.provider === 'string' &&
        /^[a-zA-Z0-9.-]{1,253}$/.test(value.provider)
          ? value.provider
          : undefined,
      requestedModel: identifier(value.requestedModel),
      ...trace,
      upstreamStatus:
        Number.isInteger(value.upstreamStatus) &&
        value.upstreamStatus! >= 100 &&
        value.upstreamStatus! <= 599
          ? value.upstreamStatus
          : undefined,
      ...Object.fromEntries(
        phases
          .filter(
            (p) =>
              typeof value[p] === 'number' &&
              Number.isFinite(value[p]) &&
              value[p]! >= 0,
          )
          .map((p) => [p, rounded(value[p]!)]),
      ),
    };
    const body = JSON.stringify(clean);
    if (body.length > 8192) throw new Error('Audit too large');
    const auditRoot = join(root, 'model-audit'),
      day = new Date(value.endedAt).toISOString().slice(0, 10),
      directory = join(auditRoot, day);
    await privateDirectory(auditRoot);
    await privateDirectory(directory);
    temporary = join(
      directory,
      `${value.jobId}-${value.attempt}.${randomUUID()}.tmp`,
    );
    await writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
    await rename(
      temporary,
      join(directory, `${value.jobId}-${value.attempt}.json`),
    );
    temporary = undefined;
    // 30 UTC days, at most 1000 immutable records per day. Only exact own filenames.
    const cutoff = new Date(value.endedAt - 29 * 86400000)
      .toISOString()
      .slice(0, 10);
    for (const entry of await readdir(auditRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !dayPattern.test(entry.name)) continue;
      if (entry.name >= cutoff && entry.name !== day) continue;
      const path = join(auditRoot, entry.name);
      const state = await lstat(path);
      if (!state.isDirectory() || state.isSymbolicLink()) continue;
      const files = [];
      const entries = await readdir(path, { withFileTypes: true });
      if (
        entry.name >= cutoff &&
        entries.filter((e) => e.isFile() && filePattern.test(e.name)).length <=
          1000
      )
        continue;
      for (const item of entries)
        if (item.isFile() && filePattern.test(item.name)) {
          const target = join(path, item.name),
            stat = await lstat(target);
          if (stat.isFile() && !stat.isSymbolicLink())
            files.push({ path: target, time: stat.mtimeMs });
        }
      const remove =
        entry.name < cutoff
          ? files
          : files.sort((a, b) => b.time - a.time).slice(1000);
      for (const file of remove) await unlink(file.path);
      if (entry.name < cutoff) await rmdir(path).catch(() => undefined);
    }
    return true;
  } catch {
    console.warn('Model attempt audit unavailable; inference is not repeated.');
    return false;
  } finally {
    if (temporary) await unlink(temporary).catch(() => undefined);
  }
}
