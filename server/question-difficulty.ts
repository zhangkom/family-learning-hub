import type { FamilyStore } from './family-store';
import type { DifficultyStars } from '../lib/question-difficulty';
import { HttpError } from './family-backend';
import { ownedScan, questionsOf, requireStudent } from './mobile-service';
import { readStoredScan, writeStoredScan } from './scan-files';

export async function setQuestionDifficulty(store: FamilyStore, account: string, scanId: string, questionId: string, body: Record<string, unknown>) {
  await ownedScan(store, account, scanId);
  requireStudent(store, account, typeof body.studentId === 'string' ? body.studentId : null);
  if (Object.keys(body).some(key => !['studentId', 'revision', 'stars'].includes(key)) || !Number.isSafeInteger(body.revision) || !Number.isInteger(body.stars) || Number(body.stars) < 1 || Number(body.stars) > 5) throw new HttpError(400, '请设置1至5星难度并提供资料版本');
  return store.transaction(() => {
    const owner = store.scanOwner(account), current = readStoredScan(store, owner, scanId);
    if (!current || current.deletedAt || current.studentId !== body.studentId) throw new HttpError(404, '当前学生的资料不存在');
    if (current.revision !== body.revision) throw new HttpError(409, '资料已更新，请刷新后修改难度');
    const question = questionsOf(current).find(q => q.id === questionId);
    if (!question) throw new HttpError(404, '题目不存在');
    if (question.difficulty?.source === 'user' && question.difficulty.stars === body.stars) return current;
    if (store.db.prepare("SELECT id FROM scan_jobs WHERE owner=? AND scan_id=? AND status IN ('queued','processing')").get(owner, scanId)) throw new HttpError(409, 'AI 正在处理，请等待结果后修改难度');
    const difficulty = { stars: body.stars as DifficultyStars, source: 'user' as const, updatedAt: new Date().toISOString(), actorAccountId: account };
    return writeStoredScan(store, owner, { ...current, revision: current.revision + 1, structuredQuestions: questionsOf(current).map(q => q.id === questionId ? { ...q, difficulty } : q) }, `question-difficulty:${account}`);
  });
}
