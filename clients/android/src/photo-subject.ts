import { subjects, type Question, type Subject } from './types';

// This is a convenience for this device, scoped to one family's student and photo.
// The saved subject of each question remains the server's authoritative value.
export function photoSubjectKey(owner: string, studentId: string, scanId: string) {
  return `family-learning:photo-subject:${JSON.stringify([owner, studentId, scanId])}`;
}

export function readPhotoSubject(key: string, questions: Question[]): Subject | undefined {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) || 'null');
    if (stored && typeof stored === 'object' && 'subject' in stored) {
      if (stored.subject === null) return undefined;
      if ('questionId' in stored && subjects.includes(stored.subject as Subject) &&
        questions.some((q) => q.id === stored.questionId && q.subject === stored.subject)) {
        return stored.subject as Subject;
      }
    }
  } catch { /* Unavailable or invalid optional settings must not block review. */ }
  // Old per-photo defaults (often "数学") are not evidence of a user's choice.
  // Mixed subjects have no reliable ordering, so only infer a unanimous subject.
  const known = new Set(questions.map((q) => q.subject).filter((s): s is Subject =>
    subjects.includes(s as Subject)));
  return known.size === 1 ? [...known][0] : undefined;
}

export function rememberPhotoSubject(key: string, questionId: string, subject?: Subject) {
  try { localStorage.setItem(key, JSON.stringify({ questionId, subject: subject || null })); }
  catch { /* The current screen still remembers the choice when storage is unavailable. */ }
}
