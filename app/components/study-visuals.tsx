'use client';

/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Inline SVG diagrams use an accessible image role; HTML img cannot contain these vector elements. */

import { useState } from 'react';
import type { StudyLesson } from '@/lib/study';

export function StudyVisual({ kind }: { kind: StudyLesson['visual'] }) {
  if (kind === 'absolute') return <AbsoluteExplorer />;
  if (kind === 'globe') return <GlobeSketch />;
  if (kind === 'coordinates') return <CoordinateExplorer />;
  return null;
}

function AbsoluteExplorer() {
  const [value, setValue] = useState(-3);
  const origin = 180;
  const point = origin + value * 25;
  return (
    <figure className="study-demo">
      <figcaption className="font-bold">移动a，看“位置”和“距离”</figcaption>
      <svg
        viewBox="0 0 360 110"
        role="img"
        aria-label={`数轴上a为${value}，到0的距离为${Math.abs(value)}`}
      >
        <line x1="25" y1="62" x2="335" y2="62" stroke="currentColor" />
        {[-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((n) => (
          <g key={n}>
            <line
              x1={origin + n * 25}
              y1="58"
              x2={origin + n * 25}
              y2="67"
              stroke="currentColor"
            />
            <text
              x={origin + n * 25}
              y="86"
              textAnchor="middle"
              fontSize="12"
              fill="currentColor"
            >
              {n}
            </text>
          </g>
        ))}
        <line
          x1={origin}
          y1="38"
          x2={point}
          y2="38"
          stroke="var(--primary)"
          strokeWidth="5"
        />
        <circle cx={point} cy="62" r="6" fill="var(--primary)" />
        <text
          x="180"
          y="20"
          textAnchor="middle"
          fill="currentColor"
          fontSize="13"
        >
          到0的距离：{Math.abs(value)}
        </text>
      </svg>
      <label className="block text-sm font-bold">
        a＝{value}
        <input
          className="mt-3 block w-full accent-current"
          type="range"
          min="-5"
          max="5"
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
        />
      </label>
      <p className="mt-3 text-sm" aria-live="polite">
        |a|＝{Math.abs(value)}；−a＝{value === 0 ? 0 : -value}。
        {value < 0 ? 'a是负数，所以|a|＝−a。' : 'a非负，所以|a|＝a。'}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        试一试−3、0、3；上方色线表示距离，不表示移动路程。
      </p>
    </figure>
  );
}

function GlobeSketch() {
  return (
    <figure className="study-demo">
      <figcaption className="font-bold">
        橘子瓣的边是经线，腰带是纬线
      </figcaption>
      <svg
        viewBox="0 0 360 235"
        role="img"
        aria-label="球形地球示意：经线在南北极相交，纬线围绕地球，赤道位于中间"
      >
        <circle
          cx="180"
          cy="116"
          r="86"
          fill="var(--secondary)"
          stroke="currentColor"
        />
        <ellipse
          cx="180"
          cy="116"
          rx="39"
          ry="86"
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2"
        />
        <line
          x1="180"
          y1="30"
          x2="180"
          y2="202"
          stroke="var(--primary)"
          strokeWidth="2"
        />
        <ellipse
          cx="180"
          cy="116"
          rx="86"
          ry="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <ellipse
          cx="180"
          cy="74"
          rx="75"
          ry="15"
          fill="none"
          stroke="currentColor"
          strokeDasharray="5 4"
        />
        <ellipse
          cx="180"
          cy="158"
          rx="75"
          ry="15"
          fill="none"
          stroke="currentColor"
          strokeDasharray="5 4"
        />
        <text
          x="180"
          y="19"
          textAnchor="middle"
          fontSize="13"
          fill="currentColor"
        >
          北极 N
        </text>
        <text
          x="180"
          y="224"
          textAnchor="middle"
          fontSize="13"
          fill="currentColor"
        >
          南极 S
        </text>
        <text x="276" y="120" fontSize="13" fill="currentColor">
          赤道 0°
        </text>
        <text x="22" y="75" fontSize="13" fill="currentColor">
          纬线
        </text>
        <line x1="57" y1="72" x2="107" y2="72" stroke="currentColor" />
        <text x="265" y="51" fontSize="13" fill="currentColor">
          经线
        </text>
        <line x1="260" y1="55" x2="200" y2="55" stroke="var(--primary)" />
      </svg>
      <p className="text-sm leading-6">
        经线沿南北延伸，经度分东西；纬线沿东西延伸，纬度分南北。
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        原创形状示意，不是地图投影。图中一个完整的纵向椭圆表示一对相对经线组成的经线圈；单条经线是半圆。
      </p>
    </figure>
  );
}

function CoordinateExplorer() {
  const [longitude, setLongitude] = useState(60);
  const [latitude, setLatitude] = useState(30);
  const longitudeText =
    longitude === 0
      ? '0°经度'
      : `${Math.abs(longitude)}°${longitude > 0 ? 'E' : 'W'}`;
  const latitudeText =
    latitude === 0
      ? '0°纬度'
      : `${Math.abs(latitude)}°${latitude > 0 ? 'N' : 'S'}`;
  return (
    <figure className="study-demo">
      <figcaption className="font-bold">给宝箱选地址</figcaption>
      <svg
        viewBox="0 0 360 220"
        role="img"
        aria-label={`北上经纬网示意，宝箱在${longitudeText}，${latitudeText}`}
      >
        <rect
          x="60"
          y="35"
          width="240"
          height="140"
          fill="var(--secondary)"
          stroke="currentColor"
        />
        {[-120, -60, 0, 60, 120].map((n) => (
          <g key={n}>
            <line
              x1={180 + n}
              y1="35"
              x2={180 + n}
              y2="175"
              stroke="currentColor"
              strokeOpacity=".3"
            />
            <text
              x={180 + n}
              y="196"
              fontSize="11"
              textAnchor="middle"
              fill="currentColor"
            >
              {n === 0 ? '0°' : `${Math.abs(n)}°${n > 0 ? 'E' : 'W'}`}
            </text>
          </g>
        ))}
        {[-60, -30, 0, 30, 60].map((n) => (
          <g key={n}>
            <line
              x1="60"
              y1={105 - n}
              x2="300"
              y2={105 - n}
              stroke="currentColor"
              strokeOpacity=".3"
            />
            <text
              x="50"
              y={109 - n}
              fontSize="11"
              textAnchor="end"
              fill="currentColor"
            >
              {n === 0 ? '0°' : `${Math.abs(n)}°${n > 0 ? 'N' : 'S'}`}
            </text>
          </g>
        ))}
        <line
          x1={180 + longitude}
          y1="35"
          x2={180 + longitude}
          y2="175"
          stroke="var(--primary)"
          strokeWidth="2"
        />
        <line
          x1="60"
          y1={105 - latitude}
          x2="300"
          y2={105 - latitude}
          stroke="var(--primary)"
          strokeWidth="2"
        />
        <circle
          cx={180 + longitude}
          cy={105 - latitude}
          r="7"
          fill="var(--ink)"
          stroke="white"
          strokeWidth="2"
        />
        <text
          x="180"
          y="20"
          textAnchor="middle"
          fontSize="12"
          fill="currentColor"
        >
          北 ↑　东 →
        </text>
      </svg>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label>
          经度
          <select
            aria-label="经度"
            className="mt-1 min-h-11 w-full rounded-lg border bg-card px-2"
            value={longitude}
            onChange={(e) => setLongitude(Number(e.target.value))}
          >
            {[-120, -60, 0, 60, 120].map((n) => (
              <option key={n} value={n}>
                {n === 0
                  ? '0°'
                  : `${Math.abs(n)}°${n > 0 ? 'E 东经' : 'W 西经'}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          纬度
          <select
            aria-label="纬度"
            className="mt-1 min-h-11 w-full rounded-lg border bg-card px-2"
            value={latitude}
            onChange={(e) => setLatitude(Number(e.target.value))}
          >
            {[-60, -30, 0, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n === 0
                  ? '0°赤道'
                  : `${Math.abs(n)}°${n > 0 ? 'N 北纬' : 'S 南纬'}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-3 text-sm font-bold" aria-live="polite">
        宝箱地址：{longitudeText}，{latitudeText}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        北上、东右的局部教学网格，不按地面距离等比例；其他地图要看方向标记。这里不判断东西半球。
      </p>
    </figure>
  );
}
