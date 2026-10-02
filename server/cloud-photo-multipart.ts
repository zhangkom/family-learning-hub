import busboy from 'busboy';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { CLOUD_PHOTO_CAPABILITY as limits } from '../lib/cloud-photos';
import { HttpError } from './family-backend';

// Bounded streaming ingestion: never build a full FormData/ArrayBuffer/base64 copy.
export async function receiveCloudPhoto(request: Request, directory: string) {
  const maxBody = limits.maxFileBytes + 65536;
  if (Number(request.headers.get('content-length')) > maxBody)
    throw new HttpError(413, '图片不能超过32 MiB');
  if (
    !request.body ||
    !request.headers.get('content-type')?.startsWith('multipart/form-data;')
  )
    throw new HttpError(400, '请使用图片上传表单');
  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({
      headers: { 'content-type': request.headers.get('content-type')! },
      defParamCharset: 'utf8',
      limits: {
        files: 1,
        fields: 5,
        parts: 7,
        fieldSize: 4096,
        fileSize: limits.maxFileBytes + 1,
        headerPairs: 30,
      },
    });
  } catch {
    throw new HttpError(400, '上传表单格式不正确');
  }
  const source = Readable.fromWeb(
    request.body as Parameters<typeof Readable.fromWeb>[0],
  );
  const fields: Record<string, string> = Object.create(null);
  let failure: Error | undefined,
    fileTask: Promise<void> | undefined,
    size = 0,
    bodySize = 0;
  let file: { path: string; filename: string; mimeType: string } | undefined;
  const hash = createHash('sha256');
  const fail = (error: Error) => {
    failure ??= error;
    source.destroy(error);
    parser.destroy(error);
  };
  parser.on('field', (name, value, info) => {
    if (
      !['studentId', 'batchId', 'clientRequestId', 'sha256'].includes(name) ||
      Object.hasOwn(fields, name) ||
      info.valueTruncated ||
      info.nameTruncated
    )
      failure ??= new HttpError(400, '上传字段无效或重复');
    else fields[name] = value;
  });
  parser.on('file', (name, stream, info) => {
    if (
      name !== 'file' ||
      file ||
      !info.filename ||
      !limits.mimeTypes.includes(info.mimeType as never)
    ) {
      stream.on('error', () => {});
      stream.resume();
      failure ??= new HttpError(400, '仅支持单张JPEG、PNG、WebP原图');
      return;
    }
    file = {
      path: join(directory, 'incoming'),
      filename: info.filename,
      mimeType: info.mimeType,
    };
    stream.on('limit', () => {
      failure ??= new HttpError(413, '图片不能超过32 MiB');
    });
    fileTask = pipeline(
      stream,
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          size += chunk.length;
          if (size > limits.maxFileBytes) {
            failure ??= new HttpError(413, '图片不能超过32 MiB');
            done();
            return;
          }
          hash.update(chunk);
          done(null, chunk);
        },
      }),
      createWriteStream(file.path, { flags: 'wx', mode: 0o600 }),
    ).catch(fail);
  });
  for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit'])
    parser.on(event, () => {
      failure ??= new HttpError(400, '上传字段数量超限');
    });
  const abort = () => fail(new HttpError(408, '上传已取消'));
  request.signal.addEventListener('abort', abort, { once: true });
  // Bound stalled uploads independently of proxy timeouts.
  const timer = setTimeout(
    () => fail(new HttpError(408, '上传超时，请重试')),
    120_000,
  );
  try {
    if (request.signal.aborted) abort();
    await pipeline(
      source,
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          bodySize += chunk.length;
          done(
            bodySize > maxBody ? new HttpError(413, '上传请求过大') : null,
            chunk,
          );
        },
      }),
      parser,
    );
    await fileTask;
    if (failure) throw failure;
    if (!file || !size || Object.keys(fields).length !== 4)
      throw new HttpError(400, '请选择图片并填写批次、学生和上传标识');
    return { ...file, size, sha256: hash.digest('hex'), fields };
  } catch (error) {
    fail(error instanceof Error ? error : new Error('Upload failed'));
    await fileTask;
    throw failure instanceof HttpError
      ? failure
      : new HttpError(400, '图片上传不完整，请重试');
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
  }
}
