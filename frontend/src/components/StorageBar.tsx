export function StorageBar({
  pct,
  label,
}: {
  pct: number | null;
  label?: string;
}) {
  const p = Math.min(100, Math.max(0, pct ?? 0));
  const color =
    p >= 90 ? "bg-red-500" : p >= 75 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div>
      <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
        <span className="truncate max-w-[70%]">{label ?? "Disk"}</span>
        <span>{pct != null ? `${p.toFixed(0)}%` : "—"}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${p}%` }}
        />
      </div>
    </div>
  );
}
