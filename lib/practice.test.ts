import { describe, expect, it } from 'vitest';
import {
  buildWrongQuestionFromPractice,
  findPracticeSheet,
  juniorMathChapterOne,
  markPracticeComplete,
  mergePracticeWrongQuestions,
  recordWorksheetMistakes,
  seniorGradeTwoStarters,
  validatePracticeCatalog,
} from './practice';

describe('printable practice catalog', () => {
  it('provides eight progressive worksheets for junior math chapter one', () => {
    expect(juniorMathChapterOne).toHaveLength(8);
    expect(new Set(juniorMathChapterOne.map((sheet) => sheet.id)).size).toBe(8);
    expect(juniorMathChapterOne.map((sheet) => sheet.sequence)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
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
    const issues = validatePracticeCatalog([
      ...juniorMathChapterOne,
      ...seniorGradeTwoStarters,
    ]);
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
  it('records only actual paper mistakes as conservative learning evidence', () => {
    const sheet = findPracticeSheet('method-xb-abs-box')!;
    const now = new Date('2026-09-25T08:00:00Z');
    const attempts = recordWorksheetMistakes(
      [],
      sheet,
      [sheet.questions[0].id],
      now,
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      lessonId: 'xb-abs-box',
      questionId: sheet.questions[0].id,
      correct: false,
      assisted: true,
      origin: 'paper',
      at: now.toISOString(),
    });
    expect(recordWorksheetMistakes(attempts, sheet, [], now)).toEqual(attempts);
    expect(
      recordWorksheetMistakes(
        [],
        juniorMathChapterOne[0],
        [juniorMathChapterOne[0].questions[0].id],
        now,
      ),
    ).toEqual([]);
  });
  it('preserves the original failure when grading a linked method worksheet', () => {
    const sheet = findPracticeSheet('method-xb-abs-box')!;
    const first = buildWrongQuestionFromPractice(
      sheet,
      sheet.questions[0],
      '第一次选了5a',
      new Date('2026-09-20T08:00:00Z'),
    );
    const merged = mergePracticeWrongQuestions(
      [first],
      sheet,
      [sheet.questions[0].id, sheet.questions[1].id],
      new Date('2026-09-25T08:00:00Z'),
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((item) => item.questionId === first.questionId)).toEqual(
      first,
    );
  });

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
    expect(entry.reviewDates).toEqual([
      '2026-09-02',
      '2026-09-07',
      '2026-09-30',
    ]);
  });

  it('replaces an earlier record for the same question instead of duplicating it', () => {
    const sheet = juniorMathChapterOne[0];
    const first = buildWrongQuestionFromPractice(
      sheet,
      sheet.questions[0],
      '第一次批改',
      new Date('2026-08-30T08:00:00.000Z'),
    );
    const merged = mergePracticeWrongQuestions(
      [first],
      sheet,
      [sheet.questions[0].id, sheet.questions[1].id],
      new Date('2026-08-31T08:00:00.000Z'),
    );

    expect(merged).toHaveLength(2);
    expect(
      merged.filter((item) => item.questionId === sheet.questions[0].id),
    ).toHaveLength(1);
    expect(merged[0].learnerAnswer).toContain('家长批改');
  });

  it('marks a worksheet complete only once', () => {
    expect(markPracticeComplete(['page-1'], 'page-1')).toEqual(['page-1']);
    expect(markPracticeComplete(['page-1'], 'page-2')).toEqual([
      'page-1',
      'page-2',
    ]);
  });
});
