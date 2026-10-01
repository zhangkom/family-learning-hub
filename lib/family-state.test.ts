import { describe, expect, it } from 'vitest';
import { createWrongQuestion } from './learning';
import {
  emptyFamily,
  mergeFamily,
  parseBackup,
  validateFamily,
} from './family-state';
const wrong = (day: string, answer: string) =>
  createWrongQuestion({
    questionId: 'question-1',
    subject: '数学',
    knowledgePoint: '绝对值',
    prompt: '|-2|=?',
    answer: '2',
    learnerAnswer: answer,
    source: '原创',
    now: new Date(day),
  });
describe('cross-device record merging', () => {
  it('keeps the earliest failure and every later attempt in either upload order', () => {
    const a = emptyFamily(),
      b = emptyFamily();
    a.xiaobao.wrong = [wrong('2026-09-01', '-2')];
    b.xiaobao.wrong = [wrong('2026-09-03', '0')];
    a.xiaobao.attempts = [
      {
        lessonId: 'lesson',
        questionId: 'question-1',
        answer: '-2',
        correct: false,
        assisted: false,
        mode: 'practice',
        at: '2026-09-01T01:00:00Z',
      },
    ];
    b.xiaobao.attempts = [
      {
        ...a.xiaobao.attempts[0],
        answer: '2',
        correct: true,
        at: '2026-09-03T01:00:00Z',
      },
    ];
    const merged = mergeFamily(b, a);
    expect(merged).toEqual(mergeFamily(a, b));
    expect(merged.xiaobao.wrong[0].learnerAnswer).toBe('-2');
    expect(merged.xiaobao.attempts).toHaveLength(2);
    expect(mergeFamily(merged, a)).toEqual(merged);
    expect(merged.dabao.wrong).toHaveLength(0);
  });
  it('retains unchecked task tombstones when an offline device sends an older snapshot', () => {
    const a = emptyFamily(),
      b = emptyFamily();
    a.dabao.weekly = [{ id: 'math', done: true, at: 10, nonce: 'a' }];
    b.dabao.weekly = [{ id: 'math', done: false, at: 11, nonce: 'b' }];
    a.dabao.completed = ['sheet1'];
    b.dabao.completed = ['sheet2'];
    expect(mergeFamily(b, a).dabao.weekly[0].done).toBe(false);
    expect(mergeFamily(a, b).dabao.completed).toEqual(['sheet1', 'sheet2']);
  });
  it('rejects malformed backups and excessive history without dropping valid data', () => {
    expect(() => parseBackup({ version: 2 })).toThrow();
    const s = emptyFamily();
    s.xiaobao.wrong = [wrong('2026-09-01', '-2')];
    expect(
      parseBackup({ app: 'family-learning-hub', version: 1, records: s }),
    ).toEqual(s);
    expect(() =>
      validateFamily({
        ...s,
        dabao: { ...s.dabao, weekly: [{ id: '__proto__', done: 'true' }] },
      }),
    ).toThrow();
    expect(() =>
      validateFamily({
        ...s,
        dabao: { ...s.dabao, completed: Array(2001).fill('a') },
      }),
    ).toThrow();
  });
});
