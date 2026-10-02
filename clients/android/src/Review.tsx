import type { LearningMode } from '../../../lib/learning-session';
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { ArrowLeft, Check, Plus, Save, RefreshCw, Trash2 } from 'lucide-react';
import { ApiError, FamilyApi } from './api';
import { RegionEditor } from './RegionEditor';
import { CandidatePicker } from './CandidatePicker';
import { adoptCandidates, candidateQuestions, overlapsExisting } from './candidates';
import { TutoringResult } from './TutoringResult';
import { reviewDrafts } from './drafts';
import { loadReviewImage } from './photo-processing/review-image';
import { photoSubjectKey, readPhotoSubject, rememberPhotoSubject } from './photo-subject';
import {
  emptyQuestion,
  mergeQuestions,
  removeQuestion,
  removeRegion,
} from './regions';
import { subjects, statusNames, type Subject, type Question, type Region, type Scan, type TutoringReviewInput } from './types';
import { AnalysisStatus } from './AnalysisStatus';
import { QuestionPaper } from './QuestionPaper';
import { decodeQuestionImage } from './question-images';

type Props = {
  api: FamilyApi;
  owner: string;
  scan: Scan;
  studentName: string;
  recognitionEnabled: boolean;
  selectedQuestionId?: string;
  onBack: () => void;
  onUpdate: (scan: Scan) => void;
  onLearn: (mode: LearningMode, scan: Scan, questionId: string) => void;
};
export function Review({
  api,
  owner,
  scan: initial,
  studentName,
  recognitionEnabled,
  selectedQuestionId,
  onBack,
  onUpdate, onLearn,
}: Props) {
  const draftId = `${owner}|${initial.id}`;
  // A scan's uploaded image is immutable. Polling analysis revisions must not reread/redecode it.
  const reviewPhoto = useRef(initial).current;
  const subjectKey = photoSubjectKey(owner, initial.studentId, initial.id);
  const [photoSubject, setPhotoSubject] = useState<Subject | undefined>(() =>
    readPhotoSubject(subjectKey, initial.questions || []));
  const draftRevision = useRef(initial.revision);
  const editing = useRef(false),
    latestRevision = useRef(initial.revision);
  const mutation = useRef(false);
  const [scan, setScan] = useState(initial),
    [questions, setQuestions] = useState(initial.questions || []);
  const [selected, setSelected] = useState(selectedQuestionId || initial.questions?.[0]?.id || ''),
    [region, setRegion] = useState('');
  const [image, setImage] = useState(''),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  const [allowCloudImage, setAllowCloudImage] = useState(false), [localImageMissing, setLocalImageMissing] = useState(false);
  const [imageRetry, setImageRetry] = useState(0), [imageError, setImageError] = useState('');
  const [imageSource, setImageSource] = useState<'local' | 'cloud'>();
  const [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [mergeTarget, setMergeTarget] = useState('');
  const [draftReady, setDraftReady] = useState(false),
    [conflict, setConflict] = useState(false);
  const [suggestions, setSuggestions] = useState<Question[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>();
  const [originalQuestionId, setOriginalQuestionId] = useState('');
  const candidateRequest = useRef(0), localEdits = useRef(0);
  useEffect(() => () => { candidateRequest.current++; }, [draftId]);
  const question = questions.find((q) => q.id === selected);
  const newQuestionSubject = questions.some((q) => q.subject === photoSubject)
    ? photoSubject : undefined;
  const hasPendingAnalysis = questions.some((q) => ['queued', 'processing'].includes(q.tutoring?.status || ''));
  const analyzing = ['queued', 'processing'].includes(question?.tutoring?.status || '');
  const validQuestion = !!question?.subject && question.regions.some((r) => r.kind === 'stem');
  const backAction = useRef<() => void>(() => {});
  backAction.current = () => {
    if (busy || !draftReady) return;
    if (!dirty || window.confirm('还有未保存的校对，确定返回吗？')) onBack();
  };
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener('backButton', () => backAction.current());
    return () => { void listener.then((handle) => handle.remove()); };
  }, []);
  useEffect(() => {
    let alive = true;
    void reviewDrafts
      .read(draftId)
      .then((draft) => {
        if (!alive || !draft) return;
        draftRevision.current = draft.revision;
        editing.current = true;
        setQuestions(draft.questions);
        setPhotoSubject(readPhotoSubject(subjectKey, draft.questions));
        setSelected(draft.questions.some((q) => q.id === selectedQuestionId) ? selectedQuestionId! : draft.questions[0]?.id || '');
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
  }, [draftId, initial.revision, selectedQuestionId, subjectKey]);
  useEffect(() => {
    const abort = new AbortController();
    let url = '';
    setLocalImageMissing(false); setImageError(''); setImage(''); setImageSize(undefined);
    void loadReviewImage(api, owner, reviewPhoto, allowCloudImage, abort.signal)
      .then(async ({ file, source }) => {
        const decoded = await decodeQuestionImage(file, abort.signal); url = decoded.url;
        if (!abort.signal.aborted) { setImage(url); setImageSize({ width: decoded.width, height: decoded.height }); setImageSource(source); }
        else URL.revokeObjectURL(url);
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setImageError(e.message);
          if (Capacitor.getPlatform() === 'android' && !allowCloudImage) setLocalImageMissing(true);
          else setError(e.message);
        }
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, owner, reviewPhoto, allowCloudImage, imageRetry]);
  useEffect(() => {
    if (!draftReady || dirty || (!hasPendingAnalysis && !['queued', 'processing'].includes(scan.status)))
      return;
    let alive = true;
    const timer = setInterval(() => {
      if (mutation.current) return;
      void api
        .scan(scan.id)
        .then(({ scan: next }) => {
          if (
            !alive ||
            mutation.current ||
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
  }, [api, draftReady, dirty, scan.id, scan.status, hasPendingAnalysis, onUpdate]);
  function change(all: Question[]) {
    localEdits.current++;
    all = all.map((q) => {
      const old = questions.find((item) => item.id === q.id);
      const input = (item: Question) => JSON.stringify([item.subject, item.prompt, item.diagram, item.regions,
        item.answerSteps, item.parentQuestionId, item.sharedRegionIds]);
      const sharedChanged = (q.sharedRegionIds || []).some((id) => {
        const before = questions.flatMap((item) => item.regions).find((r) => r.id === id);
        const after = all.flatMap((item) => item.regions).find((r) => r.id === id);
        return JSON.stringify(before) !== JSON.stringify(after);
      });
      return old?.tutoring && (input(old) !== input(q) || sharedChanged)
        ? { ...q, tutoring: { ...old.tutoring, status: 'stale' as const } } : q;
    });
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
  function chooseSubject(subject?: Subject) {
    if (!question) return;
    setPhotoSubject(subject);
    rememberPhotoSubject(subjectKey, question.id, subject);
    update(question.id, { subject });
  }
  function newQuestion() {
    return { ...emptyQuestion(String(questions.length + 1)),
      subject: newQuestionSubject };
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
    mutation.current = true;
    setBusy(true);
    setError('');
    try {
      const { scan: next } = await api.review(scan, questions);
      await accept(next);
      setNotice('已保存题目框和手写步骤');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        setError(
          '另一台设备或识别任务更新了资料。本机草稿已保留，请导出后加载服务器内容进行比较。',
        );
      } else setError((e as Error).message);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  async function accept(next: Scan) {
    draftRevision.current = next.revision;
    latestRevision.current = next.revision;
    editing.current = false;
    setScan(next);
    setQuestions(next.questions);
    setDirty(false);
    onUpdate(next);
    await reviewDrafts.remove(draftId).catch(() => {
      setNotice('服务器已保存，本机旧草稿未能清理，重进时请加载服务器内容。');
    });
  }
  async function collect(andExplain: boolean) {
    if (!question || !validQuestion || busy || conflict) return;
    const questionId = question.id;
    let saved = !!question.wrongBook;
    mutation.current = true;
    setBusy(true);
    setError('');
    setNotice(andExplain ? '正在保存题目并提交分析…' : '正在保存错题…');
    try {
      let next = scan;
      if (dirty) {
        next = (await api.review(scan, questions)).scan;
        await accept(next);
      }
      if (!next.questions.find((q) => q.id === questionId)?.wrongBook) {
        next = (await api.saveWrongQuestion(next, questionId)).scan;
        saved = true;
        await accept(next);
      }
      if (andExplain) {
        next = (await api.explain(next, questionId)).scan;
        await accept(next);
        setNotice('已存入错题本，AI 正在分析这道题。可以返回，稍后再看。');
      } else setNotice('已存入当前学生的错题本');
    } catch (e) {
      setNotice(saved ? '错题已保存，仍可重新提交分析。' : '本机题框草稿已保留。');
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        setError('资料已有新版本，请先加载服务器内容，核对后再操作。');
      } else setError((saved && andExplain ? '分析未提交成功：' : '') + (e as Error).message);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  async function reviewAnalysis(input: TutoringReviewInput) {
    if (!question || dirty || busy || conflict || hasPendingAnalysis) return false;
    mutation.current = true; setBusy(true); setError('');
    try {
      const next = (await api.reviewAnalysis(scan, question.id, input)).scan;
      await accept(next);
      setNotice(input.status === 'confirmed' ? '已记录你对这份分析的核对。' : '核对意见已保存，尚未再次调用 AI。可按校对内容重新分析。');
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      setError((e as Error).message); return false;
    } finally { mutation.current = false; setBusy(false); }
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
  async function findCandidates() {
    if (finding || busy || conflict || !image || !imageSize || !draftReady) return;
    const request = ++candidateRequest.current;
    const edits = localEdits.current, revision = latestRevision.current;
    const source = { ...scan, revision };
    setFinding(true); setError(''); setNotice('');
    try {
      const result = await api.candidateRegions(source);
      if (request !== candidateRequest.current) return;
      if (edits !== localEdits.current || revision !== latestRevision.current) {
        setNotice('你已修改题框，本次建议未应用。'); return;
      }
      const proposed = candidateQuestions(result, source);
      if (imageSize.width !== result.image.width || imageSize.height !== result.image.height)
        throw new Error('建议框暂时无法与这张上传图对应，请手动框题。');
      if (!proposed.length) setNotice('暂时没有找到可用的建议框，请手动框题。');
      else setSuggestions(proposed);
    } catch (e) {
      if (request !== candidateRequest.current) return;
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        setError('这张照片已有更新，本机修改已保留。核对最新内容后可重新找题。');
      } else if (e instanceof ApiError && [429, 503].includes(e.status))
        setError('找题服务正忙，稍后重试，或先手动框题。');
      else if (e instanceof ApiError && [404, 405].includes(e.status))
        setError('当前服务尚未开启自动找题，请先手动框题。');
      else if (e instanceof Error && ['TimeoutError', 'AbortError'].includes(e.name))
        setError('本次未能完成找题，上传图和已有题目仍保留。');
      else setError((e as Error).message || '找题未完成，请手动框题。');
    } finally {
      if (request === candidateRequest.current) setFinding(false);
    }
  }
  function acceptCandidates(proposed: Question[], subject: Subject) {
    if (conflict || busy) return false;
    if (proposed.some((q) => overlapsExisting(q, questions)) &&
      !window.confirm('所选建议与已有题框重叠，可能重复。核对后仍要采用吗？')) return false;
    try {
      const next = adoptCandidates(questions, proposed, subject);
      const first = next[questions.length];
      change(next);
      setPhotoSubject(subject); rememberPhotoSubject(subjectKey, first.id, subject);
      setSelected(first.id); setRegion(first.regions[0].id);
      setNotice(`已采用 ${proposed.length} 个题框，尚未保存到服务器。`);
      return true;
    } catch (e) { setError((e as Error).message); return false; }
  }
  function addQuestion() {
    const q = newQuestion();
    change([...questions, q]);
    setSelected(q.id);
    setRegion('');
  }
  function splitRegion() {
    if (!question) return;
    const moved = question.regions.find((r) => r.id === region);
    if (!moved) return;
    const q = emptyQuestion(String(questions.length + 1));
    q.subject = question.subject;
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
          disabled={busy || !draftReady}
          onClick={() => backAction.current()}
        >
          <ArrowLeft />
        </button>
        <div>
          <small>{studentName} · {question?.subject || '框题后选科目'}</small>
          <h1>{questions.length ? '题目详情' : '框选题目'}</h1>
        </div>
        <button
          className="primary save-button"
          disabled={busy || !dirty || conflict || !draftReady}
          onClick={() => void save()}
        >
          <Save size={17} /> 保存校对
        </button>
      </header>

      {localImageMissing && <section className="notice"><p>暂时无法读取本机题图。可以重试读取，或主动从云端恢复这张题图。</p>
        <button type="button" onClick={() => setImageRetry(value => value + 1)}>重试读取本机题图</button>
        <button type="button" onClick={() => setAllowCloudImage(true)}>从云端恢复这张题图</button></section>}
      <div className="review-status">
        <span className="status">
          {statusNames[scan.status] || scan.status}
        </span>
        <span>
          {imageSource === 'local' ? '本机照片 · ' : ''}{questions.length} 道题{dirty ? ' · 有修改未保存' : ''}
        </span>
        {!suggestions && <button
          disabled={finding || busy || conflict || !draftReady || !image || !imageSize || hasPendingAnalysis || ['queued', 'processing'].includes(scan.status)}
          onClick={() => void findCandidates()}>
          {finding ? '正在查找建议框…' : '自动找题'}
        </button>}
        {finding && <button onClick={() => {
          candidateRequest.current++; setFinding(false); setNotice('已取消找题，上传图和已有题目保持不变。');
        }}>取消找题</button>}
        {questions.length === 0 && <button
          disabled={
            !recognitionEnabled || busy || finding || !!suggestions || dirty || questions.length > 0 || ['queued', 'processing'].includes(scan.status)
          }
          onClick={() => void recognize()}
        >
          <RefreshCw size={15} />
          {scan.status === 'failed' ? '重试识别' : '识别这张照片'}
        </button>}
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
                setPhotoSubject(readPhotoSubject(subjectKey, next.questions));
                setSelected(next.questions[0]?.id || '');
                setDirty(false);
                setConflict(false);
                setSuggestions(null);
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
      {scan.analysis && !scan.analysis.questionId && <AnalysisStatus progress={scan.analysis} />}
      {suggestions ? <fieldset className="candidate-fieldset" disabled={!draftReady || busy || conflict}>
        <CandidatePicker image={image} suggestions={suggestions} existing={questions}
          defaultSubject={newQuestionSubject} onAdopt={acceptCandidates}
          onCancel={() => setSuggestions(null)} />
      </fieldset> : <fieldset className="review-grid" disabled={!draftReady || busy}>
        <RegionEditor
          image={image}
          onImageDimensions={(width, height) => setImageSize({ width, height })}
          questions={questions}
          selectedId={selected}
          activeRegion={region}
          onSelect={(q, r) => {
            setSelected(q);
            setRegion(r);
          }}
          onChange={replaceRegion}
          onCreate={(r) => {
            const q = newQuestion();
            q.regions = [r];
            change([...questions, q]);
            setSelected(q.id);
            setRegion(r.id);
          }}
          onAdd={(r) => {
            if (question) {
              update(question.id, { regions: [...question.regions, r] });
              setRegion(r.id);
            }
          }}
        >
          {question && <section className="question-actions" aria-label="所选题目与科目">
            <div className="section-line"><strong>已选第 {question.number || questions.indexOf(question) + 1} 题</strong>
              {question.wrongBook && <span className="saved-tag">已存错题本</span>}</div>
            <label>这道题的科目
              <select value={question.subject || ''} onChange={(e) => chooseSubject((e.target.value || undefined) as Subject | undefined)}>
                <option value="">请选择科目</option>
                {subjects.map((subject) => <option key={subject}>{subject}</option>)}
              </select>
            </label>
            <output className="hint">{newQuestionSubject
              ? `同一张照片后续新框题沿用${newQuestionSubject}，可逐题修改；已有题目不变。`
              : '选一次，同一张照片后续新框的题会自动沿用。'}</output>
            {!validQuestion && <p className="hint">{question.regions.some((r) => r.kind === 'stem') ? '选好科目，就能保存和分析这道题。' : '请先为这道题补充题干框。'}</p>}
            <div className="question-save-actions">
              <button className="primary" disabled={!validQuestion || busy || conflict || hasPendingAnalysis || !recognitionEnabled}
                onClick={() => void collect(true)}>{busy ? '正在保存…' : analyzing ? '正在分析…' : question.tutoring ? '重新分析这道题' : '保存并分析这道题'}</button>
              <button disabled={!validQuestion || busy || conflict || hasPendingAnalysis} onClick={() => void collect(false)}>只存错题本</button>
            </div>
            {!recognitionEnabled && <p className="hint">AI 分析暂不可用，可以先存错题本。</p>}
            {hasPendingAnalysis && !analyzing && <p className="hint">这张照片的另一道题正在分析，完成后可继续保存和分析。</p>}
            <p className="hint">AI 讲解需核对；原题和作答以照片为准。</p>
          </section>}
        </RegionEditor>
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
              <p>点照片上方的“框选一道题”，直接拖框即可。</p>
            </div>
          ) : (
            <>
              <section className="question-card review-question-paper" aria-label="当前题目原题">
                <header className="question-card-heading"><div><span className="paper-number">{question.number || questions.indexOf(question) + 1}.</span><span className="subject-tag">{question.subject || '待选科目'}</span></div>
                  <button className="question-original-toggle" type="button" aria-pressed={originalQuestionId === question.id}
                    onClick={() => setOriginalQuestionId(originalQuestionId === question.id ? '' : question.id)}>{originalQuestionId === question.id ? '整理版' : '原图'}</button></header>
                <QuestionPaper question={question} questions={questions} original={originalQuestionId === question.id}
                  image={image && imageSize ? { url: image, ...imageSize } : undefined}
                  onImageError={() => { setImage(''); setImageError('题图显示失败，请重新读取'); }} />
                {!image && <output className="paper-image-note">{imageError || '正在读取题图…'}</output>}
                {imageError && <button type="button" onClick={() => setImageRetry(value => value + 1)}>重试读取题图</button>}
              </section>
              <label className="confirm-check">
                <input
                  type="checkbox"
                  checked={question.confirmed}
                  disabled={
                    !question.prompt.trim() ||
                    !question.regions.length ||
                    question.answerSteps.some(
                      (s) =>
                        !s.regionIds.length ||
                        !s.text.trim(),
                    )
                  }
                  onChange={(e) =>
                    update(question.id, { confirmed: e.target.checked })
                  }
                />
                题干与题框已核对
              </label>
              <p className="hint">
                进入练习前请核对题干、题框和原作答；需要修改时展开下方“核对题干和原作答”。
              </p>
              {question.answerSteps.some(s => s.uncertain || s.author === 'unknown') && <p className="hint">题干和题框核对后可继续学习；待确认的笔迹会保留标记，不作为判断个人错因的依据。</p>}
              {dirty && <button disabled={busy || conflict || hasPendingAnalysis} onClick={() => void save()}>保存这次校对</button>}
              <div className="question-learning-actions"><button disabled={dirty || busy || conflict || hasPendingAnalysis || !question.confirmed} onClick={() => onLearn('practice', scan, question.id)}>举一反三</button><button disabled={dirty || busy || conflict || hasPendingAnalysis || !question.confirmed} onClick={() => onLearn('challenge', scan, question.id)}>难题突破</button></div>
              {dirty && <p className="hint">保存校对后可进入练习与突破。</p>}
              {dirty && question.tutoring?.result && <p className="hint">请先保存题框或文字修改，再核对分析。</p>}
              <TutoringResult question={question} progress={scan.analysis} disabled={dirty || busy || conflict || hasPendingAnalysis || !draftReady}
                onReview={reviewAnalysis} onReanalyze={() => void collect(true)} canReanalyze={validQuestion && recognitionEnabled} />
              {!question.prompt.trim() && question.tutoring?.result?.transcribedPrompt && <button disabled={busy || conflict || hasPendingAnalysis} onClick={() => update(question.id, { prompt: question.tutoring!.result!.transcribedPrompt })}>采用识别题干，再校对</button>}
              <details className="manual-review"><summary>核对题干和原作答</summary>
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
                  aria-label="完整题干"
                  rows={4}
                  value={question.prompt}
                  placeholder="核对条件、选项和单位，不清楚的地方先保留待确认"
                  onChange={(e) =>
                    update(question.id, { prompt: e.target.value })
                  }
                />
              </label>
              <label>
                知识点（用逗号分隔）
                <input key={question.id + JSON.stringify(question.knowledgePoints)} defaultValue={question.knowledgePoints.join('，')} onBlur={e => { const points = [...new Set(e.target.value.split(/[,，、]/).map(value => value.trim()).filter(Boolean))].slice(0, 20); if (JSON.stringify(points) !== JSON.stringify(question.knowledgePoints)) update(question.id, { knowledgePoints: points }); }} placeholder="例如：匀速直线运动、路程计算" />
              </label>
              <label>
                配图说明
                <input
                  value={question.diagram}
                  onChange={(e) =>
                    update(question.id, { diagram: e.target.value })
                  }
                  placeholder="几何图、表格等保留在上传图中"
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
                      <summary>对应上传图区域（{step.regionIds.length}）</summary>
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
              </details>
            </>
          )}
        </section>
      </fieldset>}
    </main>
  );
}
function ScanEmpty() {
  return <span className="empty-symbol">▧</span>;
}
