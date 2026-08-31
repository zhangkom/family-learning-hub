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

const sentencePunctuation = /[.!?。！？]+$/u;

export function normalizeEnglishAnswer(value: string) {
  return value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ').replace(sentencePunctuation, '');
}

export function normalizeMathAnswer(value: string) {
  return value
    .trim()
    .replace(/\s+/g, '')
    .replace(/[＝]/g, '=')
    .replace(/[－−]/g, '-');
}

export function evaluateAnswer(value: string, acceptedAnswers: string[], kind: AnswerKind) {
  const normalize = kind === 'english' ? normalizeEnglishAnswer : normalizeMathAnswer;
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
