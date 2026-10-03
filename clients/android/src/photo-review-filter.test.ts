import { describe, expect, it } from 'vitest';
import { needsPhotoReview, needsQuestionReview } from './photo-review-filter';
import type { Question, Scan } from './types';

const pending = { confirmed: true, paperMark: { classification: 'pending' } } as Question;
const review = { decision: 'wrong', materialStatus: 'complete', reason: '已核对完整题图', reviewedAt: '2026-10-03', actorAccountId: 'synthetic', sourceRevision: 2, status: 'current' } as const;
describe('manual collection and pending material stay distinct', () => {
  it('does not clear original pending just by confirming text', () => { expect(needsQuestionReview(pending)).toBe(true); });
  it('updates pending state from a current explicit complete review while preserving original evidence', () => {
    const q = { ...pending, collectionReview: review }; expect(needsQuestionReview(q)).toBe(false);
    expect(q.paperMark?.classification).toBe('pending'); expect(needsPhotoReview({ questions: [q] } as Scan)).toBe(false);
  });
  it('keeps incomplete and stale human decisions pending, including not-collected material', () => {
    expect(needsQuestionReview({ ...pending, collectionReview: { ...review, materialStatus: 'incomplete' } })).toBe(true);
    expect(needsQuestionReview({ ...pending, collectionReview: { ...review, decision: 'none', materialStatus: 'incomplete' } })).toBe(true);
    expect(needsQuestionReview({ ...pending, collectionReview: { ...review, status: 'stale' } })).toBe(true);
    expect(needsQuestionReview({ ...pending, collectionReview: { ...review, decision: 'none' } })).toBe(false);
  });
});
