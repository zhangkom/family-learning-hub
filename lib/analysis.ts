export const MAX_ANALYSIS_ATTEMPTS = 3;
export const ANALYSIS_LEASE_MS = 180000;
export type AnalysisProgress = {
  questionId?: string;
  phase: 'queued' | 'processing' | 'retry_wait' | 'recovering' | 'paused';
  attempts: number;
  maxAttempts: number;
  queuedAt: number;
  startedAt?: number;
  retryAt?: number;
  serverTime: number;
};
export type AnalysisIssue = 'recognition' | 'solution' | 'incomplete';
export type TutoringReviewInput = {
  status: 'confirmed' | 'flagged';
  issue?: AnalysisIssue;
  note?: string;
  correctedPrompt?: string;
};
export type TutoringReview = Omit<TutoringReviewInput, 'correctedPrompt'> & {
  reviewedAt: string;
  resultGeneratedAt: string;
};
