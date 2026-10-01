import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const c = JSON.parse(
  readFileSync('work/model-audit-dev-connection.json', 'utf8'),
);
assert(c.syntheticOnly && c.questionModelStub);
assert.equal(new URL(c.apiBase).hostname, '127.0.0.1');
const headers = { Origin: 'http://127.0.0.1:3178' };
async function call(path, body, method = 'POST') {
  const r = await fetch(c.apiBase + '/' + path, {
    method,
    headers,
    ...(body === undefined
      ? {}
      : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
  assert(r.ok, `${path}: ${r.status}`);
  return r.json();
}
const login = await call('session/login', {
  username: c.username,
  password: c.password,
});
headers.Authorization = 'Bearer ' + login.token;
const students = await call('students', undefined, 'GET');
const bytes = await sharp({
  create: { width: 256, height: 256, channels: 3, background: 'white' },
})
  .png()
  .toBuffer();
const f = new FormData();
f.set('studentId', students.students[0].id);
f.set('source', 'synthetic');
f.set('clientRequestId', randomUUID());
f.set('file', new File([bytes], 'synthetic.png', { type: 'image/png' }));
let { scan } = await call('scans', f);
({ scan } = await call(
  `scans/${scan.id}/review`,
  {
    revision: scan.revision,
    questions: [
      {
        id: 'q1',
        subject: '物理',
        number: '1',
        prompt: '',
        diagram: '',
        knowledgePoints: [],
        uncertainties: [],
        confirmed: false,
        answerSteps: [],
        regions: [{ id: 'r1', kind: 'stem', x: 0, y: 0, width: 1, height: 1 }],
      },
    ],
  },
  'PUT',
));
({ scan } = await call(`scans/${scan.id}/questions/q1/explain`, {
  revision: scan.revision,
}));
for (let i = 0; i < 30; i++) {
  ({ scan } = await call(`scans/${scan.id}`, undefined, 'GET'));
  if (scan.questions[0].tutoring?.status === 'needs_review') break;
  await new Promise((done) => setTimeout(done, 200));
}
assert.equal(scan.questions[0].tutoring?.status, 'needs_review');
const root = join(c.directory, 'data', 'model-audit');
const auditFiles = readdirSync(root).flatMap((day) =>
  readdirSync(join(root, day))
    .filter((f) => f.endsWith('.json'))
    .map((file) => join(root, day, file)),
);
assert.equal(auditFiles.length, 1);
const audit = JSON.parse(readFileSync(auditFiles[0], 'utf8'));
assert.equal(audit.outcome, 'succeeded');
assert.equal(audit.requestedModel, 'synthetic-question-model');
for (const p of ['readOriginalMs', 'cropMs', 'httpMs', 'parseValidationMs'])
  assert(audit[p] >= 0);
const report = {
  syntheticOnly: true,
  realModelCalls: 0,
  stubCalls: 1,
  workerVerified: true,
  audit,
};
writeFileSync(
  'work/model-audit-runtime-verification.json',
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    syntheticOnly: true,
    realModelCalls: 0,
    stubCalls: 1,
    auditOutcome: audit.outcome,
    phasesVerified: true,
  }),
);
