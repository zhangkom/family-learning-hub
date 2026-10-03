import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FamilyStore } from './family-store';
import { handleAdmin, handleExternalReview } from './admin-backend';
import {
  createBatch,
  createReviewToken,
  digest,
  provisionAdmin,
  readBatch,
} from './admin-service';
import { handleFamily, hashPassword } from './family-backend';
import { saveScan, readStoredScan, writeStoredScan } from './scan-files';
import { sharp } from './sharp';
import type { ScanRecord } from '../lib/scans';
import type { Question } from '../lib/mobile';
import type { ReviewItem } from '../lib/admin';

let store: FamilyStore, dir: string, scan: ScanRecord;
const origin = 'https://family.example',
  adminToken = 'a'.repeat(64),
  userToken = 'b'.repeat(64);
const q = (id: string): Question => ({
  id,
  number: id,
  subject: '数学',
  prompt: '已知 x + 1 = 2，求 x。',
  diagram: '',
  knowledgePoints: ['旧知识点'],
  regions: [
    { id: id + '-stem', kind: 'stem', x: 0, y: 0, width: 1, height: 0.4 },
  ],
  answerSteps: [],
  uncertainties: [],
  confirmed: true,
  wrongBook: { savedAt: '2026-10-01T00:00:00Z' },
  referenceAnswer: '2',
  explanation: '旧解法',
});
function call(
  path: string,
  body?: unknown,
  token = adminToken,
  requestOrigin = origin,
) {
  return handleAdmin(
    new Request(origin + '/family-learning/api/admin/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Cookie: 'family_session=' + token,
        Origin: requestOrigin,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    path.split('?')[0].split('/'),
    store,
  );
}
function external(path: string, token: string, body?: unknown) {
  return handleExternalReview(
    new Request(origin + '/family-learning/api/external-review/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    path.split('?')[0].split('/'),
    store,
  );
}
const input = (item: ReviewItem, answer = '1') => ({
  fingerprint: item.fingerprint,
  provider: 'codex',
  model: 'synthetic-test-model',
  summary: '修正移项计算',
  knowledgePoints: ['一元一次方程'],
  result: {
    transcribedPrompt: '已知 x + 1 = 2，求 x。',
    referenceAnswer: answer,
    explanation: '两边减1，x=2−1=1。代回原式得到2=2。',
    answerEvidence: [],
    errorHypotheses: [],
    uncertainties: [],
  },
});
function batch(ids = ['q1']) {
  return createBatch(store, 'admin-id', {
    title: '合成复核',
    items: ids.map((questionId) => ({
      accountId: 'family-a',
      scanId: scan.id,
      questionId,
    })),
  });
}
beforeEach(async () => {
  store = new FamilyStore(':memory:');
  dir = await mkdtemp(join(tmpdir(), 'prism-admin-'));
  vi.stubEnv('FAMILY_DATA_DIR', dir);
  vi.stubEnv('FAMILY_PUBLIC_ORIGIN', origin);
  vi.stubEnv('FAMILY_REGISTRATION_ENABLED', 'true');
  const password = await hashPassword('test-password-1234');
  for (const [id, name, token] of [
    ['admin-id', 'admin', adminToken],
    ['family-a', 'family_a', userToken],
    ['family-b', 'family_b', 'c'.repeat(64)],
  ]) {
    store.db
      .prepare('INSERT INTO accounts VALUES (?,?,?,?)')
      .run(id, name, password, Date.now());
    store.db
      .prepare('INSERT INTO sessions VALUES (?,?,?)')
      .run(digest(token), id, Date.now() + 60000);
  }
  store.db
    .prepare('INSERT INTO platform_admins VALUES (?,?,0)')
    .run('admin-id', Date.now());
  store.db
    .prepare('INSERT INTO legacy_owners VALUES (?,?)')
    .run('family-a', 'legacy-owner');
  store.db
    .prepare('INSERT INTO students VALUES (?,?,?,?,?,?)')
    .run('family-a', 'student-a', '合成学生', '高二', '2026-10-01', null);
  const bytes = await sharp({
    create: { width: 100, height: 100, channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer();
  scan = {
    id: randomUUID(),
    studentId: 'student-a',
    subject: '数学',
    source: '合成单元测试',
    originalName: 'synthetic.png',
    mimeType: 'image/png',
    size: bytes.length,
    status: 'ready',
    createdAt: '2026-10-01T00:00:00Z',
    fileUrl: 'private',
    revision: 1,
    structuredQuestions: [q('q1'), q('q2')],
  };
  await saveScan('legacy-owner', scan, bytes, store);
});
afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
describe('platform administration', () => {
  it('rejects ordinary sessions, forged usernames and unsigned requests on every sensitive route', async () => {
    for (const path of [
      'overview',
      'accounts',
      'accounts/family-a',
      'questions',
      'question-image',
      'batches',
      'audit',
    ]) {
      expect((await call(path, undefined, userToken)).status).toBe(403);
      expect((await call(path, undefined, '')).status).toBe(401);
    }
    store.db.prepare('DELETE FROM platform_admins').run();
    expect((await call('accounts')).status).toBe(403);
  });
  it('requires initial password rotation and rejects short administrator passwords', async () => {
    store.db.prepare('UPDATE platform_admins SET must_change_password=1').run();
    expect((await call('session')).status).toBe(200);
    expect((await call('accounts')).status).toBe(428);
    expect(
      (
        await call('password', {
          currentPassword: 'test-password-1234',
          password: '123456',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('password', {
          currentPassword: 'test-password-1234',
          password: 'new-strong-password-5678',
        })
      ).status,
    ).toBe(200);
    expect((await call('session')).status).toBe(401);
    expect(
      store.db
        .prepare('SELECT must_change_password m FROM platform_admins')
        .get()?.m,
    ).toBe(0);
  });
  it('uses explicit safe profile fields and distinguishes users from administrators', async () => {
    const response = await call('overview');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({
      accounts: 3,
      users: 2,
      administrators: 1,
      questions: 2,
    });
    const data = await (await call('accounts')).text();
    expect(data).not.toContain('password');
    expect(data).not.toContain(adminToken);
    expect(data).not.toContain('token');
    expect(await (await call('accounts/family-a')).json()).toMatchObject({
      account: { username: 'family_a', questions: 2 },
      students: [{ id: 'student-a' }],
    });
  });
  it('filters and pages all questions by actual owner and student with no guessed legacy child', async () => {
    expect(
      await (await call('questions?accountId=family-a&subject=数学')).json(),
    ).toMatchObject({
      total: 2,
      items: [{ studentName: '合成学生' }, { studentName: '合成学生' }],
    });
    expect(
      await (await call('questions?accountId=family-b')).json(),
    ).toMatchObject({ total: 0 });
    expect(
      await (await call('questions?state=unanswered')).json(),
    ).toMatchObject({ total: 0 });
    expect(await (await call('questions?search=%25')).json()).toMatchObject({
      total: 0,
    });
    const changed = { ...scan, studentId: undefined };
    store.transaction(() =>
      writeStoredScan(store, 'legacy-owner', changed, 'synthetic'),
    );
    expect(await (await call('questions')).json()).toMatchObject({
      items: [
        { studentId: null, studentName: '归属待核对' },
        { studentId: null, studentName: '归属待核对' },
      ],
    });
  });
  it('checks origin for all management writes and cannot be granted by request body', async () => {
    expect(
      (
        await call(
          'batches',
          { title: 'x', items: [] },
          adminToken,
          'https://evil.example',
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          'batches',
          { role: 'admin', accountId: 'admin-id', title: 'x', items: [] },
          userToken,
        )
      ).status,
    ).toBe(403);
  });
  it('provisions only a new admin account without adopting another family', async () => {
    await expect(
      provisionAdmin(store, 'a-strong-password-123'),
    ).rejects.toThrow('已存在');
    store.db
      .prepare(
        "UPDATE accounts SET username='previous_admin' WHERE id='admin-id'",
      )
      .run();
    const created = await provisionAdmin(store, 'a-strong-password-123');
    expect(store.scanOwner(created.id)).toBe(created.id);
    expect(store.students(created.id)).toEqual([]);
    expect(
      store.db
        .prepare(
          'SELECT must_change_password m FROM platform_admins WHERE account_id=?',
        )
        .get(created.id)?.m,
    ).toBe(1);
  });
  it('reads the exact question crop for an authorized administrator', async () => {
    const response = await call(
      'question-image?' +
        new URLSearchParams({
          accountId: 'family-a',
          scanId: scan.id,
          questionId: 'q1',
        }),
    );
    expect(response.status).toBe(200);
    const info = await sharp(
      new Uint8Array(await response.arrayBuffer()),
    ).metadata();
    expect(info.width).toBe(100);
    expect(info.height).toBe(40);
  });
});
describe('selected-batch desktop review', () => {
  it('rejects applying a proposal after only the underlying image version has changed', async () => {
    const b = batch(), grant = createReviewToken(store, 'admin-id', b.id), item = b.items[0];
    const proposed = await (await external(`items/${item.id}/proposal`, grant.token, input(item))).json() as ReviewItem;
    writeStoredScan(store, 'legacy-owner', { ...scan, revision: 2, sourcePage: { documentId: 'synthetic-doc', photoId: 'synthetic-photo', title: '合成资料', subject: '数学', pageNumber: 1, pageCount: 1, revision: 1, scanSha256: 'a'.repeat(64) } }, 'synthetic');
    expect((await call(`batches/${b.id}/items/${item.id}/apply`, { proposalHash: proposed.proposalHash })).status).toBe(409);
  });
  it('exports all readable image parts only inside the selected batch', async () => {
    const b = batch(), grant = createReviewToken(store, 'admin-id', b.id), item = b.items[0];
    expect((await (await external('batch', grant.token)).json() as { imagePartsVersion: number }).imagePartsVersion).toBe(1);
    const response = await external(`items/${item.id}/images`, grant.token); expect(response.status).toBe(200);
    const data = await response.json() as { parts: { index: number; size: number }[] }; expect(data.parts).toHaveLength(1); expect(data.parts[0]).toMatchObject({ index: 0 });
    expect((await external(`items/${item.id}/image?part=0`, grant.token)).status).toBe(200);
    expect((await external(`items/${item.id}/image?part=1`, grant.token)).status).toBe(404);
    expect((await external(`items/${randomUUID()}/images`, grant.token)).status).toBe(404);
  });
  it('limits external grants to chosen items, redacts account identities, forbids publishing and cookie fallback', async () => {
    const b = batch(),
      grant = createReviewToken(store, 'admin-id', b.id),
      other = batch(['q2']);
    const read = await external('batch', grant.token);
    expect(read.status).toBe(200);
    const detail = await (
      await external('items/' + b.items[0].id, grant.token)
    ).text();
    expect(detail).not.toContain('family-a');
    expect(detail).not.toContain('student-a');
    expect(
      (await external('items/' + other.items[0].id, grant.token)).status,
    ).toBe(404);
    expect((await external('accounts', grant.token)).status).toBe(404);
    expect(
      (await external('items/' + b.items[0].id + '/apply', grant.token, {}))
        .status,
    ).toBe(404);
    expect((await external('batch', adminToken)).status).toBe(401);
    expect(
      (await external('items/' + b.items[0].id + '/image', grant.token)).status,
    ).toBe(200);
  });
  it('expires and revokes grants, including removing the issuing admin role', async () => {
    const b = batch(),
      g = createReviewToken(store, 'admin-id', b.id);
    store.db.prepare('UPDATE review_tokens SET expires_at=0').run();
    expect((await external('batch', g.token)).status).toBe(401);
    const second = createReviewToken(store, 'admin-id', b.id);
    store.db.prepare('DELETE FROM platform_admins').run();
    expect((await external('batch', second.token)).status).toBe(401);
  });
  it('keeps proposals separate until checked, applies two siblings, retains original geometry and supports safe rollback', async () => {
    const b = batch(['q1', 'q2']),
      g = createReviewToken(store, 'admin-id', b.id);
    const proposals: ReviewItem[] = [];
    for (const item of b.items)
      proposals.push(
        (await (
          await external('items/' + item.id + '/proposal', g.token, input(item))
        ).json()) as ReviewItem,
      );
    expect(readStoredScan(store, 'legacy-owner', scan.id)).toEqual(scan);
    for (const item of proposals)
      expect(
        (
          await call(`batches/${b.id}/items/${item.id}/apply`, {
            proposalHash: item.proposalHash,
          })
        ).status,
      ).toBe(200);
    const updated = readStoredScan(store, 'legacy-owner', scan.id)!;
    expect(updated.revision).toBe(3);
    expect(
      updated.structuredQuestions!.map(
        (q) => q.tutoring?.result?.referenceAnswer,
      ),
    ).toEqual(['1', '1']);
    expect(updated.structuredQuestions![0].regions).toEqual(
      scan.structuredQuestions![0].regions,
    );
    expect(updated.structuredQuestions![0].answerSteps).toEqual([]);
    expect(updated.structuredQuestions![0].wrongBook).toEqual(
      scan.structuredQuestions![0].wrongBook,
    );
    expect(updated.structuredQuestions![0].tutoring?.review?.status).toBe(
      'confirmed',
    );
    expect(
      (await call(`batches/${b.id}/items/${proposals[0].id}/rollback`, {}))
        .status,
    ).toBe(200);
    expect(
      readStoredScan(store, 'legacy-owner', scan.id)!.structuredQuestions![0],
    ).toEqual(scan.structuredQuestions![0]);
    expect(
      readStoredScan(store, 'legacy-owner', scan.id)!.structuredQuestions![1]
        .referenceAnswer,
    ).toBe('1');
  });
  it('is idempotent for lost submit/apply responses and requires the reviewed proposal hash', async () => {
    const b = batch(),
      item = b.items[0],
      g = createReviewToken(store, 'admin-id', b.id),
      path = `batches/${b.id}/items/${item.id}/apply`;
    const a = (await (
      await external('items/' + item.id + '/proposal', g.token, input(item))
    ).json()) as ReviewItem;
    const retry = (await (
      await external('items/' + item.id + '/proposal', g.token, input(item))
    ).json()) as ReviewItem;
    expect(retry.proposalHash).toBe(a.proposalHash);
    const changed = (await (
      await external(
        'items/' + item.id + '/proposal',
        g.token,
        input(item, 'different'),
      )
    ).json()) as ReviewItem;
    expect((await call(path, { proposalHash: a.proposalHash })).status).toBe(
      409,
    );
    expect(
      (await call(path, { proposalHash: changed.proposalHash })).status,
    ).toBe(200);
    expect(
      (await call(path, { proposalHash: changed.proposalHash })).status,
    ).toBe(200);
    expect(readStoredScan(store, 'legacy-owner', scan.id)!.revision).toBe(2);
  });
  it('rejects changed source conditions and active worker jobs without modifying originals', async () => {
    const b = batch(),
      item = b.items[0],
      g = createReviewToken(store, 'admin-id', b.id);
    const p = (await (
      await external('items/' + item.id + '/proposal', g.token, input(item))
    ).json()) as ReviewItem;
    const path = `batches/${b.id}/items/${item.id}/apply`;
    store.db
      .prepare(
        'INSERT INTO scan_jobs(id,account_id,owner,student_id,scan_id,revision,status,available_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(
        'job',
        'family-a',
        'legacy-owner',
        'student-a',
        scan.id,
        1,
        'queued',
        Date.now(),
        Date.now(),
      );
    expect((await call(path, { proposalHash: p.proposalHash })).status).toBe(
      409,
    );
    store.db.prepare('DELETE FROM scan_jobs').run();
    const changed = {
      ...scan,
      revision: 2,
      structuredQuestions: scan.structuredQuestions!.map((q) => ({
        ...q,
        prompt: '已修改',
      })),
    };
    store.transaction(() =>
      writeStoredScan(store, 'legacy-owner', changed, 'synthetic-change'),
    );
    expect((await call(path, { proposalHash: p.proposalHash })).status).toBe(
      409,
    );
    expect(readStoredScan(store, 'legacy-owner', scan.id)).toEqual(changed);
  });
  it('refuses rollback after a later edit and refuses submissions after closure', async () => {
    const b = batch(),
      item = b.items[0],
      g = createReviewToken(store, 'admin-id', b.id),
      base = `batches/${b.id}/items/${item.id}`;
    const p = (await (
      await external('items/' + item.id + '/proposal', g.token, input(item))
    ).json()) as ReviewItem;
    await call(base + '/apply', { proposalHash: p.proposalHash });
    const updated = readStoredScan(store, 'legacy-owner', scan.id)!;
    updated.structuredQuestions![0].prompt = '新题干';
    updated.revision++;
    store.transaction(() =>
      writeStoredScan(store, 'legacy-owner', updated, 'synthetic-edit'),
    );
    expect((await call(base + '/rollback', {})).status).toBe(409);
    expect((await call('batches/' + b.id + '/revoke', {})).status).toBe(200);
    expect((await external('batch', g.token)).status).toBe(401);
    expect((await call('batches/' + b.id + '/token', {})).status).toBe(409);
  });
  it('validates content, evidence references, selected IDs and fingerprint before accepting a proposal', async () => {
    const b = batch(),
      item = b.items[0],
      g = createReviewToken(store, 'admin-id', b.id),
      path = 'items/' + item.id + '/proposal';
    expect(
      (await external(path, g.token, { ...input(item), fingerprint: 'wrong' }))
        .status,
    ).toBe(409);
    expect(
      (await external(path, g.token, { ...input(item), role: 'admin' })).status,
    ).toBe(400);
    expect(
      (
        await external(path, g.token, {
          ...input(item),
          result: {
            ...input(item).result,
            errorHypotheses: [{ text: 'guess', evidenceIndexes: [5] }],
          },
        })
      ).status,
    ).toBe(400);
    expect(readBatch(store, b.id).items[0].status).toBe('pending');
  });
  it('updates a corrected prompt only when explicitly selected and invalidates dependent old explanations', async () => {
    scan.structuredQuestions![1].parentQuestionId = 'q1';
    scan.structuredQuestions![1].tutoring = {
      status: 'needs_review',
      result: {
        ...input({ fingerprint: '' } as ReviewItem).result,
        generatedAt: '2026-10-01',
        needsReview: true,
      },
    };
    store.transaction(() =>
      writeStoredScan(store, 'legacy-owner', scan, 'synthetic-parent'),
    );
    const b = batch(),
      item = b.items[0],
      g = createReviewToken(store, 'admin-id', b.id);
    const p = (await (
      await external('items/' + item.id + '/proposal', g.token, {
        ...input(item),
        result: {
          ...input(item).result,
          transcribedPrompt: '纠正后的共同题干：x + 2 = 3',
        },
      })
    ).json()) as ReviewItem;
    expect(
      (
        await call(`batches/${b.id}/items/${item.id}/apply`, {
          proposalHash: p.proposalHash,
          updatePrompt: true,
        })
      ).status,
    ).toBe(200);
    const updated = readStoredScan(store, 'legacy-owner', scan.id)!;
    expect(updated.structuredQuestions![0].prompt).toContain('纠正后的');
    expect(updated.structuredQuestions![1].confirmed).toBe(false);
    expect(updated.structuredQuestions![1].tutoring?.status).toBe('stale');
  });
  it('does not substitute the transcription by default', async () => {
    const b = batch(),
      item = b.items[0],
      g = createReviewToken(store, 'admin-id', b.id);
    const p = (await (
      await external('items/' + item.id + '/proposal', g.token, {
        ...input(item),
        result: { ...input(item).result, transcribedPrompt: '其他题干' },
      })
    ).json()) as ReviewItem;
    await call(`batches/${b.id}/items/${item.id}/apply`, {
      proposalHash: p.proposalHash,
    });
    expect(
      readStoredScan(store, 'legacy-owner', scan.id)!.structuredQuestions![0]
        .prompt,
    ).toBe(scan.structuredQuestions![0].prompt);
  });
  it('password change revokes desktop grants', async () => {
    const b = batch(),
      g = createReviewToken(store, 'admin-id', b.id);
    expect(
      (
        await call('password', {
          currentPassword: 'test-password-1234',
          password: 'another-password-789',
        })
      ).status,
    ).toBe(200);
    expect((await external('batch', g.token)).status).toBe(401);
    const login = await handleFamily(
      new Request(origin + '/family-learning/api/family/login', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'admin',
          password: 'another-password-789',
        }),
      }),
      'login',
      store,
    );
    expect(login.status).toBe(200);
  });
});
