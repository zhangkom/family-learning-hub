import type { AnalysisIssue, TutoringReview } from '../lib/analysis';
import type { FamilyStore } from './family-store';
import { HttpError } from './family-backend';
import { ownedScan, questionsOf } from './mobile-service';
import { readStoredScan, writeStoredScan } from './scan-files';
import { questionContext } from '../lib/question-context';

export async function reviewTutoring(store: FamilyStore, account: string, scanId: string, questionId: string, body: Record<string, unknown>) {
  await ownedScan(store, account, scanId);
  if (Object.keys(body).some(key => !['revision', 'resultGeneratedAt', 'status', 'issue', 'note', 'correctedPrompt'].includes(key)) ||
    !Number.isSafeInteger(body.revision) || typeof body.resultGeneratedAt !== 'string' || !['confirmed', 'flagged'].includes(String(body.status)))
    throw new HttpError(400, '核对状态或资料版本无效');
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if ((body.note !== undefined && typeof body.note !== 'string') || note.length > 2000 ||
    (body.correctedPrompt !== undefined && (typeof body.correctedPrompt !== 'string' || body.correctedPrompt.length > 12000)))
    throw new HttpError(400, '核对说明或题干过长或无效');
  const flagged = body.status === 'flagged';
  if (flagged ? !['recognition', 'solution', 'incomplete'].includes(String(body.issue)) : body.issue !== undefined || body.correctedPrompt !== undefined || note !== '')
    throw new HttpError(400, '请选择需要核对的问题类型');
  const correctedPrompt = typeof body.correctedPrompt === 'string' ? body.correctedPrompt.trim() : undefined;
  if (flagged && (body.issue === 'recognition' ? !correctedPrompt : !note || correctedPrompt !== undefined))
    throw new HttpError(400, body.issue === 'recognition' ? '请填写核对后的完整题干' : '请说明需要改正或补充的地方');
  const owner = store.scanOwner(account);
  return store.transaction(() => {
    const current = readStoredScan(store, owner, scanId)!;
    if (current.deletedAt) throw new HttpError(404, '资料不存在');
    if (current.revision !== body.revision) throw new HttpError(409, '资料已有新版本，请重新打开后核对');
    const questions = questionsOf(current), question = questions.find(q => q.id === questionId), tutoring = question?.tutoring;
    if (!question) throw new HttpError(404, '题目不存在');
    if (!tutoring?.result || tutoring.result.generatedAt !== body.resultGeneratedAt)
      throw new HttpError(409, '分析结果已经变化，请核对最新结果');
    if (store.db.prepare("SELECT 1 FROM scan_jobs WHERE owner=? AND scan_id=? AND status IN ('queued','processing')").get(owner, scanId))
      throw new HttpError(409, 'AI 正在分析，请等待完成后核对');
    if (!flagged && tutoring.status !== 'needs_review') throw new HttpError(409, '这份分析已过期或未完成，请重新分析后核对');
    const review: TutoringReview = { status: flagged ? 'flagged' : 'confirmed', reviewedAt: new Date().toISOString(), resultGeneratedAt: tutoring.result.generatedAt,
      ...(flagged ? { issue: body.issue as AnalysisIssue, note } : {}) };
    const updated = { ...question, ...(correctedPrompt === undefined ? {} : { prompt: correctedPrompt }),
      tutoring: { ...tutoring, status: flagged ? 'stale' as const : tutoring.status, review } };
    const nextQuestions = questions.map(q => q.id === questionId ? updated : q);
    const invalidated = nextQuestions.map(q => {
      const before = questions.find(old => old.id === q.id)!;
      const changed = JSON.stringify(questionContext(q, nextQuestions)) !== JSON.stringify(questionContext(before, questions));
      return changed ? { ...q, confirmed: false, ...(q.tutoring ? { tutoring: { ...q.tutoring, status: 'stale' as const } } : {}) } : q;
    });
    return writeStoredScan(store, owner, { ...current, revision: current.revision + 1,
      ...(invalidated.some(q => !q.confirmed) ? { confirmedAt: undefined } : {}),
      structuredQuestions: invalidated }, flagged ? 'flag-analysis' : 'confirm-analysis');
  });
}
