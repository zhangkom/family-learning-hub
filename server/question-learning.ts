import type { FamilyStore } from './family-store';
import { HttpError } from './family-backend';
import { listScans, readStoredScan, writeStoredScan } from './scan-files';
import { ownedScan, questionsOf, requireStudent } from './mobile-service';
import { questionContext } from '../lib/question-context';
import { scanSubjects, type ScanRecord } from '../lib/scans';

export function selectedQuestion(record: ScanRecord, id: string) {
  const questions = questionsOf(record);
  const question = questions.find((q) => q.id === id);
  if (!question) throw new HttpError(404, '题目不存在');
  if (!question.subject || !scanSubjects.includes(question.subject))
    throw new HttpError(400, '请先为这道题选择科目');
  if (
    !questionContext(question, questions).regions.some((r) => r.kind === 'stem')
  )
    throw new HttpError(400, '请先框出这道题的题干');
  return question;
}

export async function setWrongBook(
  store: FamilyStore,
  account: string,
  scanId: string,
  questionId: string,
  body: Record<string, unknown>,
) {
  await ownedScan(store, account, scanId);
  if (typeof body.saved !== 'boolean' || !Number.isSafeInteger(body.revision))
    throw new HttpError(400, '保存状态或资料版本无效');
  const owner = store.scanOwner(account);
  return store.transaction(() => {
    const current = readStoredScan(store, owner, scanId)!;
    if (current.deletedAt) throw new HttpError(404, '资料不存在');
    if (current.revision !== body.revision)
      throw new HttpError(409, '资料已更新，请刷新后保存');
    const question = body.saved
      ? selectedQuestion(current, questionId)
      : questionsOf(current).find((q) => q.id === questionId);
    if (!question) throw new HttpError(404, '题目不存在');
    if (Boolean(question.wrongBook) === body.saved) return current;
    if (
      store.db
        .prepare(
          "SELECT id FROM scan_jobs WHERE owner=? AND scan_id=? AND status IN ('queued','processing')",
        )
        .get(owner, scanId)
    )
      throw new HttpError(409, 'AI 正在处理，请等待结果后修改收录状态');
    return writeStoredScan(
      store,
      owner,
      {
        ...current,
        revision: current.revision + 1,
        structuredQuestions: questionsOf(current).map((q) =>
          q.id === questionId
            ? {
                ...q,
                wrongBook: body.saved
                  ? { savedAt: new Date().toISOString() }
                  : undefined,
              }
            : q,
        ),
      },
      body.saved ? 'save-wrong-question' : 'remove-wrong-question',
    );
  });
}

export async function wrongBookItems(
  store: FamilyStore,
  account: string,
  studentId: string | null,
) {
  requireStudent(store, account, studentId);
  const scans = await listScans(store.scanOwner(account), store);
  return scans
    .filter(
      (s) => !s.deletedAt && (s.studentId || s.child || 'dabao') === studentId,
    )
    .flatMap((scan) =>
      questionsOf(scan)
        .filter((q) => q.wrongBook)
        .map((question) => ({
          scanId: scan.id,
          studentId: studentId!,
          subject: question.subject || '待选择',
          source: scan.source,
          question,
        })),
    )
    .sort((a, b) =>
      b.question.wrongBook!.savedAt.localeCompare(
        a.question.wrongBook!.savedAt,
      ),
    );
}
