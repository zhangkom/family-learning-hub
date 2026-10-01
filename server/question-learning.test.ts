import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
