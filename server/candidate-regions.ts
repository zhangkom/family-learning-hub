import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import type { CandidateRegions } from '../lib/mobile';
import { MAX_SCAN_BYTES } from '../lib/upload-security';
import { HttpError } from './family-backend';
import type { FamilyStore } from './family-store';
import { ownedScan } from './mobile-service';
import { readScanFile } from './scan-files';
import workerSource from './candidate-worker.cjs?raw';

type Detection = Omit<CandidateRegions, 'scanId' | 'revision'>;
// vinext rewrites import.meta.url to the build-time source path. The standalone
// entrypoint sets cwd to its own release root; development/tests use the repo
// root. Resolve only from that runtime root, including in private service mounts.
const require = createRequire(resolve(process.cwd(), 'package.json'));
function dimensions(value: unknown): value is Detection['image'] {
  const v = value as Detection['image'] | undefined;
  return Boolean(
    v &&
    Number.isSafeInteger(v.width) &&
    Number.isSafeInteger(v.height) &&
    v.width > 0 &&
    v.height > 0 &&
    v.width * v.height <= 32_000_000,
  );
}
function validResult(value: unknown): value is Detection {
  const r = value as Detection | undefined;
  return Boolean(
    r &&
    r.algorithm === 'layout-v1' &&
    r.coordinateSpace === 'oriented-normalized' &&
    dimensions(r.image) &&
    ['candidates', 'manual_required'].includes(r.status) &&
    Array.isArray(r.candidates) &&
    r.candidates.length <= 24 &&
    (r.status !== 'manual_required' || r.candidates.length === 0) &&
    Array.isArray(r.warnings) &&
    r.warnings.length <= 8 &&
    r.warnings.every(
      (x) => typeof x === 'string' && /^[A-Z_]{1,60}$/.test(x),
    ) &&
    r.candidates.every(
      (b, i) =>
        b.id === `candidate-${i + 1}` &&
        b.order === i &&
        b.reason === 'LAYOUT_GAP' &&
        b.region &&
        [b.region.x, b.region.y, b.region.width, b.region.height].every(
          (v) =>
            typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1,
        ) &&
        b.region.width > 0 &&
        b.region.height > 0 &&
        b.region.x + b.region.width <= 1.000000001 &&
        b.region.y + b.region.height <= 1.000000001,
    ),
  );
}

