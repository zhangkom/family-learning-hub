import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Hand, Move, ScanLine, ZoomIn, ZoomOut } from 'lucide-react';
import { rectangle, type Point } from './regions';
import type { Question, Region } from './types';

type Props = {
  image: string;
  questions: Question[];
  selectedId: string;
  activeRegion: string;
  onSelect: (questionId: string, regionId: string) => void;
  onChange: (questionId: string, region: Region) => void;
  onAdd: (region: Region) => void;
  onCreate: (region: Region) => void;
  candidateIds?: string[];
  selectedCandidateIds?: string[];
  readOnlyIds?: string[];
  showExtraRegions?: boolean;
  allowCreate?: boolean;
  onToggleCandidate?: (id: string) => void;
  onImageDimensions?: (width: number, height: number) => void;
  children?: ReactNode;
};
type Mode = 'browse' | 'new' | 'append' | 'move';
type Drag = {
  pointerId: number; start: Point; origin?: Region;
  kind: 'draw' | 'move' | 'resize'; questionId: string;
};
const percent = (n: number) => `${n * 100}%`;

export function RegionEditor({
  image, questions, selectedId, activeRegion, onSelect, onChange, onAdd, onCreate, children,
  candidateIds = [], selectedCandidateIds = [], readOnlyIds = [], showExtraRegions = true, allowCreate = true,
  onToggleCandidate,
  onImageDimensions,
}: Props) {
  const surface = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [mode, setMode] = useState<Mode>('browse');
  const [kind, setKind] = useState<Region['kind']>('stem');
  const [preview, setPreview] = useState<Region | null>(null);
  const [zoom, setZoom] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [hint, setHint] = useState('');
  const selectedQuestion = questions.find((q) => q.id === selectedId);
  useEffect(() => {
    if (!loaded || !selectedId) return;
    const rect = surface.current?.querySelector(`[data-question-id="${CSS.escape(selectedId)}"]`);
    const viewport = surface.current?.parentElement?.parentElement;
    if (!rect || !viewport) return;
    const frame = rect.getBoundingClientRect(), visible = viewport.getBoundingClientRect();
    viewport.scrollTo({
      top: viewport.scrollTop + frame.top - visible.top - Math.max(20, (visible.height - frame.height) / 2),
      left: viewport.scrollLeft + frame.left - visible.left - Math.max(10, (visible.width - frame.width) / 2),
    });
  }, [loaded, selectedId]);
  function position(event: React.PointerEvent): Point {
    const r = surface.current!.getBoundingClientRect();
    return { x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height };
  }
  function cancel() { drag.current = null; setPreview(null); }
  function switchMode(next: Mode) { cancel(); setMode(next); setHint(''); }
  function start(event: React.PointerEvent, questionId = selectedId, region?: Region, resize = false) {
    if (mode === 'browse' || !loaded || event.button !== 0 || !event.isPrimary) return;
    if ((mode === 'move' && readOnlyIds.includes(questionId)) || (mode === 'new' && !allowCreate)) return;
    if ((mode === 'append' && !selectedQuestion) || (mode === 'move' && !region)) return;
    event.preventDefault();
    event.stopPropagation();
    surface.current!.setPointerCapture(event.pointerId);
    if (region && mode === 'move') onSelect(questionId, region.id);
    drag.current = {
      pointerId: event.pointerId, start: position(event),
      origin: mode === 'move' ? region : undefined,
      kind: mode === 'move' ? resize ? 'resize' : 'move' : 'draw', questionId,
    };
  }
  function calculate(d: Drag, point: Point): Region {
    if (d.kind === 'draw') return { ...rectangle(d.start, point), id: '', kind: mode === 'new' ? 'stem' : kind };
    const r = d.origin!;
    if (d.kind === 'move') return { ...r,
      x: Math.min(1 - r.width, Math.max(0, r.x + point.x - d.start.x)),
      y: Math.min(1 - r.height, Math.max(0, r.y + point.y - d.start.y)),
    };
    return { ...r,
      width: Math.min(1 - r.x, Math.max(0.012, point.x - r.x)),
      height: Math.min(1 - r.y, Math.max(0.012, point.y - r.y)),
    };
  }
  function move(event: React.PointerEvent) {
    const d = drag.current;
    if (d?.pointerId === event.pointerId) setPreview(calculate(d, position(event)));
  }
  function finish(event: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    const result = calculate(d, position(event));
    cancel();
    if (surface.current?.hasPointerCapture(event.pointerId)) surface.current.releasePointerCapture(event.pointerId);
    if (d.kind === 'draw') {
      const bounds = surface.current!.getBoundingClientRect();
      if (result.width * bounds.width < 16 || result.height * bounds.height < 16) {
        setHint('框太小了，请拖动框住完整的一道题。');
        return;
      }
      result.id = crypto.randomUUID();
      if (mode === 'new') onCreate(result); else onAdd(result);
      setMode('move');
      setHint(mode === 'new' ? '题目已框好，可在下方保存或修改科目。' : '已补充区域，可拖动调整。');
    } else if (result.x !== d.origin!.x || result.y !== d.origin!.y ||
      result.width !== d.origin!.width || result.height !== d.origin!.height) {
      onChange(d.questionId, result);
    }
  }
  return (
    <section className="paper-panel" aria-label="原图与题目框">
      <div className="paper-toolbar framing-toolbar">
        <button className={mode === 'new' ? 'selected' : ''} disabled={!loaded || !allowCreate}
          onClick={() => switchMode('new')}><ScanLine size={16} /> 框选一道题</button>
        <button className={mode === 'browse' ? 'selected' : ''} onClick={() => switchMode('browse')}>
          <Hand size={16} /> 浏览照片</button>
        {questions.some((q) => q.regions.length > 0) && <button
          className={mode === 'move' ? 'selected' : ''} onClick={() => switchMode('move')}>
          <Move size={16} /> 调整框</button>}
      </div>
      <output className="hint">{hint || (
        mode === 'browse' ? onToggleCandidate
          ? '点建议框选择或取消；滑动查看照片，需改范围时点“调整框”。'
          : '先滑动照片找到题目，再点“框选一道题”。' :
        mode === 'new' ? '拖动框住一道题的完整题干和配图，松手就能建题。' :
        mode === 'append' ? '拖动给当前题补框；需要另一道题请点“框选一道题”。' :
        '拖动框调整位置；拖动右下角圆点调整大小。滑动照片请切回“浏览照片”。'
      )}</output>
      <div className="paper-scroll" aria-label="照片浏览区域">
        <div className="paper-surface" style={{ width: percent(zoom) }}>
          {image ? <img src={image} alt="上传的完整作业原图" draggable={false}
            onLoad={(event) => {
              setLoaded(true);
              onImageDimensions?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
            }} onError={() => { setLoaded(false); setHint('原图未能显示，请返回后重试。'); }} />
            : <div className="image-loading">正在加载原图…</div>}
          {image && loaded && <svg ref={surface} className={`region-overlay ${mode}`}
            onPointerDown={(e) => start(e)} onPointerMove={move} onPointerUp={finish}
            onPointerCancel={cancel} onLostPointerCapture={cancel}>
            {questions.flatMap((q, index) => q.regions.map((original) => {
              const r = preview?.id === original.id ? preview : original;
              return <g key={r.id}>
                <rect x={percent(r.x)} y={percent(r.y)} width={percent(r.width)} height={percent(r.height)}
                  data-region-id={r.id} data-question-id={q.id}
                  className={`${q.id === selectedId ? 'active-region' : 'other-region'}${candidateIds.includes(q.id) ? ' candidate-region' : ''}${selectedCandidateIds.includes(q.id) ? ' candidate-selected' : ''}${readOnlyIds.includes(q.id) ? ' readonly-region' : ''}`}
                  onPointerDown={(e) => start(e, q.id, r)}
                  onClick={() => {
                    if (mode !== 'browse' || readOnlyIds.includes(q.id)) return;
                    if (candidateIds.includes(q.id) && onToggleCandidate) onToggleCandidate(q.id);
                    else onSelect(q.id, r.id);
                  }} />
                <text x={percent(r.x)} y={percent(r.y)} dx="5" dy="19" className="region-number">
                  {q.number || index + 1}{r.kind === 'answer' ? ' · 作答' : r.kind === 'figure' ? ' · 配图' : ''}
                  {selectedCandidateIds.includes(q.id) ? ' · ✓ 已选' : ''}
                </text>
                {r.id === activeRegion && mode === 'move' && <g>
                  <circle cx={percent(r.x + r.width)} cy={percent(r.y + r.height)} r="10" className="resize-handle" />
                  <circle cx={percent(r.x + r.width)} cy={percent(r.y + r.height)} r="22"
                    className="resize-target" aria-label="拖动调整题框大小"
                    onPointerDown={(e) => start(e, q.id, r, true)} />
                </g>}
              </g>;
            }))}
            {preview && !preview.id && <rect className="active-region preview-region"
              x={percent(preview.x)} y={percent(preview.y)} width={percent(preview.width)} height={percent(preview.height)} />}
          </svg>}
        </div>
      </div>
      <div className="photo-zoom">
        <span>照片缩放</span>
        <button aria-label="缩小照片" disabled={zoom <= 1} onClick={() => { switchMode('browse'); setZoom((z) => z - 0.5); }}><ZoomOut size={18} /></button>
        <output>{Math.round(zoom * 100)}%</output>
        <button aria-label="放大照片" disabled={zoom >= 3} onClick={() => { switchMode('browse'); setZoom((z) => z + 0.5); }}><ZoomIn size={18} /></button>
      </div>
      {children}
      {selectedQuestion && showExtraRegions && <details className="extra-regions">
        <summary>补充作答、配图或批注区域</summary>
        <div className="paper-toolbar">
          <button className={mode === 'append' ? 'selected' : ''} disabled={!loaded}
            onClick={() => switchMode('append')}><ScanLine size={16} /> 补一个框</button>
          <select aria-label="新框的内容类型" value={kind} onChange={(e) => setKind(e.target.value as Region['kind'])}>
            <option value="stem">题干</option><option value="figure">配图</option>
            <option value="answer">作答</option><option value="annotation">批注</option>
          </select>
        </div>
      </details>}
    </section>
  );
}
