import { createHash } from 'node:crypto';
import type { Question } from '../lib/mobile';
import type { ScanRecord } from '../lib/scans';
import type { PreparedWorksheetQuestion, WorksheetAvailability, WorksheetExportInput, WorksheetPreview } from '../lib/worksheet';
import { validateWorksheetBlocks, validateWorksheetMaterial } from '../lib/worksheet';
import { questionContext, questionLearningReadiness } from '../lib/question-context';
import { questionDifficultyStars } from '../lib/question-difficulty';
import { HttpError, json, readJson } from './family-backend';
import type { FamilyStore } from './family-store';
import { mobileScan, ownedScan, questionsOf, requireStudent } from './mobile-service';
import { readScanFile, readStoredScan, writeStoredScan } from './scan-files';
import { buildWorksheetDocx, worksheetDocumentBudget, worksheetHasSourcePhotos, worksheetSourceImage, type WorksheetDocumentQuestion, type WorksheetSourceImage } from './worksheet-docx';

const exportingAccounts = new Set<string>();

/** Changes to stars/collection timestamps do not invalidate a checked transcription. */
export function worksheetSourceFingerprint(record: ScanRecord, question: Question) {
  return createHash('sha256').update(JSON.stringify({
    scanId: record.id, studentId: record.studentId, number: question.number,
    image: [record.sourcePage?.scanSha256, record.processing?.sha256, record.size, record.mimeType],
    source: question.sourcePage || record.sourcePage || record.source,
    context: questionContext(question, questionsOf(record)),
  })).digest('hex');
}
function sourceTitle(record: ScanRecord, question: Question) { return (question.sourcePage?.title || record.sourcePage?.title || record.source || '来源待核对').trim(); }
export function worksheetAvailability(record: ScanRecord, question: Question, includeAnswers = false): WorksheetAvailability {
  const reasons: string[] = [], ready = question.worksheet;
  const material = questionLearningReadiness(question, questionsOf(record));
  if (material) reasons.push(material);
  if (!question.number.trim()) reasons.push('原题号尚未核对');
  if (!ready) reasons.push('题干、公式和配图尚未完成打印排版核对');
  else {
    if (ready.version !== 1 || ready.sourceFingerprint !== worksheetSourceFingerprint(record, question)) reasons.push('原题已修改，请重新核对打印内容');
    if (includeAnswers && !ready.answerBlocks?.length) reasons.push('参考答案与解析尚未核对');
  }
  return { scanId: record.id, questionId: question.id, revision: record.revision, sourceTitle: sourceTitle(record, question),
    originalNumber: question.number, subject: question.subject || record.subject, stars: questionDifficultyStars(question), ready: reasons.length === 0, reasons, sourceFingerprint: worksheetSourceFingerprint(record, question) };
}
function exportInput(body: Record<string, unknown>): WorksheetExportInput {
  if (Object.keys(body).some(k => !['studentId', 'selections', 'includeAnswers'].includes(k)) || typeof body.studentId !== 'string' ||
    !Array.isArray(body.selections) || !body.selections.length || body.selections.length > 2000 || (body.includeAnswers !== undefined && typeof body.includeAnswers !== 'boolean')) throw new HttpError(400, '请选择当前学生需要导出的题目');
  const seen = new Set<string>();
  for (const s of body.selections) {
    if (!s || typeof s !== 'object' || Object.keys(s).some(k => !['scanId', 'questionId', 'revision'].includes(k)) || typeof s.scanId !== 'string' || typeof s.questionId !== 'string' || !Number.isSafeInteger(s.revision) || s.revision < 0) throw new HttpError(400, '题目选择或版本无效');
    const key = `${s.scanId}/${s.questionId}`;
    if (seen.has(key)) throw new HttpError(400, '请勿重复选择同一道题'); seen.add(key);
  }
  return body as WorksheetExportInput;
}
async function selected(store: FamilyStore, account: string, input: WorksheetExportInput) {
  const student = requireStudent(store, account, input.studentId), records = new Map<string, ScanRecord>();
  for (const choice of input.selections) {
    if (!records.has(choice.scanId)) records.set(choice.scanId, await ownedScan(store, account, choice.scanId));
    const record = records.get(choice.scanId)!;
    if (record.studentId !== input.studentId) throw new HttpError(404, '当前学生的题目不存在');
    if (record.revision !== choice.revision) throw new HttpError(409, '题目已更新，请刷新列表后重新导出');
  }
  const items = input.selections.map(choice => {
    const record = records.get(choice.scanId)!, question = questionsOf(record).find(q => q.id === choice.questionId);
    if (!question || (!question.wrongBook && !question.focusBook)) throw new HttpError(404, '所选收录题目不存在');
    return { record, question };
  });
  return { student, items };
}
export async function worksheetResponse(request: Request, parts: string[], store: FamilyStore, account: string) {
  if (request.method !== 'POST') throw new HttpError(405, '请求方式不支持');
  if (parts.length !== 2 || !['preview', 'export', 'prepare'].includes(parts[1])) throw new HttpError(404, '接口不存在');
  const body = await readJson(request, parts[1] === 'prepare' ? 400000 : 250000);
  if (parts[1] === 'prepare') return prepare(store, account, body);
  const input = exportInput(body), { student, items } = await selected(store, account, input);
  const availability = items.map(({ record, question }) => worksheetAvailability(record, question, input.includeAnswers));
  const preview: WorksheetPreview = { items: availability, totalCount: availability.length, readyCount: availability.filter(q => q.ready).length };
  if (parts[1] === 'preview') return json(preview);
  if (preview.readyCount !== preview.totalCount) return json({ error: '部分题目尚未完成打印核对，请处理后重试，或明确仅选择已就绪题目', code: 'WORKSHEET_NOT_READY', ...preview }, 409);
  if (!store.allow(`worksheet:${account}`, 8, 60000)) throw new HttpError(429, '正在生成文档，请稍后重试');
  // Snapshot selected content and order; no student work or model answer leaks into the exercise.
  const documentQuestions: WorksheetDocumentQuestion[] = items.map(({ record, question }) => ({ sourceTitle: sourceTitle(record, question), originalNumber: question.number,
    subject: question.subject || record.subject, stars: questionDifficultyStars(question), prepared: question.worksheet! }));
  try { worksheetDocumentBudget(documentQuestions, input.includeAnswers === true, true); } catch (e) { throw new HttpError(413, (e as Error).message); }
  if (exportingAccounts.has(account) || exportingAccounts.size >= 2) throw new HttpError(429, '文档正在生成，请完成后再试');
  exportingAccounts.add(account);
  try {
  // Only owned, selected scan versions may supply photographs. Read after obtaining a render slot.
  const images = new Map<string, WorksheetSourceImage>(); let imageBytes = 0;
  const sourceRecords = new Map(items.filter((_, i) => worksheetHasSourcePhotos(documentQuestions[i].prepared, input.includeAnswers === true)).map(({ record }) => [record.id, record]));
  if ([...sourceRecords.values()].reduce((sum, record) => sum + record.size, 0) > 128 * 1024 * 1024) throw new HttpError(413, '照片原件较多，请按科目分次导出，未省略任何题目');
  for (const [i, item] of items.entries()) if (worksheetHasSourcePhotos(documentQuestions[i].prepared, input.includeAnswers === true)) {
    request.signal.throwIfAborted();
    let image = images.get(item.record.id);
    if (!image) {
      image = await readSourcePhoto(store, account, item.record);
      imageBytes += image.bytes.length;
      if (imageBytes > 128 * 1024 * 1024) throw new HttpError(413, '照片原件较多，请按科目分次导出，未省略任何题目');
      images.set(item.record.id, image);
    }
    documentQuestions[i].sourceImage = image;
  }
  try { worksheetDocumentBudget(documentQuestions, input.includeAnswers === true); } catch (e) { throw new HttpError(413, (e as Error).message); }
  const bytes = await buildWorksheetDocx({ studentName: student.name, date: new Date().toISOString(), includeAnswers: input.includeAnswers === true, questions: documentQuestions, signal: request.signal });
  // No stale/private result is returned after a concurrent deletion, student move or edit.
  for (const { record } of items) {
    const current = readStoredScan(store, store.scanOwner(account), record.id);
    if (!current || current.deletedAt || current.studentId !== input.studentId || current.revision !== record.revision) throw new HttpError(409, '生成期间题目已更新，请刷新后重试');
  }
  requireStudent(store, account, input.studentId);
  const filename = `${student.name.replace(/[\\/:*?"<>|\r\n]/g, '_')}-错题练习卷.docx`;
  return new Response(new Uint8Array(bytes), { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Disposition': `attachment; filename="practice.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Access-Control-Expose-Headers': 'X-Content-SHA256, Content-Disposition',
    'Content-Length': String(bytes.length), 'X-Content-SHA256': createHash('sha256').update(bytes).digest('hex'),
  } });
  } finally { exportingAccounts.delete(account); }
}
async function readSourcePhoto(store: FamilyStore, account: string, record: ScanRecord) {
  try {
    const bytes = await readScanFile(store.scanOwner(account), record.id, record);
    return await worksheetSourceImage(bytes, record.sourcePage?.scanSha256);
  } catch { throw new HttpError(409, '题目照片原件不可用或版本校验失败，请恢复原件并重新核对'); }
}
async function prepare(store: FamilyStore, account: string, body: Record<string, unknown>) {
  const allowed = ['studentId', 'scanId', 'questionId', 'revision', 'sourceFingerprint', 'blocks', 'sharedMaterial', 'answerBlocks', 'answerSpaceMm', 'verificationNote'];
  if (Object.keys(body).some(k => !allowed.includes(k)) || typeof body.scanId !== 'string' || typeof body.questionId !== 'string' || !Number.isSafeInteger(body.revision) ||
    typeof body.verificationNote !== 'string' || body.verificationNote.trim().length < 10 || body.verificationNote.length > 2000 ||
    typeof body.answerSpaceMm !== 'number' || !Number.isFinite(body.answerSpaceMm) || body.answerSpaceMm < 8 || body.answerSpaceMm > 100) throw new HttpError(400, '请完整填写排版内容、答题空间及逐项核对说明');
  const record = await ownedScan(store, account, body.scanId), question = questionsOf(record).find(q => q.id === body.questionId);
  requireStudent(store, account, body.studentId);
  if (record.studentId !== body.studentId || !question) throw new HttpError(404, '当前学生的题目不存在');
  if (record.revision !== body.revision || body.sourceFingerprint !== worksheetSourceFingerprint(record, question)) throw new HttpError(409, '原题已变化，请重新对照原件核对');
  let content: PreparedWorksheetQuestion;
  try {
    content = { version: 1, sourceFingerprint: String(body.sourceFingerprint), blocks: validateWorksheetBlocks(body.blocks),
      ...(body.sharedMaterial === undefined ? {} : { sharedMaterial: validateWorksheetMaterial(body.sharedMaterial) }),
      ...(body.answerBlocks === undefined ? {} : { answerBlocks: validateWorksheetBlocks(body.answerBlocks) }),
      answerSpaceMm: body.answerSpaceMm, reviewedAt: new Date().toISOString(), reviewedBy: account, verificationNote: body.verificationNote.trim() };
  } catch (e) { throw new HttpError(400, (e as Error).message); }
  if (worksheetHasSourcePhotos(content)) {
    if (exportingAccounts.has(account) || exportingAccounts.size >= 2) throw new HttpError(429, '照片正在核对或文档正在生成，请稍后重试');
    exportingAccounts.add(account);
    try {
      const sourceImage = await readSourcePhoto(store, account, record);
      try { worksheetDocumentBudget([{ sourceTitle: '', originalNumber: question.number, subject: '', stars: 3, prepared: content, sourceImage }], true); }
      catch (e) { throw new HttpError(400, (e as Error).message); }
    } finally { exportingAccounts.delete(account); }
  }
  return store.transaction(() => {
    const owner = store.scanOwner(account), current = readStoredScan(store, owner, record.id);
    if (!current || current.deletedAt || current.studentId !== body.studentId) throw new HttpError(404, '当前学生的题目不存在');
    if (current.revision !== body.revision) throw new HttpError(409, '核对期间资料已变化，请刷新后重试');
    if (store.db.prepare("SELECT id FROM scan_jobs WHERE owner=? AND scan_id=? AND status IN ('queued','processing')").get(owner, current.id)) throw new HttpError(409, '原题正在分析，请等待完成后核对排版');
    const updated = writeStoredScan(store, owner, { ...current, revision: current.revision + 1,
      structuredQuestions: questionsOf(current).map(q => q.id === question.id ? { ...q, worksheet: content } : q) }, `worksheet-review:${account}`);
    return json({ scan: mobileScan(updated) });
  });
}
