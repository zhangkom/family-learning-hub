import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FamilyStore } from './family-store';
import { handleFamily } from './family-backend';
import { handleScans } from './scans-backend';
import { saveScan, scanWrongRecords } from './scan-files';
import { recognizeQuestions } from './model-gateway';
import { blankScanQuestion, type ScanRecord } from '../lib/scans';

const origin = 'https://family.example';
let directory: string, store: FamilyStore, cookie: string;
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const question = {
  ...blankScanQuestion('数学'),
  number: '1',
  prompt: '2+3=?',
  learnerAnswer: '6',
  answer: '5',
  knowledgePoint: '加法',
  selected: true,
};
function record(): ScanRecord {
  return {
    id: randomUUID(),
    subject: '数学',
    source: '旧版测试资料',
    originalName: 'test.png',
    mimeType: 'image/png',
    size: png.length,
    status: '已核对',
    createdAt: '2026-09-25T00:00:00.000Z',
    fileUrl: '/api/scans/old/file',
    revision: 2,
    confirmedAt: '2026-09-25T01:00:00.000Z',
    questions: [question],
  };
}
function call(
  action: 'list' | 'item' | 'file' | 'recognize',
  id?: string,
  body?: Record<string, unknown> | FormData,
  auth = cookie,
  requestOrigin = origin,
) {
  return handleScans(
    new Request(`${origin}/family-learning/api/family/scans`, {
      method: body ? 'POST' : 'GET',
      headers: {
        origin: requestOrigin,
        cookie: auth,
        ...(body instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      ...(body
        ? { body: body instanceof FormData ? body : JSON.stringify(body) }
        : {}),
    }),
    action,
    id,
    store,
  );
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'family-scans-test-'));
  vi.stubEnv('FAMILY_DATA_DIR', directory);
  vi.stubEnv('FAMILY_SETUP_TOKEN', 's'.repeat(48));
  vi.stubEnv('FAMILY_PUBLIC_ORIGIN', origin);
  vi.stubEnv('FAMILY_AI_API_KEY', '');
  vi.stubEnv('OPENAI_API_KEY', '');
  store = new FamilyStore(':memory:');
  const setup = await handleFamily(
    new Request(`${origin}/family-learning/api/family/setup`, {
      method: 'POST',
      headers: { origin },
      body: JSON.stringify({
        username: 'family',
        password: 'test-family-password',
        setupToken: 's'.repeat(48),
      }),
    }),
    'setup',
    store,
  );
  cookie = setup.headers.get('set-cookie')!.split(';')[0];
});
afterEach(async () => {
  store.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep + 'family-scans-test-'))
    throw new Error('Unsafe test cleanup');
  await rm(target, { recursive: true, force: true });
});
describe('private scan lifecycle and existing data', () => {
  it('adopts existing scans for the first family and protects originals from guests and other accounts', async () => {
    const old = record();
    await saveScan('family', old, png);
    expect(
      ((await (await call('list')).json()) as { items: ScanRecord[] }).items[0]
        .id,
    ).toBe(old.id);
    expect((await scanWrongRecords('family')).dabao.wrong[0].scanId).toBe(
      old.id,
    );
    expect((await call('file', old.id, undefined, '')).status).toBe(401);
    expect((await call('file', '../secret')).status).toBe(404);
    const other = { ...old, id: randomUUID() };
    await saveScan('other-household', other, png);
    expect((await call('file', other.id)).status).toBe(404);
    const file = await call('file', old.id);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(png);
    expect(file.headers.get('cache-control')).toContain('no-store');
  });
  it('keeps draft edits out of confirmed history and rejects stale revisions', async () => {
    const old = record();
    await saveScan('family', old, png);
    const draft = { ...question, learnerAnswer: 'changed draft' };
    const saved = await call('item', old.id, {
      action: 'save',
      revision: 2,
      questions: [draft],
    });
    expect(saved.status).toBe(200);
    expect(
      (await scanWrongRecords('family')).dabao.wrong[0].learnerAnswer,
    ).toBe('6');
    expect(
      (
        await call('item', old.id, {
          action: 'save',
          revision: 2,
          questions: [draft],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call('item', old.id, {
          action: 'confirm',
          revision: 3,
          questions: [draft],
        })
      ).status,
    ).toBe(200);
    const account = store.db.prepare('SELECT id FROM accounts').get()!;
    expect(store.read(String(account.id)).dabao.wrong[0].learnerAnswer).toBe(
      '6',
    );
    expect(
      (await call('item', old.id, { action: 'trash', revision: 4 })).status,
    ).toBe(200);
    expect((await scanWrongRecords('family')).dabao.wrong).toHaveLength(1);
    expect(
      (await call('item', old.id, { action: 'restore', revision: 5 })).status,
    ).toBe(200);
  });
  it('validates file contents and origin, preserves upload and requires AI configuration', async () => {
    const form = (bytes: Uint8Array) => {
      const data = new FormData();
      data.set('child', 'xiaobao');
      data.set('source', '测试卷');
      data.set('subject', '数学');
      data.set(
        'file',
        new File([new Uint8Array(bytes)], 'scan.png', { type: 'image/png' }),
      );
      return data;
    };
    expect(
      (await call('list', undefined, form(new Uint8Array([1, 2, 3])))).status,
    ).toBe(400);
    expect(
      (await call('list', undefined, form(png), cookie, 'https://evil.example'))
        .status,
    ).toBe(403);
    const uploaded = await call('list', undefined, form(png));
    expect(uploaded.status).toBe(201);
    const item = ((await uploaded.json()) as { item: ScanRecord }).item;
    expect(item.child).toBe('xiaobao');
    expect((await call('recognize', item.id, {})).status).toBe(503);
    expect((await call('file', item.id)).status).toBe(200);
  });
  it('uses a configured compatible provider without trusting AI-selected mistakes', async () => {
    vi.stubEnv('FAMILY_AI_API_KEY', 'fake-test-key');
    vi.stubEnv('FAMILY_AI_BASE_URL', 'https://api.deepseek.com');
    vi.stubEnv('FAMILY_AI_MODEL', 'deepseek-flash');
    vi.stubEnv('FAMILY_AI_PROTOCOL', 'chat-completions');
    vi.stubEnv('FAMILY_AI_JSON_MODE', 'json_object');
    const fetcher = vi.fn(async () =>
      Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify({ questions: [question] }) },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await recognizeQuestions(record(), png);
    expect(result[0].selected).toBe(false);
    const args = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(args[0]).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(args[1].body as string);
    expect(body.model).toBe('deepseek-flash');
    expect(body.messages[1].content[1].image_url.url).toMatch(
      /^data:image\/png;base64,/,
    );
    await expect(
      recognizeQuestions({ ...record(), mimeType: 'application/pdf' }, png),
    ).rejects.toThrow('PDF');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockImplementation(async () =>
      Response.json({
        choices: [{ finish_reason: 'length', message: { content: '{}' } }],
      }),
    );
    await expect(recognizeQuestions(record(), png)).rejects.toThrow('不完整');
  });
});
