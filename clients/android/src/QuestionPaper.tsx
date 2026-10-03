import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { Image as ImageIcon, FileText, ChevronRight, ZoomIn } from 'lucide-react';
import type { Question, Scan } from './types';
import { sourcePageLabel } from './source-location';
import { questionPrompt, questionRectangles, questionTextLayout, type QuestionRectangle } from './question-presentation';
import { type QuestionImage, type QuestionImageState, type QuestionImages } from './question-images';
import { QuestionImageViewer } from './QuestionImageViewer';
import './question-paper.css';

function CroppedRegions({ image, rectangles, label, onImageError, onOpen }: { image: QuestionImage; rectangles: QuestionRectangle[]; label: string; onImageError?: () => void; onOpen: () => void }) {
  return <div className="question-crops">{rectangles.map((rect, index) => <button type="button" className="question-crop-open" key={rect.id} disabled={!image.url} onClick={onOpen} aria-label={`放大查看题图区域 ${index + 1}`}><span className="question-crop"
    style={{ aspectRatio: `${rect.width * image.width} / ${rect.height * image.height}` }}>
    {image.url && <img src={image.url} alt={`${label}${rectangles.length > 1 ? ` · 区域 ${index + 1}` : ''}`} draggable={false} onError={onImageError}
      style={{ width: `${100 / rect.width}%`, height: `${100 / rect.height}%`, left: `${-100 * rect.x / rect.width}%`, top: `${-100 * rect.y / rect.height}%` }} />}
  </span></button>)}</div>;
}

function PaperText({ text }: { text: string }) {
  const { stem, options } = questionTextLayout(text);
  return <>{stem && <p className="paper-prompt">{stem}</p>}{options.length > 0 && <div className="paper-options" aria-label="题目选项">
    {options.map((option, index) => <p key={index}>{option}</p>)}
  </div>}</>;
}

export function QuestionSource({ scan, question }: { scan: Scan; question: Question }) {
  const parent = scan.questions.find(q => q.id === question.parentQuestionId && q.id !== question.id);
  const source = question.sourcePage || scan.sourcePage;
  const location = question.sourcePage?.majorNumber ? `第 ${question.sourcePage.majorNumber} 大题${question.sourcePage.subNumber ? ` · 第 ${question.sourcePage.subNumber} 小题` : ''}` : `${parent ? `第 ${parent.number || '待核对'} 大题 · ` : ''}第 ${question.number || '待核对'} 题`;
  return <details className="question-source"><summary>{source ? `${source.title} · ${sourcePageLabel(source)} · ${location}` : '题目来源'}</summary><dl>
    {source && <><dt>所属作业</dt><dd>{source.title}</dd><dt>原卷页码</dt><dd>{sourcePageLabel(source)}{source.paperPageCount ? ` / 共 ${source.paperPageCount} 页` : ''}</dd></>}
    <dt>来源照片</dt><dd>{scan.originalName || '原文件名未记录'}</dd>
    <dt>原题位置</dt><dd>{location}</dd>
    <dt>科目</dt><dd>{question.subject || '待确认'}</dd>
    <dt>来源说明</dt><dd>{scan.source || '未登记'}</dd>
    {source?.sourceParts && <><dt>关联原页</dt><dd>{[...new Map(source.sourceParts.map(part => [part.photoId, part])).values()].map(part => <div key={part.photoId}>{part.title || source.title} · {part.pageRole === 'answer-sheet' ? '答题卡 · ' : ''}{part.paperPageNumber ? `第 ${part.paperPageNumber} 页 · ` : ''}{part.originalName || '原文件名未记录'}</div>)}</dd></>}
    {question.paperMark && <><dt>收录依据</dt><dd>{question.paperMark.evidence.map(item => item.text).join('；') || '纸面标记核对'}<small>按纸面批改标记收录，不作为独立测验成绩。</small></dd></>}
  </dl></details>;
}

export function QuestionPaper({ question, questions, image, original, onImageError, onViewerChange }: {
  question: Question; questions: Question[]; image?: QuestionImage; original: boolean; onImageError?: () => void; onViewerChange?: (open: boolean) => void;
}) {
  const [viewer, setViewer] = useState<{ id: string; url: string; original: boolean }>();
  const expanded = !!image?.url && viewer?.id === question.id && viewer.url === image.url && viewer.original === original;
  useEffect(() => { onViewerChange?.(expanded); return () => onViewerChange?.(false); }, [expanded, onViewerChange]);
  const openImage = () => { if (image?.url) setViewer({ id: question.id, url: image.url, original }); };
  const prompt = questionPrompt(question), figures = questionRectangles(question, questions, 'figures');
  const parent = questions.find(q => q.id === question.parentQuestionId && q.id !== question.id);
  const shared = questions.flatMap(q => q.regions).filter(r => question.sharedRegionIds?.includes(r.id));
  // Without a separately marked figure, a text reconstruction could silently lose a diagram.
  const typeset = !original && question.confirmed && (!parent || parent.confirmed) && !!prompt && figures.length > 0 && !shared.some(r => r.kind === 'stem');
  const rectangles = questionRectangles(question, questions, original ? 'original' : 'paper');
  const brokenContext = (!!question.parentQuestionId && !parent) || question.sharedRegionIds?.some(id => !questions.some(q => q.regions.some(r => r.id === id)));
  return <div className={`question-paper ${original ? 'is-original' : 'is-typeset'}`}>
    {original && <output className="paper-view-label">原图题框 · 第 {question.number || '—'} 题</output>}
    {typeset ? <>
      {parent && questionPrompt(parent) && <div className="paper-context"><small>共用题干</small><p>{questionPrompt(parent)}</p></div>}
      <PaperText text={prompt} />
      {image && (figures.length ? <CroppedRegions image={image} rectangles={figures} label="原题配图" onImageError={onImageError} onOpen={openImage} />
        : rectangles.length > 0 && <div className="paper-source-fallback"><small>原题题框（含配图）</small><CroppedRegions image={image} rectangles={rectangles} label="原题题干与配图" onImageError={onImageError} onOpen={openImage} /></div>)}
    </> : image && rectangles.length ? <div className={original ? undefined : 'paper-source-fallback'}>
      {!original && <small>原题题框（含配图）</small>}<CroppedRegions image={image} rectangles={rectangles} label={original ? '这道题的原图题框' : '原题题干与配图'} onImageError={onImageError} onOpen={openImage} />
    </div> : <>{!original && prompt && <PaperText text={prompt} />}</>}
    {!rectangles.length && <p className="paper-image-note">尚未框选题图，可进入详情补充。</p>}
    {!!image?.url && rectangles.length > 0 && <button type="button" className="question-enlarge" onClick={openImage}><ZoomIn size={16} />放大题图</button>}
    {brokenContext && <output className="paper-incomplete">共用题干或配图的来源不完整，请进入详情核对。</output>}
    {expanded && image && <QuestionImageViewer image={image} rectangles={questionRectangles(question, questions, 'original')} number={question.number} onClose={() => setViewer(undefined)} onImageError={onImageError} />}
  </div>;
}

