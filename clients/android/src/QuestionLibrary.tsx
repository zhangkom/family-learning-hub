import { useMemo, useState, type ReactNode } from 'react';
import { BookOpen, ChevronRight, Layers, Sparkles } from 'lucide-react';
import { subjects, type Scan, type Question } from './types';

export type LibraryMode = 'wrong' | 'knowledge' | 'photos';
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
export function QuestionLibrary({ records, mode, onMode, onOpen, renderScan, refreshing }: {
  records: Scan[]; mode: LibraryMode; onMode: (mode: LibraryMode) => void;
  onOpen: (scan: Scan, questionId?: string) => void; renderScan: (scan: Scan) => ReactNode; refreshing: boolean;
}) {
  const [subject, setSubject] = useState('全部');
  const all = useMemo(() => records.flatMap(scan => scan.questions.map(question => ({ scan, question }))), [records]);
  const wrong = all.filter(item => item.question.wrongBook).sort((a, b) => b.question.wrongBook!.savedAt.localeCompare(a.question.wrongBook!.savedAt));
  const visible = all.filter(item => subject === '全部' || (item.question.subject || '待选科目') === subject);
  const visibleWrong = wrong.filter(item => subject === '全部' || (item.question.subject || '待选科目') === subject);
  const knowledge = collectKnowledge(visible);
  const subjectNames = [...subjects, ...new Set(all.map(item => item.question.subject || '待选科目').filter(value => !subjects.includes(value as typeof subjects[number])))];
  function questionCard({ scan, question }: Item) {
    const status = question.tutoring?.status;
    return <button className="wrong-question-card" key={`${scan.id}/${question.id}`} onClick={() => onOpen(scan, question.id)}>
      <div><span className="subject-tag">{question.subject || '待选科目'}</span><small>第 {question.number || '—'} 题</small></div>
      <strong>{question.prompt || question.tutoring?.result?.transcribedPrompt || '已框选题目，查看原图'}</strong>
      <span>{status === 'needs_review' ? question.tutoring?.review?.status === 'confirmed' ? '讲解已核对' : 'AI 分析待核对' : status === 'failed' ? '分析未完成 · 可重试' : status === 'stale' ? '题目已修改 · 需重新分析' : status ? '正在分析' : '查看原题与讲解'}</span>
    </button>;
  }
  return <div className="question-library">
    <section className="learning-overview" aria-label="题目概览"><BookOpen size={24} /><div><strong>{wrong.length} 道错题</strong><span>已整理 {all.length} 道题 · {collectKnowledge(all).length} 个知识点</span></div></section>
    <section className="subject-section" aria-label="按科目学习"><div className="section-line"><h2>各科错题</h2><button aria-pressed={subject === '全部'} onClick={() => setSubject('全部')}>全部科目</button></div>
      <div className="subject-grid">{subjectNames.map(name => <button key={name} className={subject === name ? 'selected' : ''} aria-pressed={subject === name} onClick={() => { setSubject(name); if (mode === 'photos') onMode('wrong'); }}><strong>{name}</strong><span>{wrong.filter(item => (item.question.subject || '待选科目') === name).length} 道错题</span></button>)}</div>
    </section>
    <nav className="library-modes" aria-label="题目分类"><button className={mode === 'wrong' ? 'selected' : ''} onClick={() => onMode('wrong')}>错题本</button><button className={mode === 'knowledge' ? 'selected' : ''} onClick={() => onMode('knowledge')}>知识点归纳</button><button className={mode === 'photos' ? 'selected' : ''} onClick={() => { setSubject('全部'); onMode('photos'); }}>原题照片</button></nav>
    {mode === 'wrong' && <section className="wrong-book" aria-label="错题本"><div className="section-line"><h2>{subject} · {visibleWrong.length} 道错题</h2></div>{visibleWrong.length ? visibleWrong.map(questionCard) : <div className="empty-records"><BookOpen size={28} /><p>{refreshing ? '正在读取题目…' : '该科目还没有收录错题。可从原题照片中框题、选科并收录。'}</p><button onClick={() => onMode('photos')}>查看原题照片 <ChevronRight size={14} /></button></div>}</section>}
    {mode === 'knowledge' && <section className="knowledge-section" aria-label="知识点归纳"><p className="hint">按题目中已保存的知识点归类，展开可回看相关题目。</p>{knowledge.length ? knowledge.map(group => <details className="knowledge-card" key={`${group.subject}/${group.name}`}><summary><Layers size={18} /><span><strong>{group.name}</strong><small>{group.subject} · {group.items.length} 道题 · {group.items.filter(item => item.question.wrongBook).length} 道错题{group.items.some(item => !item.question.confirmed) ? ' · 含待校对题目' : ''}</small></span></summary><div>{group.items.map(questionCard)}</div></details>) : <div className="empty-records"><Layers size={28} /><p>暂无已记录的知识点。校对题目时补充知识点后，会自动归类到这里。</p></div>}</section>}
    {mode === 'photos' && <section className="records-section"><div className="section-line"><h2>原题照片 · {records.length}</h2></div>{records.length ? <div className="record-grid">{records.map(scan => renderScan(scan))}</div> : <div className="empty-records"><p>{refreshing ? '正在读取资料…' : '还没有原题照片，请到首页收题。'}</p></div>}</section>}
    <div className="practice-planned"><Sparkles size={20} /><div><strong>举一反三</strong><small>围绕错题知识点练习同类题</small></div><span>准备中</span></div>
  </div>;
}
