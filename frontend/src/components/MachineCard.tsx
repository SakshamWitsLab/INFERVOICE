"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Cpu,
  HardDrive,
  Loader2,
  MemoryStick,
  MonitorSmartphone,
  Pencil,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
} from "lucide-react";
import type { Machine } from "@/lib/api";
import { api, fmtGB, relTime } from "@/lib/api";
import { StatusDot } from "./Status";
import { StorageBar } from "./StorageBar";
import { EditMachineDialog } from "./EditMachineDialog";

export function MachineCard({
  machine,
  onChanged,
}: {
  machine: Machine;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<null | "refresh" | "delete">(null);
  const [editing, setEditing] = useState(false);
  const specs = machine.specs;

  async function refresh() {
    setBusy("refresh");
    try {
      await api.refreshMachine(machine.id);
      onChanged();
    } catch {}
    setBusy(null);
  }

  async function remove() {
    if (!window.confirm(`Remove "${machine.name}" from the fleet?`)) return;
    setBusy("delete");
    try {
      await api.deleteMachine(machine.id);
      onChanged();
    } catch {}
    setBusy(null);
  }

  return (
    <div className="group relative rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-white/20 hover:bg-white/[0.05]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={machine.status} />
            <Link
              href={`/machines/${machine.id}`}
              className="truncate font-semibold tracking-tight hover:text-violet-300"
            >
              {machine.name}
            </Link>
            <button
              onClick={() => setEditing(true)}
              title="Rename / configure"
              className="opacity-0 transition-opacity group-hover:opacity-100 text-zinc-500 hover:text-zinc-200"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {machine.username}@{machine.host} · seen {relTime(machine.last_seen_at)}
          </p>
        </div>
        <div className="flex shrink-0 gap-1 opacity-60 transition-opacity group-hover:opacity-100">
          <IconBtn title="Refresh specs" onClick={refresh}>
            {busy === "refresh" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </IconBtn>
          <Link href={`/machines/${machine.id}`} title="Terminal & details">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent hover:border-white/10 hover:bg-white/10">
              <Terminal className="h-3.5 w-3.5" />
            </span>
          </Link>
          <IconBtn title="Remove" onClick={remove}>
            {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </IconBtn>
        </div>
      </div>

      {specs ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <Spec icon={<Cpu className="h-3.5 w-3.5 text-violet-300" />} value={specs.chip ?? "—"} />
            <Spec icon={<MemoryStick className="h-3.5 w-3.5 text-sky-300" />} value={fmtGB(specs.memory_gb)} />
            <Spec
              icon={<MonitorSmartphone className="h-3.5 w-3.5 text-zinc-400" />}
              value={`${specs.os_name ?? "macOS"} ${specs.os_version ?? ""}`.trim()}
            />
            <Spec icon={<HardDrive className="h-3.5 w-3.5 text-emerald-300" />} value={fmtGB(specs.disk_total_gb ?? specs.storage[0]?.total_gb)} />
          </div>
          <div className="mt-4">
            <StorageBar
              pct={specs.disk_pct_used ?? specs.storage[0]?.pct_used ?? null}
              label="SSD used"
            />
          </div>
        </>
      ) : (
        <div className="mt-4 flex h-[74px] items-center justify-center rounded-lg border border-dashed border-white/10 text-xs text-zinc-500">
          {machine.status === "online"
            ? "No specs yet — hit refresh"
            : machine.error
              ? null
              : "Waiting for first contact"}
        </div>
      )}

      {machine.error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] leading-snug text-amber-200/90">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span className="line-clamp-2 break-all">{machine.error}</span>
        </div>
      )}

      <Link
        href={`/machines/${machine.id}`}
        className="absolute inset-x-0 bottom-0 -z-10 h-px"
        aria-hidden
      >
        <ArrowRight className="hidden" />
        <Plus className="hidden" />
      </Link>

      {editing && (
        <EditMachineDialog
          machine={machine}
          onClose={() => setEditing(false)}
          onSaved={onChanged}
        />
      )}
    </div>
  );
}

function Spec({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0">{icon}</span>
      <span className="truncate text-zinc-300">{value}</span>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent hover:border-white/10 hover:bg-white/10"
    >
      {children}
    </button>
  );
}
