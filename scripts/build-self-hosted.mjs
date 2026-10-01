import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  realpathSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '/family-learning';
if (!/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(basePath)) {
  throw new Error(
    'NEXT_PUBLIC_BASE_PATH must be an absolute path without a trailing slash.',
  );
}
const packageRoot = resolve('node_modules/vinext');
const pkg = JSON.parse(
  readFileSync(resolve(packageRoot, 'package.json'), 'utf8'),
);
// The centralized server layout keeps generated files outside code/. vinext's
// default cleanup removes the dist symlink itself, so clean its verified target
// here and tell the builder to preserve the directory entry.
const dist = resolve('dist');
const keepBuildRoot = existsSync(dist) && lstatSync(dist).isSymbolicLink();
if (keepBuildRoot) {
  const project = resolve('..');
  const expected = resolve(project, 'runtime/development-build');
  if (
    resolve('.') !== resolve(project, 'code') ||
    realpathSync(dist) !== expected
  ) {
    throw new Error('Refusing to clean an unexpected build symlink target.');
  }
  for (const entry of readdirSync(expected)) {
    rmSync(resolve(expected, entry), { recursive: true, force: true });
  }
}
const result = spawnSync(
  process.execPath,
  [resolve(packageRoot, pkg.bin.vinext), 'build'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      FAMILY_SELF_HOSTED: 'true',
      FAMILY_KEEP_BUILD_ROOT: String(keepBuildRoot),
      NEXT_PUBLIC_SELF_HOSTED: 'true',
      NEXT_PUBLIC_BASE_PATH: basePath,
    },
  },
);
if (result.error) throw result.error;
if (result.status === 0) {
  // Keep runtime dependency resolution independent of the caller's directory.
  // This also makes relocated standalone releases work without source access.
  const entry = 'dist/standalone/server.js';
  const launcher = readFileSync(entry, 'utf8');
  if (!launcher.includes('startProdServer({')) {
    throw new Error('Unrecognized standalone launcher; cannot set runtime root.');
  }
  writeFileSync(
    entry,
    launcher.replace(
      'startProdServer({',
      'process.chdir(import.meta.dirname);\n\nstartProdServer({',
    ),
  );
  copyFileSync(
    'scripts/backup-family.mjs',
    'dist/standalone/backup-family.mjs',
  );
  const { build } = await import('vite');
  await build({
    configFile: false,
    build: {
      ssr: resolve('server/scan-worker.ts'),
      outDir: 'dist/standalone/worker',
      emptyOutDir: true,
      rolldownOptions: { output: { entryFileNames: 'worker.mjs' } },
    },
  });
}
process.exit(result.status ?? 1);
