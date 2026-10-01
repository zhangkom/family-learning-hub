import type { Question, Region } from './types';
export type Point = { x: number; y: number };
const bound = (value: number) => Math.max(0, Math.min(1, value));
export function rectangle(
  start: Point,
  end: Point,
): Pick<Region, 'x' | 'y' | 'width' | 'height'> {
  const x = Math.min(bound(start.x), bound(end.x)),
    y = Math.min(bound(start.y), bound(end.y));
  return {
    x,
    y,
    width: Math.max(bound(start.x), bound(end.x)) - x,
    height: Math.max(bound(start.y), bound(end.y)) - y,
  };
}
export function emptyQuestion(number: string): Question {
  return {
    id: crypto.randomUUID(),
    number,
    prompt: '',
    diagram: '',
    knowledgePoints: [],
    regions: [],
    answerSteps: [],
    uncertainties: [],
    confirmed: false,
  };
}
export function mergeQuestions(
  questions: Question[],
  sourceId: string,
  targetId: string,
) {
  if (sourceId === targetId) return questions;
  const source = questions.find((q) => q.id === sourceId),
    target = questions.find((q) => q.id === targetId);
  if (!source || !target || target.parentQuestionId === sourceId)
    throw new Error('请选择没有父子冲突的目标题目');
  return questions
    .filter((q) => q.id !== sourceId)
    .map((q) => {
      if (q.id !== targetId)
        return q.parentQuestionId === sourceId
          ? { ...q, parentQuestionId: targetId, confirmed: false }
          : q;
      return {
        ...q,
        prompt: [q.prompt, source.prompt].filter(Boolean).join('\n'),
        diagram: [q.diagram, source.diagram].filter(Boolean).join('\n'),
        regions: [...q.regions, ...source.regions],
        answerSteps: [...q.answerSteps, ...source.answerSteps].map(
          (s, order) => ({ ...s, order }),
        ),
        knowledgePoints: [
          ...new Set([...q.knowledgePoints, ...source.knowledgePoints]),
        ],
        sharedRegionIds: [
          ...new Set([
            ...(q.sharedRegionIds || []),
            ...(source.sharedRegionIds || []),
          ]),
        ].filter(
          (id) => ![...q.regions, ...source.regions].some((r) => r.id === id),
        ),
        uncertainties: [...q.uncertainties, ...source.uncertainties],
        confirmed: false,
      };
    });
}

export function removeQuestion(questions: Question[], id: string) {
  const removed = new Set(
    questions.find((q) => q.id === id)?.regions.map((r) => r.id) || [],
  );
  return questions
    .filter((q) => q.id !== id)
    .map((q) => {
      const affected =
        q.parentQuestionId === id ||
        (q.sharedRegionIds || []).some((r) => removed.has(r)) ||
        q.answerSteps.some((s) => s.regionIds.some((r) => removed.has(r)));
      if (!affected) return q;
      return {
        ...q,
        confirmed: false,
        parentQuestionId:
          q.parentQuestionId === id ? undefined : q.parentQuestionId,
        sharedRegionIds: (q.sharedRegionIds || []).filter(
          (r) => !removed.has(r),
        ),
        answerSteps: q.answerSteps.map((s) =>
          s.regionIds.some((r) => removed.has(r))
            ? {
                ...s,
                regionIds: s.regionIds.filter((r) => !removed.has(r)),
                uncertain: true,
              }
            : s,
        ),
        uncertainties: [
          ...q.uncertainties,
          '关联的题目或区域已移除，请重新核对条件。',
        ],
      };
    });
}

export function removeRegion(questions: Question[], id: string) {
  return questions.map((q) => {
    if (
      !q.regions.some((r) => r.id === id) &&
      !(q.sharedRegionIds || []).includes(id) &&
      !q.answerSteps.some((s) => s.regionIds.includes(id))
    )
      return q;
    return {
      ...q,
      confirmed: false,
      regions: q.regions.filter((r) => r.id !== id),
      sharedRegionIds: (q.sharedRegionIds || []).filter((r) => r !== id),
      answerSteps: q.answerSteps.map((s) =>
        s.regionIds.includes(id)
          ? {
              ...s,
              regionIds: s.regionIds.filter((r) => r !== id),
              uncertain: true,
            }
          : s,
      ),
    };
  });
}
