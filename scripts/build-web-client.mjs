import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const client = resolve('clients/android');
const vite = resolve(client, 'node_modules/vite/bin/vite.js');
if (!existsSync(vite)) throw new Error('Run npm --prefix clients/android ci before building the hosted client.');
const result = spawnSync(process.execPath, [vite, 'build', '--config', 'vite.web.config.ts'], { cwd: client, stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error('Hosted web client build failed.');
