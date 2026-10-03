import { useEffect, useMemo, useRef, useState } from 'react';
import { useNativeBack } from './native-back';
import { ArrowLeft, ChevronRight, Lightbulb, RefreshCw } from 'lucide-react';
import { ApiError, type FamilyApi } from './api';
import type { Scan } from './types';
import { learningModeNames, verdictNames, sessionSummary, taskPassed, type LearningMode, type LearningSession, type LearningSummary, type LearningTask } from '../../../lib/learning-session';
import { learningProgress, readLearningDraft, writeLearningDraft } from './learning-history';
import { QuestionCard } from './QuestionPaper';
import { QuestionImages, decodeQuestionImage } from './question-images';
import { loadReviewImage } from './photo-processing/review-image';
import { questionLearningReadiness } from '../../../lib/question-context';
import { learningSourceSnapshot } from './learning-source-image';

export type LearningView = { mode: LearningMode; source?: { scanId: string; questionId: string }; sessionId?: string };
type Props = { api: FamilyApi; owner: string; studentId: string; studentName: string; records: Scan[]; view: LearningView;
  onClose: () => void; onOpenSource: (scan: Scan, questionId: string, sessionId?: string) => void; onRefreshSources: () => void };
const date = (value: string) => new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
export function LearningHub({ api, owner, studentId, studentName, records, view, onClose, onOpenSource, onRefreshSources }: Props) {
  const [sessionId, setSessionId] = useState(view.sessionId || ''), [session, setSession] = useState<LearningSession | null>(null);
  const [selected, setSelected] = useState(view.source), [query, setQuery] = useState(''), [subject, setSubject] = useState('全部');
  const [history, setHistory] = useState<LearningSummary[]>([]), [more, setMore] = useState(false), [historyReady, setHistoryReady] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [refreshTick, setRefreshTick] = useState(0);
  const lock = useRef(false), controller = useRef<AbortController | null>(null), live = useRef(true);
  const draftScope = `${view.mode}:${selected?.scanId || ''}:${selected?.questionId || ''}`;
  const [stuck, setStuck] = useState(() => readLearningDraft(owner, studentId, `${draftScope}:stuck`));
  const [work, setWork] = useState(() => readLearningDraft(owner, studentId, `${draftScope}:work`));
  const nonce = useRef<{ fingerprint: string; id: string } | null>(null);
  const images = useMemo(() => new QuestionImages(async (scan, _cloud, signal) => decodeQuestionImage((await loadReviewImage(api, owner, scan, true, signal)).file, signal)), [api, owner]);
  useEffect(() => () => images.dispose(), [images]);
  useEffect(() => { live.current = true; return () => { live.current = false; controller.current?.abort(); }; }, []);
  const back = () => { if (lock.current) { controller.current?.abort(); onClose(); return; } if (sessionId) { setSessionId(''); setSession(null); setRefreshTick(x => x + 1); } else if (selected) setSelected(undefined); else onClose(); };
  const backRef = useRef(back); backRef.current = back;
  useNativeBack(() => backRef.current());
  useEffect(() => { setStuck(readLearningDraft(owner, studentId, `${draftScope}:stuck`)); setWork(readLearningDraft(owner, studentId, `${draftScope}:work`)); }, [owner, studentId, draftScope]);
  useEffect(() => {
    const abort = new AbortController();
    void api.learningSessions(studentId, 0, abort.signal).then(result => { if (!abort.signal.aborted) { setHistory(result.sessions); setMore(result.more); setHistoryReady(true); } })
      .catch(e => { if (!abort.signal.aborted) { setError(e.message); setHistoryReady(true); } });
    return () => abort.abort();
  }, [api, studentId, refreshTick]);
  useEffect(() => {
    if (!sessionId) return;
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api.learningSession(sessionId, abort.signal);
        if (abort.signal.aborted) return;
        if (result.session.studentId !== studentId) throw new Error('学习记录不属于当前学生');
        setSession(current => current?.id === result.session.id && current.revision > result.session.revision ? current : result.session); setError('');
        if (result.session.job && result.session.job.status !== 'failed') timer = setTimeout(poll, 2500);
      } catch (e) { if (!abort.signal.aborted) { setError((e as Error).message); timer = setTimeout(poll, 8000); } }
    }
    void poll(); return () => { abort.abort(); clearTimeout(timer); };
  }, [api, sessionId, studentId, refreshTick]);
  async function operate(fn: (signal: AbortSignal) => Promise<{ session: LearningSession }>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); const abort = new AbortController(); controller.current = abort;
    try {
      const result = await fn(abort.signal); if (abort.signal.aborted || !live.current) return;
      if (result.session.studentId !== studentId) throw new Error('学习记录归属不匹配');
      setSession(result.session); setSessionId(result.session.id); setRefreshTick(x => x + 1);
    } catch (e) {
      if (live.current && !abort.signal.aborted) {
        setError((e as Error).message);
        if (e instanceof ApiError && e.status === 409) { setRefreshTick(x => x + 1); onRefreshSources(); }
      }
    } finally { lock.current = false; if (live.current) setBusy(false); }
  }
  const all = records.flatMap(scan => scan.questions.map(question => ({ scan, question })));
  const source = all.find(item => item.scan.id === selected?.scanId && item.question.id === selected?.questionId);
  const filtered = all.filter(({ question }) => (subject === '全部' || question.subject === subject) && (!query || [question.prompt, question.number, ...question.knowledgePoints].join(' ').includes(query)));
  const historyHere = history.filter(item => item.mode === view.mode);
  function saveDraft(key: string, value: string) { if (!writeLearningDraft(owner, studentId, `${draftScope}:${key}`, value)) setError('本机空间不足，草稿尚未保存；离开前请先提交'); }
  function start() {
    if (!source) return;
    const reason = questionLearningReadiness(source.question, source.scan.questions);
    if (reason) { setError(reason); return; }
    const body = { studentId, scanId: source.scan.id, questionId: source.question.id, revision: source.scan.revision, mode: view.mode, stuckPoint: stuck.trim(), initialWork: work.trim() };
    const fingerprint = JSON.stringify(body);
    const key = `request:${draftScope}`;
    try { const saved = JSON.parse(readLearningDraft(owner, studentId, key) || 'null'); if (saved?.fingerprint === fingerprint) nonce.current = saved; } catch { /* An invalid local draft is replaced below. */ }
    if (nonce.current?.fingerprint !== fingerprint) nonce.current = { fingerprint, id: crypto.randomUUID() };
    writeLearningDraft(owner, studentId, key, JSON.stringify(nonce.current));
    void operate(async signal => { const reply = await api.createLearning({ ...body, requestId: nonce.current!.id }, signal); writeLearningDraft(owner, studentId, key, ''); nonce.current = null; return reply; });
  }
  async function loadMore() {
    if (lock.current) return; lock.current = true; setBusy(true);
    try { const reply = await api.learningSessions(studentId, history.length); if (live.current) { setHistory(rows => [...rows, ...reply.sessions.filter(item => !rows.some(old => old.id === item.id))]); setMore(reply.more); } }
    catch (e) { if (live.current) setError((e as Error).message); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }
  const currentSource = session && records.find(scan => scan.id === session.source.scanId);
  const currentQuestionExists = currentSource?.questions.some(question => question.id === session?.source.questionId);
  const snapshot = learningSourceSnapshot(currentSource || undefined, session);
  const snapshotQuestion = snapshot?.questions.find(q => q.id === session?.source.questionId);
  const active = !!session?.job && session.job.status !== 'failed';
  return <main className="learning-hub">
    <header className="learning-hub-header"><button onClick={back} aria-label="返回学习列表或首页"><ArrowLeft size={18} />返回</button><span>{studentName}</span></header>
    <div className="section-line"><div><h1>{learningModeNames[view.mode]}</h1><p className="hint">{view.mode === 'practice' ? '从一道题出发，练会一类题。' : '说清卡点，逐步找到解题方法。'}</p></div><button disabled={busy} onClick={() => { setRefreshTick(x => x + 1); onRefreshSources(); }} aria-label="刷新学习进度"><RefreshCw size={18} /></button></div>
    {error && <p role="alert" className="error">{error}</p>}
    {sessionId ? session ? <>
      <section className="learning-source-line"><div><strong>{session.source.subject} · 原题 {session.source.number}</strong><small>{learningProgress(sessionSummary(session))}</small></div>{currentSource && currentQuestionExists && <button onClick={() => onOpenSource(currentSource, session.source.questionId, session.id)}>原题详情<ChevronRight size={15} /></button>}</section>
      {!currentQuestionExists && <p className="hint">当前原题已移除或暂不可用；本次已保存的学习记录仍可查看。</p>}
      {currentSource && !snapshot && <p className="hint">原题图片已有修订，当前服务未提供创建时的图片版本。请更新服务后再查看历史题图；已保存的作答仍可查看。</p>}
      {session.stuckPoint && <details className="learning-context"><summary>我的卡点与尝试</summary><p>{session.stuckPoint}</p><p>{session.initialWork || '当时尚未填写尝试。'}</p></details>}
      {snapshot && snapshotQuestion && <details className="learning-context" open={session.mode === 'challenge' && !session.tasks.length}><summary>回看创建时的原题</summary><QuestionCard scan={snapshot} question={snapshotQuestion} images={images} api={api} owner={owner} onOpen={currentQuestionExists ? () => onOpenSource(currentSource!, session.source.questionId, session.id) : undefined} />{currentSource!.revision !== session.source.revision && <p className="hint">原题之后有过更新；本组练习保留创建时的题干和题框。</p>}</details>}
      {session.job && <section className="learning-job" aria-live="polite"><strong>{session.job.status === 'failed' ? '这一步还未完成' : session.job.status === 'queued' ? '任务已保存，等待处理' : session.job.operation === 'grade' ? '正在核对作答与步骤…' : '正在准备题目并复核…'}</strong><p>{session.job.error || '可以离开页面，稍后从学习记录继续。'}</p>{session.job.status === 'failed' && <button disabled={busy} onClick={() => void operate(signal => api.learningAction(session, 'retry', {}, signal))}>重试这一步</button>}</section>}
      <div className="learning-task-list">{session.tasks.map((task, index) => <LearningTaskCard key={task.id} task={task} index={index} owner={owner} studentId={studentId} disabled={busy || !!session.job}
        onAction={(action, values) => void operate(signal => api.learningAction(session, action, { ...values, taskId: task.id }, signal))} />)}</div>
      {!active && session.tasks.length > 0 && session.tasks.filter(t => t.kind !== 'retest').every(taskPassed) && <section className="learning-retest"><h2>再独立试一次</h2><p>{sessionSummary(session).independentRetest ? '本次已独立完成复测，过几天再练一次。' : '换一道新题，看看能否独立运用。'}{session.retestDueAt && ` 建议 ${date(session.retestDueAt)} 回来复测。`}</p><button className="primary" disabled={busy || !!session.job || session.tasks.some(t => t.kind === 'retest' && !taskPassed(t))} onClick={() => void operate(signal => api.learningAction(session, 'retest', {}, signal))}>生成新的复测题</button></section>}
      <p className="hint learning-ai-note">AI 出题与批改仍需核对；有疑问可回看原题与参考解法，一次正确不代表长期掌握。</p>
    </> : <output>正在读取学习记录…</output> : <>
      {selected ? source ? <section className="learning-start">
        <div className="section-line"><h2>从这道题开始</h2><button onClick={() => setSelected(undefined)}>换一道题</button></div>
        <QuestionCard scan={source.scan} question={source.question} images={images} api={api} owner={owner} onOpen={() => onOpenSource(source.scan, source.question.id)} />
        {view.mode === 'challenge' && <><label>卡在哪一步？<textarea maxLength={2000} value={stuck} onChange={e => { setStuck(e.target.value); saveDraft('stuck', e.target.value); }} placeholder="例如：知道要用哪个公式，但不知道怎样列式" /></label><label>已经尝试了什么？（选填）<textarea maxLength={8000} value={work} onChange={e => { setWork(e.target.value); saveDraft('work', e.target.value); }} placeholder="写下已有思路或计算步骤" /></label></>}
        {questionLearningReadiness(source.question, source.scan.questions) ? <p className="hint">{questionLearningReadiness(source.question, source.scan.questions)}。<button onClick={() => onOpenSource(source.scan, source.question.id)}>查看并校对原题</button></p> : <p className="hint">{view.mode === 'practice' ? '结合完整题图生成3道递进变式；先自己作答，再核对解法。' : '先试着独立作答，需要时逐级查看提示。'}</p>}
        {view.mode === 'challenge' && !stuck.trim() && <p className="hint">先填写“卡在哪一步”，再开始突破。</p>}
        <button className="primary full" disabled={busy || !!questionLearningReadiness(source.question, source.scan.questions) || view.mode === 'challenge' && !stuck.trim()} onClick={start}>{busy ? '正在提交…' : view.mode === 'practice' ? '生成3道变式' : '开始逐步突破'}</button>
      </section> : <p className="hint">原题暂未读取到，请刷新或重新选择。<button onClick={() => setSelected(undefined)}>重新选题</button></p> : <>
        <section className="learning-history"><h2>学习记录</h2>{historyHere.length ? historyHere.map(item => <button className="learning-history-item" key={item.id} onClick={() => { setSession(null); setSessionId(item.id); }}><span><strong>{item.source.subject} · 原题 {item.source.number}</strong><small>{learningProgress(item)} · {date(item.updatedAt)}{item.retestDueAt && new Date(item.retestDueAt).getTime() <= Date.now() ? ' · 到期复测' : ''}</small></span><ChevronRight size={17} /></button>) : <p className="hint">{historyReady ? '选择一道自己的题，开始第一次练习。' : '正在读取记录…'}</p>}{more && <button disabled={busy} onClick={() => void loadMore()}>更多学习记录</button>}</section>
        <section className="learning-source-picker"><h2>选择原题</h2><div className="learning-filters"><input aria-label="搜索原题或知识点" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索题干或知识点" /><select aria-label="学习科目" value={subject} onChange={e => setSubject(e.target.value)}><option>全部</option>{[...new Set(all.flatMap(item => item.question.subject ? [item.question.subject] : []))].map(name => <option key={name}>{name}</option>)}</select></div>
          {filtered.length ? filtered.map(({ scan, question }) => <button className="learning-source-option" key={`${scan.id}/${question.id}`} onClick={() => setSelected({ scanId: scan.id, questionId: question.id })}><span><strong>{question.subject || '待选科目'} · 第 {question.number} 题{question.wrongBook ? ' · 错题' : ''}</strong><small>{question.prompt || question.knowledgePoints.join(' · ') || scan.originalName}</small><small>{questionLearningReadiness(question, scan.questions) || '已校对，可开始学习'}</small></span><ChevronRight size={17} /></button>) : <p className="hint">{all.length ? '没有匹配的原题。' : '还没有整理好的题目，请先到首页收题并校对。'}</p>}
        </section>
      </>}
    </>}
  </main>;
}
function LearningTaskCard({ task, index, owner, studentId, disabled, onAction }: { task: LearningTask; index: number; owner: string; studentId: string; disabled: boolean;
  onAction: (action: 'hint' | 'solution' | 'attempt', values?: Record<string, unknown>) => void }) {
  const key = `task:${task.id}`;
  const [answer, setAnswer] = useState(() => readLearningDraft(owner, studentId, key));
  const [draftError, setDraftError] = useState('');
  const nonce = useRef<{ text: string; id: string } | null>(null);
  if (!nonce.current) { try { nonce.current = JSON.parse(readLearningDraft(owner, studentId, `${key}:request`) || 'null'); } catch { /* Ignore invalid local receipts. */ } }
  const pending = task.attempts.find(a => !a.feedback);
  useEffect(() => { if (nonce.current && task.attempts.some(a => a.id === nonce.current?.id)) { if (answer.trim() === nonce.current.text) { setAnswer(''); writeLearningDraft(owner, studentId, key, ''); } nonce.current = null; writeLearningDraft(owner, studentId, `${key}:request`, ''); } }, [task.attempts, owner, studentId, key, answer]);
  function submit() {
    const text = answer.trim(); if (!text || disabled) return;
    if (nonce.current?.text !== text) nonce.current = { text, id: crypto.randomUUID() };
    writeLearningDraft(owner, studentId, `${key}:request`, JSON.stringify(nonce.current));
    onAction('attempt', { requestId: nonce.current.id, answer: text });
  }
  const answerForm = <form onSubmit={e => { e.preventDefault(); submit(); }}><label>我的答案与步骤<textarea value={answer} maxLength={8000} disabled={disabled} onChange={e => { setAnswer(e.target.value); if (!writeLearningDraft(owner, studentId, key, e.target.value)) setDraftError('草稿未能保存到本机，请保持页面并提交。'); }} placeholder={task.kind === 'retest' ? '不看提示，独立写下答案和关键步骤' : '写下答案和推导；暂时不会也可以写出自己的尝试'} /></label>{draftError && <p role="alert">{draftError}</p>}<button className="primary" disabled={disabled || !answer.trim()}>{pending ? '正在批改…' : '提交作答'}</button></form>;
  return <article className="learning-task question-card" aria-label={`学习第 ${index + 1} 题`}>
    <header className="question-card-heading"><strong>{task.kind === 'retest' ? '独立复测' : `第 ${index + 1} 题`} · {task.difficulty}</strong><span className="subject-tag">{taskPassed(task) ? '本题已完成' : '待作答'}</span></header>
    <p className="paper-prompt">{task.prompt}</p><p className="hint">{task.knowledgePoints.join(' · ')}</p>
    {task.hints.length > 0 && <div className="learning-hints">{task.hints.map((hint, n) => <div key={n}><strong>提示 {n + 1}</strong><p>{hint}</p></div>)}</div>}
    {!taskPassed(task) && task.kind !== 'retest' && task.hintCount < task.totalHints && <button className="learning-hint-button" disabled={disabled} onClick={() => onAction('hint')}><Lightbulb size={16} />{task.hintCount ? '再给一点提示' : '给我一点提示'}（{task.hintCount}/{task.totalHints}）</button>}
    {taskPassed(task) ? <details className="learning-redo"><summary>再作答一次</summary>{answerForm}</details> : answerForm}
    {!!task.attempts.length && <div className="learning-attempts">{[...task.attempts].reverse().map((attempt, n) => <details key={attempt.id} open={n === 0}><summary>{attempt.feedback ? verdictNames[attempt.feedback.verdict] : '作答已保存，等待批改'} · {attempt.helped ? '已参考提示或反馈' : '独立尝试'}</summary><p className="learning-answer">{attempt.answer}</p>{attempt.feedback && <><p>{attempt.feedback.feedback}</p><p><strong>下一步：</strong>{attempt.feedback.nextStep}</p></>}</details>)}</div>}
    {task.solution ? <details className="learning-solution" open><summary>参考解法</summary><p>{task.solution.answer}</p><p>{task.solution.explanation}</p></details> : task.attempts.some(a => a.feedback) && <button disabled={disabled} onClick={() => onAction('solution')}>查看参考解法</button>}
  </article>;
}
