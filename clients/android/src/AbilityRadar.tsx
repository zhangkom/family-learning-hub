/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Inline SVG charts need an image role to expose their title and description together. */
import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import './ability-radar.css';

export type AbilityAxis = {
  id: string;
  label: string;
  score: number | null;
  evidenceCount: number;
  confidence: 'insufficient' | 'limited' | 'supported';
  summary?: string;
};

const confidenceNames = { insufficient: '证据不足', limited: '证据有限', supported: '证据较充分' } as const;

function assessedScore(axis: AbilityAxis): number | null {
  return axis.confidence !== 'insufficient' && typeof axis.score === 'number'
    && Number.isFinite(axis.score) && axis.score >= 0 && axis.score <= 100 ? axis.score : null;
}

function evidenceCount(axis: AbilityAxis): number {
  return Number.isFinite(axis.evidenceCount) ? Math.max(0, Math.floor(axis.evidenceCount)) : 0;
}

function labelLines(label: string, limit: number): string[] {
  const letters = Array.from(label);
  return Array.from({ length: Math.ceil(letters.length / limit) }, (_, i) => letters.slice(i * limit, (i + 1) * limit).join(''));
}

export function AbilityRadar({ axes, selectedId, onSelect, subject }: {
  axes: AbilityAxis[];
  selectedId: string;
  onSelect: (id: string) => void;
  subject: string;
}) {
  const titleId = useId(), descriptionId = useId();
  const plot = useRef<HTMLDivElement>(null);
  const pointerStart = useRef<{ id: number; x: number; y: number } | null>(null);
  const [width, setWidth] = useState(288);
  useEffect(() => {
    const node = plot.current;
    if (!node) return;
    const measure = () => {
      const measured = node.getBoundingClientRect().width;
      if (measured > 0) setWidth(Math.round(measured));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [axes.length]);

  const narrow = width < 400, fontSize = narrow ? 13 : 14;
  const labels = axes.map(axis => labelLines(axis.label, narrow ? 4 : 6));
  const labelHeight = Math.max(2, ...labels.map(lines => lines.length + 1)) * 18;
  const radius = Math.max(24, Math.min(148, (width - (narrow ? 152 : 208)) / 2));
  const padding = labelHeight / 2 + 46;
  const height = (radius + padding) * 2, cx = width / 2, cy = height / 2;
  const at = (index: number, distance: number) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / axes.length;
    return { x: cx + Math.cos(angle) * distance, y: cy + Math.sin(angle) * distance };
  };
  const scores = axes.map(assessedScore);
  const points = scores.map((score, i) => score === null ? null : at(i, radius * score / 100));
  const assessed = scores.filter(score => score !== null).length;
  const complete = axes.length >= 3 && assessed === axes.length;
  const selectedIndex = axes.findIndex(axis => axis.id === selectedId);
  const selected = axes[selectedIndex], selectedScore = scores[selectedIndex];
  const summary = axes.map((axis, i) => `${axis.label}：${scores[i] === null ? '待评估' : `${scores[i]}分`}`).join('；');

  function selectFromChart(event: PointerEvent<SVGSVGElement>) {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || start.id !== event.pointerId || Math.hypot(start.x - event.clientX, start.y - event.clientY) > 10) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = (event.clientX - bounds.left) * width / bounds.width;
    const y = (event.clientY - bounds.top) * height / bounds.height;
    // One shared chart hit area avoids overlapping touch targets near the centre.
    // The separate native buttons expose the same choices to keyboard users.
    let nearest = -1, distance = Infinity;
    axes.forEach((_, index) => {
      const locations = [at(index, radius + 24)];
      if (points[index]) locations.push(points[index]!);
      locations.forEach(location => {
        const candidate = Math.hypot(location.x - x, location.y - y);
        if (candidate < distance) { distance = candidate; nearest = index; }
      });
    });
    if (nearest >= 0) onSelect(axes[nearest].id);
  }

  return <figure className="ability-radar" aria-label={`${subject || '当前科目'}能力图谱`}>
    <figcaption className="ability-radar-heading">
      <strong>{subject || '当前科目'}能力图谱</strong>
      <span>能力参考水平 · 0–100</span>
    </figcaption>
    {axes.length >= 3 ? <>
      <div className="ability-radar-plot" ref={plot}>
        <svg className="ability-radar-svg" viewBox={`0 0 ${width} ${height}`} style={{ height }} role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
          onPointerDown={event => { pointerStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; }}
          onPointerUp={selectFromChart} onPointerCancel={() => { pointerStart.current = null; }}>
          <title id={titleId}>{`${subject || '当前科目'}能力雷达图`}</title>
          <desc id={descriptionId}>{summary}。点离中心越远，能力参考水平越高；待评估维度没有数值点。可使用图下的维度按钮查看详情。</desc>
          {[.25, .5, .75, 1].map(fraction => <polygon key={fraction} className="ability-radar-grid"
            points={axes.map((_, i) => { const point = at(i, radius * fraction); return `${point.x},${point.y}`; }).join(' ')} />)}
          {axes.map((axis, i) => {
            const end = at(i, radius), label = at(i, radius + 20), vertical = at(i, radius + 36);
            const alignment = Math.abs(label.x - cx) < 1 ? 'middle' : label.x > cx ? 'start' : 'end';
            const blockHeight = (labels[i].length + 1) * 18;
            return <g key={axis.id}>
              <line className="ability-radar-spoke" x1={cx} y1={cy} x2={end.x} y2={end.y} />
              <text className="ability-radar-axis-label" x={label.x} y={vertical.y - blockHeight / 2 + 13} textAnchor={alignment}
                style={{ fontSize }} data-axis-id={axis.id}>
                {labels[i].map((line, lineIndex) => <tspan key={lineIndex} x={label.x} dy={lineIndex ? 18 : 0}>{line}</tspan>)}
                <tspan className="ability-radar-axis-value" x={label.x} dy={18}>{scores[i] === null ? '待评估' : `${scores[i]}/100`}</tspan>
              </text>
            </g>;
          })}
          {complete && <polygon className="ability-radar-score-area" data-ability-shape="complete"
            points={points.map(point => `${point!.x},${point!.y}`).join(' ')} />}
          {!complete && points.map((point, i) => {
            const next = points[(i + 1) % points.length];
            return point && next ? <line key={axes[i].id} className="ability-radar-score-line" data-ability-segment={`${axes[i].id}:${axes[(i + 1) % axes.length].id}`}
              x1={point.x} y1={point.y} x2={next.x} y2={next.y} /> : null;
          })}
          {points.map((point, i) => point && <g key={axes[i].id} data-ability-point={axes[i].id} data-score={scores[i]!}>
            {axes[i].id === selectedId && <circle className="ability-radar-selection" cx={point.x} cy={point.y} r={9} />}
            <circle className="ability-radar-point" cx={point.x} cy={point.y} r={4.5} />
          </g>)}
          {!assessed && <g className="ability-radar-unassessed" aria-hidden="true">
            <rect x={cx - 34} y={cy - 15} width={68} height={30} rx={5} />
            <text x={cx} y={cy + 5} textAnchor="middle">待评估</text>
          </g>}
        </svg>
      </div>
      <p className="ability-radar-caption">{assessed ? `已评估 ${assessed}/${axes.length} 个维度 · 越靠外，参考水平越高` : '各维度待评估，补充作答与复测后更新'}{assessed > 0 && !complete ? '；其余维度待评估' : ''}</p>
    </> : <p className="ability-radar-empty">{axes.length ? '能力维度尚未齐全，可先查看已记录的维度。' : '该科目暂无能力评价，补充学习记录后再查看。'}</p>}
    {!!axes.length && <fieldset className="ability-radar-choices" aria-label="选择能力维度">
      {axes.map((axis, i) => <button key={axis.id} type="button" className="ability-radar-choice" aria-pressed={axis.id === selectedId}
        aria-label={`${axis.label}，${scores[i] === null ? '待评估' : `能力参考水平 ${scores[i]} 分`}，${evidenceCount(axis)} 条依据，${confidenceNames[axis.confidence]}`}
        onClick={() => onSelect(axis.id)}>
        <span>{axis.label}</span><small>{scores[i] === null ? '待评估' : `${scores[i]}/100`} · {evidenceCount(axis)} 条依据</small>
      </button>)}
    </fieldset>}
    {selected && <div className="ability-radar-detail" aria-live="polite" aria-atomic="true">
      <div><strong>{selected.label}</strong><span>{selectedScore === null ? '待评估' : `${selectedScore}/100`}</span></div>
      <p>{evidenceCount(selected)} 条依据 · {confidenceNames[selected.confidence]}</p>
      {selected.summary && <p className="ability-radar-summary">{selected.summary}</p>}
    </div>}
  </figure>;
}
