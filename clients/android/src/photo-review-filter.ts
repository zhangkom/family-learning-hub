import type { Scan } from './types';

export function needsPhotoReview(scan: Scan) {
  return !scan.questions.length || scan.questions.some(question => !question.confirmed || question.paperMark?.classification === 'pending');
}
