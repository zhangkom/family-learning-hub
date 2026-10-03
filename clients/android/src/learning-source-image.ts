import type { LearningSession } from '../../../lib/learning-session';
import type { Scan } from './types';

export function learningSourceSnapshot(current: Scan | undefined, session: LearningSession | null): Scan | undefined {
  if (!current || !session) return undefined;
  const questionHash = session.sourceQuestions?.find(question => question.id === session.source.questionId)?.sourcePage?.scanSha256;
  if (!session.sourceImage && current.sourcePage?.scanSha256 && questionHash !== current.sourcePage.scanSha256) return undefined;
  return { ...current, ...session.sourceImage,
    // Missing historical fields must not inherit a current image revision's metadata.
    sourcePage: session.sourceImage ? session.sourceImage.sourcePage : current.sourcePage,
    sourceKind: session.sourceImage ? session.sourceImage.sourceKind : current.sourceKind,
    // The server validates fixed-length coordinates; the native reader validates them again.
    processing: (session.sourceImage ? session.sourceImage.processing : current.processing) as Scan['processing'],
    imageRevision: session.sourceImage?.sourcePage?.scanSha256 ? undefined : session.source.revision,
    questions: session.sourceQuestions || current.questions };
}
