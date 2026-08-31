"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Server, Mic, Trash2, Square, Download, Loader2 } from "lucide-react";
import { api, type Machine, type InferenceRunSummary } from "@/lib/api";
import { usePoll } from "@/hooks/usePoll";
import { MachineCard } from "@/components/MachineCard";
import { InlineRename } from "@/components/InlineRename";

export default function Dashboard() {
  const { data: machines, reload } = usePoll<Machine[]>(api.listMachines, 5000);
  const { data: runsRes } = usePoll(() => api.listRuns(), 10000);
  const [bulkInstalling, setBulkInstalling] = useState(false);

  const total = machines?.length ?? 0;
  const online = machines?.filter((m) => m.status === "online").length ?? 0;
  const issues = machines?.filter((m) => m.status === "auth_error").length ?? 0;

  async function deleteRun(id: string) {
    if (!window.confirm("Delete this run from history?")) return;
    try {
      await api.deleteRun(id);
    } catch {}
  }

  async function installAllOnline() {
    const targets = (machines ?? []).filter((m) => m.status === "online");
    if (targets.length === 0) {
      window.alert("No online machines to install on.");
      return;
    }
    if (!window.confirm(`Pre-install ASR runtime on ${targets.length} online machine(s)?`)) return;
    setBulkInstalling(true);
    try {
      await Promise.allSettled(targets.map((m) => api.installAsrRuntime(m.id)));
    } finally {
      setBulkInstalling(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-900/40">
              <Server className="h-4.5 w-4.5 h-5 w-5 text-white" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">InferVoice</h1>
          </div>
          <p className="mt-1 text-sm text-zinc-400">Mac fleet control center</p>
        </div>
        <div className="flex items-center gap-2">
          {online > 0 && (
            <button
              onClick={installAllOnline}
              disabled={bulkInstalling}
              title="Pre-install ASR runtime on all online machines"
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {bulkInstalling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Install ASR (all online)
            </button>
          )}
          <Link
            href="/add"
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
          >
            <Plus className="h-4 w-4" /> Add machine
          </Link>
        </div>
      </header>

      {total > 0 && (
        <div className="mt-6 flex gap-3 text-xs">
          <Stat label="Machines" value={total} />
          <Stat label="Online" value={online} accent="text-emerald-300" />
          {issues > 0 && <Stat label="Auth issues" value={issues} accent="text-amber-300" />}
        </div>
      )}

      {total === 0 ? (
        <div className="mt-16 flex flex-col items-center rounded-xl border border-dashed border-white/10 py-20 text-center">
          <Server className="h-10 w-10 text-zinc-600" />
          <h2 className="mt-4 font-medium">No machines yet</h2>
          <p className="mt-1 max-w-sm text-sm text-zinc-500">
            Discover Macs on your LAN or add one manually to start controlling specs, storage and shells.
          </p>
          <Link
            href="/add"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
          >
            <Plus className="h-4 w-4" /> Add your first Mac
          </Link>
        </div>
      ) : (
        <>
          <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {machines!.map((m) => (
              <MachineCard key={m.id} machine={m} onChanged={reload} />
            ))}
          </section>
          <section className="mt-10">
            <h2 className="mb-3 text-sm font-medium text-zinc-300">Recent inference runs</h2>
            {(runsRes?.runs ?? []).length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-zinc-600">
                No runs yet.
              </p>
            ) : (
              <div className="space-y-1.5">
                {runsRes!.runs.map((r: InferenceRunSummary) => {
                  const modelLabel =
                    r.model_ids && r.model_ids.length > 1
                      ? `multi (${r.model_ids.length} models)`
                      : r.model_id;
                  return (
                    <div
                      key={r.id}
                      className={`flex items-stretch gap-0 rounded-lg border ${
                        "border-white/10 hover:bg-white/5"
                      }`}
                    >
                      <div className="flex w-full flex-wrap items-center gap-3 px-3 py-2 text-left text-xs">
                        <Mic className="h-3 w-3 text-zinc-600" />
                        <span className="font-medium">{modelLabel}</span>
                        <InlineRename
                          value={r.audio_name}
                          onSave={async (name) => {
                            await api.renameRun(r.id, name);
                          }}
                          className="truncate text-zinc-500"
                        />
                        {r.status === "running" && (
                          <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[9px] text-sky-300">
                            running
                          </span>
                        )}
                        {r.status === "cancelled" && (
                          <span className="rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-[9px] text-zinc-400">
                            cancelled
                          </span>
                        )}
                        <span className="ml-auto text-zinc-600">
                          {r.done}/{r.machines.length} · {new Date(r.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 border-l border-white/10 px-1.5">
                        {r.status === "running" && (
                          <button
                            onClick={() => api.stopRun(r.id).catch(() => {})}
                            title="Stop"
                            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-red-400/10 hover:text-red-400"
                          >
                            <Square className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          onClick={() => deleteRun(r.id)}
                          title="Delete"
                          className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-red-400/10 hover:text-red-400"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2">
      <span className={`font-semibold ${accent ?? ""}`}>{value}</span>{" "}
      <span className="text-zinc-500">{label}</span>
    </div>
  );
}
