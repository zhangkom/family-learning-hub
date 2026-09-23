import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '/family-learning';
if (!/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(basePath)) {
  throw new Error('NEXT_PUBLIC_BASE_PATH must be an absolute path without a trailing slash.');
}
const packageRoot = resolve('node_modules/vinext');
const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
const result = spawnSync(process.execPath, [resolve(packageRoot, pkg.bin.vinext), 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    FAMILY_SELF_HOSTED: 'true',
    NEXT_PUBLIC_SELF_HOSTED: 'true',
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
