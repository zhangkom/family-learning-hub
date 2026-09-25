import { focusLessons } from './study-content/focus';
import { juniorLessons } from './study-content/junior';
import { seniorLessons } from './study-content/senior';
import type { StudyLesson } from './study';

// Geography replaces an optional extra task; it is not piled on top of daily work.
const geographyWeeks: Record<string, number> = {
  'xb-geo-lines': 1,
  'xb-geo-address': 2,
  'xb-geo-read': 3,
  'xb-geo-treasure': 4,
};
export const studyLessons: StudyLesson[] = [
  ...focusLessons.map((item) => ({
    ...item,
    week: geographyWeeks[item.id] ?? item.week,
  })),
  ...juniorLessons,
  ...seniorLessons,
];
export function findStudyLesson(id: string) {
  return studyLessons.find((item) => item.id === id);
}
export function lessonForQuestion(id: string) {
  return studyLessons.find((item) => item.questions.some((q) => q.id === id));
}
