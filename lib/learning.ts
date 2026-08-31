export type AnswerKind = 'math' | 'english';

export type LearningSubject = '数学' | '英语' | '物理' | '化学' | '生物';

export type WrongQuestionInput = {
  questionId: string;
  subject: LearningSubject;
  knowledgePoint: string;
  prompt: string;
  answer: string;
  learnerAnswer: string;
  source: string;
  now?: Date;
};

export type WrongQuestion = Omit<WrongQuestionInput, 'now'> & {
  id: string;
  status: '待重做';
  createdOn: string;
  reviewDates: string[];
};

const learningSubjects = new Set<LearningSubject>([
  '数学',
  '英语',
  '物理',
  '化学',
  '生物',
]);

function isShortString(value: unknown, maxLength = 2000): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maxLength
  );
}

function isStoredWrongQuestion(value: unknown): value is WrongQuestion {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    isShortString(item.id, 200) &&
    isShortString(item.questionId, 200) &&
    learningSubjects.has(item.subject as LearningSubject) &&
    isShortString(item.knowledgePoint, 200) &&
    isShortString(item.prompt) &&
    isShortString(item.answer) &&
    isShortString(item.learnerAnswer) &&
    isShortString(item.source, 500) &&
    item.status === '待重做' &&
    isShortString(item.createdOn, 50) &&
    Array.isArray(item.reviewDates) &&
    item.reviewDates.length <= 10 &&
    item.reviewDates.every((date) => isShortString(date, 50))
  );
}

export function parseStoredWrongQuestions(
  value: string | null,
  maxItems = 500,
) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredWrongQuestion).slice(0, maxItems);
  } catch {
    return [];
  }
}

export function parseStoredStringList(value: string | null, maxItems = 500) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(parsed.filter((item) => isShortString(item, 200))),
    ).slice(0, maxItems);
  } catch {
    return [];
  }
}

const sentencePunctuation = /[.!?。！？]+$/u;

export function normalizeEnglishAnswer(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
    .replace(sentencePunctuation, '');
}

export function normalizeMathAnswer(value: string) {
  return value
    .trim()
    .replace(/\s+/g, '')
    .replace(/[＝]/g, '=')
    .replace(/[－−]/g, '-');
}

export function evaluateAnswer(
  value: string,
  acceptedAnswers: string[],
  kind: AnswerKind,
) {
  const normalize =
    kind === 'english' ? normalizeEnglishAnswer : normalizeMathAnswer;
  const candidate = normalize(value);
  return acceptedAnswers.some((answer) => normalize(answer) === candidate);
}

export function buildReviewDates(start: Date) {
  return [2, 7, 30].map((days) => {
    const review = new Date(start);
    review.setUTCDate(review.getUTCDate() + days);
    return review.toISOString().slice(0, 10);
  });
}

export function createWrongQuestion(input: WrongQuestionInput): WrongQuestion {
  const { now = new Date(), ...question } = input;
  return {
    ...question,
    id: `wrong-${question.questionId}-${now.getTime()}`,
    status: '待重做',
    createdOn: now.toISOString().slice(0, 10),
    reviewDates: buildReviewDates(now),
  };
}
