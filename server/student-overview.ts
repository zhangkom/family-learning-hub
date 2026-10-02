import type { FamilyStore } from './family-store';
import { listScans } from './scan-files';
import { questionsOf } from './mobile-service';

// Counts only: keep photo bytes and question bodies out of the profile response.
export async function studentOverview(store: FamilyStore, accountId: string) {
  const students = store.students(accountId).map(student => ({ ...student, overview: {
    scanCount: 0, questionCount: 0, wrongQuestionCount: 0, needsReviewCount: 0, cloudPhotoCount: 0,
  } }));
  const byId = new Map(students.map(student => [student.id, student]));
  let unassignedScanCount = 0;
  for (const scan of await listScans(store.scanOwner(accountId), store)) {
    if (scan.deletedAt) continue;
    // Missing ownership does not establish which child owns a historical photo.
    const student = byId.get(scan.studentId || scan.child || '');
    if (!student) { unassignedScanCount++; continue; }
    const questions = questionsOf(scan);
    student.overview.scanCount++;
    student.overview.questionCount += questions.length;
    student.overview.wrongQuestionCount += questions.filter(question => question.wrongBook).length;
    if (scan.status === 'needs_review') student.overview.needsReviewCount++;
  }
  for (const row of store.db.prepare('SELECT student_id, COUNT(*) AS total FROM cloud_photos WHERE account_id=? GROUP BY student_id').all(accountId)) {
    const student = byId.get(String(row.student_id));
    if (student) student.overview.cloudPhotoCount = Number(row.total);
  }
  return { students, unassignedScanCount };
}
