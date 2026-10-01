export type User = { id: string; username: string };
export type Student = {
  id: string;
  name: string;
  grade?: string;
  createdAt: string;
};
export type Region = {
  id: string;
  kind: 'stem' | 'figure' | 'answer' | 'annotation';
  x: number;
  y: number;
  width: number;
  height: number;
};
export type AnswerStep = {
  id: string;
  order: number;
  text: string;
  latex?: string;
  regionIds: string[];
  author: 'student' | 'teacher' | 'unknown';
  crossedOut: boolean;
  uncertain: boolean;
};
export type Question = {
  id: string;
  number: string;
  prompt: string;
  diagram: string;
  knowledgePoints: string[];
  parentQuestionId?: string;
  regions: Region[];
  answerSteps: AnswerStep[];
  uncertainties: string[];
  confirmed: boolean;
  sharedRegionIds?: string[];
  referenceAnswer?: string;
  explanation?: string;
};
export type Scan = {
  id: string;
  studentId: string;
  subject: string;
  source: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  revision: number;
  status: 'queued' | 'processing' | 'needs_review' | 'ready' | 'failed';
  questions: Question[];
  confirmedAt?: string;
  error?: string;
};
export type Login = { token: string; user: User; expiresAt: number | string };
export const statusNames: Record<Scan['status'], string> = {
  queued: '等待识别',
  processing: '正在识别',
  needs_review: '待校对',
  ready: '已校对',
  failed: '识别未完成',
};
