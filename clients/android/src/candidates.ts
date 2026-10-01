import { emptyQuestion, rectangle } from './regions';
import type { Question, Region, Scan, Subject } from './types';

export type CandidateRegion = {
  id: string;
  order: number;
  region: Pick<Region, 'x' | 'y' | 'width' | 'height'>;
  reason: string;
};
export type CandidateReply = {
  scanId: string;
  revision: number;
  algorithm: string;
  coordinateSpace: 'oriented-normalized';
  image: { width: number; height: number };
  status: 'candidates' | 'manual_required';
  candidates: CandidateRegion[];
  warnings: string[];
};
export const candidateLimit = 24;

export function candidateQuestions(value: CandidateReply, scan: Pick<Scan, 'id' | 'revision'>): Question[] {
  if (!value || value.scanId !== scan.id || value.revision !== scan.revision ||
    value.coordinateSpace !== 'oriented-normalized' ||
    !['candidates', 'manual_required'].includes(value.status) ||
    !Number.isSafeInteger(value.image?.width) || !Number.isSafeInteger(value.image?.height) ||
    value.image.width < 1 || value.image.height < 1 ||
    !Array.isArray(value.candidates) || value.candidates.length > candidateLimit)
    throw new Error('题框建议与当前照片不一致，请重新查找或手动框题。');
  const ids = new Set<string>();
  for (const candidate of value.candidates) {
    const r = candidate?.region;
    if (!candidate || typeof candidate.id !== 'string' || !candidate.id || candidate.id.length > 160 ||
      ids.has(candidate.id) || !Number.isSafeInteger(candidate.order) || candidate.order < 0 ||
      !r || ![r.x, r.y, r.width, r.height].every(Number.isFinite) ||
      r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > 1 || r.y + r.height > 1)
      throw new Error('收到的题框范围无效，请重新查找或手动框题。');
    ids.add(candidate.id);
  }
  if (value.status === 'manual_required' && value.candidates.length)
    throw new Error('题框建议状态不一致，请手动框题。');
  return [...value.candidates].sort((a, b) => a.order - b.order).map((candidate, i) => ({
    ...emptyQuestion(`建议 ${i + 1}`),
    regions: [{ ...candidate.region, id: crypto.randomUUID(), kind: 'stem' }],
  }));
}

export function mergeCandidates(questions: Question[], selected: string[]): Question[] {
  const chosen = questions.filter((q) => selected.includes(q.id));
  if (chosen.length < 2) return questions;
  const regions = chosen.flatMap((q) => q.regions);
  const merged = { ...emptyQuestion(chosen[0].number), regions: [{
    ...rectangle({ x: Math.min(...regions.map((r) => r.x)), y: Math.min(...regions.map((r) => r.y)) },
      { x: Math.max(...regions.map((r) => r.x + r.width)), y: Math.max(...regions.map((r) => r.y + r.height)) }),
    id: crypto.randomUUID(), kind: 'stem' as const,
  }] };
  return questions.flatMap((q) => q.id === chosen[0].id ? [merged] : selected.includes(q.id) ? [] : [q]);
}

export function adoptCandidates(existing: Question[], selected: Question[], subject: Subject): Question[] {
  if (!selected.length || existing.length + selected.length > 100)
    throw new Error('每张照片最多保存 100 道题，请减少所选题框。');
  return [...existing, ...selected.map((q, i) => ({
    ...emptyQuestion(String(existing.length + i + 1)), subject,
    regions: q.regions.map((r) => ({ ...r, id: crypto.randomUUID() })),
  }))];
}

export function overlapsExisting(candidate: Question, existing: Question[]): boolean {
  return candidate.regions.some((r) => existing.some((q) => q.regions.some((other) => {
    const intersection = Math.max(0, Math.min(r.x + r.width, other.x + other.width) - Math.max(r.x, other.x)) *
      Math.max(0, Math.min(r.y + r.height, other.y + other.height) - Math.max(r.y, other.y));
    return intersection / Math.min(r.width * r.height, other.width * other.height) > 0.5;
  })));
}
