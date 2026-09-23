import { describe, expect, it } from 'vitest';
import { createWrongQuestion, parseStoredWrongQuestions } from './learning';
import { getStudyStatus, parseStudyAttempts, recordStudyAttempt, type StudyAttempt } from './study';

const attempt = (overrides: Partial<StudyAttempt> = {}): StudyAttempt => ({
  lessonId: 'xb-abs-box', questionId: 'xb-abs-box-q1', answer: 'b',
  correct: true, assisted: false, mode: 'practice', at: '2026-09-23T10:00:00.000Z', ...overrides,
});

describe('method learning evidence', () => {
  it('does not mark a viewed lesson or a hinted answer as independent', () => {
    expect(getStudyStatus([], 'xb-abs-box').label).toBe('还没练');
    expect(getStudyStatus([attempt({ assisted: true })], 'xb-abs-box').label).toBe('需要提示');
    expect(getStudyStatus([attempt()], 'xb-abs-box').label).toBe('继续练习');
  });
  it('requires two different independent questions and a later fresh review', () => {
    const evidence = [attempt(), attempt({ questionId: 'xb-abs-box-q2' })];
    expect(getStudyStatus(evidence, 'xb-abs-box').label).toBe('独立完成');
    expect(getStudyStatus(evidence, 'xb-abs-box').dueOn).toBe('2026-09-25');
    const early = attempt({ questionId: 'xb-abs-box-q4', mode: 'review' });
    expect(getStudyStatus([...evidence, early], 'xb-abs-box').label).toBe('独立完成');
    const later = { ...early, at: '2026-09-25T10:00:00.000Z' };
    expect(getStudyStatus([...evidence, later], 'xb-abs-box').label).toBe('隔时迁移通过');
    expect(getStudyStatus([...evidence, later, attempt({ correct: false, at: '2026-09-26T10:00:00Z' })], 'xb-abs-box').label).toBe('需要提示');
  });
  it('keeps a first wrong answer and every later attempt without duplicate wrong cards', () => {
    const wrong = createWrongQuestion({ questionId: 'xb-abs-box-q1', subject: '数学', knowledgePoint: '绝对值', prompt: '题目', answer: '正确', learnerAnswer: '第一次错误', source: '双宝原创' });
    const first = recordStudyAttempt([], [], attempt({ correct: false }), wrong);
    const second = recordStudyAttempt(first.attempts, first.wrongQuestions, attempt({ correct: false }), { ...wrong, learnerAnswer: '第二次错误' });
    const third = recordStudyAttempt(second.attempts, second.wrongQuestions, attempt());
    expect(third.attempts).toHaveLength(3);
    expect(third.wrongQuestions).toHaveLength(1);
    expect(third.wrongQuestions[0].learnerAnswer).toBe('第一次错误');
    expect(recordStudyAttempt([], [], attempt()).wrongQuestions).toEqual([]);
  });
  it('accepts geography in the existing wrong book and rejects malformed attempt data', () => {
    const geo = createWrongQuestion({ questionId: 'geo-1', subject: '地理', knowledgePoint: '经纬度', prompt: '题目', answer: '北纬', learnerAnswer: '南纬', source: '双宝原创' });
    expect(parseStoredWrongQuestions(JSON.stringify([geo]))).toHaveLength(1);
    expect(parseStudyAttempts('not json')).toEqual([]);
    expect(parseStudyAttempts(JSON.stringify([{ ...attempt(), correct: 'yes' }, { ...attempt(), at: 'bad' }, attempt()]))).toEqual([attempt()]);
  });
});
