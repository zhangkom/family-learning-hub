import type { LearningMode, LearningSummary } from '../../../lib/learning-session';
import { learningProgress } from './learning-history';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BookOpen, ChevronRight, Layers } from 'lucide-react';
import { type Scan, type Question } from './types';
import type { FamilyApi } from './api';
import { loadReviewImage } from './photo-processing/review-image';
import { QuestionImages, decodeQuestionImage } from './question-images';
import { QuestionCard } from './QuestionPaper';

export type LibraryMode = 'all' | 'wrong' | 'knowledge' | 'photos';
type Item = { scan: Scan; question: Question };
export function collectKnowledge(items: Item[]) {
  const groups = new Map<string, { subject: string; name: string; items: Item[] }>();
  for (const item of items) for (const name of new Set(item.question.knowledgePoints.map(value => value.trim()).filter(value => value && value !== '待确认'))) {
    const subject = item.question.subject || '待选科目', key = `${subject}\u0000${name}`;
    if (!groups.has(key)) groups.set(key, { subject, name, items: [] });
    groups.get(key)!.items.push(item);
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name, 'zh-CN'));
}
export function QuestionLibrary({ api, owner, records, mode, onMode, onOpen, renderScan, refreshing, onLearn, learning }: {
  api: FamilyApi; owner: string;
  learning: LearningSummary[]; onLearn: (mode: LearningMode, source?: { scanId: string; questionId: string }, sessionId?: string) => void;
  records: Scan[]; mode: LibraryMode; onMode: (mode: LibraryMode) => void;
  onOpen: (scan: Scan, questionId?: string) => void; renderScan: (scan: Scan) => ReactNode; refreshing: boolean;
}) {
  const [subject, setSubject] = useState('全部');
  const images = useMemo(() => new QuestionImages(async (scan, cloud, signal) => {
    const result = await loadReviewImage(api, owner, scan, cloud, signal);
    return decodeQuestionImage(result.file, signal);
  }), [api, owner]);
  useEffect(() => () => images.dispose(), [images]);
  const all = useMemo(() => records.flatMap(scan => scan.questions.map(question => ({ scan, question }))), [records]);
  const wrong = all.filter(item => item.question.wrongBook).sort((a, b) => b.question.wrongBook!.savedAt.localeCompare(a.question.wrongBook!.savedAt));
  const subjectItems = mode === 'wrong' ? wrong : all;
  const subjectNames: string[] = [...new Set(subjectItems.map(item => item.question.subject || '待选科目'))];
  const activeSubject = subjectNames.includes(subject) ? subject : '全部';
  const visible = all.filter(item => activeSubject === '全部' || (item.question.subject || '待选科目') === activeSubject);
  const visibleWrong = wrong.filter(item => activeSubject === '全部' || (item.question.subject || '待选科目') === activeSubject);
  const knowledge = collectKnowledge(visible);
  function questionCard({ scan, question }: Item) {
    return <QuestionCard key={`${scan.id}/${question.id}`} scan={scan} question={question} images={images} onOpen={() => onOpen(scan, question.id)} actions={<>
      <div className="question-learning-actions"><button onClick={() => onLearn('practice', { scanId: scan.id, questionId: question.id })}>举一反三</button><button onClick={() => onLearn('challenge', { scanId: scan.id, questionId: question.id })}>难题突破</button></div>
      {learning.filter(item => item.source.scanId === scan.id && item.source.questionId === question.id).slice(0, 2).map(item => <button className="question-learning-history" key={item.id} onClick={() => onLearn(item.mode, undefined, item.id)}>{item.mode === 'practice' ? '变式练习' : '难题突破'} · {learningProgress(item)} <ChevronRight size={13} /></button>)}
    </>} />;
  }
  return <div className="question-library">
    <p className="learning-totals" aria-label="题目概览">{wrong.length} 道错题 · {all.length} 道题 · {collectKnowledge(all).length} 个知识点</p>
    <nav className="library-modes" aria-label="题目分类"><button className={mode === 'all' ? 'selected' : ''} onClick={() => { setSubject('全部'); onMode('all'); }}>全部</button><button className={mode === 'wrong' ? 'selected' : ''} onClick={() => { setSubject('全部'); onMode('wrong'); }}>错题本</button><button className={mode === 'knowledge' ? 'selected' : ''} onClick={() => { setSubject('全部'); onMode('knowledge'); }}>知识点归纳</button><button className={mode === 'photos' ? 'selected' : ''} onClick={() => { setSubject('全部'); onMode('photos'); }}>原题照片</button></nav>
    {mode !== 'photos' && subjectNames.length > 0 && <section className="subject-section" aria-label="按科目学习">
      <div className="subject-grid"><button className={activeSubject === '全部' ? 'selected' : ''} aria-pressed={activeSubject === '全部'} onClick={() => setSubject('全部')}>全部科目</button>{subjectNames.map(name => <button key={name} className={activeSubject === name ? 'selected' : ''} aria-pressed={activeSubject === name} onClick={() => setSubject(name)}>{name}<span>{subjectItems.filter(item => (item.question.subject || '待选科目') === name).length} {mode === 'wrong' ? '道错题' : '道题'}</span></button>)}</div>
    </section>}
    {(mode === 'all' || mode === 'wrong') && <section className="wrong-book" aria-label={mode === 'all' ? '全部题目' : '错题本'}><div className="section-line"><h2>{activeSubject === '全部' ? mode === 'all' ? '全部题目' : '全部错题' : activeSubject} · {(mode === 'all' ? visible : visibleWrong).length} 道题</h2></div>{(mode === 'all' ? visible : visibleWrong).length ? (mode === 'all' ? visible : visibleWrong).map(questionCard) : <div className="empty-records"><BookOpen size={28} /><p>{refreshing ? '正在读取题目…' : records.length ? mode === 'all' ? '照片还未整理成题目，可进入原题照片框选。' : '还没有收录错题，可从原题照片中框题并收录。' : '还没有题目，请到首页拍照或选图。'}</p>{records.length > 0 && <button onClick={() => onMode('photos')}>查看原题照片 <ChevronRight size={14} /></button>}</div>}</section>}
    {mode === 'knowledge' && <section className="knowledge-section" aria-label="知识点归纳"><p className="hint">按题目中已保存的知识点归类，展开可回看相关题目。</p>{knowledge.length ? knowledge.map(group => <details className="knowledge-card" key={`${group.subject}/${group.name}`}><summary><Layers size={18} /><span><strong>{group.name}</strong><small>{group.subject} · {group.items.length} 道题 · {group.items.filter(item => item.question.wrongBook).length} 道错题{group.items.some(item => !item.question.confirmed) ? ' · 含待校对题目' : ''}</small></span></summary><div>{group.items.map(questionCard)}</div></details>) : <div className="empty-records"><Layers size={28} /><p>暂无已记录的知识点。校对题目时补充知识点后，会自动归类到这里。</p></div>}</section>}
    {mode === 'photos' && <section className="records-section"><div className="section-line"><h2>原题照片 · {records.length}</h2></div>{records.length ? <div className="record-grid">{records.map(scan => renderScan(scan))}</div> : <div className="empty-records"><p>{refreshing ? '正在读取资料…' : '还没有原题照片，请到首页收题。'}</p></div>}</section>}

  </div>;
}
