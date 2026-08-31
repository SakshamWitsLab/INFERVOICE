"use client";

import { useCallback, useRef, useState } from "react";

export interface SeriesDef {
  id: string;
  color: string;
  data: (number | null)[];
}

export function MultiLine({
  series,
  fixedMax,
  height = 120,
  labels,
}: {
  series: SeriesDef[];
  fixedMax?: number;
  height?: number;
  labels?: Record<string, string>;
}) {
  const W = 100;
  const H = 40;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const allVals = series.flatMap((s) => s.data.filter((v): v is number => v != null));
  const maxVal = fixedMax ?? Math.max(1e-6, ...allVals) * 1.25;
  const longest = Math.max(2, ...series.map((s) => s.data.length));
  const scale = (v: number) => H - 3 - (Math.min(v, maxVal) / maxVal) * (H - 6);

  const xOf = (i: number, len: number) => (len > 1 ? (i / (len - 1)) * W : 0);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || longest < 2) return;
      const rect = svg.getBoundingClientRect();
      const pctX = (e.clientX - rect.left) / rect.width;
      const idx = Math.round(pctX * (longest - 1));
      setHoverIdx(Math.max(0, Math.min(idx, longest - 1)));
    },
    [longest]
  );

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height }}
        className="overflow-visible cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={H * f}
            y2={H * f}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="0.5"
          />
        ))}

        {/* Hover crosshair line */}
        {hoverIdx != null && (
          <line
            x1={xOf(hoverIdx, longest)}
            x2={xOf(hoverIdx, longest)}
            y1="0"
            y2={H}
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="0.3"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {series.map((s) => {
          const len = s.data.length;
          if (len < 2) return null;
          let d = "";
          let pen = false;
          s.data.forEach((v, i) => {
            if (v == null) {
              pen = false;
              return;
            }
            const cmd = pen ? " L" : " M";
            d += `${cmd}${xOf(i, len).toFixed(2)},${scale(v).toFixed(2)}`;
            pen = true;
          });
          if (!d) return null;
          return (
            <path
              key={s.id}
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth="1.75"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        {/* Hover dots */}
        {hoverIdx != null &&
          series.map((s) => {
            const val = s.data[hoverIdx];
            if (val == null) return null;
            const cx = xOf(hoverIdx, s.data.length);
            const cy = scale(val);
            return (
              <circle
                key={`dot-${s.id}`}
                cx={cx}
                cy={cy}
                r="1.5"
                fill={s.color}
                stroke="rgba(0,0,0,0.5)"
                strokeWidth="0.5"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
      </svg>

      {/* Tooltip */}
      {hoverIdx != null && (
        <div className="pointer-events-none absolute -top-2 right-2 z-10 rounded-lg border border-white/10 bg-zinc-900/95 px-2.5 py-1.5 text-[10px] shadow-lg backdrop-blur-sm">
          {series.map((s) => {
            const val = s.data[hoverIdx];
            if (val == null) return null;
            return (
              <div key={s.id} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-zinc-400">{labels?.[s.id] ?? s.id}</span>
                <span className="ml-auto font-mono text-zinc-200">{val.toFixed(1)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
