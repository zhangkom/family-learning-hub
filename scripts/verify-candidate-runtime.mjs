import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const connection = JSON.parse(
  readFileSync('work/mobile-dev-connection.json', 'utf8'),
);
assert.equal(connection.syntheticOnly, true);
assert.equal(new URL(connection.apiBase).hostname, '127.0.0.1');
const headers = { Origin: 'http://127.0.0.1:3178' };
async function call(path, body, method = 'POST') {
  const response = await fetch(connection.apiBase + '/' + path, {
    method,
    headers,
    ...(body === undefined
      ? {}
      : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
  assert(response.ok, `${path}: ${response.status}`);
  return response.json();
}
const login = await call('session/login', {
  username: connection.username,
  password: connection.password,
});
headers.Authorization = `Bearer ${login.token}`;
const students = await call('students', undefined, 'GET');
const report = { syntheticOnly: true, modelCalls: 0, cases: [] };
for (const [name, count] of [
  ['single-column', 4],
  ['two-columns', 6],
  ['long-image', 11],
  ['blank', 0],
  ['two-columns-with-header', 0],
]) {
  const file = readFileSync(
    resolve('work/candidate-lab/artifacts', name + '.png'),
  );
  const form = new FormData();
  form.set('studentId', students.students[0].id);
  form.set('clientRequestId', randomUUID());
  form.set('source', 'synthetic-layout');
  form.set('file', new File([file], name + '.png', { type: 'image/png' }));
  const { scan } = await call('scans', form);
  const start = performance.now();
  const result = await call(`scans/${scan.id}/candidate-regions`, {
    revision: scan.revision,
  });
  assert.equal(result.candidates.length, count);
  assert.equal(result.status, count ? 'candidates' : 'manual_required');
  const after = await call(`scans/${scan.id}`, undefined, 'GET');
  assert.deepEqual(after.scan, scan);
  report.cases.push({
    name,
    count,
    status: result.status,
    elapsedMs: Math.round(performance.now() - start),
  });
}
writeFileSync(
  'work/candidate-runtime-verification.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
