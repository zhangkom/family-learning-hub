import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import type { QuestionImage } from './question-images';
import type { QuestionRectangle } from './question-presentation';
import { useNativeBack } from './native-back';

/** Shows only this question's separate regions. The owning image store retains/revokes its URL. */
export function QuestionImageViewer({ image, rectangles, number, title, onClose, onImageError }: {
  image: QuestionImage; rectangles: QuestionRectangle[]; number: string; title?: string; onClose: () => void; onImageError?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), viewport = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const [scale, setScale] = useState(2), [width, setWidth] = useState(350);
  const scaleRef = useRef(2), frame = useRef(0), points = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; scale: number } | undefined>(undefined);
  useNativeBack(onClose, 100);
  useEffect(() => {
    const node = dialog.current, scroll = viewport.current, activePointers = points.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow, x = window.scrollX, y = window.scrollY;
    document.body.style.overflow = 'hidden'; node?.showModal(); closeButton.current?.focus({ preventScroll: true });
    const measure = () => { if (scroll) { const style = getComputedStyle(scroll); setWidth(Math.max(1, scroll.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0))); } };
    measure(); const observer = new ResizeObserver(measure); if (scroll) observer.observe(scroll);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame.current); activePointers.clear();
      node?.close(); document.body.style.overflow = oldOverflow;
      window.scrollTo(x, y); if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  function zoom(value: number, clientX?: number, clientY?: number) {
    const scroll = viewport.current; if (!scroll) return;
    const next = Math.max(1, Math.min(4, value)), bounds = scroll.getBoundingClientRect();
    const px = clientX === undefined ? scroll.clientWidth / 2 : clientX - bounds.left;
    const py = clientY === undefined ? scroll.clientHeight / 2 : clientY - bounds.top;
    const anchorX = (scroll.scrollLeft + px) / scaleRef.current, anchorY = (scroll.scrollTop + py) / scaleRef.current;
    scaleRef.current = next; setScale(next); cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => { scroll.scrollLeft = Math.max(0, anchorX * next - px); scroll.scrollTop = Math.max(0, anchorY * next - py); });
  }
  function pointerDown(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.current.size === 2) { const [a, b] = [...points.current.values()]; pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: scaleRef.current }; }
  }
  function pointerMove(event: PointerEvent<HTMLElement>) {
    const previous = points.current.get(event.pointerId), scroll = viewport.current;
    if (!previous || !scroll) return;
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.current.size === 2 && pinch.current) {
      const [a, b] = [...points.current.values()];
      if (pinch.current.distance > 0) zoom(pinch.current.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.distance, (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (points.current.size === 1) { scroll.scrollLeft -= event.clientX - previous.x; scroll.scrollTop -= event.clientY - previous.y; }
  }
  function pointerUp(event: PointerEvent<HTMLElement>) {
    points.current.delete(event.pointerId); pinch.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <dialog ref={dialog} className="question-image-viewer" aria-label={title || `第 ${number || '—'} 题放大查看`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><strong>{title || `第 ${number || '—'} 题 · 完整题图`}</strong><button ref={closeButton} type="button" aria-label="关闭题图放大" onClick={onClose}><X size={20} />关闭</button></header>
    <div className="question-viewer-tools"><button type="button" aria-label="缩小题图" disabled={scale <= 1} onClick={() => zoom(scale - .5)}><Minus size={18} /></button><output aria-label="题图缩放比例">{Math.round(scale * 100)}%</output><button type="button" aria-label="放大题图比例" disabled={scale >= 4} onClick={() => zoom(scale + .5)}><Plus size={18} /></button><button type="button" onClick={() => { zoom(1); cancelAnimationFrame(frame.current); if (viewport.current) { viewport.current.scrollTop = 0; viewport.current.scrollLeft = 0; } }}>适合屏幕</button></div>
    <p className="question-viewer-hint">双指缩放，拖动查看；{title ? '当前为整张来源原件。' : `共 ${rectangles.length} 个题图区域。`}</p>
    {/* A named scroll region is keyboard-focusable so arrow keys can pan the enlarged image. */}
    {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
    <section ref={viewport} className="question-viewer-scroll" tabIndex={0} aria-label="可缩放的完整题图" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      <div className="question-viewer-pages" style={{ width: width * scale }}>{rectangles.map((rect, index) => <div className="question-crop" key={rect.id} style={{ aspectRatio: `${rect.width * image.width} / ${rect.height * image.height}` }}>
        <img src={image.url} alt={title ? '整张来源原件' : `完整题图 · 区域 ${index + 1}`} draggable={false} onError={() => { if (onImageError) onImageError(); else onClose(); }} style={{ width: `${100 / rect.width}%`, height: `${100 / rect.height}%`, left: `${-100 * rect.x / rect.width}%`, top: `${-100 * rect.y / rect.height}%` }} />
      </div>)}</div>
    </section>
  </dialog>;
}
