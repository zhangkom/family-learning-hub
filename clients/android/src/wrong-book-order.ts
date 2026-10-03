import type { Question, Scan } from './types';
import { questionDifficultyStars } from '../../../lib/question-difficulty';
export type WrongQuestion = { scan: Scan; question: Question };
export function orderedWrongQuestions(records: Scan[], order: 'newest' | 'oldest' | 'hardest' | 'easiest' = 'newest'): WrongQuestion[] {
  // Sort uploads once, preserving within-photo order when filtering subjects.
  const rows = records.map((scan, index) => ({ scan, index })).sort((a, b) => {
    const ta = Date.parse(a.scan.createdAt) || 0, tb = Date.parse(b.scan.createdAt) || 0;
    return (order === 'oldest' ? ta - tb : tb - ta) || a.index - b.index;
  }).flatMap(({ scan }) => scan.questions.filter(question => question.wrongBook || question.focusBook).map(question => ({ scan, question })));
  return order === 'hardest' || order === 'easiest' ? rows.sort((a, b) => (order === 'hardest' ? -1 : 1) * (questionDifficultyStars(a.question) - questionDifficultyStars(b.question))) : rows;
}
