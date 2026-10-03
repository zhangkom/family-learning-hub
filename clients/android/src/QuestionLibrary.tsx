import type { LearningMode, LearningSummary } from '../../../lib/learning-session';
import { learningProgress } from './learning-history';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { BookOpen, ChevronRight } from 'lucide-react';
import { subjects, type Scan } from './types';
import type { FamilyApi } from './api';
import { loadReviewImage } from './photo-processing/review-image';
import { QuestionImages, decodeQuestionImage } from './question-images';
import { QuestionCard } from './QuestionPaper';
import { QuestionImageRecovery } from './QuestionImageRecovery';
import { orderedWrongQuestions, type WrongQuestion } from './wrong-book-order';
import { WeaknessView } from './WeaknessView';
import { needsPhotoReview } from './photo-review-filter';
import { questionLearningReadiness } from '../../../lib/question-context';
import { WorksheetExport } from './WorksheetExport';

export type LibraryMode = 'wrong' | 'knowledge' | 'photos';
export type LibraryContext = { subject: string; order: 'newest' | 'oldest' | 'hardest' | 'easiest'; dimension: string; collection?: 'all' | 'wrong' | 'focus'; photoFilter?: 'all' | 'pending' };
export function QuestionLibrary({ api, owner, studentId, records, mode, onMode, context, onContext, onOpen, renderScan, refreshing, onLearn, learning, onUpdate }: {
  api: FamilyApi; owner: string; studentId: string;
  learning: LearningSummary[]; onLearn: (mode: LearningMode, source?: { scanId: string; questionId: string }, sessionId?: string) => void;
  records: Scan[]; mode: LibraryMode; onMode: (mode: LibraryMode) => void;
  context: LibraryContext; onContext: (context: LibraryContext) => void;
  onOpen: (scan: Scan, questionId?: string) => void; renderScan: (scan: Scan) => ReactNode; refreshing: boolean;
  onUpdate?: (scan: Scan) => void;
}) {
  const { subject, order, collection = 'all' } = context;
  const [exporting, setExporting] = useState(false);
  const setSubject = (subject: string) => onContext({ ...context, subject, dimension: '' });
  const images = useMemo(() => new QuestionImages(async (scan, _cloud, signal) => decodeQuestionImage((await loadReviewImage(api, owner, scan, true, signal)).file, signal)), [api, owner]);
  useEffect(() => () => images.dispose(), [images]);
  const wrong = useMemo(() => orderedWrongQuestions(records, order), [records, order]);
  const subjectNames: string[] = [...subjects];
  for (const { question } of wrong) if (!subjectNames.includes(question.subject || '待选科目')) subjectNames.push(question.subject || '待选科目');
  const filterNames = mode === 'knowledge' ? [...subjects] : subjectNames;
  const activeSubject = filterNames.includes(subject) ? subject : mode === 'knowledge' ? filterNames[0] : '全部';
  const subjectQuestions = wrong.filter(({ question }) => activeSubject === '全部' || (question.subject || '待选科目') === activeSubject);
  const visible = subjectQuestions.filter(({ question }) => collection === 'all' || (collection === 'focus' ? question.focusBook : question.wrongBook));
  function questionCard({ scan, question }: WrongQuestion) {
    const learningBlocked = questionLearningReadiness(question, scan.questions);
    return <QuestionCard key={`${scan.id}/${question.id}`} scan={scan} question={question} images={images} api={api} owner={owner} onUpdate={onUpdate} onOpen={() => onOpen(scan, question.id)} actions={<>
      <div className="question-learning-actions"><button disabled={!!learningBlocked} onClick={() => onLearn('practice', { scanId: scan.id, questionId: question.id })}>举一反三</button><button disabled={!!learningBlocked} onClick={() => onLearn('challenge', { scanId: scan.id, questionId: question.id })}>难题突破</button></div>
      {learningBlocked && <p className="hint">{learningBlocked}。可进入题目详情处理。</p>}
      {learning.filter(item => item.source.scanId === scan.id && item.source.questionId === question.id).slice(0, 2).map(item => <button className="question-learning-history" key={item.id} onClick={() => onLearn(item.mode, undefined, item.id)}>{item.mode === 'practice' ? '变式练习' : '难题突破'} · {learningProgress(item)} <ChevronRight size={13} /></button>)}
    </>} />;
  }
  return <div className="question-library">
    <nav className="library-modes" aria-label="题目分类"><button className={mode !== 'knowledge' ? 'selected' : ''} aria-pressed={mode !== 'knowledge'} onClick={() => onMode('wrong')}>错题本</button><button className={mode === 'knowledge' ? 'selected' : ''} aria-pressed={mode === 'knowledge'} onClick={() => onMode('knowledge')}>能力图谱</button></nav>
    {mode !== 'photos' && <>
      <div className="wrong-book-toolbar"><h2>{mode === 'knowledge' ? `${activeSubject} · 能力与补强方向` : `${activeSubject === '全部' ? collection === 'focus' ? '重点题' : collection === 'wrong' ? '全部错题' : '全部收录' : activeSubject} · ${visible.length} 道`}</h2>{mode === 'wrong' && <select aria-label="错题排序" value={order} onChange={e => onContext({ ...context, order: e.target.value as typeof order })}><option value="newest">最新上传</option><option value="oldest">最早上传</option><option value="hardest">难度从高到低</option><option value="easiest">难度从低到高</option></select>}</div>
      <nav className="subject-filters" aria-label={mode === 'knowledge' ? '选择图谱科目' : '按科目筛选错题'}>{mode === 'wrong' && <button className={activeSubject === '全部' ? 'selected' : ''} aria-pressed={activeSubject === '全部'} onClick={() => setSubject('全部')}>全部</button>}{filterNames.map(name => <button key={name} className={activeSubject === name ? 'selected' : ''} aria-pressed={activeSubject === name} onClick={() => setSubject(name)}>{name}</button>)}</nav>
      {mode === 'wrong' && <nav className="collection-filters" aria-label="按收录类型筛选">{([{ id: 'all', label: '全部收录' }, { id: 'wrong', label: '错题' }, { id: 'focus', label: '重点题' }] as const).map(item => <button key={item.id} className={collection === item.id ? 'selected' : ''} aria-pressed={collection === item.id} onClick={() => onContext({ ...context, collection: item.id })}>{item.label}</button>)}</nav>}
      {mode === 'wrong' && visible.length > 0 && <div className="worksheet-entry"><button type="button" onClick={() => setExporting(true)}>导出 Word</button></div>}
    </>}
    {mode === 'wrong' && Capacitor.getPlatform() === 'android' && <QuestionImageRecovery key={`${owner}/${studentId}`} studentId={studentId} records={records} images={images} />}
    {mode === 'wrong' && <section className="wrong-book" aria-label="错题本">{visible.length ? visible.map(questionCard) : <div className="empty-records"><BookOpen size={28} /><p>{refreshing ? '正在读取题目…' : wrong.length ? `${activeSubject === '全部' ? '当前' : activeSubject}还没有${collection === 'focus' ? '收录的重点题' : collection === 'wrong' ? '收录的错题' : '收录的题目'}。` : records.length ? '照片已保存，框选题目并收录后会出现在这里。' : '还没有错题，先从首页录入。'}</p>{records.length > 0 && <button onClick={() => onMode('photos')}>整理原题照片 <ChevronRight size={14} /></button>}</div>}</section>}
    {mode === 'knowledge' && <WeaknessView key={activeSubject} api={api} owner={owner} studentId={studentId} subject={activeSubject === '全部' ? '' : activeSubject} records={records} onOpen={onOpen} onLearn={onLearn}
      selectedDimension={context.dimension} onSelectDimension={dimension => onContext({ ...context, dimension })} />}
    {mode === 'photos' && <section className="records-section"><div className="section-line"><h2>原题照片 · {records.length}</h2><button onClick={() => onMode('wrong')}>返回错题本</button></div><p className="hint">照片先保存在这里；待确认资料可进入详情核对，缺字或缺图时需补拍原题。</p><nav className="collection-filters" aria-label="原题整理状态"><button aria-pressed={context.photoFilter !== 'pending'} className={context.photoFilter !== 'pending' ? 'selected' : ''} onClick={() => onContext({ ...context, photoFilter: 'all' })}>全部资料 · {records.length}</button><button aria-pressed={context.photoFilter === 'pending'} className={context.photoFilter === 'pending' ? 'selected' : ''} onClick={() => onContext({ ...context, photoFilter: 'pending' })}>待确认 · {records.filter(needsPhotoReview).length}</button></nav>{records.filter(scan => context.photoFilter !== 'pending' || needsPhotoReview(scan)).length ? <div className="record-grid">{records.filter(scan => context.photoFilter !== 'pending' || needsPhotoReview(scan)).map(renderScan)}</div> : <div className="empty-records"><p>{refreshing ? '正在读取资料…' : context.photoFilter === 'pending' ? '没有待确认资料。' : '还没有原题照片，请到首页录入。'}</p></div>}</section>}
    {exporting && mode === 'wrong' && <WorksheetExport key={`${owner}/${studentId}`} api={api} studentId={studentId} rows={visible} onClose={() => setExporting(false)} onOpen={({ scan, question }) => onOpen(scan, question.id)} />}
  </div>;
}
