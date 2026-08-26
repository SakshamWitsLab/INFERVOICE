import type { MachineStatus } from "@/lib/api";

const STYLES: Record<MachineStatus, { dot: string; label: string; text: string; ring: string }> = {
  online: { dot: "bg-emerald-400", label: "Online", text: "text-emerald-300", ring: "shadow-[0_0_8px_rgba(52,211,153,0.7)]" },
  offline: { dot: "bg-zinc-600", label: "Offline", text: "text-zinc-400", ring: "" },
  auth_error: { dot: "bg-amber-400", label: "Auth error", text: "text-amber-300", ring: "shadow-[0_0_8px_rgba(251,191,36,0.6)]" },
  unknown: { dot: "bg-zinc-500 animate-pulse", label: "Checking…", text: "text-zinc-400", ring: "" },
};

export function StatusDot({ status }: { status: MachineStatus }) {
  const s = STYLES[status] ?? STYLES.unknown;
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${s.dot} ${s.ring}`} />;
}

export function StatusPill({ status }: { status: MachineStatus }) {
  const s = STYLES[status] ?? STYLES.unknown;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export const STATUS_TEXT = (s: MachineStatus) => (STYLES[s] ?? STYLES.unknown).text;
