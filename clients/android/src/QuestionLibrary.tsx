import type { LearningMode, LearningSummary } from '../../../lib/learning-session';
import { learningProgress } from './learning-history';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BookOpen, ChevronRight } from 'lucide-react';
import { subjects, type Scan } from './types';
import type { FamilyApi } from './api';
import { loadReviewImage } from './photo-processing/review-image';
import { QuestionImages, decodeQuestionImage } from './question-images';
import { QuestionCard } from './QuestionPaper';
import { orderedWrongQuestions, type WrongQuestion } from './wrong-book-order';
import { WeaknessView } from './WeaknessView';

export type LibraryMode = 'wrong' | 'knowledge' | 'photos';
export function QuestionLibrary({ api, owner, studentId, records, mode, onMode, onOpen, renderScan, refreshing, onLearn, learning }: {
  api: FamilyApi; owner: string; studentId: string;
  learning: LearningSummary[]; onLearn: (mode: LearningMode, source?: { scanId: string; questionId: string }, sessionId?: string) => void;
  records: Scan[]; mode: LibraryMode; onMode: (mode: LibraryMode) => void;
  onOpen: (scan: Scan, questionId?: string) => void; renderScan: (scan: Scan) => ReactNode; refreshing: boolean;
}) {
  const [subject, setSubject] = useState('全部'), [order, setOrder] = useState<'newest' | 'oldest'>('newest');
  const images = useMemo(() => new QuestionImages(async (scan, cloud, signal) => decodeQuestionImage((await loadReviewImage(api, owner, scan, cloud, signal)).file, signal)), [api, owner]);
  useEffect(() => () => images.dispose(), [images]);
  const wrong = useMemo(() => orderedWrongQuestions(records, order), [records, order]);
  const subjectNames: string[] = [...subjects];
  for (const { question } of wrong) if (!subjectNames.includes(question.subject || '待选科目')) subjectNames.push(question.subject || '待选科目');
  const filterNames = mode === 'knowledge' ? [...subjects] : subjectNames;
  const activeSubject = filterNames.includes(subject) ? subject : mode === 'knowledge' ? filterNames[0] : '全部';
  const visible = wrong.filter(({ question }) => activeSubject === '全部' || (question.subject || '待选科目') === activeSubject);
  function questionCard({ scan, question }: WrongQuestion) {
    return <QuestionCard key={`${scan.id}/${question.id}`} scan={scan} question={question} images={images} onOpen={() => onOpen(scan, question.id)} actions={<>
      <div className="question-learning-actions"><button onClick={() => onLearn('practice', { scanId: scan.id, questionId: question.id })}>举一反三</button><button onClick={() => onLearn('challenge', { scanId: scan.id, questionId: question.id })}>难题突破</button></div>
      {learning.filter(item => item.source.scanId === scan.id && item.source.questionId === question.id).slice(0, 2).map(item => <button className="question-learning-history" key={item.id} onClick={() => onLearn(item.mode, undefined, item.id)}>{item.mode === 'practice' ? '变式练习' : '难题突破'} · {learningProgress(item)} <ChevronRight size={13} /></button>)}
    </>} />;
  }
  return <div className="question-library">
    <nav className="library-modes" aria-label="题目分类"><button className={mode !== 'knowledge' ? 'selected' : ''} aria-pressed={mode !== 'knowledge'} onClick={() => onMode('wrong')}>错题本</button><button className={mode === 'knowledge' ? 'selected' : ''} aria-pressed={mode === 'knowledge'} onClick={() => onMode('knowledge')}>能力图谱</button></nav>
    {mode !== 'photos' && <>
      <div className="wrong-book-toolbar"><h2>{mode === 'knowledge' ? `${activeSubject} · 能力与补强方向` : `${activeSubject === '全部' ? '全部错题' : activeSubject} · ${visible.length} 道`}</h2>{mode === 'wrong' && <select aria-label="错题排序" value={order} onChange={e => setOrder(e.target.value as typeof order)}><option value="newest">最新上传</option><option value="oldest">最早上传</option></select>}</div>
      <nav className="subject-filters" aria-label={mode === 'knowledge' ? '选择图谱科目' : '按科目筛选错题'}>{mode === 'wrong' && <button className={activeSubject === '全部' ? 'selected' : ''} aria-pressed={activeSubject === '全部'} onClick={() => setSubject('全部')}>全部</button>}{filterNames.map(name => <button key={name} className={activeSubject === name ? 'selected' : ''} aria-pressed={activeSubject === name} onClick={() => setSubject(name)}>{name}</button>)}</nav>
    </>}
    {mode === 'wrong' && <section className="wrong-book" aria-label="错题本">{visible.length ? visible.map(questionCard) : <div className="empty-records"><BookOpen size={28} /><p>{refreshing ? '正在读取错题…' : wrong.length ? `${activeSubject}还没有收录的错题。` : records.length ? '照片已保存，框选题目并收录后会出现在这里。' : '还没有错题，先从首页录入。'}</p>{records.length > 0 && <button onClick={() => onMode('photos')}>整理原题照片 <ChevronRight size={14} /></button>}</div>}</section>}
    {mode === 'knowledge' && <WeaknessView key={activeSubject} api={api} owner={owner} studentId={studentId} subject={activeSubject === '全部' ? '' : activeSubject} records={records} onOpen={onOpen} onLearn={onLearn} />}
    {mode === 'photos' && <section className="records-section"><div className="section-line"><h2>原题照片 · {records.length}</h2><button onClick={() => onMode('wrong')}>返回错题本</button></div><p className="hint">照片先保存在这里；框题并收录后进入错题本。</p>{records.length ? <div className="record-grid">{records.map(renderScan)}</div> : <div className="empty-records"><p>{refreshing ? '正在读取资料…' : '还没有原题照片，请到首页录入。'}</p></div>}</section>}
  </div>;
}
