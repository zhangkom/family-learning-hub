import type { Scan } from './types';

export type QuestionImageRecord = Pick<Scan, 'id' | 'studentId' | 'sourceKind' | 'processing' | 'size' | 'mimeType' | 'sourcePage' | 'imageRevision'>;
export function questionImageHash(scan: QuestionImageRecord) { return scan.sourcePage?.scanSha256 || scan.processing?.sha256; }
/** Editing text is not an image change; a derived image revision is. */
export function questionImageIdentity(scan: QuestionImageRecord) {
  return JSON.stringify([scan.studentId, scan.id, scan.size, scan.mimeType, questionImageHash(scan) || null, questionImageHash(scan) ? null : scan.imageRevision ?? null]);
}
