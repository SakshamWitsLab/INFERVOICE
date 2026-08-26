"use client";

export function Sparkline({
  data,
  color,
  fixedMax = 100,
  height = 56,
}: {
  data: (number | null)[];
  color: string;
  fixedMax?: number;
  height?: number;
}) {
  const W = 100;
  const H = 40;
  const valid = data.filter((v): v is number => v != null);
  const maxVal =
    fixedMax ?? Math.max(1e-6, ...valid) * 1.25;

  const scale = (v: number) =>
    H - 3 - (Math.min(v, maxVal) / maxVal) * (H - 6);

  let segments: string[] = [];
  let areaPaths: string[] = [];
  if (data.length >= 2) {
    let current: [number, number][] = [];
    const flush = () => {
      if (current.length < 2) {
        current = [];
        return;
      }
      const pts = current.map(
        ([i, v]) => `${((i / (data.length - 1)) * W).toFixed(2)},${scale(v).toFixed(2)}`
      );
      segments.push(`M${pts.join(" L")}`);
      const firstX = ((current[0][0] / (data.length - 1)) * W).toFixed(2);
      const lastX = ((current[current.length - 1][0] / (data.length - 1)) * W).toFixed(2);
      areaPaths.push(
        `M${firstX},${H} L${pts.join(" L")} L${lastX},${H} Z`
      );
      current = [];
    };
    data.forEach((v, i) => {
      if (v == null) flush();
      else current.push([i, v]);
    });
    flush();
  }

  let lastIdx = -1;
  data.forEach((v, i) => {
    if (v != null) lastIdx = i;
  });
  const lastVal = lastIdx >= 0 ? (data[lastIdx] as number) : null;
  const gradId = `g-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height }}
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
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
      {areaPaths.map((d, k) => (
        <path key={`a${k}`} d={d} fill={`url(#${gradId})`} />
      ))}
      {segments.map((d, k) => (
        <path
          key={`l${k}`}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {lastVal != null && data.length > 1 && (
        <circle
          cx={(lastIdx / (data.length - 1)) * W}
          cy={scale(lastVal)}
          r="2"
          fill={color}
        />
      )}
    </svg>
  );
}
