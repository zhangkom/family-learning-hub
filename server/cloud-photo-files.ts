import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  mkdirSync,
  lstatSync,
  statfsSync,
  openSync,
  closeSync,
  readSync,
} from 'node:fs';
import { MobileError } from './mobile-service';

export const cloudHash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const cloudUuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const CLOUD_FAMILY_BYTES = 2 * 1024 ** 3;
export const CLOUD_SERVICE_BYTES = 8 * 1024 ** 3;
export const CLOUD_RESERVE_BYTES = 2 * 1024 ** 3;
export function cloudRoot() {
  if (!process.env.FAMILY_DATA_DIR)
    throw new Error('Private storage unavailable');
  return resolve(process.env.FAMILY_DATA_DIR);
}
export function privateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const state = lstatSync(path);
  if (!state.isDirectory() || state.isSymbolicLink())
    throw new Error('Unsafe cloud directory');
  return path;
}
export function cloudDirectory(account: string, id?: string) {
  const root = privateDirectory(cloudRoot());
  const owner = privateDirectory(join(root, cloudHash(account)));
  const photos = privateDirectory(join(owner, 'cloud-photos'));
  if (!id) return photos;
  if (!cloudUuid.test(id)) throw new Error('Invalid cloud photo ID');
  const path = join(photos, id),
    state = lstatSync(path);
  if (!state.isDirectory() || state.isSymbolicLink())
    throw new Error('Unsafe cloud photo');
  return path;
}
export function cloudTempDirectory() {
  const path = resolve(
    process.env.FAMILY_CLOUD_TEMP_DIR ||
      join(cloudRoot(), '..', 'temp', 'cloud-photos'),
  );
  privateDirectory(path);
  const directory = join(path, randomUUID());
  mkdirSync(directory, { mode: 0o700 });
  return directory;
}
export function requireCloudSpace(size: number) {
  const fs = statfsSync(cloudRoot(), { bigint: true });
  // Staging + committed original + first independent backup, with fixed headroom.
  if (fs.bavail * fs.bsize < BigInt(CLOUD_RESERVE_BYTES + size * 3))
    throw new MobileError(503, '服务器可用空间不足，请稍后再试', 'STORAGE_LOW');
}
export function hashFile(path: string) {
  const state = lstatSync(path);
  if (!state.isFile() || state.isSymbolicLink())
    throw new Error('Unsafe cloud file');
  const fd = openSync(path, 'r'),
    hash = createHash('sha256'),
    buffer = Buffer.alloc(65536);
  try {
    let count: number;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)))
      hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}
