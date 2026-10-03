import { createHash } from 'node:crypto';
import type { FamilyStore } from './family-store';
import type { StoredLearning } from './learning-sessions';
import type { WeaknessMaterials, WeaknessSource } from '../lib/weakness';
import { questionsOf } from './mobile-service';
import { questionContext, questionIsSummary } from '../lib/question-context';
import type { ScanRecord } from '../lib/scans';

export const WEAKNESS_MATERIAL_LIMIT = 30;
const MAX_MATERIAL_CHARS = 60000;
export type WeaknessMaterial = WeaknessSource & {
  parents: { prompt: string; diagram: string }[]; diagram: string; knowledgePoints: string[];
  studentEvidence: { text: string; kind: 'confirmed_answer' | 'ai_graded_attempt'; result?: string; helped?: boolean; taskPrompt?: string; modelFeedback?: string; sessionId?: string; taskId?: string; attemptId?: string; feedbackEvidence?: string[]; mode?: 'practice' | 'challenge' }[];
  reviewedExplanation?: string; reviewedAnswer?: string;
};
export type WeaknessBundle = { materials: WeaknessMaterials; sources: WeaknessMaterial[] };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// SQL storage is authoritative. The HTTP entry imports legacy files before this
// synchronous snapshot is taken, keeping data selection inside the transaction.
export function weaknessMaterials(store: FamilyStore, account: string, student: string, subject: string): WeaknessBundle {
  const scans = store.db.prepare("SELECT body FROM scan_documents WHERE owner=? ORDER BY json_extract(body,'$.createdAt') DESC,id DESC").all(store.scanOwner(account))
    .map(row => JSON.parse(String(row.body)) as ScanRecord).filter(scan => !scan.deletedAt && scan.studentId === student);
  const learning = store.db.prepare('SELECT body FROM learning_sessions WHERE account_id=? AND student_id=? ORDER BY updated_at DESC,id DESC').all(account, student)
    .map(row => JSON.parse(String(row.body)) as StoredLearning);
  const fingerprints: unknown[] = [], candidates: WeaknessMaterial[] = [], pending: WeaknessMaterials['pendingSources'] = [];
  let total = 0;
  for (const scan of scans) {
    const questions = questionsOf(scan);
    for (const question of questions) {
      if (!question.wrongBook || subject && question.subject !== subject) continue;
      total++;
      const sessions = learning.filter(s => {
        if (s.source.scanId !== scan.id || s.source.questionId !== question.id) return false;
        if (s.sourceRecord?.sourcePage?.scanSha256 !== scan.sourcePage?.scanSha256) return false;
        if (s.source.revision === scan.revision) return true;
        const original = s.sourceRecord?.structuredQuestions?.find(q => q.id === question.id);
        // Marking a teaching answer reviewed or collecting another question may
        // change the page revision without changing this question's conditions.
        return !!original && original.confirmed && digest(questionContext(original, s.sourceRecord.structuredQuestions!)) === digest(questionContext(question, questions));
      });
      fingerprints.push([scan.id, scan.revision, question.id, question, sessions.map(s => [s.id, s.revision])]);
      const context = questionContext(question, questions);
      let parent = question.parentQuestionId, unconfirmedParent = false, summaryContext = false;
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) {
        seen.add(parent); const ancestor = questions.find(q => q.id === parent);
        if (!ancestor?.confirmed || ancestor.paperMark?.classification === 'pending') unconfirmedParent = true;
        if (ancestor && questionIsSummary(ancestor)) summaryContext = true;
        for (const id of ancestor?.sharedRegionIds || []) {
          const shared = questions.find(q => q.regions.some(r => r.id === id));
          if (!shared?.confirmed || shared.paperMark?.classification === 'pending') unconfirmedParent = true;
          if (shared && questionIsSummary(shared)) summaryContext = true;
        }
        parent = ancestor?.parentQuestionId;
      }
      for (const id of question.sharedRegionIds || []) {
        const shared = questions.find(q => q.regions.some(r => r.id === id));
        if (!shared?.confirmed || shared.paperMark?.classification === 'pending') unconfirmedParent = true;
        if (shared && questionIsSummary(shared)) summaryContext = true;
      }
      const reason = !question.subject ? '请先选择科目' : !question.confirmed ? '请先核对并确认题干与题框' : question.paperMark?.classification === 'pending' ? '题目资料仍待补全，不能用于能力归纳' : questionIsSummary(question) || summaryContext ? '当前只有题目定位摘要；请结合完整题图解析，采用并核对完整题干、选项与图示条件后再分析' : !question.prompt.trim() || question.prompt.trim() === '待确认' ? '请补充已核对的完整题干' :
        unconfirmedParent || context.parents.some(p => !p.prompt.trim() || p.prompt.trim() === '待确认') ? '请补充并确认共用题干条件' : '';
      if (reason) { pending.push({ scanId: scan.id, questionId: question.id, number: question.number, subject: question.subject || '', reason }); continue; }
      const reviewed = question.tutoring?.status === 'needs_review' && question.tutoring.review?.status === 'confirmed' &&
        question.tutoring.review.resultGeneratedAt === question.tutoring.result?.generatedAt ? question.tutoring.result : undefined;
      const studentEvidence: WeaknessMaterial['studentEvidence'] = question.answerSteps.filter(s => s.author === 'student' && !s.uncertain && !s.crossedOut && s.text.trim())
        .map(s => ({ text: s.text, kind: 'confirmed_answer' as const }));
      if (reviewed) for (const evidence of reviewed.answerEvidence) {
        if (evidence.author === 'student' && evidence.text.trim() && !studentEvidence.some(s => s.text === evidence.text)) studentEvidence.push({ text: evidence.text, kind: 'confirmed_answer' });
      }
      // Incorrect/partial results are model judgements, always labelled as such.
      // Correct independent retests are included too, so old mistakes cannot hide improvement.
      for (const session of sessions) for (const task of session.tasks) for (const attempt of task.attempts) {
        if (attempt.feedback && attempt.feedback.verdict !== 'uncertain') studentEvidence.push({ text: attempt.answer, kind: 'ai_graded_attempt', result: `${task.kind}:${attempt.feedback.verdict}`, helped: attempt.helped, taskPrompt: task.prompt, modelFeedback: attempt.feedback.feedback, sessionId: session.id, taskId: task.id, attemptId: attempt.id, feedbackEvidence: attempt.feedback.evidence, mode: session.mode });
      }
      const material: WeaknessMaterial = { id: `${scan.id}/${question.id}`, scanId: scan.id, questionId: question.id, revision: scan.revision,
        number: question.number, subject: question.subject!, prompt: question.prompt, parents: context.parents, diagram: question.diagram,
        knowledgePoints: question.knowledgePoints, studentEvidence,
        ...(reviewed ? { reviewedExplanation: reviewed.explanation, reviewedAnswer: reviewed.referenceAnswer } : {}) };
      if (JSON.stringify(material).length > MAX_MATERIAL_CHARS / 2) {
        pending.push({ scanId: scan.id, questionId: question.id, number: question.number, subject: question.subject!, reason: '本题文字材料过长，请整理为完整且精简的题干与作答' });
      } else candidates.push(material);
    }
  }
  const sources: WeaknessMaterial[] = []; let chars = 0;
  for (const candidate of candidates) {
    const size = JSON.stringify(candidate).length;
    if (sources.length >= WEAKNESS_MATERIAL_LIMIT || chars + size > MAX_MATERIAL_CHARS) continue;
    sources.push(candidate); chars += size;
  }
  const grade = store.db.prepare('SELECT grade FROM students WHERE account_id=? AND id=?').get(account, student)?.grade;
  return { sources, materials: { version: digest([3, student, grade || '', subject, fingerprints]), total, eligible: candidates.length, selected: sources.length,
    omitted: candidates.length - sources.length, needsReview: pending.length, limit: WEAKNESS_MATERIAL_LIMIT,
    pendingSources: pending.slice(0, 50), pendingMore: Math.max(0, pending.length - 50) } };
}
