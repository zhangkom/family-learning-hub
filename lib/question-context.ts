import type { Question } from './mobile';

// Shared diagram/stem and ancestor changes also invalidate the derived answer.
export function questionContext(question: Question, all: Question[]) {
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
