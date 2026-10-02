import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { sharp } from './sharp';
import { FamilyStore } from './family-store';
import { handleMobile } from './mobile-backend';
import { claimJob, finishJob, runNextJob } from './scan-jobs';
import { scanDirectory } from './scan-files';
import { cropQuestionImage } from './question-crop';
import { validateTutoringResult } from './model-gateway';
import type { MobileScan, Question, TutoringResult } from '../lib/mobile';
import { HttpError } from './family-backend';
import { analysisProgress } from './analysis-progress';

let directory: string,
  store: FamilyStore,
  student: string,
  otherStudent: string,
  png: Uint8Array;
const token = 'a'.repeat(64),
  otherToken = 'b'.repeat(64);
const digest = (v: string | Uint8Array) =>
  createHash('sha256').update(v).digest('hex');
type TestResponse = Omit<Response, 'json'> & {
  json(): Promise<{
    scan: MobileScan;
    items: { scanId: string; subject: string; question: Question }[];
    code: string;
  }>;
};
function call(path: string, method = 'GET', body?: unknown, auth = token) {
  return handleMobile(
    new Request(
      'https://family.example/family-learning/api/mobile/v1/' + path,
      {
        method,
        headers: {
          Origin: 'https://localhost',
          Authorization: 'Bearer ' + auth,
        },
        ...(body === undefined
          ? {}
          : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      },
    ),
    path.split('?')[0].split('/'),
    store,
  ) as Promise<TestResponse>;
}
function question(subject?: Question['subject']): Question {
  return {
    id: 'q1',
    ...(subject ? { subject } : {}),
    number: '1',
    prompt: '',
    diagram: '',
    knowledgePoints: [],
    uncertainties: [],
    confirmed: false,
    answerSteps: [],
    regions: [{ id: 'r1', kind: 'stem', x: 0, y: 0, width: 1, height: 0.5 }],
  };
}
const draft = () => ({
  transcribedPrompt: '物体以 2 m/s 匀速运动 3 s，求路程。',
  referenceAnswer: '6 m',
  explanation: '路程 s=vt=2×3=6 m。',
  answerEvidence: [],
  errorHypotheses: [],
  uncertainties: [],
});
const result = (): TutoringResult => ({
  ...draft(),
  generatedAt: new Date().toISOString(),
  needsReview: true,
});
function audits() {
  const root = join(directory, 'model-audit');
  return readdirSync(root).flatMap((day) =>
    readdirSync(join(root, day))
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(root, day, f), 'utf8'))),
  );
}
async function upload(subjectValue?: string) {
  const form = new FormData();
  form.set('studentId', student);
  form.set('source', 'synthetic physics sheet');
  form.set('clientRequestId', randomUUID());
  if (subjectValue !== undefined) form.set('subject', subjectValue);
  form.set(
    'file',
    new File([new Uint8Array(png)], 'synthetic.png', { type: 'image/png' }),
  );
  const response = await call('scans', 'POST', form);
  expect(response.status).toBe(201);
  return (await response.json()).scan;
}
async function review(scan: MobileScan, questions = [question('物理')]) {
  const response = await call(`scans/${scan.id}/review`, 'PUT', {
    revision: scan.revision,
    questions,
  });
  expect(response.status).toBe(200);
  return (await response.json()).scan;
}
async function mark(scan: MobileScan, saved = true) {
  const response = await call(
    `scans/${scan.id}/questions/q1/wrong-book`,
    'POST',
    { revision: scan.revision, saved },
  );
  expect(response.status).toBe(200);
  return (await response.json()).scan;
}
async function enqueue(scan: MobileScan) {
  const response = await call(`scans/${scan.id}/questions/q1/explain`, 'POST', {
    revision: scan.revision,
  });
  expect(response.status).toBe(202);
  return (await response.json()).scan;
}
async function get(scan: MobileScan) {
  return (await (await call(`scans/${scan.id}`)).json()).scan;
}
async function completed() {
  let scan = await enqueue(await mark(await review(await upload())));
  const job = claimJob(store)!;
  expect(finishJob(store, job, undefined, undefined, Date.now(), result())).toBe(true);
  scan = await get(scan); return scan;
}
function analysisReview(scan: MobileScan, values: Record<string, unknown>, auth = token, questionId = 'q1') {
  return call(`scans/${scan.id}/questions/${questionId}/analysis-review`, 'POST', {
    revision: scan.revision, resultGeneratedAt: scan.questions.find(q => q.id === questionId)?.tutoring?.result?.generatedAt, ...values,
  }, auth);
}
beforeEach(async () => {
  mkdirSync('work', { recursive: true });
  directory = mkdtempSync(resolve('work/question-learning-'));
  store = new FamilyStore(join(directory, 'family.sqlite'));
  vi.stubEnv('FAMILY_DATA_DIR', directory);
  vi.stubEnv('FAMILY_PUBLIC_ORIGIN', 'https://family.example');
  vi.stubEnv('FAMILY_MOBILE_ORIGINS', 'https://localhost');
  vi.stubEnv('FAMILY_RECOGNITION_ENABLED', 'true');
  vi.stubEnv('FAMILY_AI_API_KEY', 'synthetic-key');
  vi.stubEnv('FAMILY_AI_MODEL', 'synthetic-model');
  vi.stubEnv('FAMILY_AI_BASE_URL', 'https://model.example/v1');
  vi.stubEnv('FAMILY_AI_PROTOCOL', 'chat-completions');
  vi.stubEnv('FAMILY_AI_JSON_MODE', 'json_object');
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockRejectedValue(new Error('Unexpected model call in synthetic test')),
  );
  for (const [id, name, t] of [
    ['family-a', 'family_a', token],
    ['family-b', 'family_b', otherToken],
  ]) {
    store.db
      .prepare('INSERT INTO accounts VALUES (?,?,?,?)')
      .run(id, name, 'synthetic-unusable-password', Date.now());
    store.db
      .prepare('INSERT INTO mobile_sessions VALUES (?,?,?,?,?)')
      .run(digest(t), id, Date.now() + 60000, 'test', Date.now());
  }
  student = store.addStudent('family-a', '合成学生').id;
  otherStudent = store.addStudent('family-b', '另一个学生').id;
  png = await sharp({
    create: { width: 100, height: 200, channels: 3, background: '#ff0000' },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 100,
            height: 100,
            channels: 3,
            background: '#0000ff',
          },
        })
          .png()
          .toBuffer(),
        left: 0,
        top: 100,
      },
    ])
    .png()
    .toBuffer();
});
afterEach(() => {
  store.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (
    !resolve(directory).startsWith(resolve('work') + sep + 'question-learning-')
  )
    throw new Error('Unsafe cleanup');
  rmSync(directory, { recursive: true, force: true });
});

