import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

// Isolated synthetic data only. Deliberately never inherit production AI keys.
const port = Number(process.env.FAMILY_MOBILE_TEST_PORT || 3285);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid test port');
const inUse = await new Promise((done) => {
  const socket = createConnection({ host: '127.0.0.1', port });
  socket.on('connect', () => {
    socket.destroy();
    done(true);
  });
  socket.on('error', () => done(false));
});
if (inUse)
  throw new Error(
    'Test port already in use; inspect the existing test service first',
  );
mkdirSync('work', { recursive: true });
const directory = mkdtempSync(resolve('work/mobile-dev-'));
const runtime = resolve(directory, 'runtime');
cpSync(resolve('dist/standalone'), runtime, { recursive: true });
const origin = `http://127.0.0.1:${port}`,
  base = origin + '/family-learning';
const password = randomBytes(24).toString('hex'),
  setupToken = randomBytes(32).toString('hex');
const needsSetup = process.env.FAMILY_MOBILE_TEST_NEEDS_SETUP === 'true';
const server = spawn(process.execPath, [resolve(runtime, 'server.js')], {
  windowsHide: true,
  detached: true,
  stdio: [
    'ignore',
    openSync(resolve(directory, 'server.log'), 'a'),
    openSync(resolve(directory, 'server-error.log'), 'a'),
  ],
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    NODE_ENV: 'production',
    FAMILY_DATA_DIR: resolve(directory, 'data'),
    FAMILY_PUBLIC_ORIGIN: origin,
    FAMILY_SETUP_TOKEN: setupToken,
    FAMILY_AI_API_KEY: '',
    FAMILY_RECOGNITION_ENABLED: 'false',
    OPENAI_API_KEY: '',
    FAMILY_MOBILE_ORIGINS: 'https://localhost,http://127.0.0.1:3178',
  },
});
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (server.exitCode !== null)
      throw new Error('Test server exited; inspect project-local logs');
    try {
      if ((await fetch(base + '/api/family/session')).ok) {
        ready = true;
        break;
      }
    } catch {
      /* starting */
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  if (!ready) throw new Error('Test server did not become ready');
  const availability = await fetch(base + '/api/mobile/v1/setup');
  if (!availability.ok || !(await availability.json()).needsSetup)
    throw new Error('Synthetic setup status is not available');
  if (!needsSetup) {
    const setup = await fetch(base + '/api/family/setup', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'mobiletest', password, setupToken }),
    });
    if (!setup.ok) throw new Error('Synthetic account setup failed');
    const login = await fetch(base + '/api/mobile/v1/session/login', {
      method: 'POST',
      headers: {
        Origin: 'http://127.0.0.1:3178',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'mobiletest', password }),
    });
    if (
      !login.ok ||
      login.headers.get('access-control-allow-origin') !==
        'http://127.0.0.1:3178'
    )
      throw new Error('Mobile route or development CORS check failed');
    await login.json();
  }
  const metadata = {
    origin,
    base,
    apiBase: base + '/api/mobile/v1',
    username: 'mobiletest',
    password,
    directory,
    pid: server.pid,
    syntheticOnly: true,
    aiEnabled: false,
    needsSetup,
    ...(needsSetup ? { setupToken } : {}),
  };
  const path = resolve('work/mobile-dev-connection.json');
  writeFileSync(path, JSON.stringify(metadata, null, 2), { mode: 0o600 });
  server.unref();
  console.log(
    JSON.stringify({
      origin,
      apiBase: metadata.apiBase,
      connectionFile: path,
      pid: server.pid,
      syntheticOnly: true,
    }),
  );
} catch (e) {
  server.kill();
  throw e;
}
