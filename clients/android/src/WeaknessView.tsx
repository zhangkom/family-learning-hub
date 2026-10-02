import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Target } from 'lucide-react';
import type { WeaknessOverview, WeaknessReport } from '../../../lib/weakness';
import type { LearningMode } from '../../../lib/learning-session';
import { ApiError, type FamilyApi } from './api';
import type { Scan } from './types';
import { readLearningDraft, writeLearningDraft } from './learning-history';
import { AbilityRadar } from './AbilityRadar';

export function WeaknessView({ api, owner, studentId, subject, records, onOpen, onLearn, selectedDimension, onSelectDimension }: {
  selectedDimension: string; onSelectDimension: (dimension: string) => void;
  api: FamilyApi; owner: string; studentId: string; subject: string; records: Scan[];
  onOpen: (scan: Scan, questionId?: string) => void;
  onLearn: (mode: LearningMode, source?: { scanId: string; questionId: string }, sessionId?: string) => void;
}) {
  const [overview, setOverview] = useState<WeaknessOverview | null>(null), [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [busy, setBusy] = useState(false), [tick, setTick] = useState(0);
  const live = useRef(true), lock = useRef(false), operation = useRef<AbortController | null>(null);
  const version = records.map(scan => `${scan.id}:${scan.revision}`).join('|');
  useEffect(() => { live.current = true; return () => { live.current = false; operation.current?.abort(); }; }, []);
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const next = await api.weaknessOverview(studentId, subject, abort.signal); if (abort.signal.aborted) return;
        if (next.report && (next.report.studentId !== studentId || next.report.subject !== subject)) throw new Error('分析记录归属不匹配，请刷新');
        setOverview(next); setReadError('');
        if (next.report?.status === 'queued' || next.report?.status === 'processing') timer = setTimeout(read, 2500);
      } catch (e) { if (!abort.signal.aborted) { setReadError((e as Error).message); timer = setTimeout(read, 8000); } }
    }
    void read(); return () => { abort.abort(); clearTimeout(timer); };
  }, [api, studentId, subject, tick, version]);
  const report = overview?.report, pending = report?.status === 'queued' || report?.status === 'processing';
  async function run(retry = false) {
    if (!overview || lock.current) return;
    lock.current = true; setBusy(true); setError(''); const abort = new AbortController(); operation.current = abort;
    const key = `weakness-request:${subject}`, fingerprint = overview.materials.version;
    try {
      let result: { report: WeaknessReport };
      if (retry && report) result = await api.retryWeakness(report, abort.signal);
      else {
        let request: { fingerprint: string; id: string } | undefined;
        try { request = JSON.parse(readLearningDraft(owner, studentId, key) || 'null'); } catch { /* Replace an invalid local receipt. */ }
        if (!request || request.fingerprint !== fingerprint || !/^[0-9a-f-]{36}$/i.test(request.id)) request = { fingerprint, id: crypto.randomUUID() };
        if (!writeLearningDraft(owner, studentId, key, JSON.stringify(request))) throw new Error('本机暂时无法保存分析请求，请清理存储空间后重试。');
        result = await api.createWeakness({ requestId: request.id, studentId, subject, materialVersion: fingerprint }, abort.signal);
        writeLearningDraft(owner, studentId, key, '');
      }
      if (abort.signal.aborted || !live.current) return;
      if (result.report.studentId !== studentId || result.report.subject !== subject) throw new Error('分析结果归属不匹配');
      setOverview(value => value ? { ...value, report: result.report } : value); setTick(x => x + 1);
    } catch (e) { if (!abort.signal.aborted && live.current) { setError((e as Error).message); if (e instanceof ApiError && e.status === 409) setTick(x => x + 1); } }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }
  const sources = report?.sources || [];
  const axes = (report?.result?.axes || overview?.axes || []).filter(axis => axis.subject === subject);
  const selectedAxis = axes.find(axis => axis.id === selectedDimension)
    || axes.find(axis => axis.id === report?.result?.focuses.find(focus => focus.subject === subject)?.dimensionId) || axes[0];
  const selectedFocuses = (report?.result?.focuses || []).filter(focus => focus.subject === subject && (!selectedAxis || focus.dimensionId === selectedAxis.id));
  return <section className="weakness-view" aria-label="能力图谱">
    <div className="weakness-intro"><Target size={23} /><p>从多道错题发现共同卡点，再用独立练习和复测观察进步。</p></div>
    {(error || readError) && <p role="alert" className="error">{error || readError} <button onClick={() => { setError(''); setReadError(''); setTick(x => x + 1); }}>重新读取</button></p>}
    {!overview ? <output>正在整理可分析的错题…</output> : <>
      {report?.stale && <output className="weakness-stale">错题或学习记录已有变化，下面是上一次图谱；请更新分析。</output>}
      {axes.length > 0 && <AbilityRadar subject={subject} axes={axes} selectedId={selectedAxis?.id || ''} onSelect={onSelectDimension} />}
      <p className="ability-score-note">点击维度查看错题与补强方向。参考分依据 AI 批改，不代表长期掌握。</p>
      <section className="weakness-materials"><div><strong>{subject || '全部科目'} · {overview.materials.total} 道错题</strong><p>可分析 {overview.materials.eligible} 道{overview.materials.needsReview ? ` · ${overview.materials.needsReview} 道需先校对` : ''}</p></div>
        <button className="primary" disabled={busy || pending || !overview.enabled || overview.materials.selected < 2 || !!report && !report.stale} onClick={() => void run()}><RefreshCw size={16} />{pending ? '正在分析…' : report ? report.stale ? '更新分析' : report.status === 'failed' ? '分析未完成' : '图谱已更新' : '分析多道错题'}</button>
        {overview.materials.omitted > 0 && <p className="weakness-coverage">本次分析最近上传的 {overview.materials.selected} 道，另有 {overview.materials.omitted} 道未纳入；可按科目缩小范围。</p>}
        {overview.materials.selected < 2 && <p className="weakness-coverage">至少需要 2 道已核对题干的错题，才能交叉分析。</p>}
        {!overview.enabled && <p className="weakness-coverage">AI 服务暂不可用，已保存的分析仍可查看。</p>}
      </section>
      {!!overview.materials.pendingSources.length && <details className="weakness-pending"><summary>需要校对的题目 · {overview.materials.needsReview} 道</summary>{overview.materials.pendingSources.map(source => {
        const scan = records.find(item => item.id === source.scanId); return <div key={`${source.scanId}/${source.questionId}`}><span>{source.subject || '待选科目'} · 第 {source.number} 题<small>{source.reason}</small></span><button disabled={!scan} onClick={() => scan && onOpen(scan, source.questionId)}>去校对</button></div>;
      })}{overview.materials.pendingMore > 0 && <p className="hint">另有 {overview.materials.pendingMore} 道，请到错题本继续核对。</p>}</details>}
    </>}
    {pending && <p className="weakness-job" aria-live="polite">{report.status === 'queued' ? '任务已保存，正在排队。' : '正在对照多道错题与作答证据…'} 可以离开，回来后继续查看。</p>}
    {report?.status === 'failed' && <div className="weakness-job"><p>{report.error || '本次分析未完成，错题仍保留。'}</p><button disabled={busy || !overview?.enabled} onClick={() => void run(true)}>重试分析</button></div>}
    {report?.result && <>
      <p className="weakness-result-caption">{new Date(report.updatedAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })} · 综合 {report.coverage.selected} 道错题 · AI 建议待核对</p>
      <p className="weakness-summary">{report.result.summary}</p>
      {selectedFocuses.map(focus => <article className="weakness-focus" key={focus.id}>
        <header><span className={`weakness-priority ${focus.priority}`}>{focus.priority === 'high' ? '优先补强' : focus.priority === 'medium' ? '重点巩固' : '继续关注'}</span><span>{focus.subject}</span></header>
        <h3>{focus.title}</h3><div className="ability-knowledge-tags">{focus.knowledgePoints.map(point => <span key={point}>{point}</span>)}</div><p>{focus.reason}</p><p className="weakness-direction"><strong>怎么练</strong>{focus.practiceDirection}</p>
        <small className="weakness-basis">{focus.basis === 'answer_evidence' ? '依据已核对的作答证据' : '依据多道错题的共同考点'} · 需要核对</small>
        <details className="weakness-evidence"><summary>查看依据 · {new Set(focus.evidence.map(item => item.sourceId)).size} 道错题</summary>{focus.evidence.map((evidence, index) => {
          const source = sources.find(item => item.id === evidence.sourceId), scan = source && records.find(item => item.id === source.scanId);
          return <div key={`${evidence.sourceId}/${index}`}><strong>{source ? `${source.subject} · 第 ${source.number} 题` : '原题暂不可用'}</strong><blockquote>{evidence.quote}</blockquote><p>{evidence.reason}</p>{scan && source && <div className="weakness-evidence-actions"><button onClick={() => onOpen(scan, source.questionId)}>回看原题</button><button disabled={report.stale || !scan.questions.find(q => q.id === source.questionId)?.confirmed} onClick={() => onLearn('practice', { scanId: scan.id, questionId: source.questionId })}>针对这题练习</button></div>}</div>;
        })}</details>
      </article>)}
      {!selectedFocuses.length && <p className="hint">{selectedAxis?.label || '这个维度'}目前没有足够的跨题证据给出具体补强项；不代表已经掌握。可查看其他维度，或补充错题与独立作答后更新。</p>}
      {!!selectedAxis?.evidence.length && <details className="weakness-evidence ability-performance"><summary>参考水平的作答依据 · {selectedAxis.evidenceCount} 道练习</summary>{selectedAxis.evidence.map(evidence => <div key={`${evidence.sessionId}/${evidence.taskId}/${evidence.attemptId}`}><strong>{evidence.verdict === 'correct' ? '独立答对' : evidence.verdict === 'partial' ? '部分正确' : '尚未答对'} · AI 批改</strong><blockquote>{evidence.prompt}</blockquote><p>作答：{evidence.answer}</p><button onClick={() => onLearn(evidence.mode, undefined, evidence.sessionId)}>查看作答与复测</button></div>)}</details>}
      {!!report.result.limitations.length && <details className="weakness-limitations"><summary>本次分析的依据与限制</summary><ul>{report.result.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
    </>}
    {selectedAxis && <details className="weakness-limitations"><summary>本学科的能力维度</summary><p>{selectedAxis.grade} · {selectedAxis.gradeFocus}</p><p>维度用于整理学习证据，具体内容以孩子的课程和已核对题目为准。</p></details>}
  </section>;
}
