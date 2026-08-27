"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Cpu,
  Fingerprint,
  HardDrive,
  Loader2,
  MemoryStick,
  Pencil,
  RefreshCw,
  Timer,
  Trash2,
} from "lucide-react";
import { api, fmtGB, fmtUptime, relTime, type Deployment, type Machine } from "@/lib/api";
import { usePoll } from "@/hooks/usePoll";
import { StatusPill } from "@/components/Status";
import { StorageBar } from "@/components/StorageBar";
import { ExecBox } from "@/components/ExecBox";
import { LiveMetrics } from "@/components/LiveMetrics";
import { KeyInstallDialog } from "@/components/KeyInstallDialog";
import { EditMachineDialog } from "@/components/EditMachineDialog";

const TerminalPanel = dynamic(() => import("@/components/TerminalPanel"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-xl border border-white/10">
      <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
    </div>
  ),
});

export default function MachineDetail() {
  return (
    <Suspense>
      <Detail />
    </Suspense>
  );
}

function Detail() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = params.id;
  const [showKeyDialog, setShowKeyDialog] = useState(search.get("welcome") === "1");
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deletingModel, setDeletingModel] = useState<string | null>(null);

  const { data: m, reload } = usePoll<Machine>(
    () => api.getMachine(id!),
    5000
  );
  const { data: deploymentsRes } = usePoll<{ deployments: Deployment[] }>(
    () => api.deployments(),
    20000
  );
  const myModels = (deploymentsRes?.deployments ?? []).filter((d) => d.machine_id === id);

  async function refresh() {
    if (!m) return;
    setRefreshing(true);
    try {
      await api.refreshMachine(m.id);
      await reload();
    } catch {}
    setRefreshing(false);
  }

  async function deleteModel(nimId: string) {
    if (!window.confirm(`Remove ${nimId} from ${m?.name}?`)) return;
    setDeletingModel(nimId);
    try {
      await api.deleteDeployment(id!, nimId);
      await reload();
    } catch {}
    setDeletingModel(null);
  }

  if (!m) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </main>
    );
  }

  const s = m.specs;
  const needsKey = m.status === "auth_error";

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <header className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{m.name}</h1>
            <button
              onClick={() => setEditing(true)}
              title="Rename / configure"
              className="text-zinc-500 hover:text-zinc-200"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <StatusPill status={m.status} />
          </div>
          <p className="mt-0.5 text-sm text-zinc-500">
            {m.username}@{m.host}:{m.port} · last seen {relTime(m.last_seen_at)}
          </p>
        </div>
        <div className="flex gap-2">
          {(needsKey || showKeyDialog) && (
            <button
              onClick={() => setShowKeyDialog(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3.5 py-2 text-sm font-medium text-amber-200 hover:bg-amber-400/20"
            >
              <Fingerprint className="h-4 w-4" /> Install SSH key
            </button>
          )}
          <button
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh specs
          </button>
        </div>
      </header>

      {m.error && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs leading-relaxed text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          {m.error}
        </p>
      )}

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-medium">
            <Cpu className="h-4 w-4 text-violet-300" /> Hardware & OS
          </h2>
          {s ? (
            <dl className="space-y-2.5 text-sm">
              <Row label="Computer name" value={s.computer_name} />
              <Row
                label="Model"
                value={
                  s.model || s.model_name
                    ? `${s.model_name ?? ""}${s.model ? (s.model_name ? ` (${s.model})` : s.model) : ""}`.trim()
                    : null
                }
              />
              <Row label="Chip" value={s.chip} mono />
              <Row
                label="Cores"
                value={
                  s.cores_total != null
                    ? `${s.cores_total}` +
                      (s.cores_performance ? ` (${s.cores_performance}P` : "") +
                      (s.cores_efficiency ? ` + ${s.cores_efficiency}E)` : s.cores_performance ? ")" : "")
                    : null
                }
              />
              <Row label="Memory" value={fmtGB(s.memory_gb)} icon={<MemoryStick className="h-3.5 w-3.5" />} />
              <Row label="macOS" value={s.os_version ? `${s.os_name ?? "macOS"} ${s.os_version}${s.os_build ? ` (${s.os_build})` : ""}` : null} />
              <Row label="Uptime" value={fmtUptime(s.uptime_seconds)} icon={<Timer className="h-3.5 w-3.5" />} />
              <Row label="Serial" value={s.serial} mono />
            </dl>
          ) : (
            <Empty text="No specs collected yet. If the machine is online, hit “Refresh specs”." />
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-medium">
            <HardDrive className="h-4 w-4 text-emerald-300" /> Storage
          </h2>
          {s && (s.storage.length > 0 || s.disk_total_gb != null) ? (
            <div>
              <StorageBar pct={s.disk_pct_used ?? s.storage[0]?.pct_used ?? null} label="SSD used" />
              <p className="mt-1.5 text-[13px] text-zinc-300">
                {fmtGB(s.disk_used_gb ?? 0, 1)} used of {fmtGB(s.disk_total_gb, 1)} · {fmtGB(s.disk_free_gb, 1)} free
              </p>
              <div className="mt-4 space-y-2.5 border-t border-white/5 pt-3">
                {s.storage.map((v) => {
                  const friendly =
                    v.mount === "/System/Volumes/Data"
                      ? "Data — your apps & files"
                      : v.mount === "/"
                        ? "System — macOS (read-only)"
                        : v.mount;
                  return (
                    <div key={v.mount} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate text-zinc-400">{friendly}</span>
                      <span className="shrink-0 font-mono text-zinc-300">
                        {fmtGB(v.used_gb, 1)} / {fmtGB(v.total_gb, 1)}
                      </span>
                    </div>
                  );
                })}
                <p className="pt-1 text-[11px] leading-snug text-zinc-600">
                  Both volumes share one physical SSD (APFS container) — usage is combined in the bar above.
                </p>
              </div>
            </div>
          ) : (
            <Empty text="No storage data yet." />
          )}
        </div>
      </section>

      <LiveMetrics machineId={id} online={m.status === "online" || refreshing} />

      {myModels.length > 0 && (
        <section className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Boxes className="h-4 w-4 text-fuchsia-300" /> Installed models
          </h2>
          <div className="space-y-2">
            {myModels.map((d) => (
              <div key={`${d.nim_id}-${d.machine_id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/5 px-3 py-2 text-xs hover:border-white/15">
                <Link href="/models" className="font-medium text-violet-300 hover:text-violet-200">
                  {d.nim_id}
                </Link>
                <span className="truncate font-mono text-[11px] text-zinc-500">{d.target_dir}</span>
                {d.disk_size && (
                  <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">
                    {d.disk_size} on disk
                  </span>
                )}
                <button
                  onClick={() => deleteModel(d.nim_id)}
                  disabled={deletingModel === d.nim_id}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:border-red-400/30 hover:bg-red-400/10 hover:text-red-400"
                  title={`Remove ${d.nim_id} from this machine`}
                >
                  {deletingModel === d.nim_id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  delete
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-4">
        <ExecBox machineId={id} />
      </section>

      <section className="mt-4">
        <TerminalPanel machineId={id} />
      </section>

      {showKeyDialog && (
        <KeyInstallDialog
          machineId={id}
          machineName={m.name}
          onDone={reload}
          onClose={() => setShowKeyDialog(false)}
        />
      )}

      {editing && m && (
        <EditMachineDialog machine={m} onClose={() => setEditing(false)} onSaved={reload} />
      )}
    </main>
  );
}

function Row({ label, value, mono, icon }: { label: string; value?: string | null; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 pb-2 last:border-0 last:pb-0">
      <dt className="flex items-center gap-1.5 shrink-0 text-xs text-zinc-500">{icon}{label}</dt>
      <dd className={`truncate text-right ${mono ? "font-mono text-xs" : "text-[13px]"} text-zinc-200`}>{value || "—"}</dd>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-white/10 px-6 text-center text-xs text-zinc-500">
      {text}
    </div>
  );
}
