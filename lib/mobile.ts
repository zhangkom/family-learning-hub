import type { LearningSubject } from './learning';
import { scanSubjects } from './scans';

export type TutoringResult = {
  transcribedPrompt: string;
  referenceAnswer: string;
  explanation: string;
  answerEvidence: { text: string; author: 'student' | 'teacher' | 'unknown' }[];
  errorHypotheses: { text: string; evidenceIndexes: number[] }[];
  uncertainties: string[];
  generatedAt: string;
  needsReview: true;
};
export type Student = {
  id: string;
  name: string;
  grade?: string;
  createdAt: string;
  legacyChildId?: 'dabao' | 'xiaobao';
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
  subject?: LearningSubject;
  wrongBook?: { savedAt: string };
  tutoring?: {
    status: 'queued' | 'processing' | 'needs_review' | 'failed' | 'stale';
    result?: TutoringResult;
    error?: string;
  };
  number: string;
  prompt: string;
  diagram: string;
  knowledgePoints: string[];
  parentQuestionId?: string;
  regions: Region[];
  sharedRegionIds?: string[];
  answerSteps: AnswerStep[];
  uncertainties: string[];
  confirmed: boolean;
  referenceAnswer?: string;
  explanation?: string;
};
export type MobileScan = {
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

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('字段格式不正确');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 12000) {
  if (typeof value !== 'string' || value.length > max)
    throw new Error('文字字段无效或过长');
  return value.trim();
}
function id(value: unknown) {
  const s = text(value, 96);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(s))
    throw new Error('题目、区域或步骤 ID 无效');
  return s;
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error('题目字段数量超出限制');
  return value;
}
function boolean(value: unknown) {
  if (typeof value !== 'boolean') throw new Error('确认字段无效');
  return value;
}
export function validateQuestions(value: unknown): Question[] {
  const regionIds = new Map<string, Region>();
  const questionIds = new Set<string>(),
    stepIds = new Set<string>();
  let steps = 0;
  const result = list(value, 100).map((entry): Question => {
    const q = object(entry),
      key = id(q.id);
    if (
      q.subject !== undefined &&
      !scanSubjects.includes(q.subject as LearningSubject)
    )
      throw new Error('请选择支持的题目学科');
    if (questionIds.has(key)) throw new Error('题目 ID 重复');
    questionIds.add(key);
    const regions = list(q.regions, 50).map((entry): Region => {
      const r = object(entry),
        key = id(r.id);
      if (regionIds.has(key)) throw new Error('区域 ID 重复，请用共享区域关联');
      if (!['stem', 'figure', 'answer', 'annotation'].includes(String(r.kind)))
        throw new Error('区域类型无效');
      const coords = [r.x, r.y, r.width, r.height];
      if (
        !coords.every(
          (n) =>
            typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1,
        )
      )
        throw new Error('区域坐标必须在 0 到 1 内');
      const [x, y, width, height] = coords as number[];
      if (
        width <= 0 ||
        height <= 0 ||
        x + width > 1.000000001 ||
        y + height > 1.000000001
      )
        throw new Error('区域不能超出原图');
      const region: Region = {
        id: key,
        kind: r.kind as Region['kind'],
        x,
        y,
        width,
        height,
      };
      regionIds.set(key, region);
      return region;
    });
    const orders = new Set<number>();
    const answerSteps = list(q.answerSteps, 200).map((entry): AnswerStep => {
      const s = object(entry),
        key = id(s.id);
      if (stepIds.has(key)) throw new Error('作答步骤 ID 重复');
      stepIds.add(key);
      steps++;
      if (
        !Number.isSafeInteger(s.order) ||
        Number(s.order) < 0 ||
        Number(s.order) > 10000 ||
        orders.has(Number(s.order))
      )
        throw new Error('步骤顺序无效或重复');
      orders.add(Number(s.order));
      if (!['student', 'teacher', 'unknown'].includes(String(s.author)))
        throw new Error('笔迹作者无效');
      return {
        id: key,
        order: Number(s.order),
        text: text(s.text),
        ...(s.latex === undefined ? {} : { latex: text(s.latex) }),
        regionIds: [...new Set(list(s.regionIds, 50).map(id))],
        author: s.author as AnswerStep['author'],
        crossedOut: boolean(s.crossedOut),
        uncertain: boolean(s.uncertain),
      };
    });
    return {
      id: key,
      ...(q.subject === undefined
        ? {}
        : { subject: q.subject as LearningSubject }),
      number: text(q.number, 200),
      prompt: text(q.prompt),
      diagram: text(q.diagram),
      knowledgePoints: [
        ...new Set(list(q.knowledgePoints, 30).map((x) => text(x, 200))),
      ],
      ...(q.parentQuestionId === undefined
        ? {}
        : { parentQuestionId: id(q.parentQuestionId) }),
      regions,
      sharedRegionIds: [...new Set(list(q.sharedRegionIds ?? [], 50).map(id))],
      answerSteps,
      uncertainties: list(q.uncertainties, 50).map((x) => text(x, 2000)),
      confirmed: boolean(q.confirmed),
      ...(q.referenceAnswer === undefined
        ? {}
        : { referenceAnswer: text(q.referenceAnswer) }),
      ...(q.explanation === undefined
        ? {}
        : { explanation: text(q.explanation) }),
    };
  });
  if (regionIds.size > 1000 || steps > 2000)
    throw new Error('整页区域或步骤过多，请拆分照片');
  const byId = new Map(result.map((q) => [q.id, q]));
  for (const q of result) {
    const seen = new Set([q.id]);
    let parent = q.parentQuestionId;
    while (parent) {
      if (!byId.has(parent) || seen.has(parent))
        throw new Error('父题不存在或题目关系存在循环');
      seen.add(parent);
      parent = byId.get(parent)!.parentQuestionId;
    }
    for (const shared of q.sharedRegionIds || []) {
      const region = regionIds.get(shared);
      if (!region || !['stem', 'figure'].includes(region.kind))
        throw new Error('共享区域必须引用本页题干或配图');
    }
    const allowed = new Set([
      ...q.regions.map((r) => r.id),
      ...(q.sharedRegionIds || []),
    ]);
    for (const step of q.answerSteps) {
      if (step.regionIds.some((r) => !allowed.has(r)))
        throw new Error('作答步骤关联了不存在或其他题目的区域');
    }
  }
  return result;
}
