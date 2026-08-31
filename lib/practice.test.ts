import { describe, expect, it } from 'vitest';
import {
  buildWrongQuestionFromPractice,
  findPracticeSheet,
  juniorMathChapterOne,
  seniorGradeTwoStarters,
  validatePracticeCatalog,
} from './practice';

describe('printable practice catalog', () => {
  it('provides eight progressive worksheets for junior math chapter one', () => {
    expect(juniorMathChapterOne).toHaveLength(8);
    expect(new Set(juniorMathChapterOne.map((sheet) => sheet.id)).size).toBe(8);
    expect(juniorMathChapterOne.map((sheet) => sheet.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('starts senior grade two with math, physics, chemistry and biology', () => {
    expect(seniorGradeTwoStarters.map((sheet) => sheet.subject)).toEqual([
      '数学',
      '物理',
      '化学',
      '生物',
    ]);
  });

  it('keeps every printable sheet commercially traceable and teachable', () => {
    const issues = validatePracticeCatalog([...juniorMathChapterOne, ...seniorGradeTwoStarters]);
    expect(issues).toEqual([]);

    for (const sheet of [...juniorMathChapterOne, ...seniorGradeTwoStarters]) {
      expect(sheet.questions.length).toBeGreaterThanOrEqual(5);
      for (const question of sheet.questions) {
        expect(question.source).toContain('双宝原创');
        expect(question.answer.length).toBeGreaterThan(0);
        expect(question.explanation.length).toBeGreaterThan(0);
      }
    }
  });

  it('finds a sheet by id and returns undefined for unknown ids', () => {
    expect(findPracticeSheet('g7-math-1-01')?.title).toBe('立体图形会分类');
    expect(findPracticeSheet('missing')).toBeUndefined();
  });
});

describe('practice to wrong-question loop', () => {
  it('keeps the worksheet source and schedules spaced reviews', () => {
    const sheet = juniorMathChapterOne[0];
    const question = sheet.questions[0];
    const entry = buildWrongQuestionFromPractice(
      sheet,
      question,
      '纸笔作答，家长批改标记为错题',
      new Date('2026-08-31T08:00:00.000Z'),
    );

    expect(entry.questionId).toBe(question.id);
    expect(entry.subject).toBe('数学');
    expect(entry.source).toBe(question.source);
    expect(entry.reviewDates).toEqual(['2026-09-02', '2026-09-07', '2026-09-30']);
  });
});
