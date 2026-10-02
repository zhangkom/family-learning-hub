import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Image as ImageIcon, FileText, ChevronRight } from 'lucide-react';
import type { Question, Scan } from './types';
import { questionPrompt, questionRectangles, type QuestionRectangle } from './question-presentation';
import { type QuestionImage, type QuestionImageState, type QuestionImages } from './question-images';

function CroppedRegions({ image, rectangles, label }: { image: QuestionImage; rectangles: QuestionRectangle[]; label: string }) {
  return <div className="question-crops">{rectangles.map((rect, index) => <div className="question-crop" key={rect.id}
    style={{ aspectRatio: `${rect.width * image.width} / ${rect.height * image.height}` }}>
    {image.url && <img src={image.url} alt={`${label}${rectangles.length > 1 ? ` · 区域 ${index + 1}` : ''}`} draggable={false}
      style={{ width: `${100 / rect.width}%`, left: `${-100 * rect.x / rect.width}%`, top: `${-100 * rect.y / rect.height}%` }} />}
  </div>)}</div>;
}

export function QuestionPaper({ question, questions, image, original }: {
  question: Question; questions: Question[]; image?: QuestionImage; original: boolean;
}) {
  const prompt = questionPrompt(question), figures = questionRectangles(question, questions, 'figures');
  const parent = questions.find(q => q.id === question.parentQuestionId && q.id !== question.id);
  const shared = questions.flatMap(q => q.regions).filter(r => question.sharedRegionIds?.includes(r.id));
  // Without a separately marked figure, a text reconstruction could silently lose a diagram.
  const typeset = !original && !!prompt && figures.length > 0 && !shared.some(r => r.kind === 'stem');
  const rectangles = questionRectangles(question, questions, original ? 'original' : 'paper');
  return <div className={`question-paper ${original ? 'is-original' : 'is-typeset'}`}>
    {typeset ? <>
      {parent && questionPrompt(parent) && <div className="paper-context"><small>共用题干</small><p>{questionPrompt(parent)}</p></div>}
      <p className="paper-prompt">{prompt}</p>
      {image && <CroppedRegions image={image} rectangles={figures} label="原题配图" />}
    </> : image && rectangles.length ? <CroppedRegions image={image} rectangles={rectangles} label={original ? '这道题的原图题框' : '原题题干与配图'} />
      : <>{prompt && <p className="paper-prompt">{prompt}</p>}{!rectangles.length && <p className="paper-image-note">尚未框选题图，可进入详情补充。</p>}</>}
  </div>;
}

export function QuestionCard({ scan, question, images, onOpen }: {
  scan: Scan; question: Question; images: QuestionImages; onOpen: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const size = useRef<{ width: number; height: number } | undefined>(undefined);
  const [nearby, setNearby] = useState(false), [original, setOriginal] = useState(false);
  const [state, setState] = useState<QuestionImageState>({ status: 'loading' });
  const hasRegions = questionRectangles(question, scan.questions, 'original').length > 0;
  useEffect(() => {
    const node = ref.current; if (!node) return;
    const observer = new IntersectionObserver(entries => setNearby(entries.some(entry => entry.isIntersecting)), { rootMargin: '300px 0px' });
    observer.observe(node); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!nearby || !hasRegions) return;
    return images.subscribe(scan, setState);
  }, [images, nearby, scan, hasRegions]);
  const status = question.tutoring?.status;
  const summary = status === 'needs_review' ? question.tutoring?.review?.status === 'confirmed' ? '讲解已核对' : 'AI 分析待核对'
    : status === 'failed' ? '分析未完成 · 可重试' : status === 'stale' ? '题目已修改 · 需重新分析'
      : status ? '正在分析' : question.wrongBook ? '已收录错题' : question.confirmed ? '题目已校对' : '题目待校对';
  if (state.status === 'ready') size.current = { width: state.image.width, height: state.image.height };
  const image = nearby && state.status === 'ready' ? state.image : size.current ? { ...size.current, url: '' } : undefined;
  return <article ref={ref} className={`question-card wrong-question-card ${original ? 'show-original' : ''}`} aria-label={`第 ${question.number || '—'} 题`}>
    <header className="question-card-heading"><div><span className="paper-number">{question.number || '—'}.</span><span className="subject-tag">{question.subject || '待选科目'}</span></div>
      <button type="button" className="question-original-toggle" aria-pressed={original} onClick={() => setOriginal(value => !value)}>
        {original ? <FileText size={15} /> : <ImageIcon size={15} />}{original ? '整理版' : '原图'}</button></header>
    <QuestionPaper question={question} questions={scan.questions} image={image} original={original} />
    {hasRegions && nearby && state.status === 'loading' && <output className="paper-image-note">正在读取题图…</output>}
    {hasRegions && nearby && state.status === 'error' && <div className="paper-image-unavailable"><p>{Capacitor.getPlatform() === 'android' ? '本机题图暂不可用' : '题图暂时无法读取'}</p>
      <button type="button" onClick={() => images.retry(scan.id)}>重试读取</button>
      {Capacitor.getPlatform() === 'android' && <button type="button" onClick={() => images.retry(scan.id, true)}>从云端读取这张题图</button>}</div>}
    <footer className="question-card-footer"><small>{summary}</small><button type="button" onClick={onOpen}>题目详情 <ChevronRight size={15} /></button></footer>
  </article>;
}
