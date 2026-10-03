import type { Question } from './mobile';
export type QuestionContextSource = Pick<Question, 'id' | 'subject' | 'prompt' | 'diagram' | 'answerSteps' | 'regions' | 'sharedRegionIds' | 'parentQuestionId'>;
export type QuestionLearningSource = QuestionContextSource & Pick<Question, 'confirmed' | 'paperMark'>;

// Older host imports used an explicit application label before this field existed.
export const questionIsSummary = (question: Pick<Question, 'prompt' | 'promptKind'>) => question.promptKind === 'summary' || /^题目定位摘要[：:]/.test(question.prompt.trim());

/** Empty means the complete saved source is ready for generating new learning tasks. */
export function questionLearningReadiness(question: QuestionLearningSource, all: QuestionLearningSource[]): string {
  if (!question.subject) return '请先为原题选择科目';
  if (question.paperMark?.classification === 'pending') return '本题资料仍待补全，请先补齐题干、配图或关联页并核对收录状态';
  if (!question.confirmed) return '请先校对并确认原题，再开始学习';
  const byId = new Map(all.map(q => [q.id, q])), visited = new Set<string>();
  let current: QuestionLearningSource | undefined = question;
  while (current) {
    if (visited.has(current.id)) return '共用题干关系存在循环，请先核对';
    visited.add(current.id);
    if (current.paperMark?.classification === 'pending') return '共用题干资料仍待补全，请先补齐并核对';
    if (!current.confirmed) return '共用题干尚未核对确认，请先进入详情完成校对';
    for (const id of current.sharedRegionIds || []) {
      const owner = all.find(q => q.regions.some(r => r.id === id && ['stem', 'figure'].includes(r.kind)));
      if (!owner) return '共用题干或配图缺失，请先补齐关联题框';
      if (owner.paperMark?.classification === 'pending') return '共用题干或配图仍待补全，请先补齐并核对';
      if (!owner.confirmed) return '共用题干或配图尚未核对确认，请先进入详情完成校对';
    }
    if (!current.parentQuestionId) break;
    current = byId.get(current.parentQuestionId);
    if (!current) return '共用题干缺失，请先补齐父题';
  }
  if (!questionContext(question, all).regions.some(r => r.kind === 'stem')) return '请先框出这道题的完整题干';
  return '';
}

// Shared diagram/stem and ancestor changes also invalidate the derived answer.
export function questionContext(question: QuestionContextSource, all: QuestionContextSource[]) {
  const selected = new Set([
    ...question.regions.map((r) => r.id),
    ...(question.sharedRegionIds || []),
  ]);
  const parents: { prompt: string; diagram: string }[] = [];
  const visited = new Set([question.id]);
  let parentId = question.parentQuestionId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = all.find((q) => q.id === parentId);
    if (!parent) break;
    parents.push({ prompt: parent.prompt, diagram: parent.diagram });
    for (const region of parent.regions)
      if (region.kind === 'stem' || region.kind === 'figure')
        selected.add(region.id);
    for (const id of parent.sharedRegionIds || []) selected.add(id);
    parentId = parent.parentQuestionId;
  }
  return {
    subject: question.subject,
    prompt: question.prompt,
    diagram: question.diagram,
    answerSteps: question.answerSteps,
    parents,
    regions: all.flatMap((q) => q.regions).filter((r) => selected.has(r.id)),
  };
}
