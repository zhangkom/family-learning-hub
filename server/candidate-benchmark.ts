// Explicit developer benchmark entry, never imported by the web app/worker.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { platform, totalmem, cpus } from 'node:os';
import { Buffer } from 'node:buffer';
import { CandidateRunner } from './candidate-regions';
import { HttpError } from './family-backend';
import source from './candidate-worker.cjs?raw';

const require = createRequire(import.meta.url);
const fixtures = resolve('work/candidate-lab/artifacts');
assert.equal(
  JSON.parse(readFileSync(resolve(fixtures, 'fixtures.json'), 'utf8'))
    .syntheticOnly,
  true,
);
const metricsSource =
  source +
  "\nprocess.once('beforeExit',()=>process.stdout.write(JSON.stringify({kind:'metrics',usage:process.resourceUsage()})+'\\n'));";
const cases = [];
for (const name of [
  'single-column',
  'two-columns',
  'long-image',
  'blank',
  'two-columns-with-header',
  'max-32mp',
]) {
  const bytes = readFileSync(resolve(fixtures, name + '.png'));
  for (let run = 1; run <= 2; run++) {
    const start = performance.now();
    const child = spawnSync(
      process.execPath,
      ['--max-old-space-size=96', '--input-type=commonjs', '-e', metricsSource],
      {
        input: JSON.stringify({
          sharpPath: require.resolve('sharp'),
          bytes: Buffer.from(bytes).toString('base64'),
        }),
        encoding: 'utf8',
        timeout: 8000,
        maxBuffer: 65536,
        windowsHide: true,
        env: {
          NODE_ENV: 'production',
          UV_THREADPOOL_SIZE: '1',
          ...(process.env.SystemRoot
            ? { SystemRoot: process.env.SystemRoot }
            : {}),
        },
      },
    );
    assert.equal(child.status, 0, `${name} child did not finish safely`);
    const output = child.stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
      result = output.find((m) => m.kind === 'result')?.result,
      usage = output.find((m) => m.kind === 'metrics')?.usage;
    assert(result && usage);
    cases.push({
      name,
      run,
      status: result.status,
      count: result.candidates.length,
      wallMs: Math.round(performance.now() - start),
      childPeakRssMiB: Math.round((usage.maxRSS / 1024) * 100) / 100,
      childUserCpuMs: Math.round(usage.userCPUTime / 1000),
      childSystemCpuMs: Math.round(usage.systemCPUTime / 1000),
    });
  }
}
const runner = new CandidateRunner({
  source:
    "process.stdout.write(JSON.stringify({kind:'image',image:{width:10,height:20}})+'\\n');setInterval(()=>{},1000);",
});
const started = performance.now(),
  active = runner.run(async () => new Uint8Array());
await assert.rejects(
  runner.run(async () => new Uint8Array()),
  (e: unknown) => e instanceof HttpError && e.status === 503,
);
const result = await active;
assert.equal(result.status, 'manual_required');
assert(result.warnings.includes('PROCESSING_TIMEOUT'));
const timeoutMs = Math.round(performance.now() - started);
let released = false;
for (let i = 0; i < 50 && !released; i++) {
  const abort = new AbortController(),
    pending = runner.run(async () => new Uint8Array(), abort.signal);
  abort.abort();
  try {
    await pending;
    assert.fail('Aborted request resolved');
  } catch (e) {
    assert(e instanceof HttpError);
    released = e.status === 408;
    if (!released) assert.equal(e.status, 503);
  }
  if (!released) await new Promise((done) => setTimeout(done, 20));
}
assert(released);
const report = {
  syntheticOnly: true,
  modelCalls: 0,
  productionLearningDataRead: false,
  productionServicesChanged: false,
  platform: platform(),
  node: process.version,
  cpuCount: cpus().length,
  totalRamMiB: Math.round(totalmem() / 1024 / 1024),
  cases,
  concurrency: { maximumChildren: 1, busyStatus: 503, waitingQueue: 0 },
  timeout: {
    configuredMs: 8000,
    observedMs: timeoutMs,
    manualFallback: true,
    capacityReleasedAfterKill: released,
  },
  limitations:
    'Geometric synthetic images only. RSS is child peak, not total service RSS. First and repeated runs both start a fresh child. No real-photo accuracy claim.',
};
writeFileSync(
  'work/candidate-server-benchmark.json',
  JSON.stringify(report, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(report));
