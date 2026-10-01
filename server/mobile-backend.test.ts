import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { backup } from 'node:sqlite';
import { FamilyStore } from './family-store';
import { handleFamily } from './family-backend';
import { handleMobile, handleWorkspace } from './mobile-backend';
import {
  claimJob,
  enqueueRecognition,
  finishJob,
  runNextJob,
} from './scan-jobs';
import { ownedScan } from './mobile-service';
import { readStoredScan, saveScan } from './scan-files';
import { blankScanQuestion } from '../lib/scans';
import {
  validateQuestions,
  type MobileScan,
  type Question,
  type Student,
} from '../lib/mobile';
import { recognizeStructuredQuestions } from './model-gateway';
import { handleScans } from './scans-backend';

const origin = 'https://family.example',
  password = 'test-family-password';
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
let directory: string,
  store: FamilyStore,
  cookie: string,
  token: string,
  account: string;
type TestResponse = Omit<Response, 'json'> & {
  json(): Promise<{
    token: string;
    user: { id: string };
    scan: MobileScan;
    scans: MobileScan[];
    student: Student;
    students: Student[];
  }>;
};
function call(
  path: string,
  method = 'GET',
  body?: unknown,
  auth = token,
  headers: Record<string, string> = {},
) {
  return handleMobile(
    new Request(origin + '/family-learning/api/mobile/v1/' + path, {
      method,
      headers: {
        ...(auth ? { Authorization: 'Bearer ' + auth } : {}),
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    }),
    path.split('?')[0].split('/'),
    store,
  ) as Promise<TestResponse>;
}
function question(id = 'q1'): Question {
  return {
    id,
    number: '1',
    prompt: '2+3=?',
    diagram: '',
    knowledgePoints: ['加法'],
    uncertainties: [],
    confirmed: true,
    regions: [
      { id: 'r1', kind: 'answer', x: 0.1, y: 0.2, width: 0.4, height: 0.2 },
    ],
    answerSteps: [
      {
        id: 's1',
        order: 1,
        text: '2+3=6',
        author: 'student',
        regionIds: ['r1'],
        crossedOut: false,
        uncertain: false,
      },
    ],
    referenceAnswer: '5',
    explanation: '待核对参考说明',
  };
}
async function upload(
  studentId = 'dabao',
  clientRequestId = randomUUID(),
  source = '合成测试',
  bytes = png,
) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    studentId,
    subject: '数学',
    source,
    clientRequestId,
  }))
    form.set(key, value);
  form.set(
    'file',
    new File([new Uint8Array(bytes)], 'test.png', { type: 'image/png' }),
  );
  return call('scans', 'POST', form);
}
async function newScan(student = 'dabao') {
  const response = await upload(student);
  expect(response.status).toBe(201);
  return (await response.json()).scan as MobileScan;
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'family-mobile-test-'));
  vi.stubEnv('FAMILY_DATA_DIR', directory);
  vi.stubEnv('FAMILY_PUBLIC_ORIGIN', origin);
  vi.stubEnv('FAMILY_SETUP_TOKEN', 's'.repeat(48));
  vi.stubEnv(
    'FAMILY_MOBILE_ORIGINS',
    'https://localhost,http://127.0.0.1:4178',
  );
  vi.stubEnv('FAMILY_AI_API_KEY', '');
  vi.stubEnv('OPENAI_API_KEY', '');
  store = new FamilyStore(join(directory, 'family.sqlite'));
  const setup = await handleFamily(
    new Request(origin + '/setup', {
      method: 'POST',
      headers: { origin },
      body: JSON.stringify({
        username: 'family',
        password,
        setupToken: 's'.repeat(48),
      }),
    }),
    'setup',
    store,
  );
  cookie = setup.headers.get('set-cookie')!.split(';')[0];
  account = ((await setup.json()) as { user: { id: string } }).user.id;
  const response = await call(
    'session/login',
    'POST',
    { username: 'family', password },
    '',
  );
  token = (await response.json()).token;
});
afterEach(() => {
  store.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep + 'family-mobile-test-'))
    throw new Error('Unsafe cleanup');
  rmSync(target, { recursive: true, force: true });
});
describe('mobile authentication and students', () => {
  it('isolates bearer and cookie sessions, hashes tokens, and revokes one device on logout', async () => {
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(
      store.db.prepare('SELECT token FROM mobile_sessions').get()?.token,
    ).toBe(createHash('sha256').update(token).digest('hex'));
    expect((await call('session')).status).toBe(200);
    expect(
      (await call('students', 'GET', undefined, '', { cookie })).status,
    ).toBe(401);
    const web = await handleFamily(
      new Request(origin + '/sync', {
        headers: { Authorization: 'Bearer ' + token },
      }),
      'sync',
      store,
    );
    expect(web.status).toBe(401);
    const next = await call(
      'session/login',
      'POST',
      { username: 'family', password, deviceName: '平板' },
      '',
    );
    expect(next.headers.get('set-cookie')).toBeNull();
    const second = (await next.json()).token;
    await call('session/logout', 'POST', {});
    expect((await call('session')).status).toBe(401);
    expect((await call('session', 'GET', undefined, second)).status).toBe(200);
  });
  it('rejects expired tokens and revokes all mobile sessions on password change', async () => {
    const expiry = store.db
      .prepare('SELECT expires FROM mobile_sessions')
      .get()!.expires;
    store.db.prepare('UPDATE mobile_sessions SET expires=0').run();
    expect((await call('session')).status).toBe(401);
    store.db.prepare('UPDATE mobile_sessions SET expires=?').run(expiry);
    const changed = await handleFamily(
      new Request(origin + '/password', {
        method: 'POST',
        headers: { cookie, origin },
        body: JSON.stringify({
          currentPassword: password,
          password: 'replacement-family-pass',
        }),
      }),
      'password',
      store,
    );
    expect(changed.status).toBe(200);
    expect((await call('session')).status).toBe(401);
  });
  it('enforces exact CORS and keeps cookie writes protected', async () => {
    const okay = await call('students', 'GET', undefined, token, {
      origin: 'http://127.0.0.1:4178',
    });
    expect(okay.headers.get('access-control-allow-origin')).toBe(
      'http://127.0.0.1:4178',
    );
    expect(okay.headers.get('access-control-allow-credentials')).toBeNull();
    expect(
      (
        await call('students', 'GET', undefined, token, {
          origin: 'https://localhost.evil.example',
        })
      ).status,
    ).toBe(403);
    const preflight = await call('scans', 'OPTIONS', undefined, '', {
      origin: 'https://localhost',
    });
    expect(preflight.status).toBe(204);
    const rejected = await handleWorkspace(
      new Request(origin + '/students', {
        method: 'POST',
        headers: { cookie, origin: 'https://localhost' },
        body: JSON.stringify({ name: '不应创建' }),
      }),
      ['students'],
      store,
    );
    expect(rejected.status).toBe(403);
  });
  it('preserves legacy profiles, supports a third student, and isolates households', async () => {
    expect(
      (await (await call('students')).json()).students
        .map((s: Student) => s.id)
        .sort(),
    ).toEqual(['dabao', 'xiaobao']);
    const add = await call('students', 'POST', {
      name: '第三位同学',
      grade: '初一',
    });
    expect(add.status).toBe(201);
    const student = (await add.json()).student;
    const scan = await newScan(student.id);
    expect(
      (await (await call('scans?studentId=xiaobao')).json()).scans,
    ).toHaveLength(0);
    expect(
      (await (await call('scans?studentId=' + student.id)).json()).scans[0]
        .studentId,
    ).toBe(student.id);
    const encoded = store.db
      .prepare('SELECT password FROM accounts WHERE id=?')
      .get(account)!.password;
    store.db
      .prepare('INSERT INTO accounts VALUES (?,?,?,?)')
      .run('other', 'other', encoded, Date.now());
    const other = (
      await (
        await call('session/login', 'POST', { username: 'other', password }, '')
      ).json()
    ).token;
    expect(
      (await (await call('students', 'GET', undefined, other)).json()).students,
    ).toEqual([]);
    expect(
      (await call('scans?studentId=' + student.id, 'GET', undefined, other))
        .status,
    ).toBe(404);
    for (const suffix of ['', '/file'])
      expect(
        (await call('scans/' + scan.id + suffix, 'GET', undefined, other))
          .status,
      ).toBe(404);
    expect(
      (
        await call(
          'scans/' + scan.id + '/review',
          'PUT',
          { revision: 0, questions: [] },
          other,
        )
      ).status,
    ).toBe(404);
  });
});
describe('scan uploads and revisions', () => {
  it('deduplicates retries, detects changed payloads, and protects original bytes', async () => {
    const key = randomUUID();
    const first = await upload('dabao', key),
      scan = (await first.json()).scan;
    const second = await upload('dabao', key);
    expect(second.status).toBe(200);
    expect((await second.json()).scan.id).toBe(scan.id);
    expect((await upload('xiaobao', key)).status).toBe(409);
    expect((await upload('dabao', key, '改变出处')).status).toBe(409);
    const file = await call(`scans/${scan.id}/file`);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(png);
    expect(file.headers.get('cache-control')).toContain('no-store');
    expect(
      (await call(`scans/${scan.id}/file`, 'GET', undefined, '')).status,
    ).toBe(401);
    expect(
      (await upload('dabao', randomUUID(), '假图片', new Uint8Array([1, 2, 3])))
        .status,
    ).toBe(400);
  });
  it('recovers the same upload after an interrupted database commit', async () => {
    const key = randomUUID(),
      first = (await (await upload('dabao', key)).json()).scan;
    store.db.prepare('DELETE FROM scan_uploads').run();
    store.db.prepare('DELETE FROM scan_documents').run();
    const retry = await upload('dabao', key);
    expect(retry.status).toBe(200);
    expect((await retry.json()).scan.id).toBe(first.id);
    expect(
      store.db.prepare('SELECT count(*) AS n FROM scan_documents').get()?.n,
    ).toBe(1);
  });
  it('keeps stable question/step IDs, revision history and human confirmations', async () => {
    const scan = await newScan();
    const saved = await call(`scans/${scan.id}/review`, 'PUT', {
      revision: 0,
      questions: [question()],
    });
    expect(saved.status).toBe(200);
    const reviewed = (await saved.json()).scan;
    expect(reviewed).toMatchObject({
      status: 'ready',
      revision: 1,
      questions: [{ id: 'q1', answerSteps: [{ id: 's1', text: '2+3=6' }] }],
    });
    expect(
      (
        await call(`scans/${scan.id}/review`, 'PUT', {
          revision: 0,
          questions: [],
        })
      ).status,
    ).toBe(409);
    const next = await call(`scans/${scan.id}/review`, 'PUT', {
      revision: 1,
      questions: [{ ...question(), confirmed: false }],
    });
    expect((await next.json()).scan.confirmedAt).toBeUndefined();
    expect(
      store.db
        .prepare('SELECT count(*) AS n FROM scan_versions WHERE id=?')
        .get(scan.id)?.n,
    ).toBe(3);
    expect(store.read(account).dabao.attempts).toHaveLength(0);
    expect(
      new Uint8Array(await (await call(`scans/${scan.id}/file`)).arrayBuffer()),
    ).toEqual(png);
  });
  it('reads and preserves legacy confirmed records when adopting structured review', async () => {
    const id = randomUUID();
    await saveScan(
      'family',
      {
        id,
        subject: '数学',
        source: '旧扫描',
        originalName: 'old.png',
        mimeType: 'image/png',
        size: png.length,
        status: '已核对',
        createdAt: new Date().toISOString(),
        revision: 2,
        fileUrl: '',
        confirmedAt: new Date().toISOString(),
        questions: [
          {
            ...blankScanQuestion('数学'),
            prompt: '2+3=?',
            learnerAnswer: '6',
            answer: '5',
            selected: true,
          },
        ],
      },
      png,
    );
    const response = await call('scans/' + id);
    expect(response.status).toBe(200);
    expect((await response.json()).scan).toMatchObject({
      studentId: 'dabao',
      revision: 2,
      questions: [{ answerSteps: [{ text: '6' }] }],
    });
    expect(
      (
        await call(`scans/${id}/review`, 'PUT', {
          revision: 2,
          questions: [question()],
        })
      ).status,
    ).toBe(200);
    expect(store.read(account).dabao.wrong[0].learnerAnswer).toBe('6');
  });
  it('rejects cyclic parent links, out-of-image boxes and crossed question handwriting links', () => {
    expect(() =>
      validateQuestions([{ ...question(), parentQuestionId: 'q1' }]),
    ).toThrow('循环');
    expect(() =>
      validateQuestions([
        { ...question(), regions: [{ ...question().regions[0], x: 0.9 }] },
      ]),
    ).toThrow('超出');
    expect(() =>
      validateQuestions([
        {
          ...question(),
          answerSteps: [
            { ...question().answerSteps[0], regionIds: ['missing'] },
          ],
        },
      ]),
    ).toThrow('不存在');
    const parent = {
      ...question(),
      id: 'parent',
      answerSteps: [],
      regions: [
        { ...question().regions[0], id: 'figure1', kind: 'figure' as const },
      ],
    };
    const child = {
      ...question(),
      parentQuestionId: 'parent',
      sharedRegionIds: ['figure1'],
    };
    expect(validateQuestions([parent, child])).toHaveLength(2);
  });
});
describe('durable recognition jobs', () => {
  beforeEach(() => {
    vi.stubEnv('FAMILY_AI_API_KEY', 'fake-key');
    vi.stubEnv('FAMILY_AI_BASE_URL', 'https://api.deepseek.com');
    vi.stubEnv('FAMILY_AI_MODEL', 'deepseek-flash');
    vi.stubEnv('FAMILY_AI_PROTOCOL', 'chat-completions');
  });
  async function queue(student = 'dabao') {
    const scan = await newScan(student);
    const r = await call(`scans/${scan.id}/recognize`, 'POST', { revision: 0 });
    expect(r.status).toBe(202);
    expect((await r.json()).scan.status).toBe('queued');
    return scan;
  }
  it('keeps the human revision when an older web recognition request finishes late', async () => {
    const id = randomUUID();
    await saveScan(
      'family',
      {
        id,
        subject: '数学',
        source: '旧网页在途任务',
        originalName: 'old.png',
        mimeType: 'image/png',
        size: png.length,
        status: '待整理',
        createdAt: new Date().toISOString(),
        revision: 0,
        fileUrl: '',
        questions: [],
      },
      png,
    );
    let complete!: (response: Response) => void;
    const delayed = new Promise<Response>((done) => {
      complete = done;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => delayed),
    );
    const running = handleScans(
      new Request(origin + '/recognize', {
        method: 'POST',
        headers: { cookie, origin },
        body: '{}',
      }),
      'recognize',
      id,
      store,
    );
    for (
      let i = 0;
      i < 50 && readStoredScan(store, 'family', id)?.status !== '识别中';
      i++
    )
      await new Promise((done) => setTimeout(done, 5));
    const current = readStoredScan(store, 'family', id)!;
    expect(current.status).toBe('识别中');
    const reviewed = await call(`scans/${id}/review`, 'PUT', {
      revision: current.revision,
      questions: [question()],
    });
    expect(reviewed.status).toBe(200);
    const revision = (await reviewed.json()).scan.revision;
    complete(
      Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                questions: [
                  { ...blankScanQuestion('数学'), prompt: '旧模型答案' },
                ],
              }),
            },
          },
        ],
      }),
    );
    expect((await running).status).toBe(409);
    expect(readStoredScan(store, 'family', id)).toMatchObject({
      revision,
      status: 'ready',
      structuredQuestions: [{ prompt: '2+3=?' }],
    });
  });
  it('returns before any model call and runs the persistent job for its original student', async () => {
    const third = store.addStudent(account, '新同学');
    const scan = await queue(third.id);
    await call('scans?studentId=xiaobao');
    const recognizer = vi.fn(async () => [question()]);
    expect(await runNextJob(store, recognizer)).toBe(true);
    const finished = (await (await call('scans/' + scan.id)).json()).scan;
    expect(finished).toMatchObject({
      studentId: third.id,
      status: 'needs_review',
      revision: 3,
      questions: [{ confirmed: false }],
    });
    expect(recognizer).toHaveBeenCalledTimes(1);
  });
  it('allows only one lease and rejects results from an expired worker', async () => {
    const scan = await queue();
    const first = claimJob(store)!;
    const otherProcess = new FamilyStore(join(directory, 'family.sqlite'));
    try {
      expect(claimJob(otherProcess)).toBeNull();
      store.db
        .prepare('UPDATE scan_jobs SET lease_until=0 WHERE id=?')
        .run(first.id);
      const resumed = claimJob(otherProcess)!;
      expect(resumed.attempts).toBe(2);
      expect(finishJob(store, first, [question()])).toBe(false);
      expect(
        finishJob(otherProcess, resumed, [{ ...question(), confirmed: false }]),
      ).toBe(true);
      expect(readStoredScan(store, 'family', scan.id)?.status).toBe(
        'needs_review',
      );
    } finally {
      otherProcess.close();
    }
  });
  it('does not overwrite manual review that cancels an in-flight job', async () => {
    const scan = await queue(),
      job = claimJob(store)!;
    const human = { ...question(), prompt: '人工更正题干' };
    expect(
      (
        await call(`scans/${scan.id}/review`, 'PUT', {
          revision: job.revision,
          questions: [human],
        })
      ).status,
    ).toBe(200);
    expect(finishJob(store, job, [question()])).toBe(false);
    expect(
      readStoredScan(store, 'family', scan.id)?.structuredQuestions?.[0].prompt,
    ).toBe('人工更正题干');
    expect(
      store.db.prepare('SELECT status FROM scan_jobs WHERE id=?').get(job.id)
        ?.status,
    ).toBe('cancelled');
  });
  it('restores queued jobs and revisions from a SQLite backup', async () => {
    const scan = await queue();
    const path = join(directory, 'restored.sqlite');
    await backup(store.db, path);
    const restored = new FamilyStore(path);
    try {
      expect((await ownedScan(restored, account, scan.id)).status).toBe(
        'queued',
      );
      expect(claimJob(restored)?.studentId).toBe('dabao');
      expect(readStoredScan(store, 'family', scan.id)?.status).toBe('queued');
    } finally {
      restored.close();
    }
  });
  it('bounds crash recovery and preserves a readable failure', async () => {
    const scan = await queue();
    for (let n = 0; n < 3; n++) {
      expect(claimJob(store)?.attempts).toBe(n + 1);
      store.db.prepare('UPDATE scan_jobs SET lease_until=0').run();
    }
    expect(claimJob(store)).toBeNull();
    expect(readStoredScan(store, 'family', scan.id)?.status).toBe('failed');
  });
  it('keeps raw visible work separate from reference answers and never invents region coordinates', async () => {
    const scan = await newScan(),
      record = await ownedScan(store, account, scan.id);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  questions: [
                    {
                      id: 'q1',
                      parentQuestionId: '',
                      number: '1',
                      prompt: '2+3=?',
                      diagram: '',
                      knowledgePoints: ['加法'],
                      uncertainties: [],
                      referenceAnswer: '5',
                      explanation: '',
                      regions: [{ x: 0.5 }],
                      answerSteps: [
                        {
                          text: '2+3=6',
                          latex: '',
                          author: 'student',
                          crossedOut: false,
                          uncertain: false,
                        },
                      ],
                    },
                  ],
                }),
              },
            },
          ],
        }),
      ),
    );
    const result = await recognizeStructuredQuestions(record, png);
    expect(result[0]).toMatchObject({
      referenceAnswer: '5',
      regions: [],
      confirmed: false,
      answerSteps: [{ text: '2+3=6', regionIds: [] }],
    });
    expect(result[0].uncertainties.join('')).toContain('手动框选');
    expect(result[0].id).not.toBe('q1');
  });
  it('deduplicates active jobs and rejects stale enqueue or overwriting confirmed questions', async () => {
    const scan = await queue();
    expect(enqueueRecognition(store, account, scan.id, 1).revision).toBe(1);
    expect(
      store.db.prepare('SELECT count(*) AS n FROM scan_jobs').get()?.n,
    ).toBe(1);
    expect(() => enqueueRecognition(store, account, scan.id, 0)).toThrow(
      '更新',
    );
    await call(`scans/${scan.id}/review`, 'PUT', {
      revision: 1,
      questions: [question()],
    });
    expect(() => enqueueRecognition(store, account, scan.id, 2)).toThrow(
      '校对',
    );
  });
});
