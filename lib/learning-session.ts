import type { Question } from './mobile';
export type LearningMode = 'practice' | 'challenge';
export type LearningVerdict = 'correct' | 'partial' | 'incorrect' | 'uncertain';
export type LearningFeedback = { verdict: LearningVerdict; feedback: string; nextStep: string; evidence: string[] };
export type LearningAttempt = {
  id: string; answer: string; createdAt: string; helped: boolean; feedback?: LearningFeedback;
};
export type LearningTask = {
  id: string; kind: 'practice' | 'challenge' | 'retest'; prompt: string; difficulty: string;
  knowledgePoints: string[]; hints: string[]; hintCount: number; totalHints: number;
  solutionViewed: boolean; solution?: { answer: string; explanation: string };
  attempts: LearningAttempt[];
};
export type LearningJob = { id: string; operation: 'prepare' | 'grade' | 'retest'; status: 'queued' | 'processing' | 'failed'; error?: string; taskId?: string };
export type LearningSource = { scanId: string; questionId: string; revision: number; number: string; subject: string; prompt: string; knowledgePoints: string[] };
export type LearningSession = {
  id: string; studentId: string; mode: LearningMode; source: LearningSource;
  createdAt: string; updatedAt: string; revision: number; stuckPoint: string; initialWork: string;
  sourceQuestions?: Question[]; tasks: LearningTask[]; job?: LearningJob; retestDueAt?: string;
};
export type LearningSummary = Pick<LearningSession, 'id' | 'studentId' | 'mode' | 'source' | 'createdAt' | 'updatedAt' | 'job' | 'retestDueAt'> & {
  taskCount: number; passedCount: number; independentRetest: boolean;
};
export function taskPassed(task: LearningTask) { return task.attempts.some(a => a.feedback?.verdict === 'correct'); }
export function sessionSummary(session: LearningSession): LearningSummary {
  return { id: session.id, studentId: session.studentId, mode: session.mode, source: session.source,
    createdAt: session.createdAt, updatedAt: session.updatedAt, job: session.job, retestDueAt: session.retestDueAt,
    taskCount: session.tasks.length, passedCount: session.tasks.filter(taskPassed).length,
    independentRetest: session.tasks.some(t => t.kind === 'retest' && t.attempts.some(a => !a.helped && a.feedback?.verdict === 'correct')) };
}
export const learningModeNames = { practice: '融会贯通', challenge: '破茧成蝶' } as const;
export const verdictNames = { correct: '本次作答正确', partial: '部分正确', incorrect: '还需调整', uncertain: '需要人工核对' } as const;
