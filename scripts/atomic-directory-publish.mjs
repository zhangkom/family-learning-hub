import { lstatSync, renameSync } from 'node:fs';

const retryDelays = [25, 50, 100, 200];
const sleep = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

// Publishing a completed, private staging directory must stay a single rename.
// Windows scanners can briefly deny that rename even after our handles close.
// Do not retry storage failures, bypass permissions, copy, or replace a target.
export function publishDirectorySync(source, target, options = {}) {
  const platform = options.platform ?? process.platform;
  const rename = options.rename ?? renameSync, inspect = options.inspect ?? lstatSync, wait = options.wait ?? sleep;
  for (let attempt = 0; ; attempt++) {
    try {
      inspect(target); // lstat also catches dangling symlinks; existsSync does not.
      const error = new Error('Atomic publication target already exists');
      error.code = 'EEXIST';
      throw error;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try { rename(source, target); return; }
    catch (error) {
      if (platform !== 'win32' || !['EPERM', 'EBUSY'].includes(error.code) || attempt >= retryDelays.length) throw error;
      wait(retryDelays[attempt]);
    }
  }
}
