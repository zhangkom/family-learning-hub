'use client';

import Link from 'next/link';
import Image from 'next/image';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type SubmitEvent,
} from 'react';
import { appPath } from '@/lib/deployment';
import { currentFamily, listenLearning } from '@/lib/family-client';
import type {
  AnswerStep,
  MobileScan,
  Question,
  Region,
  Student,
} from '@/lib/mobile';
import { WorkbenchHeader } from './workbench-header';

const field =
  'mt-1 min-h-11 w-full rounded-lg border bg-background px-3 py-2 text-sm';
const button =
  'min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50';
const secondary =
  'min-h-11 rounded-lg border px-3 py-2 text-sm disabled:opacity-50';
type Payload = {
  students?: Student[];
  student?: Student;
  scans?: MobileScan[];
  scan?: MobileScan;
  recognition?: boolean;
  error?: string;
};
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<Payload> {
  const response = await fetch(appPath('/api/family/workspace/' + path), {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : body instanceof FormData
        ? { body }
        : {
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
          }),
  });
  const data = (await response.json()) as Payload;
  if (!response.ok) throw new Error(data.error || '读取失败，请重试');
  return data;
}
function blankQuestion(number: number): Question {
  return {
    id: crypto.randomUUID(),
    number: String(number),
    prompt: '',
    diagram: '',
    knowledgePoints: [],
    regions: [],
    sharedRegionIds: [],
    answerSteps: [],
    uncertainties: [],
    confirmed: false,
  };
}
type Drag = {
  questionId: string;
  regionId?: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  original?: Region;
};
export function StudentWorkspace() {
  const [students, setStudents] = useState<Student[]>([]),
    [studentId, setStudentId] = useState('');
  const [scans, setScans] = useState<MobileScan[]>([]),
    [scan, setScan] = useState<MobileScan | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]),
    [questionId, setQuestionId] = useState('');
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [recognition, setRecognition] = useState(false);
  const [message, setMessage] = useState(''),
    [regionKind, setRegionKind] = useState<Region['kind']>('stem');
  const [drag, setDrag] = useState<Drag | null>(null);
  const selectedRef = useRef(''),
    scanRef = useRef<MobileScan | null>(null),
    dirtyRef = useRef(false),
    busyRef = useRef(false),
    generation = useRef(0);
  const uploadIds = useRef(new Map<string, string>());
  useEffect(() => {
    scanRef.current = scan;
    dirtyRef.current = dirty;
    busyRef.current = busy;
  }, [scan, dirty, busy]);
  const question = questions.find((q) => q.id === questionId);
  const student = students.find((s) => s.id === studentId);
  function chooseStudent(id: string) {
    selectedRef.current = id;
    generation.current++;
    setStudentId(id);
    setScans([]);
    setScan(null);
    setQuestions([]);
    setQuestionId('');
    setDirty(false);
    setDrag(null);
    sessionStorage.setItem('family-workspace-student', id);
  }
  const loadStudents = useCallback(async () => {
    const started = generation.current;
    try {
      const data = await request('students');
      if (started !== generation.current) return;
      const entries = data.students || [];
      setStudents(entries);
      const preferred =
        selectedRef.current ||
        new URLSearchParams(location.search).get('studentId') ||
        sessionStorage.getItem('family-workspace-student');
      const next =
        entries.find((s) => s.id === preferred)?.id || entries[0]?.id || '';
      if (next !== selectedRef.current) {
        selectedRef.current = next;
        setStudentId(next);
        generation.current++;
      }
    } catch (e) {
      setStudents([]);
      setMessage((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(loadStudents);
    let family = currentFamily()?.id || null;
    return listenLearning(() => {
      const next = currentFamily()?.id || null;
      if (next !== family) {
        family = next;
        selectedRef.current = '';
        generation.current++;
        setStudents([]);
        setStudentId('');
        setScans([]);
        setScan(null);
        setQuestions([]);
        setDirty(false);
        void loadStudents();
      }
    });
  }, [loadStudents]);
  useEffect(() => {
    if (!studentId) return;
    const current = generation.current;
    let active = true;
    const refresh = async () => {
      try {
        const data = await request(
          'scans?studentId=' + encodeURIComponent(studentId),
        );
        if (
          !active ||
          generation.current !== current ||
          selectedRef.current !== studentId
        )
          return;
        const items = data.scans || [];
        setScans(items);
        setRecognition(Boolean(data.recognition));
        const selected = items.find((s) => s.id === scanRef.current?.id);
        if (selected && !dirtyRef.current && !busyRef.current) {
          setScan(selected);
          setQuestions(selected.questions);
        }
      } catch (e) {
        if (active) setMessage((e as Error).message);
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden && !busyRef.current) void refresh();
    }, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [studentId]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);
  function accept(value: MobileScan) {
    if (value.studentId !== selectedRef.current) return;
    scanRef.current = value;
    dirtyRef.current = false;
    setScans((old) => [value, ...old.filter((s) => s.id !== value.id)]);
    setScan(value);
    setQuestions(value.questions);
    setDirty(false);
    setDrag(null);
    setQuestionId((old) =>
      value.questions.some((q) => q.id === old)
        ? old
        : value.questions[0]?.id || '',
    );
  }
  function changeQuestion(id: string, change: Partial<Question>) {
    dirtyRef.current = true;
    setQuestions((old) =>
      old.map((q) =>
        q.id === id
          ? {
              ...q,
              ...change,
              ...(change.confirmed === undefined ? { confirmed: false } : {}),
            }
          : q,
      ),
    );
    setDirty(true);
  }
  async function addStudent(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    setBusy(true);
    try {
      const result = await request('students', 'POST', {
        name: data.get('name'),
        grade: data.get('grade'),
      });
      if (result.student) {
        setStudents((old) => [...old, result.student!]);
        chooseStudent(result.student.id);
      }
      form.reset();
      setMessage('学生已添加。资料会保存在所选学生名下。');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form),
      capturedStudent = studentId;
    if (dirty && !confirm('当前校对未保存，确定上传另一份资料吗？')) return;
    const file = data.get('file');
    if (!(file instanceof File)) return;
    const source = data.get('source');
    const fingerprint = `${capturedStudent}:${file.name}:${file.size}:${file.lastModified}:${typeof source === 'string' ? source : ''}`;
    let id = uploadIds.current.get(fingerprint);
    if (!id) {
      id = crypto.randomUUID();
      uploadIds.current.set(fingerprint, id);
    }
    data.set('studentId', capturedStudent);
    data.set('subject', '数学');
    data.set('clientRequestId', id);
    setBusy(true);
    setMessage('正在保存原件…');
    try {
      const result = await request('scans', 'POST', data);
      if (result.scan) accept(result.scan);
      form.reset();
      uploadIds.current.delete(fingerprint);
      setMessage('原件已保存到上传时选择的学生，可手动分题或开始识别。');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!scan) return;
    const current = scan;
    setBusy(true);
    try {
      const result = await request(`scans/${current.id}/review`, 'PUT', {
        revision: current.revision,
        questions,
      });
      if (result.scan) accept(result.scan);
      setMessage('校对已保存，原图和先前修订仍保留。');
    } catch (e) {
      setMessage(
        (e as Error).message + '。当前草稿仍在页面，可先下载草稿再重新打开。',
      );
    } finally {
      setBusy(false);
    }
  }
  async function recognize() {
    if (!scan) return;
    setBusy(true);
    try {
      const result = await request(`scans/${scan.id}/recognize`, 'POST', {
        revision: scan.revision,
      });
      if (result.scan) accept(result.scan);
      setMessage('识别已排队，可以离开页面后再回来查看。');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function exportDraft() {
    if (!scan) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              scanId: scan.id,
              studentId: scan.studentId,
              revision: scan.revision,
              questions,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `校对草稿-${scan.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function point(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }
  function startDrag(event: PointerEvent<SVGSVGElement>) {
    if (!question || busy || !event.isPrimary || event.button !== 0) return;
    const { x, y } = point(event),
      target = (event.target as Element).closest('[data-region]');
    const owner = questions.find(
      (q) => q.id === target?.getAttribute('data-question'),
    );
    const region = owner?.regions.find(
      (r) => r.id === target?.getAttribute('data-region'),
    );
    event.currentTarget.setPointerCapture(event.pointerId);
    if (region && owner) {
      setQuestionId(owner.id);
      setDrag({
        questionId: owner.id,
        regionId: region.id,
        startX: x,
        startY: y,
        ...region,
        original: region,
      });
    } else
      setDrag({
        questionId: question.id,
        startX: x,
        startY: y,
        x,
        y,
        width: 0,
        height: 0,
      });
  }
  function moveDrag(event: PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const { x, y } = point(event);
    setDrag(
      drag.original
        ? {
            ...drag,
            x: Math.max(
              0,
              Math.min(1 - drag.width, drag.original.x + x - drag.startX),
            ),
            y: Math.max(
              0,
              Math.min(1 - drag.height, drag.original.y + y - drag.startY),
            ),
          }
        : {
            ...drag,
            x: Math.min(x, drag.startX),
            y: Math.min(y, drag.startY),
            width: Math.abs(x - drag.startX),
            height: Math.abs(y - drag.startY),
          },
    );
  }
  function finishDrag() {
    if (!drag) return;
    const target = questions.find((q) => q.id === drag.questionId);
    if (target && drag.width > 0.005 && drag.height > 0.005) {
      const region: Region = {
        id: drag.regionId || crypto.randomUUID(),
        kind: drag.original?.kind || regionKind,
        x: drag.x,
        y: drag.y,
        width: drag.width,
        height: drag.height,
      };
      changeQuestion(target.id, {
        regions: drag.regionId
          ? target.regions.map((r) => (r.id === drag.regionId ? region : r))
          : [...target.regions, region],
      });
    }
    setDrag(null);
  }
  function removeRegions(ids: Set<string>, removeQuestionId?: string) {
    setQuestions((old) =>
      old
        .filter((q) => q.id !== removeQuestionId)
        .map((q) => ({
          ...q,
          confirmed: false,
          parentQuestionId:
            q.parentQuestionId === removeQuestionId
              ? undefined
              : q.parentQuestionId,
          regions: q.regions.filter((r) => !ids.has(r.id)),
          sharedRegionIds: q.sharedRegionIds?.filter((id) => !ids.has(id)),
          answerSteps: q.answerSteps.map((s) => ({
            ...s,
            regionIds: s.regionIds.filter((id) => !ids.has(id)),
          })),
        })),
    );
    setDirty(true);
  }
  function editStep(id: string, value: Partial<AnswerStep>) {
    if (question)
      changeQuestion(question.id, {
        answerSteps: question.answerSteps.map((s) =>
          s.id === id ? { ...s, ...value } : s,
        ),
      });
  }
  const statuses = {
    queued: '排队中',
    processing: '识别中',
    needs_review: '待校对',
    ready: '已校对',
    failed: '处理失败',
  };
  const kinds = {
    stem: '题干',
    figure: '配图',
    answer: '作答',
    annotation: '批注',
  };
  const allRegions = questions.flatMap((q) =>
    q.regions.map((r) => ({ ...r, question: q.number })),
  );
  return (
    <main className="min-h-screen">
      <WorkbenchHeader backHref="/family-review" backLabel="家长复盘" />
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-7">
        <header>
          <p className="text-sm font-bold text-primary">家庭资料工作台</p>
          <h1 className="mt-2 text-3xl font-bold">
            把题目和孩子的思路留在一起
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            选择学生，保存原图，再核对题目与可见手写步骤。校对不计为独立完成练习。
          </p>
          <Link href="/account" className="mt-3 inline-block text-sm underline">
            家庭登录与账号管理
          </Link>
        </header>
        <output className="block rounded-xl bg-secondary/40 px-4 py-3 text-sm">
          {message || '原件保存在私人空间，网页与手机共用同一份资料。'}
        </output>
        <section className="grid gap-5 rounded-2xl border bg-card p-5 md:grid-cols-2">
          <label className="font-bold">
            当前学生
            <select
              aria-label="当前学生"
              className={field}
              value={studentId}
              onChange={(e) => {
                if (!dirty || confirm('当前校对未保存，确定切换学生吗？'))
                  chooseStudent(e.target.value);
              }}
            >
              {!students.length && <option value="">请先登录或添加学生</option>}
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.grade ? ` · ${s.grade}` : ''}
                </option>
              ))}
            </select>
            <span className="mt-2 block text-xs font-normal text-muted-foreground">
              切换学生不改变已上传资料或在途任务的归属。
            </span>
          </label>
          <form
            onSubmit={addStudent}
            className="flex flex-wrap items-end gap-2"
          >
            <label className="flex-1 text-sm">
              学生姓名
              <input className={field} name="name" required maxLength={60} />
            </label>
            <label className="flex-1 text-sm">
              年级（可选）
              <input className={field} name="grade" maxLength={80} />
            </label>
            <button className={secondary} disabled={busy || dirty}>
              添加学生
            </button>
          </form>
        </section>
        {student && (
          <form
            onSubmit={upload}
            className="grid items-end gap-4 rounded-2xl border bg-card p-5 md:grid-cols-3"
          >
            <label className="text-sm">
              {student.name} · 数学资料出处
              <input
                className={field}
                name="source"
                placeholder="例如：周练第 2 页"
                maxLength={200}
                required
                disabled={busy}
              />
            </label>
            <label className="text-sm">
              照片或 PDF，最大 8 MiB
              <input
                name="file"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                required
                disabled={busy}
                className="mt-3 block w-full text-sm"
              />
            </label>
            <button className={button} disabled={busy}>
              保存到{student.name}的资料
            </button>
          </form>
        )}
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="font-bold">{student?.name || '学生'}的资料</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {scans.map((s) => (
              <button
                key={s.id}
                disabled={busy}
                className={`${secondary} ${scan?.id === s.id ? 'border-primary bg-secondary/50' : ''}`}
                onClick={() => {
                  if (!dirty || confirm('当前草稿未保存，确定重新打开资料吗？'))
                    accept(s);
                }}
              >
                {s.source} · {statuses[s.status]}
              </button>
            ))}
            {!scans.length && (
              <p className="text-sm text-muted-foreground">
                还没有资料，上传原件后即可开始校对。
              </p>
            )}
          </div>
        </section>
        {scan && (
          <section className="space-y-5 rounded-2xl border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">
                  {student?.name} · {scan.source}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {statuses[scan.status]}
                  {dirty ? ' · 草稿未保存' : ''}
                </p>
                {scan.error && (
                  <p className="mt-2 text-sm text-destructive">{scan.error}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className={secondary}
                  disabled={
                    busy ||
                    dirty ||
                    !recognition ||
                    !!questions.length ||
                    ['queued', 'processing'].includes(scan.status)
                  }
                  onClick={() => void recognize()}
                >
                  识别可见题目与笔迹
                </button>
                <button className={secondary} onClick={exportDraft}>
                  下载校对草稿
                </button>
                <button
                  className={button}
                  disabled={busy || !dirty}
                  onClick={() => void save()}
                >
                  保存校对
                </button>
              </div>
            </div>
            <fieldset disabled={busy} className="min-w-0">
              <legend className="sr-only">题目与笔迹校对</legend>
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">为当前题目框选：</span>
                    <select
                      aria-label="区域类型"
                      className={secondary}
                      value={regionKind}
                      onChange={(e) =>
                        setRegionKind(e.target.value as Region['kind'])
                      }
                    >
                      {Object.entries(kinds).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <a
                      className="text-sm underline"
                      href={appPath(
                        `/api/family/workspace/scans/${scan.id}/file`,
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      放大查看原件
                    </a>
                  </div>
                  {scan.mimeType === 'application/pdf' ? (
                    <iframe
                      title="原始 PDF"
                      className="h-[560px] w-full rounded-xl border"
                      src={appPath(
                        `/api/family/workspace/scans/${scan.id}/file`,
                      )}
                    />
                  ) : (
                    <div className="relative overflow-hidden rounded-xl border bg-muted">
                      {/* The original bytes are shown without cropping or an extra rotation. */}
                      <Image
                        unoptimized
                        width={1200}
                        height={1600}
                        alt="上传原图，覆盖可校对的题目区域"
                        src={appPath(
                          `/api/family/workspace/scans/${scan.id}/file`,
                        )}
                        className="block h-auto w-full"
                      />
                      <svg
                        aria-label="原图区域编辑器"
                        viewBox="0 0 1 1"
                        preserveAspectRatio="none"
                        className="absolute inset-0 h-full w-full touch-none"
                        onPointerDown={startDrag}
                        onPointerMove={moveDrag}
                        onPointerUp={finishDrag}
                        onPointerCancel={() => setDrag(null)}
                      >
                        {questions.flatMap((q) =>
                          q.regions.map((r) => (
                            <g key={r.id}>
                              <rect
                                data-region={r.id}
                                data-question={q.id}
                                x={r.x}
                                y={r.y}
                                width={r.width}
                                height={r.height}
                                fill={
                                  q.id === questionId
                                    ? '#0d948826'
                                    : '#64748b18'
                                }
                                stroke={
                                  q.id === questionId ? '#0d9488' : '#64748b'
                                }
                                strokeWidth=".003"
                              />
                              <text
                                x={r.x + 0.005}
                                y={r.y + 0.022}
                                fontSize=".022"
                                fill="#0f766e"
                                pointerEvents="none"
                              >
                                {q.number || '题'} · {kinds[r.kind]}
                              </text>
                            </g>
                          )),
                        )}
                        {drag && (
                          <rect
                            x={drag.x}
                            y={drag.y}
                            width={drag.width}
                            height={drag.height}
                            fill="#0d948833"
                            stroke="#0d9488"
                            strokeWidth=".004"
                          />
                        )}
                      </svg>
                    </div>
                  )}
                  <p className="text-xs leading-6 text-muted-foreground">
                    先选一道题，在原图拖出区域；拖动已有框可调整位置。大小也可在区域数值中修改。识别文字均需校对，无可靠坐标时不会自动画框。PDF
                    首轮可保存和转写，框选请改传页面照片。
                  </p>
                </div>
                <div className="min-w-0 space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {questions.map((q, i) => (
                      <button
                        key={q.id}
                        className={`${secondary} ${q.id === questionId ? 'border-primary bg-secondary/50' : ''}`}
                        onClick={() => setQuestionId(q.id)}
                      >
                        {q.number || `题 ${i + 1}`}
                        {q.confirmed ? ' ✓' : ''}
                      </button>
                    ))}
                    <button
                      className={secondary}
                      disabled={busy || questions.length >= 100}
                      onClick={() => {
                        const q = blankQuestion(questions.length + 1);
                        setQuestions((old) => [...old, q]);
                        setQuestionId(q.id);
                        setDirty(true);
                      }}
                    >
                      增加一道题
                    </button>
                  </div>
                  {question ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-sm">
                          原题号
                          <input
                            className={field}
                            value={question.number}
                            onChange={(e) =>
                              changeQuestion(question.id, {
                                number: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label className="text-sm">
                          父题 / 共享题干
                          <select
                            className={field}
                            value={question.parentQuestionId || ''}
                            onChange={(e) =>
                              changeQuestion(question.id, {
                                parentQuestionId: e.target.value || undefined,
                              })
                            }
                          >
                            <option value="">独立题目</option>
                            {questions
                              .filter((q) => q.id !== question.id)
                              .map((q) => (
                                <option key={q.id} value={q.id}>
                                  {q.number || '未编号题目'}
                                </option>
                              ))}
                          </select>
                        </label>
                      </div>
                      <label className="block text-sm">
                        题干与条件
                        <textarea
                          aria-label="题干与条件"
                          className={field}
                          rows={4}
                          value={question.prompt}
                          onChange={(e) =>
                            changeQuestion(question.id, {
                              prompt: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="block text-sm">
                        配图说明
                        <textarea
                          className={field}
                          value={question.diagram}
                          onChange={(e) =>
                            changeQuestion(question.id, {
                              diagram: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="block text-sm">
                        知识点（每行一个）
                        <textarea
                          className={field}
                          value={question.knowledgePoints.join('\n')}
                          onChange={(e) =>
                            changeQuestion(question.id, {
                              knowledgePoints: e.target.value.split('\n'),
                            })
                          }
                        />
                      </label>
                      <details className="rounded-xl border p-3">
                        <summary className="cursor-pointer text-sm font-bold">
                          本题区域与共享配图（{question.regions.length} 个框）
                        </summary>
                        {question.regions.map((r, index) => (
                          <div key={r.id} className="mt-3 border-t pt-3">
                            <div className="flex items-center justify-between text-sm">
                              <span>
                                区域 {index + 1} · {kinds[r.kind]}
                              </span>
                              <button
                                className="min-h-11 text-destructive underline"
                                onClick={() => {
                                  if (
                                    confirm(
                                      '删除该区域并取消其所有步骤/共享关联？',
                                    )
                                  )
                                    removeRegions(new Set([r.id]));
                                }}
                              >
                                删除区域
                              </button>
                            </div>
                            <div className="grid grid-cols-4 gap-2">
                              {(['x', 'y', 'width', 'height'] as const).map(
                                (key, i) => (
                                  <label key={key} className="text-xs">
                                    {['左%', '上%', '宽%', '高%'][i]}
                                    <input
                                      aria-label={`区域${index + 1}${key}`}
                                      className={field}
                                      type="number"
                                      min={0}
                                      max={100}
                                      step={0.1}
                                      value={Math.round(r[key] * 1000) / 10}
                                      onChange={(e) =>
                                        changeQuestion(question.id, {
                                          regions: question.regions.map(
                                            (old) =>
                                              old.id === r.id
                                                ? {
                                                    ...old,
                                                    [key]:
                                                      Number(e.target.value) /
                                                      100,
                                                  }
                                                : old,
                                          ),
                                        })
                                      }
                                    />
                                  </label>
                                ),
                              )}
                            </div>
                          </div>
                        ))}
                        {allRegions
                          .filter(
                            (r) =>
                              !question.regions.some((x) => x.id === r.id) &&
                              ['figure', 'stem'].includes(r.kind),
                          )
                          .map((r) => (
                            <label
                              key={r.id}
                              className="mt-2 flex min-h-11 items-center gap-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={
                                  question.sharedRegionIds?.includes(r.id) ||
                                  false
                                }
                                onChange={(e) =>
                                  changeQuestion(question.id, {
                                    sharedRegionIds: e.target.checked
                                      ? [
                                          ...(question.sharedRegionIds || []),
                                          r.id,
                                        ]
                                      : question.sharedRegionIds?.filter(
                                          (id) => id !== r.id,
                                        ),
                                  })
                                }
                              />
                              引用题 {r.question} 的{kinds[r.kind]}区域
                            </label>
                          ))}
                      </details>
                      <section className="space-y-3 rounded-xl bg-secondary/30 p-3">
                        <h3 className="font-bold">纸面可见的作答步骤</h3>
                        <p className="text-xs text-muted-foreground">
                          按阅读顺序转写；不补造被擦掉的内容，也不推断真实下笔顺序。
                        </p>
                        {question.answerSteps.map((step, i) => (
                          <div
                            key={step.id}
                            className="space-y-2 rounded-lg border bg-background p-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <label className="text-xs">
                                阅读顺序
                                <input
                                  aria-label={`步骤${i + 1}顺序`}
                                  className={field}
                                  type="number"
                                  min={0}
                                  value={step.order}
                                  onChange={(e) =>
                                    editStep(step.id, {
                                      order: Number(e.target.value),
                                    })
                                  }
                                />
                              </label>
                              <label className="text-xs">
                                笔迹作者
                                <select
                                  aria-label={`步骤${i + 1}作者`}
                                  className={field}
                                  value={step.author}
                                  onChange={(e) =>
                                    editStep(step.id, {
                                      author: e.target
                                        .value as AnswerStep['author'],
                                    })
                                  }
                                >
                                  <option value="unknown">待确认</option>
                                  <option value="student">孩子</option>
                                  <option value="teacher">老师</option>
                                </select>
                              </label>
                              <button
                                className="min-h-11 text-xs text-destructive"
                                onClick={() =>
                                  changeQuestion(question.id, {
                                    answerSteps: question.answerSteps.filter(
                                      (s) => s.id !== step.id,
                                    ),
                                  })
                                }
                              >
                                删除步骤
                              </button>
                            </div>
                            <label className="block text-sm">
                              逐字转写
                              <textarea
                                aria-label={`步骤${i + 1}转写`}
                                className={field}
                                rows={2}
                                value={step.text}
                                onChange={(e) =>
                                  editStep(step.id, { text: e.target.value })
                                }
                              />
                            </label>
                            <label className="block text-xs">
                              公式 LaTeX（可选）
                              <input
                                className={field}
                                value={step.latex || ''}
                                onChange={(e) =>
                                  editStep(step.id, { latex: e.target.value })
                                }
                              />
                            </label>
                            <div className="flex flex-wrap gap-4 text-xs">
                              <label className="flex min-h-11 items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={step.crossedOut}
                                  onChange={(e) =>
                                    editStep(step.id, {
                                      crossedOut: e.target.checked,
                                    })
                                  }
                                />
                                可见划掉/涂改
                              </label>
                              <label className="flex min-h-11 items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={step.uncertain}
                                  onChange={(e) =>
                                    editStep(step.id, {
                                      uncertain: e.target.checked,
                                    })
                                  }
                                />
                                字迹或符号待确认
                              </label>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {allRegions
                                .filter(
                                  (r) =>
                                    question.regions.some(
                                      (x) => x.id === r.id,
                                    ) ||
                                    question.sharedRegionIds?.includes(r.id),
                                )
                                .map((r, index) => (
                                  <label
                                    key={r.id}
                                    className="flex min-h-11 items-center gap-1 text-xs"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={step.regionIds.includes(r.id)}
                                      onChange={(e) =>
                                        editStep(step.id, {
                                          regionIds: e.target.checked
                                            ? [...step.regionIds, r.id]
                                            : step.regionIds.filter(
                                                (id) => id !== r.id,
                                              ),
                                        })
                                      }
                                    />
                                    {kinds[r.kind]}框 {index + 1}
                                  </label>
                                ))}
                            </div>
                          </div>
                        ))}
                        <button
                          className={secondary}
                          onClick={() =>
                            changeQuestion(question.id, {
                              answerSteps: [
                                ...question.answerSteps,
                                {
                                  id: crypto.randomUUID(),
                                  order:
                                    Math.max(
                                      0,
                                      ...question.answerSteps.map(
                                        (s) => s.order,
                                      ),
                                    ) + 1,
                                  text: '',
                                  author: 'unknown',
                                  regionIds: [],
                                  crossedOut: false,
                                  uncertain: true,
                                },
                              ],
                            })
                          }
                        >
                          增加可见步骤
                        </button>
                      </section>
                      <details className="rounded-xl border p-3">
                        <summary className="cursor-pointer text-sm font-bold">
                          参考答案与说明（与孩子笔迹分开）
                        </summary>
                        <label className="mt-3 block text-sm">
                          参考答案
                          <textarea
                            className={field}
                            value={question.referenceAnswer || ''}
                            onChange={(e) =>
                              changeQuestion(question.id, {
                                referenceAnswer: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label className="mt-2 block text-sm">
                          说明
                          <textarea
                            className={field}
                            value={question.explanation || ''}
                            onChange={(e) =>
                              changeQuestion(question.id, {
                                explanation: e.target.value,
                              })
                            }
                          />
                        </label>
                      </details>
                      <label className="block text-sm">
                        不确定内容（每行一项）
                        <textarea
                          className={field}
                          value={question.uncertainties.join('\n')}
                          onChange={(e) =>
                            changeQuestion(question.id, {
                              uncertainties: e.target.value.split('\n'),
                            })
                          }
                        />
                      </label>
                      <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
                        <input
                          type="checkbox"
                          checked={question.confirmed}
                          onChange={(e) =>
                            changeQuestion(question.id, {
                              confirmed: e.target.checked,
                            })
                          }
                        />
                        本题内容与笔迹归属已经人工校对
                      </label>
                      <button
                        className="min-h-11 text-sm text-destructive underline"
                        onClick={() => {
                          if (
                            confirm(
                              '删除这道题及区域？其子题将变为独立题，关联会取消，保存后仍保留旧修订。',
                            )
                          ) {
                            removeRegions(
                              new Set(question.regions.map((r) => r.id)),
                              question.id,
                            );
                            setQuestionId('');
                          }
                        }}
                      >
                        删除这道题
                      </button>
                    </div>
                  ) : (
                    <p className="rounded-xl bg-secondary/30 p-4 text-sm">
                      点击“增加一道题”开始手动整理，或使用识别生成候选文字。没有作答的题目可以保持步骤为空。
                    </p>
                  )}
                </div>
              </div>
            </fieldset>
          </section>
        )}
      </div>
    </main>
  );
}
