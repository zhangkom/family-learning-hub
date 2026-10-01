import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const old = '9bf75159fa20fa4520b2f7c4d35d03f509c3370d';
mkdirSync('work', { recursive: true });
const directory = mkdtempSync(resolve('work/rollback-028-'));
const archive = execFileSync(
  'git',
  ['archive', '--format=zip', old, 'server', 'lib'],
  { maxBuffer: 16 * 1024 * 1024, windowsHide: true },
);
const unpack = `import io,sys,zipfile\nfrom pathlib import Path\np=Path(sys.argv[1]).resolve()\nwith zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:\n for f in z.infolist():\n  if not (p/f.filename).resolve().is_relative_to(p): raise RuntimeError('Unsafe archive path')\n z.extractall(p)`;
execFileSync(
  process.platform === 'win32' ? 'py' : 'python3',
  [...(process.platform === 'win32' ? ['-3'] : []), '-c', unpack, directory],
  { input: archive, windowsHide: true },
);
copyFileSync(
  'scripts/fixtures/rollback-028-check.mjs',
  join(directory, 'check.mjs'),
);
await build({
  configFile: false,
  publicDir: false,
  build: {
    ssr: join(directory, 'check.mjs'),
    outDir: join(directory, 'built'),
    emptyOutDir: true,
    rolldownOptions: { output: { entryFileNames: 'check.mjs' } },
  },
});
await import(pathToFileURL(join(directory, 'built/check.mjs')).href);
