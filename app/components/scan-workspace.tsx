'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState, type SubmitEvent } from 'react';
import { appPath } from '@/lib/deployment';
import { childLabel, syncFamily } from '@/lib/family-client';
import {
  blankScanQuestion,
  scanFields,
  scanSubjects,
  type ScanQuestion,
  type ScanRecord,
} from '@/lib/scans';
import type { ChildId } from '@/lib/family-state';
import type { LearningSubject } from '@/lib/learning';
import { WorkbenchHeader } from './workbench-header';
const button =
  'min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50';
const field =
  'mt-1 min-h-11 w-full rounded-lg border bg-background px-3 py-2 text-sm';
async function request(
  path: string,
  body?: FormData | Record<string, unknown>,
) {
  const response = await fetch(appPath(`/api/family/scans${path}`), {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body instanceof FormData
      ? { body }
      : body
        ? {
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
          }
        : {}),
    signal: AbortSignal.timeout(120000),
  });
  const data = (await response.json()) as {
    error?: string;
    item?: ScanRecord;
    items?: ScanRecord[];
    recognition?: boolean;
  };
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}
export function ScanWorkspace() {
  const [items, setItems] = useState<ScanRecord[]>([]);
  const [item, setItem] = useState<ScanRecord | null>(null);
  const [questions, setQuestions] = useState<ScanQuestion[]>([]);
  const [child, setChild] = useState<ChildId>('dabao');
  const [subject, setSubject] = useState<LearningSubject>('数学');
  const [recognition, setRecognition] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [trash, setTrash] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function open(record: ScanRecord) {
    setItem(record);
    setQuestions(record.questions || []);
    setDirty(false);
  }
  function accept(record: ScanRecord) {
    setItems((old) => [record, ...old.filter((x) => x.id !== record.id)]);
    open(record);
  }
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);

    void request('')
      .then((data) => {
        if (query.get('child') === 'xiaobao') setChild('xiaobao');
        setItems(data.items || []);
        setRecognition(Boolean(data.recognition));
        const selected = data.items?.find((x) => x.id === query.get('id'));
        if (selected) open(selected);
      })
      .catch((e) => setMessage(e.message));
  }, []);
  async function upload(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (dirty && !window.confirm('当前整理尚未保存，确定上传另一份扫描吗？'))
      return;
    const form = new FormData(formElement);
    form.set('child', child);
    form.set('subject', subject);
    setBusy(true);
    setMessage('正在保存原件…');
    try {
      const data = await request('', form);
      if (data.item) accept(data.item);
      formElement.reset();
      setMessage('原件已保存。可以逐题填写，或使用自动识题后核对。');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function act(
    action: 'save' | 'confirm' | 'rotate' | 'trash' | 'restore' | 'recognize',
  ) {
    if (!item) return;
    if (
      action === 'trash' &&
      !window.confirm('将原件移到回收站？已收录的错题和作答历史会保留。')
    )
      return;
    setBusy(true);
    setMessage(
      action === 'recognize' ? '正在识题，请稍候。原件已保存。' : '正在保存…',
    );
    try {
      const data = await request(
        `/${item.id}${action === 'recognize' ? '/recognize' : ''}`,
        action === 'recognize'
          ? {}
          : { action, revision: item.revision, questions },
      );
      if (data.item) accept(data.item);
      setMessage(
        action === 'confirm'
          ? '核对已保存，勾选的题目已归入错题本。'
          : action === 'recognize'
            ? '识别结果需要逐题核对，确认后再收录错题。'
            : '已保存。',
      );
      if (action === 'confirm') await syncFamily();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function change(
    index: number,
    key: keyof ScanQuestion,
    value: string | boolean,
  ) {
    setQuestions((old) =>
      old.map((q, i) => (i === index ? { ...q, [key]: value } : q)),
    );
    setDirty(true);
  }
  return (
    <main className="min-h-screen">
      <WorkbenchHeader backHref="/" backLabel="家庭总览" />
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">
        <header>
          <p className="text-sm font-bold text-primary">扫描与逐题整理</p>
          <h1 className="mt-2 text-3xl font-bold">把试卷里的卡点留下来</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            先保存原件，再核对题干、图示和孩子的真实作答。只有勾选的题目会进入错题本。
          </p>
          <Link href="/account" className="mt-2 inline-block text-sm underline">
            家庭登录与备份
          </Link>
        </header>
        {message && (
          <output className="block rounded-xl border bg-secondary/40 p-4 text-sm">
            {message}
          </output>
        )}
        <form
          onSubmit={upload}
          className="grid gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-2"
        >
          <label className="text-sm font-bold">
            孩子
            <select
              className={field}
              value={child}
              onChange={(e) => setChild(e.target.value as ChildId)}
            >
              <option value="dabao">大宝</option>
              <option value="xiaobao">小宝</option>
            </select>
          </label>
          <label className="text-sm font-bold">
            学科
            <select
              className={field}
              value={subject}
              onChange={(e) => setSubject(e.target.value as LearningSubject)}
            >
              {scanSubjects.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-bold">
            出处
            <input
              className={field}
              name="source"
              maxLength={200}
              placeholder="例如：数学周练，第 2 页"
              required
            />
          </label>
          <label className="text-sm font-bold">
            照片或 PDF（不超过 8 MB）
            <input
              className="mt-3 block w-full text-sm"
              type="file"
              name="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              required
            />
          </label>
          <div>
            <button className={button} disabled={busy}>
              保存扫描原件
            </button>
          </div>
        </form>
        <section className="rounded-2xl border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">
              {trash ? '回收站' : '已保存的扫描'}
            </h2>
            <button
              className="min-h-11 text-sm underline"
              onClick={() => setTrash(!trash)}
            >
              {trash ? '返回扫描列表' : '查看回收站'}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {items
              .filter((x) => Boolean(x.deletedAt) === trash)
              .map((record) => (
                <button
                  className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm ${item?.id === record.id ? 'border-primary bg-secondary/50' : ''}`}
                  key={record.id}
                  disabled={busy}
                  onClick={() => {
                    if (
                      !dirty ||
                      window.confirm('当前修改尚未保存，确定打开另一份扫描吗？')
                    )
                      open(record);
                  }}
                >
                  {childLabel(record.child || 'dabao')} · {record.source}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {record.status} · {record.createdAt.slice(0, 10)}
                  </span>
                </button>
              ))}
          </div>
          {items.filter((x) => Boolean(x.deletedAt) === trash).length === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              这里还没有记录。
            </p>
          )}
        </section>
        {item && (
          <section className="rounded-2xl border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">{item.source}</h2>
                <p className="mt-2 text-xs text-muted-foreground">
                  {item.originalName} · {item.status}
                  {dirty ? ' · 有未保存的修改' : ''}
                </p>
              </div>
              <a
                className="min-h-11 py-3 text-sm underline"
                href={appPath(`/api/family/scans/${item.id}/file`)}
                target="_blank"
                rel="noreferrer"
              >
                新窗口查看原件
              </a>
            </div>
            <div className="mt-4 overflow-hidden rounded-xl bg-muted p-2">
              {item.mimeType === 'application/pdf' ? (
                <iframe
                  title="扫描 PDF 原件"
                  src={appPath(`/api/family/scans/${item.id}/file`)}
                  className="h-[480px] w-full"
                />
              ) : (
                <div className="flex h-[420px] items-center justify-center">
                  <Image
                    unoptimized
                    width={1200}
                    height={1600}
                    alt="扫描原件"
                    src={appPath(`/api/family/scans/${item.id}/file`)}
                    className="max-h-full max-w-full object-contain"
                    style={{
                      width: 'auto',
                      height: 'auto',
                      transform: `rotate(${item.rotation || 0}deg)`,
                    }}
                  />
                </div>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              {item.deletedAt ? (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void act('restore')}
                >
                  从回收站恢复
                </button>
              ) : (
                <>
                  <button
                    className={button}
                    disabled={
                      busy ||
                      dirty ||
                      !recognition ||
                      Boolean(item.questions?.length) ||
                      Boolean(item.confirmedAt)
                    }
                    onClick={() => void act('recognize')}
                  >
                    自动识题
                  </button>
                  <button
                    className="min-h-11 rounded-lg border px-4 text-sm"
                    disabled={busy || questions.length >= 100}
                    onClick={() => {
                      setQuestions((old) => [
                        ...old,
                        blankScanQuestion(item.subject as LearningSubject),
                      ]);
                      setDirty(true);
                    }}
                  >
                    手动增加一道题
                  </button>
                  {item.mimeType !== 'application/pdf' && (
                    <button
                      className="min-h-11 rounded-lg border px-4 text-sm"
                      disabled={busy || dirty}
                      onClick={() => void act('rotate')}
                    >
                      旋转预览
                    </button>
                  )}
                  <button
                    className="min-h-11 px-3 text-sm text-destructive underline"
                    disabled={busy}
                    onClick={() => void act('trash')}
                  >
                    移到回收站
                  </button>
                </>
              )}
            </div>
            {!recognition && (
              <p className="mt-3 text-xs text-muted-foreground">
                自动识题暂未启用，可以先手动整理；已保存的原件可稍后继续识别。
              </p>
            )}
            {!item.deletedAt &&
              questions.map((question, index) => (
                <details
                  className="mt-4 rounded-xl border p-4"
                  key={index}
                  open={index === 0}
                >
                  <summary className="cursor-pointer font-bold">
                    第 {index + 1} 道 · {question.number || '待填写原题号'}
                    {question.selected ? ' · 已勾选错题' : ''}
                  </summary>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="flex min-h-11 items-center gap-2 text-sm font-bold sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={question.selected}
                        onChange={(e) =>
                          change(index, 'selected', e.target.checked)
                        }
                      />
                      这道题做错或思路不完整，确认后收入错题本
                    </label>
                    <label className="text-sm">
                      学科
                      <select
                        className={field}
                        value={question.subject}
                        onChange={(e) =>
                          change(index, 'subject', e.target.value)
                        }
                      >
                        {scanSubjects.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                    {(
                      Object.entries(scanFields) as [
                        keyof typeof scanFields,
                        string,
                      ][]
                    ).map(([key, label]) => (
                      <label
                        className={`text-sm ${key === 'prompt' || key === 'analysis' ? 'sm:col-span-2' : ''}`}
                        key={key}
                      >
                        {label}
                        <textarea
                          aria-label={label}
                          className={field}
                          rows={key === 'prompt' || key === 'analysis' ? 4 : 2}
                          maxLength={12000}
                          value={question[key]}
                          onChange={(e) => change(index, key, e.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                </details>
              ))}
            {!item.deletedAt && questions.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  className="min-h-11 rounded-lg border px-4 text-sm font-bold"
                  disabled={busy}
                  onClick={() => void act('save')}
                >
                  保存整理草稿
                </button>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void act('confirm')}
                >
                  已核对原件，确认收录所选错题
                </button>
                <Link
                  className="min-h-11 px-3 py-3 text-sm underline"
                  href={`/${item.child || 'dabao'}/wrong-book`}
                >
                  打开错题本
                </Link>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
