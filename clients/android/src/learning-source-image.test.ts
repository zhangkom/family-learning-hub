import { describe, expect, it } from 'vitest';
import { learningSourceSnapshot } from './learning-source-image';
import type { LearningSession } from '../../../lib/learning-session';
import type { Scan } from './types';

const current = { id: 'scan', studentId: 'student', size: 200, mimeType: 'image/jpeg', revision: 9, sourcePage: { scanSha256: 'b'.repeat(64) }, processing: { sha256: 'b'.repeat(64) }, questions: [{ id: 'q', regions: [{ id: 'new-region' }] }] } as Scan;
describe('learning image versions and original question regions', () => {
  it('uses complete old metadata and old regions instead of mixing a new image with old question coordinates', () => {
    const session = { source: { revision: 1, questionId: 'q' }, sourceImage: { size: 100, mimeType: 'image/png', sourcePage: { scanSha256: 'a'.repeat(64) } }, sourceQuestions: [{ id: 'q', regions: [{ id: 'old-region' }] }] } as LearningSession;
    const snapshot = learningSourceSnapshot(current, session)!;
    expect(snapshot.size).toBe(100); expect(snapshot.mimeType).toBe('image/png'); expect(snapshot.sourcePage?.scanSha256).toBe('a'.repeat(64));
    expect(snapshot.processing).toBeUndefined(); expect(snapshot.questions[0].regions[0].id).toBe('old-region'); expect(snapshot.imageRevision).toBeUndefined();
  });
  it('hashless snapshots explicitly clear current hash/processing and select the historical revision', () => {
    const session = { source: { revision: 2, questionId: 'q' }, sourceImage: { size: 150, mimeType: 'image/jpeg' }, sourceQuestions: [] } as unknown as LearningSession;
    const snapshot = learningSourceSnapshot(current, session)!;
    expect(snapshot.imageRevision).toBe(2); expect(snapshot.sourcePage).toBeUndefined(); expect(snapshot.processing).toBeUndefined(); expect(snapshot.size).toBe(150);
  });
  it('does not show unverifiable historic regions against a revised current image from an old server', () => {
    const session = { source: { revision: 2, questionId: 'q' }, sourceQuestions: [{ id: 'q' }] } as LearningSession;
    expect(learningSourceSnapshot(current, session)).toBeUndefined();
  });
});