describe('selected question learning', () => {
  it('uploads without a subject and requires explicit per-question subject and stem selection', async () => {
    let scan = await upload();
    expect(scan.subject).toBe('待选择');
    scan = await review(scan, [question()]);
    expect(
      (
        await call(`scans/${scan.id}/questions/q1/wrong-book`, 'POST', {
          revision: scan.revision,
          saved: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(`scans/${scan.id}/questions/q1/explain`, 'POST', {
          revision: scan.revision,
        })
      ).status,
    ).toBe(400);
    scan = await review(scan, [{ ...question('物理'), regions: [] }]);
    expect(
      (
        await call(`scans/${scan.id}/questions/q1/explain`, 'POST', {
          revision: scan.revision,
        })
      ).status,
    ).toBe(400);
    const old = await upload('数学');
    const oldReviewed = await review(old, [question()]);
    expect(
      (
        await call(`scans/${old.id}/questions/q1/explain`, 'POST', {
          revision: oldReviewed.revision,
        })
      ).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('marks by question, retains the original, and lists only the selected student and family', async () => {
    let scan = await review(await upload());
    const original = join(scanDirectory('family-a', scan.id), 'original'),
      before = digest(readFileSync(original));
    scan = await mark(scan);
    const savedAt = scan.questions[0].wrongBook!.savedAt;
    expect((await mark(scan)).revision).toBe(scan.revision);
    const items = (await (await call(`wrong-book?studentId=${student}`)).json())
      .items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      scanId: scan.id,
      subject: '物理',
      question: { wrongBook: { savedAt } },
    });
    expect(
      (
        await call(
          `wrong-book?studentId=${student}`,
          'GET',
          undefined,
          otherToken,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await (
          await call(
            `wrong-book?studentId=${otherStudent}`,
            'GET',
            undefined,
            otherToken,
          )
        ).json()
      ).items,
    ).toEqual([]);
    expect(
      (
        await call(
          `scans/${scan.id}/questions/q1/wrong-book`,
          'POST',
          { revision: scan.revision, saved: false },
          otherToken,
        )
      ).status,
    ).toBe(404);
    scan = await mark(scan, false);
    expect(scan.questions[0].wrongBook).toBeUndefined();
    expect(digest(readFileSync(original))).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('queues only on explicit action, crops the chosen question and keeps AI output separate from handwriting', async () => {
    let scan = await mark(await review(await upload()));
    const mocked = vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'synthetic-returned-model',
          id: 'chatcmpl-synthetic123456',
          usage: {
            prompt_tokens: 321,
            completion_tokens: 123,
            total_tokens: 444,
            completion_tokens_details: { reasoning_tokens: 40 },
            secret: 'never-log',
          },
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify({ questions: [draft()] }) },
            },
          ],
        }),
      ),
    );
    expect(mocked).not.toHaveBeenCalled();
    scan = await enqueue(scan);
    expect(scan.questions[0].tutoring?.status).toBe('queued');
    expect((await enqueue(scan)).revision).toBe(scan.revision);
    expect(store.db.prepare('SELECT * FROM scan_jobs').all()).toHaveLength(1);
    expect(await runNextJob(store)).toBe(true);
    expect(audits()).toHaveLength(1);
    const audit = audits()[0];
    expect(audit).toMatchObject({
      outcome: 'succeeded',
      kind: 'question',
      attempt: 1,
      requestedModel: 'synthetic-model',
      returnedModel: 'synthetic-returned-model',
      provider: 'model.example',
      upstreamStatus: 200,
      requestId: 'chatcmpl-synthetic123456',
      usage: {
        prompt_tokens: 321,
        completion_tokens: 123,
        total_tokens: 444,
        reasoning_tokens: 40,
      },
    });
    for (const phase of [
      'readOriginalMs',
      'cropMs',
      'httpMs',
      'parseValidationMs',
      'queueMs',
      'readyWaitMs',
      'attemptMs',
    ])
      expect(audit[phase]).toBeGreaterThanOrEqual(0);
    const serialized = JSON.stringify(audit);
    for (const forbidden of [
      'never-log',
      'synthetic-key',
      '物体',
      'referenceAnswer',
      'image_url',
      'family-a',
    ])
      expect(serialized).not.toContain(forbidden);
    scan = await get(scan);
    expect(scan.questions[0]).toMatchObject({
      subject: '物理',
      prompt: '',
      answerSteps: [],
      wrongBook: { savedAt: expect.any(String) },
      tutoring: {
        status: 'needs_review',
        result: {
          referenceAnswer: '6 m',
          errorHypotheses: [],
          needsReview: true,
        },
      },
    });
    expect(mocked).toHaveBeenCalledTimes(1);
    const requestBody = mocked.mock.calls[0][1]?.body;
    if (typeof requestBody !== 'string')
      throw new Error('Expected JSON model body');
    const sent = JSON.parse(requestBody);
    expect(sent.messages[1].content[0].text).toContain('学科：物理');
    const dataUrl = sent.messages[1].content[1].image_url.url as string;
    const decoded = await sharp(Buffer.from(dataUrl.split(',')[1], 'base64'))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(decoded.info.width).toBe(100);
    expect(decoded.info.height).toBe(100);
    expect(decoded.data[0]).toBeGreaterThan(240);
    expect(decoded.data[2]).toBeLessThan(20);
    expect(
      digest(
        readFileSync(join(scanDirectory('family-a', scan.id), 'original')),
      ),
    ).toBe(digest(png));
  });

  it('reports only this family task stage, retry time and attempts without disclosing lease data', async () => {
    let scan = await enqueue(await mark(await review(await upload())));
    expect(scan.analysis).toMatchObject({ questionId: 'q1', phase: 'queued', attempts: 0, maxAttempts: 3 });
    const job = claimJob(store)!;
    scan = await get(scan);
    expect(scan.analysis).toMatchObject({ phase: 'processing', startedAt: job.startedAt, attempts: 1 });
    expect(JSON.stringify(scan.analysis)).not.toContain(job.token);
    expect(JSON.stringify(scan.analysis)).not.toContain(job.id);
    expect(analysisProgress(store, 'family-b', scan.id, true)).toBeUndefined();
    expect((await call(`scans/${scan.id}`, 'GET', undefined, otherToken)).status).toBe(404);
    const now = Date.now(); finishJob(store, job, undefined, { message: 'synthetic timeout', retry: true }, now);
    scan = await get(scan);
    expect(scan.analysis).toMatchObject({ phase: 'retry_wait', attempts: 1, retryAt: now + 15000 });
    expect(analysisProgress(store, 'family-a', scan.id, true, now + 15001)?.phase).toBe('queued');
    vi.stubEnv('FAMILY_RECOGNITION_ENABLED', 'false'); expect((await get(scan)).analysis?.phase).toBe('paused');
  });

  it('records human confirmation separately, keeps raw output, rejects forged or stale reviews', async () => {
    let scan = await completed(); const raw = scan.questions[0].tutoring!.result;
    expect((await analysisReview(scan, { status: 'confirmed' }, otherToken)).status).toBe(404);
    expect((await analysisReview(scan, { status: 'confirmed', resultGeneratedAt: 'old' })).status).toBe(409);
    expect((await analysisReview(scan, { status: 'confirmed', referenceAnswer: 'forged' })).status).toBe(400);
    const response = await analysisReview(scan, { status: 'confirmed' }); expect(response.status).toBe(200);
    const stale = scan; scan = (await response.json()).scan;
    expect(scan.questions[0].tutoring).toMatchObject({ status: 'needs_review', result: raw, review: { status: 'confirmed', resultGeneratedAt: raw!.generatedAt } });
    expect(scan.questions[0].confirmed).toBe(false);
    expect((await analysisReview(stale, { status: 'confirmed' })).status).toBe(409);
    scan = await review(scan, [{ ...scan.questions[0], tutoring: { ...scan.questions[0].tutoring!, review: { status: 'flagged', issue: 'solution', reviewedAt: 'forged', resultGeneratedAt: 'forged' } } }]);
    expect(scan.questions[0].tutoring?.review?.status).toBe('confirmed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps corrections and earlier output through retries, sends corrected context, resets review for the new answer', async () => {
    let scan = await completed(); const raw = scan.questions[0].tutoring!.result;
    const response = await analysisReview(scan, { status: 'flagged', issue: 'recognition', correctedPrompt: '速度2 m/s，时间4 s，求路程。', note: '时间应为4秒，图中字迹容易误认' });
    expect(response.status).toBe(200); scan = (await response.json()).scan;
    expect(scan.questions[0]).toMatchObject({ prompt: '速度2 m/s，时间4 s，求路程。', answerSteps: [], tutoring: { status: 'stale', result: raw, review: { status: 'flagged' } } });
    expect(fetch).not.toHaveBeenCalled(); expect(store.db.prepare('SELECT count(*) n FROM scan_jobs').get()?.n).toBe(1);
    expect((await analysisReview(scan, { status: 'confirmed' })).status).toBe(409);
    scan = await enqueue(scan); expect(scan.questions[0].tutoring?.result).toEqual(raw);
    const first = claimJob(store)!; scan = await get(scan);
    expect(scan.questions[0].tutoring?.review?.issue).toBe('recognition');
    expect((await analysisReview(scan, { status: 'flagged', issue: 'solution', note: 'check' })).status).toBe(409);
    finishJob(store, first, undefined, { message: 'temporary', retry: true }); scan = await get(scan);
    expect(scan.questions[0].tutoring?.result).toEqual(raw);
    store.db.prepare("UPDATE scan_jobs SET available_at=0 WHERE status='queued'").run();
    vi.mocked(fetch).mockResolvedValue(Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questions: [{ ...draft(), transcribedPrompt: '速度2 m/s，时间4 s，求路程。', referenceAnswer: '8 m' }] }) } }] }));
    await runNextJob(store); scan = await get(scan);
    const body = vi.mocked(fetch).mock.calls[0][1]?.body;
    expect(typeof body).toBe('string');
    const sent = JSON.parse(body as string);
    expect(sent.messages[1].content[0].text).toContain('correctedPrompt');
    expect(sent.messages[1].content[0].text).toContain('时间4 s');
    expect(sent.messages[1].content[0].text).toContain('时间应为4秒');
    expect(sent.messages[1].content[0].text).not.toContain('6 m');
    expect(scan.questions[0].tutoring).toMatchObject({ status: 'needs_review', result: { referenceAnswer: '8 m', needsReview: true } });
    expect(scan.questions[0].tutoring?.review).toBeUndefined(); expect(scan.analysis).toBeUndefined();
    expect(digest(readFileSync(join(scanDirectory('family-a', scan.id), 'original')))).toBe(digest(png));
  });

  it('validates issue details and invalidates child analyses when shared parent text is corrected', async () => {
    let scan = await completed();
    for (const values of [ { status: 'flagged', issue: 'unsupported', note: 'x' }, { status: 'flagged', issue: 'recognition', correctedPrompt: '' },
      { status: 'flagged', issue: 'solution' }, { status: 'flagged', issue: 'incomplete', note: 'x'.repeat(2001) } ])
      expect((await analysisReview(scan, values)).status).toBe(400);
    scan = await review(scan, [scan.questions[0], { ...question('物理'), id: 'q2', parentQuestionId: 'q1', regions: [{ ...question().regions[0], id: 'r2' }] }]);
    const response = await call(`scans/${scan.id}/questions/q2/explain`, 'POST', { revision: scan.revision }); expect(response.status).toBe(202);
    const job = claimJob(store)!; finishJob(store, job, undefined, undefined, Date.now(), result()); scan = await get(scan);
    expect(scan.questions[1].tutoring?.status).toBe('needs_review');
    const saved = await analysisReview(scan, { status: 'flagged', issue: 'recognition', correctedPrompt: '更正后的共同条件' });
    expect(saved.status).toBe(200); scan = (await saved.json()).scan;
    expect(scan.questions[1].tutoring?.status).toBe('stale');
  });

  it('does not accept forged server fields; keeps real marks and marks earlier results stale after editing', async () => {
    let scan = await upload();
    scan = await review(scan, [
      {
        ...question('物理'),
        wrongBook: { savedAt: 'forged' },
        tutoring: { status: 'needs_review', result: result() },
      },
    ]);
    expect(scan.questions[0].wrongBook).toBeUndefined();
    expect(scan.questions[0].tutoring).toBeUndefined();
    scan = await mark(scan);
    scan = await enqueue(scan);
    const job = claimJob(store)!;
    expect(
      finishJob(store, job, undefined, undefined, Date.now(), result()),
    ).toBe(true);
    scan = await get(scan);
    const before = scan.questions[0].tutoring!.result;
    scan = await review(scan, [
      {
        ...scan.questions[0],
        subject: '数学',
        prompt: 'changed',
        tutoring: undefined,
        wrongBook: undefined,
      },
    ]);
    expect(scan.questions[0].wrongBook).toBeDefined();
    expect(scan.questions[0].tutoring).toMatchObject({
      status: 'stale',
      result: before,
    });
  });

  it('cancels in-flight work on review and rejects late results without losing the saved question', async () => {
    let scan = await enqueue(await mark(await review(await upload())));
    const job = claimJob(store)!;
    scan = await get(scan);
    scan = await review(scan, [
      {
        ...scan.questions[0],
        regions: [{ ...scan.questions[0].regions[0], height: 0.4 }],
      },
    ]);
    expect(
      finishJob(store, job, undefined, undefined, Date.now(), result()),
    ).toBe(false);
    expect(scan.questions[0].wrongBook).toBeDefined();
    expect(scan.questions[0].tutoring?.status).toBe('stale');
    expect(store.db.prepare('SELECT status FROM scan_jobs').get()?.status).toBe(
      'cancelled',
    );
  });

  it('retains saved wrong questions on model failure and respects the pause and shared quota', async () => {
    let scan = await enqueue(await mark(await review(await upload())));
    vi.stubEnv('FAMILY_RECOGNITION_ENABLED', 'false');
    expect(await runNextJob(store)).toBe(false);
    expect(
      store.db.prepare('SELECT attempts FROM scan_jobs').get()?.attempts,
    ).toBe(0);
    vi.stubEnv('FAMILY_RECOGNITION_ENABLED', 'true');
    await runNextJob(store, undefined, async () => {
      throw new HttpError(503, 'synthetic unavailable');
    });
    scan = await get(scan);
    expect(scan.questions[0].tutoring?.status).toBe('failed');
    expect(scan.questions[0].wrongBook).toBeDefined();
    vi.stubEnv('FAMILY_AI_DAILY_LIMIT', '1');
    scan = await enqueue(scan);
    const model = vi.fn().mockResolvedValue(result());
    await runNextJob(store, undefined, model);
    expect(model).not.toHaveBeenCalled();
    scan = await get(scan);
    expect(scan.questions[0].tutoring?.error).toContain('限额');
    expect(audits().find((a) => a.failureCode === 'LOCAL_QUOTA')).toMatchObject(
      { outcome: 'failed' },
    );
    expect(
      audits().find((a) => a.failureCode === 'LOCAL_QUOTA').httpMs,
    ).toBeUndefined();
  });

  it.each([
    [400, 'UPSTREAM_REQUEST', 'failed'],
    [401, 'UPSTREAM_AUTH', 'failed'],
    [403, 'UPSTREAM_AUTH', 'failed'],
    [402, 'UPSTREAM_QUOTA', 'failed'],
    [429, 'UPSTREAM_RATE_LIMIT', 'retry_queued'],
    [500, 'UPSTREAM_SERVER', 'retry_queued'],
    [503, 'UPSTREAM_SERVER', 'retry_queued'],
    [408, 'MODEL_TIMEOUT', 'retry_queued'],
  ])(
    'classifies provider HTTP %s without leaking its response or retrying permanent failures',
    async (status, code, outcome) => {
      await enqueue(await mark(await review(await upload())));
      vi.mocked(fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: 'private prompt or credential',
              code: 'provider_specific',
            },
          }),
          {
            status: Number(status),
            headers: { 'x-request-id': 'req_safe-synthetic-1234' },
          },
        ),
      );
      await runNextJob(store);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(audits()[0]).toMatchObject({
        failureCode: code,
        outcome,
        upstreamStatus: status,
        requestId: 'req_safe-synthetic-1234',
      });
      expect(
        store.db.prepare('SELECT status FROM scan_jobs').get()?.status,
      ).toBe(outcome === 'retry_queued' ? 'queued' : 'failed');
      expect(JSON.stringify(audits())).not.toContain('private prompt');
      if (outcome === 'failed') {
        expect(await runNextJob(store)).toBe(false);
        expect(fetch).toHaveBeenCalledTimes(1);
      }
    },
  );

  it.each(['timeout', 'quota', 'incomplete', 'schema'])(
    'handles %s distinctly and keeps the saved question',
    async (kind) => {
      const scan = await enqueue(await mark(await review(await upload())));
      if (kind === 'timeout')
        vi.mocked(fetch).mockRejectedValue(
          new DOMException('secret', 'TimeoutError'),
        );
      else if (kind === 'quota')
        vi.mocked(fetch).mockResolvedValue(
          new Response(
            '{"error":{"code":"insufficient_quota","message":"secret"}}',
            { status: 429 },
          ),
        );
      else
        vi.mocked(fetch).mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: kind === 'incomplete' ? 'length' : 'stop',
                  message: { content: '{"questions":[{}]}' },
                },
              ],
            }),
          ),
        );
      await runNextJob(store);
      expect(audits()[0]).toMatchObject({
        failureCode:
          kind === 'timeout'
            ? 'MODEL_TIMEOUT'
            : kind === 'quota'
              ? 'UPSTREAM_QUOTA'
              : 'MODEL_OUTPUT',
        outcome: kind === 'timeout' ? 'retry_queued' : 'failed',
      });
      expect((await get(scan)).questions[0].wrongBook).toBeDefined();
      expect(JSON.stringify(audits())).not.toContain('secret');
    },
  );

  it('caps transient retries at three and saves one audit per attempt', async () => {
    await enqueue(await review(await upload()));
    vi.mocked(fetch).mockImplementation(
      async () => new Response('unavailable', { status: 503 }),
    );
    for (let attempt = 1; attempt <= 3; attempt++) {
      store.db
        .prepare('UPDATE scan_jobs SET available_at=?')
        .run(Date.now() - 500);
      expect(await runNextJob(store)).toBe(true);
    }
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      audits()
        .sort((a, b) => a.attempt - b.attempt)
        .map((a) => [a.attempt, a.outcome]),
    ).toEqual([
      [1, 'retry_queued'],
      [2, 'retry_queued'],
      [3, 'failed'],
    ]);
    expect(await runNextJob(store)).toBe(false);
  });

  it('audits discarded late results and keeps a successful result if audit storage fails', async () => {
    let scan = await enqueue(await review(await upload()));
    await runNextJob(store, undefined, async () => {
      scan = await review(await get(scan));
      return result();
    });
    expect(audits()[0].outcome).toBe('discarded');
    rmSync(join(directory, 'model-audit'), { recursive: true });
    writeFileSync(
      join(directory, 'model-audit'),
      'synthetic file blocks directory',
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    scan = await enqueue(await get(scan));
    const model = vi.fn().mockResolvedValue(result());
    await runNextJob(store, undefined, model);
    expect((await get(scan)).questions[0].tutoring?.status).toBe(
      'needs_review',
    );
    expect(model).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Model attempt audit unavailable; inference is not repeated.',
    );
    warn.mockRestore();
  });

  it('accepts Chinese-language photos, preserves their wrong-book subject and processes a tutoring receipt', async () => {
    const chinese = { ...question('语文'), prompt: '解释“学而时习之”的“习”。', knowledgePoints: ['文言实词'], confirmed: true };
    let scan = await mark(await review(await upload('语文'), [chinese]));
    expect(scan.subject).toBe('语文'); expect(scan.questions[0].subject).toBe('语文');
    expect((await (await call(`wrong-book?studentId=${student}`)).json()).items).toMatchObject([{ subject: '语文', question: { subject: '语文', prompt: chinese.prompt } }]);
    scan = await enqueue(scan); const job = claimJob(store)!;
    const teaching = { ...result(), transcribedPrompt: chinese.prompt, referenceAnswer: '温习、实践所学内容', explanation: '结合“学”与“时”理解词语含义。' };
    expect(finishJob(store, job, undefined, undefined, Date.now(), teaching)).toBe(true);
    scan = await get(scan); expect(scan.questions[0].tutoring!.result!.referenceAnswer).toBe(teaching.referenceAnswer);
    expect(scan.questions[0].subject).toBe('语文');
  });

  it('keeps independent per-question subjects in one photograph and validates review conflicts', async () => {
    const q2 = {
      ...question('数学'),
      id: 'q2',
      regions: [
        {
          id: 'r2',
          kind: 'stem' as const,
          x: 0,
          y: 0.5,
          width: 1,
          height: 0.5,
        },
      ],
    };
    let scan = await review(await upload(), [question('物理'), q2]);
    scan = await mark(scan);
    const response = await call(
      `scans/${scan.id}/questions/q2/wrong-book`,
      'POST',
      { revision: scan.revision, saved: true },
    );
    expect(response.status).toBe(200);
    expect(
      (await (await call(`wrong-book?studentId=${student}`)).json()).items
        .map((x) => x.subject)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(['数学', '物理']);
    expect(
      (
        await call(`scans/${scan.id}/review`, 'PUT', {
          revision: 0,
          questions: [],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(`scans/${scan.id}/questions/missing/explain`, 'POST', {
          revision: (await response.json()).scan.revision,
        })
      ).status,
    ).toBe(404);
  });

  it('handles EXIF orientation before interpreting normalized rectangles', async () => {
    const image = await sharp(png)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const q = {
      ...question('物理'),
      regions: [
        {
          id: 'orientation',
          kind: 'stem' as const,
          x: 0.5,
          y: 0,
          width: 0.5,
          height: 1,
        },
      ],
    };
    const cropped = await cropQuestionImage(image, q, [q]);
    const decoded = await sharp(cropped)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(decoded.info.width).toBe(100);
    expect(decoded.info.height).toBe(100);
    const center = (50 * decoded.info.width + 50) * decoded.info.channels;
    expect(decoded.data[center]).toBeGreaterThan(230);
    expect(decoded.data[center + 2]).toBeLessThan(30);
  });

  it('migrates existing databases without dropping queued recognition or user data', () => {
    store.db.exec('ALTER TABLE scan_jobs DROP COLUMN question_id');
    store.close();
    store = new FamilyStore(join(directory, 'family.sqlite'));
    expect(
      store.db
        .prepare('PRAGMA table_info(scan_jobs)')
        .all()
        .some((c) => c.name === 'question_id'),
    ).toBe(true);
    expect(store.students('family-a').map((s) => s.id)).toEqual([student]);
  });

  it('requires actual student evidence for error hypotheses and labels every AI result as unconfirmed', () => {
    const noEvidence = validateTutoringResult([
      {
        ...draft(),
        errorHypotheses: [{ text: 'unsupported', evidenceIndexes: [] }],
      },
    ]);
    expect(noEvidence.errorHypotheses).toEqual([]);
    expect(noEvidence.needsReview).toBe(true);
    const unknown = validateTutoringResult([
      {
        ...draft(),
        answerEvidence: [{ text: 'v=3', author: 'unknown' }],
        errorHypotheses: [{ text: 'wrong value', evidenceIndexes: [0] }],
      },
    ]);
    expect(unknown.errorHypotheses).toEqual([]);
    const evidence = validateTutoringResult([
      {
        ...draft(),
        answerEvidence: [{ text: '2×3=5 m', author: 'student' }],
        errorHypotheses: [
          { text: '可能乘法计算有误，请核对该行', evidenceIndexes: [0] },
        ],
      },
    ]);
    expect(evidence.errorHypotheses).toHaveLength(1);
    expect(() =>
      validateTutoringResult([
        {
          ...draft(),
          errorHypotheses: [{ text: 'forged', evidenceIndexes: [100] }],
        },
      ]),
    ).toThrow('不完整');
  });
});
