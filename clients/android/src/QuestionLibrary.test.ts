import { describe, expect, it } from 'vitest';
import { orderedWrongQuestions } from './wrong-book-order';
import type { Scan } from './types';
const scans = [
  { id: 'old', createdAt: '2026-09-01T00:00:00Z', questions: [{ id: 'old-math', subject: '数学', wrongBook: { savedAt: '2026-10-02T00:00:00Z' } }] },
  { id: 'new', createdAt: '2026-10-01T00:00:00Z', questions: [
    { id: 'new-physics', subject: '物理', wrongBook: { savedAt: '2026-10-01T00:00:00Z' } },
    { id: 'uncollected', subject: '数学' },
    { id: 'new-math', subject: '数学', wrongBook: { savedAt: '2026-10-01T00:00:00Z' } },
  ] },
] as Scan[];
describe('wrong book upload order', () => {
  it('includes focus-only questions and deduplicates questions carrying both collection types', () => {
    const mixed = [{ ...scans[0], questions: [
      { ...scans[0].questions[0], id: 'focus', wrongBook: undefined, focusBook: { savedAt: '2026-10-03T00:00:00Z' } },
      { ...scans[0].questions[0], id: 'both', focusBook: { savedAt: '2026-10-03T00:00:00Z' } },
      { ...scans[0].questions[0], id: 'pending', wrongBook: undefined },
    ] }];
    const ordered = orderedWrongQuestions(mixed);
    expect(ordered.map(item => item.question.id)).toEqual(['focus', 'both']);
    expect(ordered.filter(item => item.question.wrongBook).map(item => item.question.id)).toEqual(['both']);
  });
  it('sorts uploads, ignoring later collection dates and retaining within-photo order', () => {
    expect(orderedWrongQuestions(scans).map(x => x.question.id)).toEqual(['new-physics', 'new-math', 'old-math']);
    expect(scans[0].id).toBe('old');
  });
  it('filters subjects from the same ordering, excluding uncollected questions', () => {
    expect(orderedWrongQuestions(scans).filter(x => x.question.subject === '数学').map(x => x.question.id)).toEqual(['new-math', 'old-math']);
  });
  it('reverses upload dates, keeping within-photo sequence intact', () => {
    expect(orderedWrongQuestions(scans, 'oldest').map(x => x.question.id)).toEqual(['old-math', 'new-physics', 'new-math']);
  });
  it('has stable order for tied or unknown historical timestamps', () => {
    const tied = scans.map(scan => ({ ...scan, createdAt: 'unknown' }));
    expect(orderedWrongQuestions(tied).map(x => x.question.id)).toEqual(['old-math', 'new-physics', 'new-math']);
  });
});
