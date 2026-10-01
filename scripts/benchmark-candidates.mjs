import { build } from 'vite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

// Run from an isolated project checkout with its own work/ and dependencies.
// No service environment, listeners, accounts, model calls or production data.
const fixtures = spawnSync(
  process.execPath,
  ['scripts/create-candidate-fixtures.mjs'],
  { stdio: 'inherit', windowsHide: true },
);
if (fixtures.status !== 0)
  throw new Error('Synthetic fixture generation failed');
await sharp({
  create: { width: 8000, height: 4000, channels: 3, background: 'white' },
})
  .png()
  .toFile('work/candidate-lab/artifacts/max-32mp.png');
await build({
  configFile: false,
  publicDir: false,
  build: {
    ssr: resolve('server/candidate-benchmark.ts'),
    outDir: 'work/candidate-benchmark',
    emptyOutDir: true,
    rolldownOptions: { output: { entryFileNames: 'benchmark.mjs' } },
  },
});
await import(
  pathToFileURL(resolve('work/candidate-benchmark/benchmark.mjs')).href
);
