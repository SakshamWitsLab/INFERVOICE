"use client";

export interface SeriesDef {
  id: string;
  color: string;
  data: (number | null)[];
}

export function MultiLine({
  series,
  fixedMax,
  height = 120,
}: {
  series: SeriesDef[];
  fixedMax?: number;
  height?: number;
}) {
  const W = 100;
  const H = 40;

  const allVals = series.flatMap((s) => s.data.filter((v): v is number => v != null));
  const maxVal = fixedMax ?? Math.max(1e-6, ...allVals) * 1.25;
  const longest = Math.max(2, ...series.map((s) => s.data.length));
  const scale = (v: number) => H - 3 - (Math.min(v, maxVal) / maxVal) * (H - 6);

  const xOf = (i: number, len: number) =>
    len > 1 ? (i / (len - 1)) * W : 0;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height }}
      className="overflow-visible"
    >
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
      ))}
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
    </svg>
  );
}
