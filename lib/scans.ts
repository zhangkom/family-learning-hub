import type { ChildId } from './family-state';
import type { LearningSubject } from './learning';
import type { Question } from './mobile';
export const scanSubjects: LearningSubject[] = [
  '数学',
  '英语',
  '地理',
  '物理',
  '化学',
  '生物',
];
export const scanFields = {
  number: '原题号 / 页码',
  prompt: '完整题干',
  diagram: '图示与位置',
  learnerAnswer: '孩子原作答',
  markings: '批改痕迹',
  knowledgePoint: '知识点',
  answer: '参考答案（待核对）',
  analysis: '分步讲解（待核对）',
  uncertainties: '待确认内容',
};
export type ScanQuestion = Record<keyof typeof scanFields, string> & {
  subject: LearningSubject;
  selected: boolean;
};
export type ScanRecord = {
  id: string;
  child?: ChildId;
  studentId?: string;
  structuredQuestions?: Question[];
  uploadFingerprint?: string;
  subject: string;
  source: string;
  originalName: string;
  mimeType: string;
  size: number;
  status: string;
  createdAt: string;
  fileUrl: string;
  revision: number;
  questions?: ScanQuestion[];
  confirmedQuestions?: ScanQuestion[];
  confirmedAt?: string;
  deletedAt?: string;
  rotation?: number;
  error?: string;
  startedAt?: string;
};
export function blankScanQuestion(subject: LearningSubject): ScanQuestion {
  return {
    number: '',
    prompt: '',
    diagram: '',
    learnerAnswer: '',
    markings: '',
    knowledgePoint: '',
    answer: '',
    analysis: '',
    uncertainties: '',
    subject,
    selected: false,
  };
}
export function validateScanQuestions(value: unknown): ScanQuestion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100)
    throw new Error('每份扫描请整理 1 至 100 道题');
  return value.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      !scanSubjects.includes(item.subject)
    )
      throw new Error('学科无效');
    const out = blankScanQuestion(item.subject);
    for (const key of Object.keys(scanFields) as (keyof typeof scanFields)[]) {
      if (typeof item[key] !== 'string' || item[key].length > 12000)
        throw new Error('题目字段无效或过长');
      out[key] = item[key].trim() || '待确认';
    }
    out.selected = item.selected === true;
    return out;
  });
}
