import { describe, expect, it } from 'vitest';
import {
  buildReviewDates,
  createWrongQuestion,
  evaluateAnswer,
  normalizeEnglishAnswer,
  parseStoredStringList,
  parseStoredWrongQuestions,
} from './learning';

describe('answer evaluation', () => {
  it('ignores harmless spaces in a mathematical answer', () => {
    expect(evaluateAnswer(' x = - 3 ', ['x=-3'], 'math')).toBe(true);
  });

  it('normalizes English case, spacing and sentence punctuation', () => {
    expect(normalizeEnglishAnswer('  She   goes to school。 ')).toBe(
      'she goes to school',
    );
    expect(
      evaluateAnswer('She goes to school.', ['she goes to school'], 'english'),
    ).toBe(true);
  });

  it('rejects a genuinely different answer', () => {
    expect(
      evaluateAnswer('she go to school', ['she goes to school'], 'english'),
    ).toBe(false);
  });
});

describe('wrong-question loop', () => {
  it('keeps the original source and the learner answer', () => {
    const entry = createWrongQuestion({
      questionId: 'math-rational-01',
      subject: '数学',
      knowledgePoint: '有理数减法',
      prompt: '计算：-2-(-5)',
      answer: '3',
      learnerAnswer: '-7',
      source: '双宝题库 · 初一数学 · 有理数专项 01',
      now: new Date('2026-08-31T08:00:00.000Z'),
    });

    expect(entry.source).toBe('双宝题库 · 初一数学 · 有理数专项 01');
    expect(entry.learnerAnswer).toBe('-7');
    expect(entry.status).toBe('待重做');
  });

  it('schedules reviews on day 2, 7 and 30', () => {
    expect(buildReviewDates(new Date('2026-08-31T08:00:00.000Z'))).toEqual([
      '2026-09-02',
      '2026-09-07',
      '2026-09-30',
    ]);
  });

  it('rejects malformed local wrong-question data instead of crashing the page', () => {
    expect(parseStoredWrongQuestions('{"not":"an array"}')).toEqual([]);
    expect(parseStoredWrongQuestions('[{"id":"incomplete"}]')).toEqual([]);
    expect(parseStoredWrongQuestions('broken json')).toEqual([]);
  });

  it('accepts a valid stored wrong question and limits stored string lists', () => {
    const entry = createWrongQuestion({
      questionId: 'safe-1',
      subject: '物理',
      knowledgePoint: '电场强度',
      prompt: '求场强',
      answer: '2 N/C',
      learnerAnswer: '1 N/C',
      source: '双宝原创',
      now: new Date('2026-08-31T08:00:00.000Z'),
    });

    expect(parseStoredWrongQuestions(JSON.stringify([entry]))).toEqual([entry]);
    expect(
      parseStoredStringList(JSON.stringify(['a', 'a', 2, 'b']), 2),
    ).toEqual(['a', 'b']);
  });
});
