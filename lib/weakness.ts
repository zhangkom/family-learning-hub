export type WeaknessSource = {
  id: string; scanId: string; questionId: string; revision: number; number: string; subject: string; prompt: string;
};
export type WeaknessCoverage = {
  total: number; eligible: number; selected: number; omitted: number; needsReview: number; limit: number;
};
export type WeaknessMaterials = WeaknessCoverage & {
  version: string;
  pendingSources: { scanId: string; questionId: string; number: string; subject: string; reason: string }[];
  pendingMore: number;
};
export type WeaknessFocus = {
  id: string; title: string; subject: string; priority: 'high' | 'medium' | 'low';
  dimensionId: string; knowledgePoints: string[];
  basis: 'wrong_question_pattern' | 'answer_evidence';
  reason: string; practiceDirection: string;
  evidence: { sourceId: string; kind: 'question' | 'student_answer'; quote: string; reason: string }[];
  needsReview: true;
};
export type WeaknessResult = { summary: string; focuses: WeaknessFocus[]; limitations: string[]; axes: AbilityAxis[] };
export type WeaknessReport = {
  id: string; studentId: string; subject: string; revision: number;
  status: 'queued' | 'processing' | 'ready' | 'failed'; createdAt: string; updatedAt: string;
  sourceVersion: string; stale: boolean; coverage: WeaknessCoverage; sources: WeaknessSource[];
  result?: WeaknessResult; error?: string;
};
export type WeaknessOverview = { enabled: boolean; materials: WeaknessMaterials; axes: AbilityAxis[]; report?: WeaknessReport };
import type { AbilityAxis } from './ability';