export function QuestionCard({ scan, question, images, onOpen, actions }: {
  scan: Scan; question: Question; images: QuestionImages; onOpen: () => void; actions?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const size = useRef<{ width: number; height: number } | undefined>(undefined);
  const [nearby, setNearby] = useState(false), [original, setOriginal] = useState(false), [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<QuestionImageState>({ status: 'loading' });
  const hasRegions = questionRectangles(question, scan.questions, 'original').length > 0;
  useEffect(() => {
    const node = ref.current; if (!node) return;
    if (typeof IntersectionObserver === 'undefined') { setNearby(true); return; }
    const observer = new IntersectionObserver(entries => setNearby(entries.some(entry => entry.isIntersecting)), { rootMargin: '300px 0px' });
    observer.observe(node); return () => observer.disconnect();
  }, []);
  const wantsImage = (nearby || original || expanded) && hasRegions;
  useEffect(() => {
    if (!wantsImage) return;
    return images.subscribe(scan, setState);
  }, [images, wantsImage, scan]);
  const status = question.tutoring?.status;
  const summary = status === 'needs_review' ? question.tutoring?.review?.status === 'confirmed' ? '讲解已核对' : 'AI 分析待核对'
    : status === 'failed' ? '分析未完成 · 可重试' : status === 'stale' ? '题目已修改 · 需重新分析'
      : status ? '正在分析' : question.wrongBook && question.focusBook ? '已收录错题与重点题' : question.wrongBook ? '已收录错题' : question.focusBook ? '已收录重点题' : question.confirmed ? '题目已校对' : '题目待校对';
  if (state.status === 'ready') size.current = { width: state.image.width, height: state.image.height };
  // Keep offscreen card heights stable without retaining decoded pictures in the DOM.
  const image = (nearby || original || expanded) ? state.status === 'ready' ? state.image : undefined
    : size.current ? { ...size.current, url: '' } : undefined;
  return <article ref={ref} className={`question-card wrong-question-card ${original ? 'show-original' : ''}`} aria-label={`第 ${question.number || '—'} 题`}>
    <header className="question-card-heading"><div><span className="paper-number">{question.number || '—'}.</span><span className="subject-tag">{question.subject || '待选科目'}</span>{question.wrongBook && <span className="collection-tag is-wrong">错题</span>}{question.focusBook && <span className="collection-tag is-focus">重点题</span>}</div>
      <button type="button" className="question-original-toggle" aria-pressed={original} onClick={() => setOriginal(value => !value)}>
        {original ? <FileText size={15} /> : <ImageIcon size={15} />}{original ? '整理版' : '原图'}</button></header>
    <QuestionPaper question={question} questions={scan.questions} image={image} original={original} onImageError={() => images.imageFailed(scan.id)} onViewerChange={setExpanded} />
    {hasRegions && (nearby || original) && state.status === 'loading' && <output className="paper-image-note" aria-live="polite">{Capacitor.getPlatform() === 'android' ? '正在读取或恢复题图…' : '正在读取题图…'}</output>}
    {hasRegions && (nearby || original) && state.status === 'error' && <div className="paper-image-unavailable"><output>{Capacitor.getPlatform() === 'android' ? '题图自动恢复未完成' : '题图读取失败，请重试'}</output>
      <small>{state.message}</small>
      <small>恢复题图后才能查看完整题目。</small>
      <button type="button" onClick={() => images.retry(scan.id, true)}>{Capacitor.getPlatform() === 'android' ? '重试恢复题图' : '重试读取'}</button>
      {Capacitor.getPlatform() === 'android' && <small>本机没有可用副本时，从服务器恢复并保存；同页题目共用。</small>}</div>}
    <QuestionSource scan={scan} question={question} />
    {actions}
    <footer className="question-card-footer"><small>{summary}</small><button type="button" onClick={onOpen}>题目详情 <ChevronRight size={15} /></button></footer>
  </article>;
}
