import type { FamilyStore } from './family-store';
import type { CollectionReviewInput, QuestionCollectionReview } from '../lib/question-collection';
import { questionCollectionState } from '../lib/question-collection';
import { questionLearningReadiness } from '../lib/question-context';
import { HttpError } from './family-backend';
import { ownedScan, questionsOf, requireStudent } from './mobile-service';
import { readScanFile, readStoredScan, writeStoredScan } from './scan-files';
import { cropQuestionImages } from './question-crop';

export async function reviewCollection(store: FamilyStore, account: string, scanId: string, questionId: string, body: Record<string, unknown>) {
  const record = await ownedScan(store, account, scanId);
  requireStudent(store, account, typeof body.studentId === 'string' ? body.studentId : null);
  if (record.studentId !== body.studentId) throw new HttpError(404, '当前学生的资料不存在');
  if (Object.keys(body).some(key => !['studentId', 'revision', 'decision', 'materialStatus', 'reason', 'materialEvidence'].includes(key)) ||
    !Number.isSafeInteger(body.revision) || !['wrong', 'focus', 'both', 'none', 'pending'].includes(String(body.decision)) || !['complete', 'incomplete'].includes(String(body.materialStatus)) ||
    typeof body.reason !== 'string' || body.reason.trim().length < 2 || body.reason.length > 1000 ||
    (body.materialEvidence !== undefined && (typeof body.materialEvidence !== 'string' || body.materialEvidence.length > 2000))) throw new HttpError(400, '人工收录决定、材料状态或理由无效');
  if (record.revision !== body.revision) throw new HttpError(409, '资料已更新，请刷新后重新核对');
  const input = body as CollectionReviewInput, question = questionsOf(record).find(q => q.id === questionId);
  if (!question) throw new HttpError(404, '题目不存在');
  const review: QuestionCollectionReview = { decision: input.decision, materialStatus: input.materialStatus, reason: input.reason.trim(),
    ...(input.materialEvidence?.trim() ? { materialEvidence: input.materialEvidence.trim() } : {}),
    reviewedAt: new Date().toISOString(), actorAccountId: account, sourceRevision: record.revision, status: 'current' };
  if (input.materialStatus === 'complete') {
    if (!review.materialEvidence || review.materialEvidence.length < 8) throw new HttpError(400, '请具体说明核对了哪些题干、配图和关联页，或如何补齐缺失材料');
    // Validate the saved current content, not arbitrary question objects from the request.
    const all = questionsOf(record).map(q => q.id === questionId ? { ...q, collectionReview: { ...review, decision: input.decision === 'pending' ? 'none' as const : input.decision } } : q);
    const reason = questionLearningReadiness(all.find(q => q.id === questionId)!, all);
    if (reason) throw new HttpError(400, reason);
    await cropQuestionImages(await readScanFile(store.scanOwner(account), scanId, record), question, questionsOf(record));
  }
  return store.transaction(() => {
    const owner = store.scanOwner(account), current = readStoredScan(store, owner, scanId);
    if (!current || current.deletedAt || current.studentId !== input.studentId) throw new HttpError(404, '当前学生的资料不存在');
    if (current.revision !== input.revision) throw new HttpError(409, '核对期间资料已更新，请刷新后重新核对');
    if (store.db.prepare("SELECT id FROM scan_jobs WHERE owner=? AND scan_id=? AND status IN ('queued','processing')").get(owner, scanId)) throw new HttpError(409, 'AI 正在处理，请等待结果后修改收录状态');
    const questions = questionsOf(current).map(q => q.id !== questionId ? q : { ...q, collectionReview: review,
      wrongBook: ['wrong', 'both'].includes(review.decision) ? q.wrongBook || { savedAt: review.reviewedAt } : undefined,
      focusBook: ['focus', 'both'].includes(review.decision) ? q.focusBook || { savedAt: review.reviewedAt } : undefined });
    const ready = questions.every(q => q.confirmed && !questionCollectionState(q).collectionPending && !questionCollectionState(q).materialPending);
    return writeStoredScan(store, owner, { ...current, revision: current.revision + 1, structuredQuestions: questions,
      status: ready ? 'ready' : 'needs_review', confirmedAt: ready ? current.confirmedAt || review.reviewedAt : undefined }, `collection-review:${account}`);
  });
}
