import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuestionDifficulty } from './QuestionDifficulty';
import { orderedWrongQuestions } from './wrong-book-order';
import type { Question, Scan } from './types';

const question = { id: 'q', wrongBook: { savedAt: '2026-10-03' } } as Question;
const scan = { id: 's', studentId: 'a', revision: 1, questions: [question] } as Scan;
describe('question difficulty', () => {
  it('renders all five exact accessible targets and default 3 stars', () => {
    const html = renderToStaticMarkup(<QuestionDifficulty scan={scan} question={question} />);
    for (let n = 1; n <= 5; n++) expect(html).toContain(`aria-label="难度 ${n} 星"`);
    expect(html).toContain('aria-label="难度 3 星" aria-pressed="true"'); expect(html).toContain('3 星 · 默认');
  });
  it('shows explicit user stars without the default label', () => {
    const html = renderToStaticMarkup(<QuestionDifficulty scan={scan} question={{ ...question, difficulty: { stars: 5, source: 'user', updatedAt: '2026-10-03' } }} />);
    expect(html).toContain('aria-label="难度 5 星" aria-pressed="true"'); expect(html).not.toContain('默认');
  });
  it('sorts high/low by the same stars as display, retaining upload order for ties and omitting uncollected', () => {
    const records = [
      { ...scan, id: 'old', createdAt: '2026-09-01', questions: [{ ...question, id: 'five', difficulty: { stars: 5 as const, source: 'user' as const, updatedAt: '2026-10-03' } }] },
      { ...scan, id: 'new', createdAt: '2026-10-01', questions: [{ ...question, id: 'default-a' }, { ...question, id: 'default-b' }, { ...question, id: 'uncollected', wrongBook: undefined }] },
    ];
    expect(orderedWrongQuestions(records, 'hardest').map(row => row.question.id)).toEqual(['five','default-a','default-b']);
    expect(orderedWrongQuestions(records, 'easiest').map(row => row.question.id)).toEqual(['default-a','default-b','five']);
  });
});
