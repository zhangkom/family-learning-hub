import type { Scan } from './types';
import { questionCollectionState } from '../../../lib/question-collection';

export function needsQuestionReview(question: Scan['questions'][number]) {
  const state = questionCollectionState(question);
  return !question.confirmed || state.collectionPending || state.materialPending;
}

export function needsPhotoReview(scan: Scan) {
  return !scan.questions.length || scan.questions.some(needsQuestionReview);
}
