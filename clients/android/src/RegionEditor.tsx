import { useRef, useState } from 'react';
import { Move, ScanLine } from 'lucide-react';
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
};
type Drag = {
  start: Point;
  origin?: Region;
  kind: 'draw' | 'move' | 'resize';
  questionId: string;
};
export function RegionEditor({
  image,
  questions,
  selectedId,
  activeRegion,
  onSelect,
  onChange,
  onAdd,
}: Props) {
  const surface = useRef<SVGSVGElement>(null),
    drag = useRef<Drag | null>(null);
  const [mode, setMode] = useState<'move' | 'draw'>('move');
  const [kind, setKind] = useState<Region['kind']>('stem');
  const [preview, setPreview] = useState<ReturnType<typeof rectangle> | null>(
    null,
  );
  function position(event: React.PointerEvent): Point {
    const r = surface.current!.getBoundingClientRect();
    return {
      x: (event.clientX - r.left) / r.width,
      y: (event.clientY - r.top) / r.height,
    };
  }
  function start(
    event: React.PointerEvent,
    questionId = selectedId,
    region?: Region,
    resize = false,
  ) {
    if (!selectedId || event.button !== 0) return;
    if (mode === 'move' && !region) return;
    event.preventDefault();
    event.stopPropagation();
    surface.current!.setPointerCapture(event.pointerId);
    if (region && mode === 'move') onSelect(questionId, region.id);
    drag.current = {
      start: position(event),
      origin: mode === 'move' ? region : undefined,
      kind: mode === 'draw' ? 'draw' : resize ? 'resize' : 'move',
      questionId,
    };
  }
  function move(event: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const point = position(event);
    if (d.kind === 'draw') {
      setPreview(rectangle(d.start, point));
      return;
    }
    const r = d.origin!;
    const change =
      d.kind === 'move'
        ? {
            ...r,
            x: Math.min(1 - r.width, Math.max(0, r.x + point.x - d.start.x)),
            y: Math.min(1 - r.height, Math.max(0, r.y + point.y - d.start.y)),
          }
        : {
            ...r,
            width: Math.min(1 - r.x, Math.max(0.012, point.x - r.x)),
            height: Math.min(1 - r.y, Math.max(0.012, point.y - r.y)),
          };
    onChange(d.questionId, change);
  }
  function finish(event: React.PointerEvent) {
    if (drag.current?.kind === 'draw') {
      const r = rectangle(drag.current.start, position(event));
      if (r.width > 0.012 && r.height > 0.012)
        onAdd({ ...r, id: crypto.randomUUID(), kind });
    }
    drag.current = null;
    setPreview(null);
  }
  return (
    <section className="paper-panel" aria-label="原图与题目框">
      <div className="paper-toolbar">
        <button
          className={mode === 'move' ? 'selected' : ''}
          onClick={() => setMode('move')}
        >
          <Move size={16} /> 调整框
        </button>
        <button
          className={mode === 'draw' ? 'selected' : ''}
          disabled={!selectedId}
          onClick={() => setMode('draw')}
        >
          <ScanLine size={16} /> 补一个框
        </button>
        <select
          aria-label="新框的内容类型"
          value={kind}
          onChange={(e) => setKind(e.target.value as Region['kind'])}
        >
          <option value="stem">题干</option>
          <option value="figure">配图</option>
          <option value="answer">作答</option>
          <option value="annotation">批注</option>
        </select>
      </div>
      <p className="hint">
        {mode === 'draw'
          ? '在原图上拖动，给当前题补框。'
          : '点击框选择题目，拖动调整位置；拖动右下角圆点调整大小。'}
      </p>
      <div className="paper-scroll">
        <div className="paper-surface">
          {image ? (
            <img src={image} alt="上传的完整作业原图" draggable={false} />
          ) : (
            <div className="image-loading">正在加载原图…</div>
          )}
          {image && (
            <svg
              ref={surface}
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              className={`region-overlay ${mode}`}
              onPointerDown={(e) => start(e)}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={() => {
                drag.current = null;
                setPreview(null);
              }}
            >
              {questions.flatMap((q, index) =>
                q.regions.map((r) => (
                  <g key={r.id}>
                    <rect
                      x={r.x * 1000}
                      y={r.y * 1000}
                      width={r.width * 1000}
                      height={r.height * 1000}
                      className={
                        q.id === selectedId ? 'active-region' : 'other-region'
                      }
                      onPointerDown={(e) => start(e, q.id, r)}
                    />
                    <text
                      x={r.x * 1000 + 5}
                      y={r.y * 1000 + 24}
                      className="region-number"
                    >
                      {q.number || index + 1}
                      {r.kind === 'answer'
                        ? ' · 作答'
                        : r.kind === 'figure'
                          ? ' · 配图'
                          : ''}
                    </text>
                    {r.id === activeRegion && mode === 'move' && (
                      <circle
                        cx={(r.x + r.width) * 1000}
                        cy={(r.y + r.height) * 1000}
                        r="12"
                        className="resize-handle"
                        onPointerDown={(e) => start(e, q.id, r, true)}
                      />
                    )}
                  </g>
                )),
              )}
              {preview && (
                <rect
                  className="active-region preview-region"
                  x={preview.x * 1000}
                  y={preview.y * 1000}
                  width={preview.width * 1000}
                  height={preview.height * 1000}
                />
              )}
            </svg>
          )}
        </div>
      </div>
    </section>
  );
}
