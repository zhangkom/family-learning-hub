import type { Question, Region } from './types';

export type QuestionRectangle = Pick<Region, 'id' | 'x' | 'y' | 'width' | 'height'>;
function bounded(region: Region): QuestionRectangle | undefined {
  if (![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.width <= 0 || region.height <= 0) return;
  const x = Math.max(0, region.x), y = Math.max(0, region.y);
  const right = Math.min(1, region.x + region.width), bottom = Math.min(1, region.y + region.height);
  if (right <= x || bottom <= y) return;
  return { id: region.id, x, y, width: right - x, height: bottom - y };
}
/** Keep separate boxes separate: their union could expose a neighboring question. */
export function questionRectangles(question: Question, questions: Question[], mode: 'paper' | 'original' | 'figures') {
  const parent = questions.find(q => q.id === question.parentQuestionId && q.id !== question.id);
  const shared = new Set(question.sharedRegionIds || []);
  const content = (region: Region) => region.kind === 'stem' || region.kind === 'figure';
  const candidates = [
    ...question.regions.filter(r => mode === 'original' || content(r)),
    ...(parent?.regions.filter(content) || []),
    ...questions.flatMap(q => q.regions.filter(r => shared.has(r.id) && content(r))),
  ].filter(r => mode !== 'figures' || r.kind === 'figure');
  const unique = [...new Map(candidates.map(r => [r.id, r])).values()]
    .map(bounded).filter((r): r is QuestionRectangle => !!r);
  return unique.filter((r, index) => !unique.some((other, otherIndex) => {
    if (index === otherIndex) return false;
    const contains = other.x <= r.x && other.y <= r.y && other.x + other.width >= r.x + r.width - 1e-9 && other.y + other.height >= r.y + r.height - 1e-9;
    const equal = Math.abs(other.x-r.x) + Math.abs(other.y-r.y) + Math.abs(other.width-r.width) + Math.abs(other.height-r.height) < 1e-9;
    return contains && (!equal || otherIndex < index);
  })).sort((a, b) => a.y - b.y || a.x - b.x);
}

export function questionPrompt(question: Question) {
  return question.prompt.trim() || question.tutoring?.result?.transcribedPrompt.trim() || '';
}
