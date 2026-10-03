import type { Question, Scan } from './types';
export type WrongQuestion = { scan: Scan; question: Question };
export function orderedWrongQuestions(records: Scan[], order: 'newest' | 'oldest' = 'newest'): WrongQuestion[] {
  // Sort uploads once, preserving within-photo order when filtering subjects.
  return records.map((scan, index) => ({ scan, index })).sort((a, b) => {
    const ta = Date.parse(a.scan.createdAt) || 0, tb = Date.parse(b.scan.createdAt) || 0;
    return (order === 'newest' ? tb - ta : ta - tb) || a.index - b.index;
  }).flatMap(({ scan }) => scan.questions.filter(question => question.wrongBook || question.focusBook).map(question => ({ scan, question })));
}
