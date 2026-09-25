import { describe, expect, it } from 'vitest';
import {
  studyLessons,
  findStudyLesson,
  lessonForQuestion,
} from './study-catalog';
import { findPracticeSheet, validatePracticeCatalog } from './practice';

describe('four-week teaching content', () => {
  it('links every method lesson to a printable sheet with the same question IDs', () => {
    for (const lesson of studyLessons) {
      const sheet = findPracticeSheet(`method-${lesson.id}`);
      expect(sheet).toBeDefined();
      expect(sheet?.questions.map((q) => q.id)).toEqual(
        lesson.questions.map((q) => q.id),
      );
      expect(validatePracticeCatalog([sheet!])).toEqual([]);
    }
  });
  it('contains twenty junior cards with geography and eight senior method cards', () => {
    expect(studyLessons.filter((l) => l.child === 'xiaobao')).toHaveLength(20);
    expect(studyLessons.filter((l) => l.child === 'dabao')).toHaveLength(8);
    for (let week = 1; week <= 4; week++) {
      const junior = studyLessons.filter(
        (l) => l.child === 'xiaobao' && l.week === week,
      );
      expect(junior).toHaveLength(5);
      expect(junior.filter((l) => l.subject === '数学')).toHaveLength(3);
      expect(junior.filter((l) => l.subject === '地理')).toHaveLength(1);
      expect(junior.filter((l) => l.subject === '英语')).toHaveLength(1);
    }
  });
  it('has stable unique IDs, bounded answer keys, explanations and original variant/review questions', () => {
    expect(new Set(studyLessons.map((l) => l.id)).size).toBe(
      studyLessons.length,
    );
    const ids = new Set<string>();
    for (const l of studyLessons) {
      expect(l.questions).toHaveLength(4);
      expect(l.steps.length).toBeGreaterThanOrEqual(3);
      expect(l.reference.url).toMatch(/^https:\/\//);
      for (const q of l.questions) {
        expect(ids.has(q.id)).toBe(false);
        ids.add(q.id);
        expect(Number.isInteger(q.correct)).toBe(true);
        expect(q.correct).toBeGreaterThanOrEqual(0);
        expect(q.correct).toBeLessThan(q.options.length);
        expect(q.explanation.length).toBeGreaterThan(5);
        expect(lessonForQuestion(q.id)?.id).toBe(l.id);
      }
    }
    expect(findStudyLesson('missing')).toBeUndefined();
  });
  it('independently verifies the two algebra identities over their applicable values', () => {
    for (const a of [-9, -3, -1]) expect(2 * Math.abs(a) + 3 * a).toBe(a);
    for (const a of [2.1, 3, 4.9])
      expect(Math.abs(a - 2) + Math.abs(a - 5)).toBeCloseTo(3);
    for (const a of [-3, 0, 2, 9])
      expect(3 * Math.abs(a - 2) - Math.abs(2 - a)).toBeCloseTo(
        2 * Math.abs(a - 2),
      );
    expect(findStudyLesson('xb-abs-sign')?.questions[0].options[2]).toBe('a');
  });
});
