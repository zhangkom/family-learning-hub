import type { LearningSubject, WrongQuestion } from './learning';

export type StudyQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correct: number;
  explanation: string;
};

export type StudyLesson = {
  id: string;
  child: 'xiaobao' | 'dabao';
  subject: LearningSubject;
  title: string;
  chapter: string;
  week: number;
  minutes: number;
  objective: string;
  hook: string;
  steps: string[];
  trap: string;
  example: { prompt: string; steps: string[] };
  parentPrompt: string;
  visual?: 'absolute' | 'globe' | 'coordinates';
  reference: { title: string; url: string };
  questions: StudyQuestion[];
};

export type StudyAttempt = {
  origin?: 'paper';
  lessonId: string;
  questionId: string;
  answer: string;
  correct: boolean;
  assisted: boolean;
  mode: 'practice' | 'review';
  at: string;
};

export function studyDate(now = new Date()) {
  // The family uses Shenzhen school dates, independent of the device's timezone.
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

function afterDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function parseStudyAttempts(raw: string | null): StudyAttempt[] {
  try {
    const items: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(items)) return [];
    return items
      .filter((item): item is StudyAttempt => {
        if (!item || typeof item !== 'object') return false;
        const a = item as Record<string, unknown>;
        return (
          ['lessonId', 'questionId', 'answer', 'at'].every(
            (key) =>
              typeof a[key] === 'string' &&
              (a[key] as string).length > 0 &&
              (a[key] as string).length <= 2000,
          ) &&
          typeof a.correct === 'boolean' &&
          typeof a.assisted === 'boolean' &&
          (a.mode === 'practice' || a.mode === 'review') &&
          Number.isFinite(Date.parse(a.at as string))
        );
      })
      .slice(-5000);
  } catch {
    return [];
  }
}

export function recordStudyAttempt(
  attempts: StudyAttempt[],
  wrongQuestions: WrongQuestion[],
  attempt: StudyAttempt,
  wrong?: WrongQuestion,
) {
  return {
    attempts: [...attempts, attempt].slice(-5000),
    // Preserve the first failure; later evidence lives in the attempt history.
    wrongQuestions:
      !attempt.correct &&
      wrong &&
      !wrongQuestions.some((item) => item.questionId === wrong.questionId)
        ? [wrong, ...wrongQuestions]
        : wrongQuestions,
  };
}

export function getStudyStatus(attempts: StudyAttempt[], lessonId: string) {
  let label = '还没练';
  let dueOn: string | undefined;
  let reviews = 0;
  const independent = new Set<string>();
  const history = attempts
    .filter((a) => a.lessonId === lessonId)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const a of history) {
    if (!a.correct || a.assisted) {
      label = '需要提示';
      independent.clear();
      reviews = 0;
      dueOn = afterDays(studyDate(new Date(a.at)), 2);
      continue;
    }
    if (a.mode === 'practice') {
      independent.add(a.questionId);
      if (independent.size < 2) {
        label = '继续练习';
        continue;
      }
      if (label !== '独立完成' && label !== '隔时迁移通过') {
        label = '独立完成';
        dueOn = afterDays(studyDate(new Date(a.at)), 2);
      }
    } else if (
      independent.size >= 2 &&
      dueOn &&
      studyDate(new Date(a.at)) >= dueOn &&
      !independent.has(a.questionId)
    ) {
      label = '隔时迁移通过';
      reviews += 1;
      dueOn = afterDays(studyDate(new Date(a.at)), reviews === 1 ? 7 : 30);
    }
  }
  return { label, dueOn, attempts: history.length };
}

export function studySource(lesson: StudyLesson, question: StudyQuestion) {
  return `双宝原创 · ${lesson.subject} · ${lesson.title} · ${question.id} · v1`;
}
