import { randomUUID } from 'node:crypto';
import { recognitionEnabled, recognizeQuestions } from './model-gateway';
import {
  currentUser,
  HttpError,
  json,
  readBody,
  readJson,
  sameOrigin,
} from './family-backend';
import { getFamilyStore, type FamilyStore } from './family-store';
import {
  listScans,
  readScan,
  readScanFile,
  saveScan,
  scanWrongRecords,
  updateScan,
} from './scan-files';
import {
  scanSubjects,
  validateScanQuestions,
  type ScanRecord,
} from '../lib/scans';
import {
  MAX_SCAN_BYTES,
  sanitizeDisplayName,
  validateScanFile,
} from '../lib/upload-security';
export async function handleScans(
  request: Request,
  action: 'list' | 'item' | 'file' | 'recognize',
  id?: string,
  injected?: FamilyStore,
) {
  try {
    if (!process.env.FAMILY_DATA_DIR)
      return json({ error: '私人存储尚未配置' }, 503);
    const store = injected || getFamilyStore();
    const user = currentUser(request, store);
    if (!user) return json({ error: '请先登录家庭账号' }, 401);
    if (request.method !== 'GET') sameOrigin(request);
    const owner = store.scanOwner(user.id);
    if (action === 'list') {
      if (request.method === 'GET')
        return json({
          items: (await listScans(owner, store)).filter(
            (x) =>
              !x.studentId ||
              x.studentId === 'dabao' ||
              x.studentId === 'xiaobao',
          ),
          recognition: recognitionEnabled(),
        });
      if (!store.allow(`upload:${user.id}`, 30, 3600000))
        throw new HttpError(429, '上传过于频繁，请稍后再试');
      const all = await listScans(owner, store);
      if (
        all.reduce((total, item) => total + item.size, 0) >=
        500 * 1024 * 1024
      )
        throw new HttpError(413, '扫描空间已达 500 MB，请联系维护人员扩容');
      const bytes = await readBody(request, MAX_SCAN_BYTES + 65536);
      const form = await new Response(new Uint8Array(bytes), {
        headers: { 'Content-Type': request.headers.get('content-type') || '' },
      }).formData();
      const file = form.get('file'),
        subjectValue = form.get('subject'),
        sourceValue = form.get('source'),
        child = form.get('child');
      const subject = typeof subjectValue === 'string' ? subjectValue : '',
        source = typeof sourceValue === 'string' ? sourceValue.trim() : '';
      if (
        !(file instanceof File) ||
        !scanSubjects.includes(subject as never) ||
        !source ||
        source.length > 200 ||
        (child !== 'xiaobao' && child !== 'dabao')
      )
        throw new HttpError(400, '请填写孩子、学科、出处并选择文件');
      const result = await validateScanFile(file);
      if (!result.ok) throw new HttpError(400, result.reason);
      if (
        all.reduce((total, item) => total + item.size, 0) + file.size >
        500 * 1024 * 1024
      )
        throw new HttpError(413, '扫描空间已达 500 MB，请联系维护人员扩容');
      const scanId = randomUUID();
      const record: ScanRecord = {
        id: scanId,
        child,
        subject,
        source,
        originalName: sanitizeDisplayName(file.name),
        mimeType: result.mime,
        size: file.size,
        status: '待整理',
        createdAt: new Date().toISOString(),
        fileUrl: `/family-learning/api/family/scans/${scanId}/file`,
        revision: 0,
        questions: [],
      };
      await saveScan(
        owner,
        record,
        new Uint8Array(await file.arrayBuffer()),
        store,
      );
      return json({ item: record }, 201);
    }
    if (
      !id ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
    )
      throw new HttpError(404, '记录不存在');
    const record = await readScan(owner, id, store);
    if (!record) throw new HttpError(404, '记录不存在');
    if (action === 'file') {
      const bytes = await readScanFile(owner, id);
      return new Response(new Uint8Array(bytes), {
        headers: {
          'Content-Type': record.mimeType,
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(record.originalName)}`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'SAMEORIGIN',
        },
      });
    }
    if (action === 'item' && request.method === 'GET')
      return json({ item: record });
    if (record.structuredQuestions)
      throw new HttpError(
        409,
        '这份资料已启用分题与步骤校对，请在学生资料工作台继续编辑',
      );
    if (action === 'recognize') {
      if (!recognitionEnabled())
        throw new HttpError(503, 'AI 识题暂未启用，原件已保存，可先手动整理');
      const maximum = Math.max(
        1,
        Math.min(50, Number(process.env.FAMILY_AI_DAILY_LIMIT) || 10),
      );
      if (!store.allow(`recognize:${user.id}`, maximum, 24 * 3600000))
        throw new HttpError(
          429,
          `已达到本家庭 24 小时内 ${maximum} 次识题限额`,
        );
      const started = await updateScan(
        owner,
        id,
        (current) => {
          if (current.structuredQuestions)
            throw new HttpError(
              409,
              '资料已转为分题校对，请在学生资料工作台继续',
            );
          if (
            current.deletedAt ||
            current.confirmedAt ||
            current.questions?.length
          )
            throw new HttpError(
              409,
              '已有整理结果或记录在回收站，请直接核对编辑',
            );
          if (
            current.status === '识别中' &&
            Date.now() - Date.parse(current.startedAt || '') < 180000
          )
            throw new HttpError(409, '正在识别，请稍候');
          return {
            ...current,
            status: '识别中',
            startedAt: new Date().toISOString(),
            error: undefined,
          };
        },
        store,
      );
      try {
        const questions = await recognizeQuestions(
          started,
          await readScanFile(owner, id),
        );
        const item = await updateScan(
          owner,
          id,
          (current) => {
            if (current.revision !== started.revision)
              throw new HttpError(409, '记录已更新，请刷新后查看');
            return { ...current, questions, status: '待核对' };
          },
          store,
        );
        return json({ item });
      } catch (e) {
        await updateScan(
          owner,
          id,
          (current) =>
            current.revision === started.revision
              ? {
                  ...current,
                  status: '识别失败',
                  error:
                    e instanceof HttpError
                      ? e.message
                      : '识别超时或网络中断，原件已保留',
                }
              : current,
          store,
        );
        throw e;
      }
    }
    const body = await readJson(request, 2 * 1024 * 1024);
    // Archive the last confirmed version before applying any edits.
    store.merge(user.id, await scanWrongRecords(owner, store));
    const item = await updateScan(
      owner,
      id,
      (current) => {
        if (current.structuredQuestions)
          throw new HttpError(
            409,
            '资料已转为分题校对，请在学生资料工作台继续',
          );
        if (body.revision !== current.revision)
          throw new HttpError(
            409,
            '其他设备已修改这份记录，请重新打开后再编辑',
          );
        if (body.action === 'trash')
          return { ...current, deletedAt: new Date().toISOString() };
        if (body.action === 'restore')
          return { ...current, deletedAt: undefined };
        if (current.deletedAt) throw new HttpError(409, '请先从回收站恢复');
        if (body.action === 'rotate')
          return { ...current, rotation: ((current.rotation || 0) + 90) % 360 };
        if (body.action !== 'save' && body.action !== 'confirm')
          throw new HttpError(400, '无效操作');
        let questions;
        try {
          questions = validateScanQuestions(body.questions);
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
        const confirmedQuestions =
          body.action === 'confirm'
            ? questions
            : current.confirmedQuestions ||
              (current.confirmedAt ? current.questions : undefined);
        return {
          ...current,
          questions,
          confirmedQuestions,
          status: body.action === 'confirm' ? '已核对' : '待核对',
          ...(body.action === 'confirm'
            ? { confirmedAt: new Date().toISOString() }
            : {}),
        };
      },
      store,
    );
    if (body.action === 'confirm')
      store.merge(user.id, await scanWrongRecords(owner, store));
    return json({ item });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(
      'Scan request failed:',
      e instanceof Error ? e.name : 'unknown',
    );
    return json({ error: '处理暂时失败，原件和已保存的记录仍保留' }, 500);
  }
}
