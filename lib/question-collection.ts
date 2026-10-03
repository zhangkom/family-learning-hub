export type CollectionDecision = 'wrong' | 'focus' | 'both' | 'none' | 'pending';
export type CollectionReviewInput = {
  studentId: string;
  revision: number;
  decision: CollectionDecision;
  materialStatus: 'complete' | 'incomplete';
  reason: string;
  /** Concrete check or repair evidence, required when declaring complete. */
  materialEvidence?: string;
};
export type QuestionCollectionReview = Omit<CollectionReviewInput, 'revision' | 'studentId'> & {
  reviewedAt: string;
  actorAccountId: string;
  sourceRevision: number;
  status: 'current' | 'stale';
};
type CollectionSource = {
  paperMark?: { classification: 'wrong' | 'focus' | 'both' | 'pending' };
  collectionReview?: QuestionCollectionReview;
  wrongBook?: { savedAt: string };
  focusBook?: { savedAt: string };
};

/** Paper evidence stays immutable; a separate human decision controls collection. */
export function questionCollectionState(question: CollectionSource) {
  const review = question.collectionReview;
  const decision: CollectionDecision = review?.decision ?? (question.wrongBook && question.focusBook ? 'both' : question.wrongBook ? 'wrong' : question.focusBook ? 'focus' : question.paperMark?.classification === 'pending' ? 'pending' : 'none');
  const reviewStale = review?.status === 'stale';
  return {
    decision,
    collectionPending: decision === 'pending' || Boolean(reviewStale && decision !== 'none'),
    materialPending: review ? reviewStale || review.materialStatus === 'incomplete' : question.paperMark?.classification === 'pending',
    reviewStale,
  };
}
