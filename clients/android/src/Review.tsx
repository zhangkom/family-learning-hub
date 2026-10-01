import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Plus, Save, RefreshCw, Trash2 } from 'lucide-react';
import { ApiError, FamilyApi } from './api';
import { RegionEditor } from './RegionEditor';
import { reviewDrafts } from './drafts';
import {
  emptyQuestion,
  mergeQuestions,
  removeQuestion,
  removeRegion,
} from './regions';
import { statusNames, type Question, type Region, type Scan } from './types';

type Props = {
  api: FamilyApi;
  owner: string;
  scan: Scan;
  studentName: string;
  onBack: () => void;
  onUpdate: (scan: Scan) => void;
};
export function Review({
  api,
  owner,
  scan: initial,
  studentName,
  onBack,
  onUpdate,
}: Props) {
  const draftId = `${owner}|${initial.id}`;
  const draftRevision = useRef(initial.revision);
  const editing = useRef(false),
    latestRevision = useRef(initial.revision);
  const [scan, setScan] = useState(initial),
    [questions, setQuestions] = useState(initial.questions || []);
  const [selected, setSelected] = useState(initial.questions?.[0]?.id || ''),
    [region, setRegion] = useState('');
  const [image, setImage] = useState(''),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [mergeTarget, setMergeTarget] = useState('');
  const [draftReady, setDraftReady] = useState(false),
    [conflict, setConflict] = useState(false);
  const question = questions.find((q) => q.id === selected);
  useEffect(() => {
    let alive = true;
    void reviewDrafts
      .read(draftId)
      .then((draft) => {
        if (!alive || !draft) return;
        draftRevision.current = draft.revision;
        editing.current = true;
        setQuestions(draft.questions);
        setSelected(draft.questions[0]?.id || '');
        setDirty(true);
        if (draft.revision !== initial.revision) {
          setConflict(true);
          setError(
            '本机校对草稿与服务器版本不同。可以查看或导出草稿，再加载服务器内容；不会自动覆盖。',
          );
        } else setNotice('已恢复本机未完成的校对');
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setDraftReady(true);
      });
    return () => {
      alive = false;
    };
  }, [draftId, initial.revision]);
  useEffect(() => {
    const abort = new AbortController();
    let url = '';
    void api
      .image(initial.id, abort.signal)
      .then((blob) => {
        url = URL.createObjectURL(blob);
        if (!abort.signal.aborted) setImage(url);
        else URL.revokeObjectURL(url);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, initial.id]);
  useEffect(() => {
    if (!draftReady || dirty || !['queued', 'processing'].includes(scan.status))
      return;
    let alive = true;
    const timer = setInterval(() => {
      void api
        .scan(scan.id)
        .then(({ scan: next }) => {
          if (
            !alive ||
            editing.current ||
            next.revision < latestRevision.current
          )
            return;
          latestRevision.current = next.revision;
          draftRevision.current = next.revision;
          setScan(next);
          setQuestions(next.questions || []);
          onUpdate(next);
          setSelected((id) =>
            next.questions.some((q) => q.id === id)
              ? id
              : next.questions[0]?.id || '',
          );
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    }, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api, draftReady, dirty, scan.id, scan.status, onUpdate]);
  function change(all: Question[]) {
    editing.current = true;
    setQuestions(all);
    setDirty(true);
    setNotice('');
    void reviewDrafts
      .save({ id: draftId, revision: draftRevision.current, questions: all })
      .catch((e) => setError(`本机草稿未能保存：${e.message}`));
  }
  function update(id: string, patch: Partial<Question>) {
    change(
      questions.map((q) =>
        q.id === id
          ? { ...q, ...patch, confirmed: patch.confirmed ?? false }
          : q,
      ),
    );
  }
  function replaceRegion(questionId: string, value: Region) {
    change(
      questions.map((q) =>
        q.id === questionId
          ? {
              ...q,
              confirmed: false,
              regions: q.regions.map((r) => (r.id === value.id ? value : r)),
            }
          : (q.sharedRegionIds || []).includes(value.id)
            ? { ...q, confirmed: false }
            : q,
      ),
    );
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      const { scan: next } = await api.review(scan, questions);
      await reviewDrafts.remove(draftId);
      draftRevision.current = next.revision;
      latestRevision.current = next.revision;
      editing.current = false;
      setScan(next);
      setQuestions(next.questions);
      setDirty(false);
      onUpdate(next);
      setNotice('已保存题目框和手写步骤');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        setError(
          '另一台设备或识别任务更新了资料。本机草稿已保留，请导出后加载服务器内容进行比较。',
        );
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function recognize() {
    setBusy(true);
    setError('');
    try {
      const { scan: next } = await api.recognize(scan);
      latestRevision.current = next.revision;
      draftRevision.current = next.revision;
      setScan(next);
      onUpdate(next);
      setNotice('已提交识别，可以返回资料列表等待');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function addQuestion() {
    const q = emptyQuestion(String(questions.length + 1));
    change([...questions, q]);
    setSelected(q.id);
    setRegion('');
  }
  function splitRegion() {
    if (!question) return;
    const moved = question.regions.find((r) => r.id === region);
    if (!moved) return;
    const q = emptyQuestion(String(questions.length + 1));
    q.regions = [moved];
    // A step spanning several regions needs explicit reassignment, not silent duplication.
    const exclusive = question.answerSteps.filter(
      (s) => s.regionIds.length === 1 && s.regionIds[0] === region,
    );
    q.answerSteps = exclusive.map((s, order) => ({ ...s, order }));
    const source = {
      ...question,
      confirmed: false,
      regions: question.regions.filter((r) => r.id !== region),
      answerSteps: question.answerSteps
        .filter((s) => !exclusive.some((x) => x.id === s.id))
        .map((s) =>
          s.regionIds.includes(region)
            ? {
                ...s,
                regionIds: s.regionIds.filter((id) => id !== region),
                uncertain: true,
              }
            : s,
        ),
    };
    change([...questions.map((x) => (x.id === source.id ? source : x)), q]);
    setSelected(q.id);
  }
  return (
    <main className="review-page">
      <header className="review-header">
        <button
          className="icon-button"
          aria-label="返回资料列表"
          onClick={() => {
            if (!dirty || window.confirm('还有未保存的校对，确定返回吗？'))
              onBack();
          }}
        >
          <ArrowLeft />
        </button>
        <div>
          <small>{studentName} · 数学</small>
          <h1>把题目和步骤核对清楚</h1>
        </div>
        <button
          className="primary save-button"
          disabled={busy || !dirty || conflict || !draftReady}
          onClick={() => void save()}
        >
          <Save size={17} /> 保存校对
        </button>
      </header>
      <div className="review-status">
        <span className="status">
          {statusNames[scan.status] || scan.status}
        </span>
        <span>
          {questions.length} 道题{dirty ? ' · 有修改未保存' : ''}
        </span>
        <button
          disabled={
            busy || dirty || ['queued', 'processing'].includes(scan.status)
          }
          onClick={() => void recognize()}
        >
          <RefreshCw size={15} />
          {scan.status === 'failed' ? '重试识别' : '识别这张照片'}
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <output className="notice">{notice}</output>}
      {conflict && (
        <div className="button-row">
          <button
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob(
                  [JSON.stringify({ scanId: scan.id, questions }, null, 2)],
                  { type: 'application/json' },
                ),
              );
              const link = document.createElement('a');
              link.href = url;
              link.download = '校对草稿.json';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            导出本机草稿
          </button>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  JSON.stringify({ scanId: scan.id, questions }, null, 2),
                );
                setNotice('草稿已复制，请粘贴保存后再加载服务器版本');
              } catch {
                setError(
                  '未能复制，请保留本页草稿，或在网页端导出后再处理冲突。',
                );
              }
            }}
          >
            复制本机草稿
          </button>
          <button
            onClick={async () => {
              if (
                !window.confirm(
                  '加载服务器内容将替换本页草稿，请先导出需要保留的修改。',
                )
              )
                return;
              try {
                const { scan: next } = await api.scan(scan.id);
                await reviewDrafts.remove(draftId);
                draftRevision.current = next.revision;
                latestRevision.current = next.revision;
                editing.current = false;
                setScan(next);
                setQuestions(next.questions);
                setSelected(next.questions[0]?.id || '');
                setDirty(false);
                setConflict(false);
                setError('');
                onUpdate(next);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            加载服务器版本
          </button>
        </div>
      )}
      {scan.error && <p className="hint">{scan.error}</p>}
      <fieldset className="review-grid" disabled={!draftReady || busy}>
        <RegionEditor
          image={image}
          questions={questions}
          selectedId={selected}
          activeRegion={region}
          onSelect={(q, r) => {
            setSelected(q);
            setRegion(r);
          }}
          onChange={replaceRegion}
          onAdd={(r) => {
            if (question) {
              update(question.id, { regions: [...question.regions, r] });
              setRegion(r.id);
            }
          }}
        />
        <section className="transcript-panel">
          <nav className="question-tabs" aria-label="选择题目">
            {questions.map((q, i) => (
              <button
                key={q.id}
                className={selected === q.id ? 'selected' : ''}
                onClick={() => {
                  setSelected(q.id);
                  setRegion('');
                }}
              >
                {q.number || i + 1}
                {q.confirmed && <Check size={13} />}
              </button>
            ))}
            <button onClick={addQuestion}>
              <Plus size={15} /> 补题
            </button>
          </nav>
          {!question ? (
            <div className="empty">
              <ScanEmpty />
              <h2>先找到照片里的每一道题</h2>
              <p>可以等待自动识别，也可以点“补题”，在原图上框选。</p>
            </div>
          ) : (
            <>
              <div className="field-row">
                <label>
                  题号
                  <input
                    value={question.number}
                    onChange={(e) =>
                      update(question.id, { number: e.target.value })
                    }
                  />
                </label>
                <label>
                  共用题干
                  <select
                    value={question.parentQuestionId || ''}
                    onChange={(e) =>
                      update(question.id, {
                        parentQuestionId: e.target.value || undefined,
                      })
                    }
                  >
                    <option value="">独立题目</option>
                    {questions
                      .filter(
                        (q) =>
                          q.id !== question.id &&
                          !q.parentQuestionId &&
                          !questions.some(
                            (child) => child.parentQuestionId === question.id,
                          ),
                      )
                      .map((q) => (
                        <option key={q.id} value={q.id}>
                          第 {q.number} 题
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <label>
                完整题干
                <textarea
                  rows={4}
                  value={question.prompt}
                  placeholder="核对条件、选项和单位，不清楚的地方先保留待确认"
                  onChange={(e) =>
                    update(question.id, { prompt: e.target.value })
                  }
                />
              </label>
              <label>
                配图说明
                <input
                  value={question.diagram}
                  onChange={(e) =>
                    update(question.id, { diagram: e.target.value })
                  }
                  placeholder="几何图、表格等保留在原图中"
                />
              </label>
              {questions.some(
                (q) =>
                  q.id !== question.id &&
                  q.regions.some((r) => ['stem', 'figure'].includes(r.kind)),
              ) && (
                <details>
                  <summary>关联共用题干或配图</summary>
                  <div className="checks">
                    {questions
                      .filter((q) => q.id !== question.id)
                      .flatMap((q) =>
                        q.regions
                          .filter((r) => ['stem', 'figure'].includes(r.kind))
                          .map((r, i) => (
                            <label key={r.id}>
                              <input
                                type="checkbox"
                                checked={(
                                  question.sharedRegionIds || []
                                ).includes(r.id)}
                                onChange={(e) =>
                                  update(question.id, {
                                    sharedRegionIds: e.target.checked
                                      ? [
                                          ...(question.sharedRegionIds || []),
                                          r.id,
                                        ]
                                      : (question.sharedRegionIds || []).filter(
                                          (id) => id !== r.id,
                                        ),
                                  })
                                }
                              />
                              第 {q.number} 题 · 区域 {i + 1}
                            </label>
                          )),
                      )}
                  </div>
                </details>
              )}
              {question.uncertainties.length > 0 && (
                <div className="uncertain">
                  <strong>这些地方需要看看</strong>
                  <ul>
                    {question.uncertainties.map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="section-line">
                <h2>孩子的原作答</h2>
                <button
                  onClick={() =>
                    update(question.id, {
                      answerSteps: [
                        ...question.answerSteps,
                        {
                          id: crypto.randomUUID(),
                          order: question.answerSteps.length,
                          text: '',
                          regionIds: [],
                          author: 'student',
                          crossedOut: false,
                          uncertain: true,
                        },
                      ],
                    })
                  }
                >
                  <Plus size={15} /> 添加步骤
                </button>
              </div>
              <p className="hint">
                按纸面内容转写。看不清就标记，不补写孩子没有写过的过程。
              </p>
              {question.answerSteps.length === 0 && (
                <p className="empty-note">还没有提取到作答。空白不代表答错。</p>
              )}
              {question.answerSteps.map((step, index) => {
                const edit = (patch: Partial<typeof step>) =>
                  update(question.id, {
                    answerSteps: question.answerSteps.map((s) =>
                      s.id === step.id ? { ...s, ...patch } : s,
                    ),
                  });
                return (
                  <article
                    className={`step-card ${step.uncertain ? 'needs-check' : ''}`}
                    key={step.id}
                  >
                    <div className="section-line">
                      <strong>步骤 {index + 1}</strong>
                      <select
                        aria-label={`步骤${index + 1}的作者`}
                        value={step.author}
                        onChange={(e) =>
                          edit({ author: e.target.value as typeof step.author })
                        }
                      >
                        <option value="student">孩子作答</option>
                        <option value="teacher">老师批注</option>
                        <option value="unknown">暂不确定</option>
                      </select>
                      <button
                        className="icon-button"
                        aria-label={`删除步骤${index + 1}`}
                        onClick={() =>
                          update(question.id, {
                            answerSteps: question.answerSteps
                              .filter((s) => s.id !== step.id)
                              .map((s, order) => ({ ...s, order })),
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <textarea
                      aria-label={`步骤${index + 1}转写`}
                      rows={2}
                      value={step.text}
                      onChange={(e) => edit({ text: e.target.value })}
                    />
                    {step.latex && (
                      <details>
                        <summary>公式转写</summary>
                        <input
                          aria-label={`步骤${index + 1}公式`}
                          value={step.latex}
                          onChange={(e) => edit({ latex: e.target.value })}
                        />
                      </details>
                    )}
                    <div className="checks">
                      <label>
                        <input
                          type="checkbox"
                          checked={step.uncertain}
                          onChange={(e) =>
                            edit({ uncertain: e.target.checked })
                          }
                        />
                        需要确认
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={step.crossedOut}
                          onChange={(e) =>
                            edit({ crossedOut: e.target.checked })
                          }
                        />
                        原纸面已划掉
                      </label>
                    </div>
                    <details>
                      <summary>对应原图区域（{step.regionIds.length}）</summary>
                      <div className="checks">
                        {question.regions.map((r, ri) => (
                          <label key={r.id}>
                            <input
                              type="checkbox"
                              checked={step.regionIds.includes(r.id)}
                              onChange={(e) => {
                                edit({
                                  regionIds: e.target.checked
                                    ? [...step.regionIds, r.id]
                                    : step.regionIds.filter(
                                        (id) => id !== r.id,
                                      ),
                                });
                                setRegion(r.id);
                              }}
                            />
                            区域 {ri + 1} ·{' '}
                            {r.kind === 'answer'
                              ? '作答'
                              : r.kind === 'stem'
                                ? '题干'
                                : r.kind === 'figure'
                                  ? '配图'
                                  : '批注'}
                          </label>
                        ))}
                      </div>
                    </details>
                  </article>
                );
              })}
              <details className="organize">
                <summary>整理题目和区域</summary>
                <button
                  onClick={() => {
                    if (
                      window.confirm('移除这道题及它的转写？原始照片仍然保留。')
                    ) {
                      const remaining = removeQuestion(questions, question.id);
                      change(remaining);
                      setSelected(remaining[0]?.id || '');
                      setRegion('');
                    }
                  }}
                >
                  移除这道题
                </button>
                <label>
                  当前区域
                  <select
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                  >
                    <option value="">选择一个框</option>
                    {question.regions.map((r, i) => (
                      <option key={r.id} value={r.id}>
                        区域 {i + 1} · {r.kind}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="button-row">
                  <button
                    disabled={!question.regions.some((r) => r.id === region)}
                    onClick={splitRegion}
                  >
                    拆成新题
                  </button>
                  <button
                    disabled={!question.regions.some((r) => r.id === region)}
                    onClick={() => {
                      change(removeRegion(questions, region));
                      setRegion('');
                    }}
                  >
                    删除框
                  </button>
                </div>
                <label>
                  合并到另一题
                  <select
                    value={mergeTarget}
                    onChange={(e) => setMergeTarget(e.target.value)}
                  >
                    <option value="">选择目标题目</option>
                    {questions
                      .filter((q) => q.id !== question.id)
                      .map((q) => (
                        <option key={q.id} value={q.id}>
                          第 {q.number} 题
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  disabled={!mergeTarget}
                  onClick={() => {
                    try {
                      change(
                        mergeQuestions(questions, question.id, mergeTarget),
                      );
                      setSelected(mergeTarget);
                      setMergeTarget('');
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  合并内容与步骤
                </button>
              </details>
              <label className="confirm-check">
                <input
                  type="checkbox"
                  checked={question.confirmed}
                  disabled={
                    !question.prompt.trim() ||
                    !question.regions.length ||
                    question.answerSteps.some(
                      (s) =>
                        s.uncertain ||
                        s.author === 'unknown' ||
                        !s.regionIds.length ||
                        !s.text.trim(),
                    )
                  }
                  onChange={(e) =>
                    update(question.id, { confirmed: e.target.checked })
                  }
                />
                这道题的条件、区域和可见作答已核对
              </label>
              <p className="hint">
                每个步骤需关联原图区域并完成校对；未完成时，可以先保存草稿。
              </p>
            </>
          )}
        </section>
      </fieldset>
    </main>
  );
}
function ScanEmpty() {
  return <span className="empty-symbol">▧</span>;
}
