import { parseStoredWrongQuestions, type WrongQuestion } from './learning';
import { parseStudyAttempts, type StudyAttempt } from './study';

export const children = ['xiaobao', 'dabao'] as const;
export type ChildId = (typeof children)[number];
export type TaskMark = { id: string; done: boolean; at: number; nonce: string };
export type ChildState = {
  wrong: WrongQuestion[];
  attempts: StudyAttempt[];
  completed: string[];
  weekly: TaskMark[];
};
export type FamilyState = Record<ChildId, ChildState>;
export function emptyChild(): ChildState {
  return { wrong: [], attempts: [], completed: [], weekly: [] };
}
export function emptyFamily(): FamilyState {
  return { xiaobao: emptyChild(), dabao: emptyChild() };
}
const short = (x: unknown, max = 200): x is string =>
  typeof x === 'string' && x.length > 0 && x.length <= max;

/** Strict at the network/import boundary: never silently discard malformed history. */
export function validateFamily(value: unknown): FamilyState {
  if (!value || typeof value !== 'object')
    throw new Error('学习记录格式不正确');
  const result = emptyFamily();
  for (const child of children) {
    const s = (value as Record<string, unknown>)[child] as
      | ChildState
      | undefined;
    if (
      !s ||
      !['wrong', 'attempts', 'completed', 'weekly'].every((k) =>
        Array.isArray(s[k as keyof ChildState]),
      )
    )
      throw new Error('缺少孩子的学习记录');
    if (
      s.wrong.length > 5000 ||
      s.attempts.length > 20000 ||
      s.completed.length > 2000 ||
      s.weekly.length > 1000
    )
      throw new Error('记录过多，请先导出备份后联系维护人员');
    const wrong = parseStoredWrongQuestions(JSON.stringify(s.wrong), 5000);
    const attempts = parseStudyAttempts(JSON.stringify(s.attempts), 20000);
    if (
      wrong.length !== s.wrong.length ||
      attempts.length !== s.attempts.length
    )
      throw new Error('部分错题或作答字段不正确，未导入');
    if (
      !s.completed.every((x) => short(x)) ||
      !s.weekly.every(
        (x) =>
          x &&
          short(x.id) &&
          typeof x.done === 'boolean' &&
          Number.isSafeInteger(x.at) &&
          x.at >= 0 &&
          short(x.nonce),
      )
    )
      throw new Error('任务记录格式不正确');
    result[child] = {
      wrong: wrong.map((w) => ({
        id: w.id,
        questionId: w.questionId,
        ...(w.scanId ? { scanId: w.scanId } : {}),
        subject: w.subject,
        knowledgePoint: w.knowledgePoint,
        prompt: w.prompt,
        answer: w.answer,
        learnerAnswer: w.learnerAnswer,
        source: w.source,
        status: '待重做',
        createdOn: w.createdOn,
        reviewDates: [...w.reviewDates],
      })),
      attempts: attempts.map((a) => ({
        lessonId: a.lessonId,
        questionId: a.questionId,
        answer: a.answer,
        correct: a.correct,
        assisted: a.assisted,
        mode: a.mode,
        at: a.at,
        ...(a.origin === 'paper' ? { origin: 'paper' as const } : {}),
      })),
      completed: [...new Set(s.completed)].sort(),
      weekly: s.weekly.map((x) => ({
        id: x.id,
        done: x.done,
        at: x.at,
        nonce: x.nonce,
      })),
    };
  }
  return result;
}

export function mergeFamily(
  left: FamilyState,
  right: FamilyState,
): FamilyState {
  const result = emptyFamily();
  for (const child of children) {
    const a = left[child],
      b = right[child];
    const wrong = new Map<string, WrongQuestion>();
    // Earliest failure wins, regardless of which device uploads first.
    for (const w of [...a.wrong, ...b.wrong].sort((x, y) =>
      `${x.createdOn}|${x.id}|${JSON.stringify(x)}`.localeCompare(
        `${y.createdOn}|${y.id}|${JSON.stringify(y)}`,
      ),
    )) {
      if (!wrong.has(w.questionId)) wrong.set(w.questionId, w);
    }
    const attempts = new Map(
      [...a.attempts, ...b.attempts].map((x) => [JSON.stringify(x), x]),
    );
    const weekly = new Map<string, TaskMark>();
    for (const mark of [...a.weekly, ...b.weekly]) {
      const old = weekly.get(mark.id);
      if (
        !old ||
        mark.at > old.at ||
        (mark.at === old.at &&
          `${mark.nonce}:${mark.done}` > `${old.nonce}:${old.done}`)
      )
        weekly.set(mark.id, mark);
    }
    result[child] = {
      wrong: [...wrong.values()].sort((x, y) =>
        x.questionId.localeCompare(y.questionId),
      ),
      attempts: [...attempts.values()].sort(
        (x, y) =>
          x.at.localeCompare(y.at) ||
          JSON.stringify(x).localeCompare(JSON.stringify(y)),
      ),
      completed: [...new Set([...a.completed, ...b.completed])].sort(),
      weekly: [...weekly.values()].sort((x, y) => x.id.localeCompare(y.id)),
    };
  }
  return validateFamily(result);
}

export function parseBackup(value: unknown): FamilyState {
  const data = value as {
    app?: string;
    version?: number;
    records?: unknown;
  } | null;
  if (!data || data.app !== 'family-learning-hub' || data.version !== 1)
    throw new Error('请选择本网站导出的学习备份文件');
  return validateFamily(data.records);
}
