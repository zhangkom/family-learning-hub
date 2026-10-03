import { afterEach, describe, expect, it, vi } from 'vitest';
import { FamilyApi } from './api';
import type { Scan } from './types';

afterEach(() => vi.unstubAllGlobals());
const scan = { id: 'scan-a', studentId: 'student-a', revision: 7 } as Scan;
const input = { decision: 'focus' as const, materialStatus: 'incomplete' as const, reason: '蓝星为人工指定重点，续页仍待补全' };
describe('manual collection protocol', () => {
  it('requires server capability and never silently falls back to editing confirmation', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetch);
    await expect(new FamilyApi('https://synthetic.invalid').reviewCollection(scan, 'q', input)).rejects.toThrow('家庭服务需要升级');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('binds a human decision to exact student, scan, question and current revision', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{"collectionReviewVersion":1}', { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ scan }), { status: 200 })); vi.stubGlobal('fetch', fetch);
    await new FamilyApi('https://synthetic.invalid').reviewCollection(scan, 'q / 1', input);
    const [url, options] = fetch.mock.calls[1];
    expect(url).toBe('https://synthetic.invalid/scans/scan-a/questions/q%20%2F%201/collection-review');
    expect(options.method).toBe('POST'); expect(JSON.parse(options.body)).toEqual({ ...input, revision: 7, studentId: 'student-a' });
  });
  it('persists user stars with the same strict context and abort signal', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{"questionDifficultyVersion":1}', { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ scan }), { status: 200 })); vi.stubGlobal('fetch', fetch);
    await new FamilyApi('https://synthetic.invalid').setQuestionDifficulty(scan, 'q', 1, new AbortController().signal);
    expect(fetch.mock.calls[1][0]).toContain('/scans/scan-a/questions/q/difficulty');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ studentId: 'student-a', revision: 7, stars: 1 });
  });
  it('does not send a difficulty mutation to an older server', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetch);
    await expect(new FamilyApi('https://synthetic.invalid').setQuestionDifficulty(scan, 'q', 5)).rejects.toThrow('家庭服务需要升级');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