// One child per web process, zero waiting queue. Busy slots stay held until the
// child closes, including after a timeout. Test overrides never come from HTTP.
export class CandidateRunner {
  private busy = false;
  constructor(
    private readonly options: { timeoutMs?: number; source?: string } = {},
  ) {}
  run(
    load: () => Promise<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<Detection> {
    if (this.busy)
      return Promise.reject(
        new HttpError(503, '自动建议正忙，请稍后重试或手动框题'),
      );
    if (signal?.aborted)
      return Promise.reject(new HttpError(408, '请求已取消'));
    this.busy = true;
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams | undefined,
        done = false;
      let image: Detection['image'] | undefined, result: Detection | undefined;
      let pending = '',
        outputBytes = 0;
      const finish = (error?: HttpError, value?: Detection) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (child && child.exitCode === null) child.kill('SIGKILL');
        if (error) reject(error);
        else resolve(value!);
      };
      const abort = () => finish(new HttpError(408, '请求已取消'));
      const timer = setTimeout(() => {
        if (image)
          finish(undefined, {
            algorithm: 'layout-v1',
            coordinateSpace: 'oriented-normalized',
            image,
            status: 'manual_required',
            candidates: [],
            warnings: [
              'LAYOUT_ONLY',
              'REVIEW_FIGURES_AND_HANDWRITING',
              'PROCESSING_TIMEOUT',
            ],
          });
        else finish(new HttpError(503, '图片处理超时，请手动框题或换清晰照片'));
      }, this.options.timeoutMs ?? 8000);
      signal?.addEventListener('abort', abort, { once: true });
      void (async () => {
        try {
          const bytes = await load();
          if (done) {
            this.busy = false;
            return;
          }
          if (bytes.length > MAX_SCAN_BYTES)
            throw new HttpError(413, '图片不能超过 8 MB');
          const source = this.options.source ?? workerSource;
          if (source.length > 16000) throw new Error('Worker source too large');
          child = spawn(
            process.execPath,
            ['--max-old-space-size=96', '--input-type=commonjs', '-e', source],
            {
              windowsHide: true,
              stdio: ['pipe', 'pipe', 'pipe'],
              // No model keys, account secrets or original paths are inherited.
              env: {
                ...(process.env.SystemRoot
                  ? { SystemRoot: process.env.SystemRoot }
                  : {}),
                NODE_ENV: 'production',
                UV_THREADPOOL_SIZE: '1',
              },
            },
          );
          child.stderr.resume();
          child.on('error', () =>
            finish(new HttpError(503, '自动建议暂不可用，请手动框题')),
          );
          child.stdin.on('error', () =>
            finish(new HttpError(503, '自动建议暂不可用，请手动框题')),
          );
          child.stdout.on('data', (buffer: Buffer) => {
            if (done) return;
            outputBytes += buffer.length;
            if (outputBytes > 65536) {
              finish(new HttpError(503, '自动建议结果无效，请手动框题'));
              return;
            }
            pending += Buffer.from(buffer).toString('utf8');
            let end: number;
            while (!done && (end = pending.indexOf('\n')) >= 0) {
              const line = pending.slice(0, end);
              pending = pending.slice(end + 1);
              try {
                const m = JSON.parse(line);
                if (m.kind === 'image' && dimensions(m.image)) image = m.image;
                else if (m.kind === 'result' && validResult(m.result))
                  result = m.result;
                else if (m.kind === 'failure')
                  finish(
                    new HttpError(
                      m.code === 'PIXEL_LIMIT' ? 413 : 400,
                      m.code === 'PIXEL_LIMIT'
                        ? '图片像素过大，最多支持 3200 万像素'
                        : '图片无法读取，请换清晰照片或手动整理',
                    ),
                  );
                else throw new Error('Invalid worker response');
              } catch {
                finish(new HttpError(503, '自动建议结果无效，请手动框题'));
              }
            }
          });
          child.on('close', (code) => {
            this.busy = false;
            if (!done)
              finish(
                code === 0 && result
                  ? undefined
                  : new HttpError(503, '自动建议暂不可用，请手动框题'),
                result,
              );
          });
          child.stdin.end(
            JSON.stringify({
              sharpPath: require.resolve('sharp'),
              bytes: Buffer.from(bytes).toString('base64'),
            }),
          );
        } catch (error) {
          if (!child) this.busy = false;
          finish(
            error instanceof HttpError
              ? error
              : new HttpError(503, '自动建议暂不可用，请手动框题'),
          );
        }
      })();
    });
  }
}
const runner = new CandidateRunner();
export async function candidateRegions(
  store: FamilyStore,
  account: string,
  scanId: string,
  revision: unknown,
  signal?: AbortSignal,
): Promise<CandidateRegions> {
  if (!Number.isSafeInteger(revision) || Number(revision) < 0)
    throw new HttpError(400, '资料版本无效');
  const record = await ownedScan(store, account, scanId);
  if (record.revision !== revision)
    throw new HttpError(409, '资料已更新，请刷新后再建议题框');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(record.mimeType))
    throw new HttpError(
      400,
      '自动建议题框暂支持 JPEG、PNG、WebP 照片；PDF 请先手动整理',
    );
  if (record.size > MAX_SCAN_BYTES)
    throw new HttpError(413, '图片不能超过 8 MB');
  if (!store.allow(`candidate-regions:${account}`, 6, 60000))
    throw new HttpError(429, '自动建议过于频繁，请稍后再试');
  const detected = await runner.run(
    () => readScanFile(store.scanOwner(account), scanId),
    signal,
  );
  const current = await ownedScan(store, account, scanId);
  if (current.revision !== revision)
    throw new HttpError(409, '资料已更新，候选框已作废，请刷新后重试');
  return { scanId, revision: Number(revision), ...detected };
}
