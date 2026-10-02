import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { HttpError } from './family-backend';
import { MobileError } from './mobile-service';
import source from './cloud-image-worker.cjs?raw';
import {
  acquireImageProcess,
  onImageProcessAvailable,
} from './image-process-slot';

const require = createRequire(resolve(process.cwd(), 'package.json'));
export type CloudImage = {
  width: number;
  height: number;
  orientation: number;
  thumbnail: Buffer;
};
type Waiting = { priority: boolean; start: (release: () => void) => void };
const waiting: Waiting[] = [];
let active = false;
function pump() {
  if (active || !waiting.length) return;
  const release = acquireImageProcess();
  if (!release) return;
  const priority = waiting.findIndex((job) => job.priority);
  waiting.splice(priority < 0 ? 0 : priority, 1)[0].start(release);
}
onImageProcessAvailable(pump);
export function inspectCloudImage(
  path: string,
  mimeType: string,
  signal?: AbortSignal,
  priority = true,
): Promise<CloudImage> {
  if (signal?.aborted) return Promise.reject(new HttpError(408, '请求已取消'));
  if (waiting.length >= 32)
    return Promise.reject(
      new MobileError(503, '图片处理正忙，请稍后重试', 'UPLOAD_BUSY'),
    );
  return new Promise((resolve, reject) => {
    const remove = (error: Error) => {
      const index = waiting.indexOf(job);
      if (index < 0) return;
      waiting.splice(index, 1);
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(error);
    };
    const abort = () => remove(new HttpError(408, '请求已取消'));
    const timer = setTimeout(
      () =>
        remove(
          new MobileError(503, '图片处理排队超时，请稍后重试', 'UPLOAD_BUSY'),
        ),
      30_000,
    );
    const job: Waiting = {
      priority,
      start: (release) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        active = true;
        void runChild(path, mimeType, signal)
          .then(resolve, reject)
          .finally(() => {
            active = false;
            release();
            pump();
          });
      },
    };
    signal?.addEventListener('abort', abort, { once: true });
    waiting.push(job);
    pump();
  });
}
async function runChild(
  path: string,
  mimeType: string,
  signal?: AbortSignal,
): Promise<CloudImage> {
  if (signal?.aborted) throw new HttpError(408, '请求已取消');
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        process.execPath,
        ['--max-old-space-size=96', '--input-type=commonjs', '-e', source],
        {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...(process.env.SystemRoot
              ? { SystemRoot: process.env.SystemRoot }
              : {}),
            NODE_ENV: 'production',
            UV_THREADPOOL_SIZE: '1',
          },
        },
      );
    } catch {
      reject(new HttpError(503, '图片处理暂不可用'));
      return;
    }
    let output = '',
      finished = false,
      closed = false,
      settled = false;
    let failure: Error | undefined, result: CloudImage | undefined;
    const settle = () => {
      if (!closed || !finished || settled) return;
      settled = true;
      if (failure) reject(failure);
      else resolve(result!);
    };
    const finish = (error?: Error, image?: CloudImage) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (child.exitCode === null) child.kill('SIGKILL');
      failure = error;
      result = image;
      settle();
    };
    const abort = () => finish(new HttpError(408, '请求已取消'));
    const timer = setTimeout(
      () => finish(new HttpError(503, '图片检查超时，请稍后重试')),
      12_000,
    );
    signal?.addEventListener('abort', abort, { once: true });
    child.stderr!.resume();
    child.stdout!.on('data', (bytes: Buffer) => {
      output += Buffer.from(bytes).toString('utf8');
      if (output.length > 1024 * 1024)
        finish(new HttpError(503, '图片处理结果无效'));
    });
    child.on('error', () => finish(new HttpError(503, '图片处理暂不可用')));
    child.stdin!.on('error', () =>
      finish(new HttpError(503, '图片处理暂不可用')),
    );
    child.on('close', (code) => {
      closed = true;
      if (finished) {
        settle();
        return;
      }
      try {
        if (code !== 0) throw new Error('Worker failed');
        const value = JSON.parse(output);
        if (value.error) {
          finish(
            new HttpError(
              value.error === 'PIXEL_LIMIT' ? 413 : 400,
              value.error === 'PIXEL_LIMIT'
                ? '图片最多支持3200万像素'
                : '图片无法完整读取或格式不支持',
            ),
          );
          return;
        }
        if (
          ![value.width, value.height, value.orientation].every(
            Number.isSafeInteger,
          ) ||
          value.width < 1 ||
          value.height < 1 ||
          value.width * value.height > 32_000_000 ||
          value.orientation < 1 ||
          value.orientation > 8 ||
          typeof value.thumbnail !== 'string'
        )
          throw new Error('Invalid response');
        const thumbnail = Buffer.from(value.thumbnail, 'base64');
        if (
          !thumbnail.length ||
          thumbnail.length > 700_000 ||
          thumbnail[0] !== 255 ||
          thumbnail[1] !== 216
        )
          throw new Error('Invalid JPEG');
        finish(undefined, {
          width: value.width,
          height: value.height,
          orientation: value.orientation,
          thumbnail,
        });
      } catch {
        finish(new HttpError(503, '图片处理暂不可用'));
      }
    });
    try {
      child.stdin!.end(
        JSON.stringify({ path, mimeType, sharpPath: require.resolve('sharp') }),
      );
    } catch {
      finish(new HttpError(503, '图片处理暂不可用'));
    }
  });
}
