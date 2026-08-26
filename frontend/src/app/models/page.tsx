"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  Boxes,
  CheckCircle2,
  Download,
  ExternalLink,
  HardDrive,
  KeyRound,
  Loader2,
  Pencil,
  Search,
  Server,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import {
  api,
  fmtGB,
  type DownloadJob,
  type Machine,
  type NvidiaModelInfo,
} from "@/lib/api";
import { usePoll } from "@/hooks/usePoll";
import { useMetricStream } from "@/hooks/useMetricStream";
import { colorForMachine } from "@/lib/colors";

const FAMILY_COLORS: Record<string, string> = {
  Parakeet: "text-violet-300 border-violet-400/30 bg-violet-400/10",
  Canary: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  Riva: "text-sky-300 border-sky-400/30 bg-sky-400/10",
  Speech: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
};

const FAMILY_GRADIENTS: Record<string, string> = {
  Parakeet: "from-violet-600/40 to-fuchsia-600/20",
  Canary: "from-amber-500/40 to-orange-600/20",
  Riva: "from-sky-500/40 to-cyan-600/20",
  Speech: "from-emerald-500/40 to-teal-600/20",
};

export default function ModelsPage() {
  const keyQ = usePoll(api.nvidiaKeyStatus, 30000);
  const configured = keyQ.data?.configured ?? false;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex items-center gap-2.5">
        <Boxes className="h-6 w-6 text-violet-400" />
        <h1 className="text-2xl font-semibold tracking-tight">Models</h1>
      </header>
      <p className="mt-1 text-sm text-zinc-400">
        NVIDIA build.nvidia.com STT catalog — drag a model onto a Mac, or hit Deploy.
      </p>

      {!configured ? (
        <KeySetup onSaved={keyQ.reload} />
      ) : (
        <>
          <PathConfigurator />
          <Catalog />
          <DownloadsPanel />
        </>
      )}
    </main>
  );
}

function PathConfigurator() {
  const { data, reload } = usePoll(() => api.modelsRoot(), 60000);
  const [editing, setEditing] = useState(false);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const current = data?.value ?? "~/infervoice_models";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.setModelsRoot(path.trim());
      setEditing(false);
      reload();
    } catch {}
    setBusy(false);
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
      <HardDrive className="h-3.5 w-3.5 text-zinc-500" />
      <span className="text-zinc-500">Install path:</span>
      {editing ? (
        <form onSubmit={save} className="flex flex-1 items-center gap-2">
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            autoFocus
            spellCheck={false}
            placeholder={current}
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] outline-none focus:border-violet-400/60"
          />
          <button type="submit" disabled={busy} className="rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold hover:bg-violet-500 disabled:opacity-50">
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-zinc-500 hover:text-zinc-200">
            <X className="h-3 w-3" />
          </button>
        </form>
      ) : (
        <>
          <code className="font-mono text-zinc-300">{current}</code>
          <button onClick={() => { setPath(current); setEditing(true); }} className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-200">
            <Pencil className="h-3 w-3" /> change
          </button>
          <span className="ml-auto text-[10px] text-zinc-600">per-machine override in edit dialog</span>
        </>
      )}
    </div>
  );
}

function KeySetup({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.saveNvidiaKey(key.trim());
      setKey("");
      onSaved();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto mt-12 max-w-lg rounded-xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center gap-2.5">
        <KeyRound className="h-5 w-5 text-violet-400" />
        <h2 className="font-semibold">Connect NVIDIA account</h2>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">
        Paste your API key from{" "}
        <a href="https://build.nvidia.com" target="_blank" rel="noreferrer" className="text-violet-300 hover:text-violet-200">
          build.nvidia.com
        </a>
        . Validated live, stored locally with owner-only permissions.
      </p>
      <form onSubmit={save} className="mt-4 space-y-3">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="nvapi-…"
          spellCheck={false}
          className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 font-mono text-sm outline-none focus:border-violet-400/60"
        />
        {error && (
          <p className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-300">{error}</p>
        )}
        <button
          type="submit"
          disabled={busy || key.trim().length < 10}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold hover:bg-violet-500 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Validate & save key
        </button>
      </form>
    </section>
  );
}

function Catalog() {
  const [search, setSearch] = useState("");
  const [deployTarget, setDeployTarget] = useState<NvidiaModelInfo | null>(null);
  const [preselectMachine, setPreselectMachine] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const { data: modelsRes } = usePoll(() => api.nvidiaModels(), 60000);
  const { data: deploymentsRes, reload: reloadDeps } = usePoll(() => api.deployments(), 20000);
  const { data: machines } = usePoll<Machine[]>(api.listMachines, 10000);

  const deployedByModel = useMemo(() => {
    const map = new Map<string, { machine_name: string; disk_size: string | null; online: boolean }[]>();
    for (const d of deploymentsRes?.deployments ?? []) {
      const arr = map.get(d.nim_id) ?? [];
      arr.push({ machine_name: d.machine_name, disk_size: d.disk_size, online: d.machine_online });
      map.set(d.nim_id, arr);
    }
    return map;
  }, [deploymentsRes]);

  const models = useMemo(
    () =>
      (modelsRes?.models ?? []).filter((m) =>
        search.trim() ? m.nim_id.toLowerCase().includes(search.toLowerCase()) : true
      ),
    [modelsRes, search]
  );

  function openDeploy(m: NvidiaModelInfo, machineId?: string) {
    setPreselectMachine(machineId ?? null);
    setDeployTarget(m);
  }

  function handleDrop(e: React.DragEvent, machineId: string, machineName: string) {
    e.preventDefault();
    setDragOver(null);
    setDragging(false);
    const nimId = e.dataTransfer.getData("text/plain");
    const m = (modelsRes?.models ?? []).find((x) => x.nim_id === nimId);
    if (m && m.downloadable) openDeploy(m, machineId);
  }

  return (
    <section className="relative mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-zinc-300">
          Speech-to-text models <span className="text-zinc-600">({models.length})</span>
          <span className="ml-3 hidden text-[11px] font-normal text-zinc-600 lg:inline">
            tip: drag a card onto a Mac in the dock →
          </span>
        </h2>
        <label className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter models…"
            className="w-56 rounded-lg border border-white/10 bg-black/30 py-1.5 pl-8 pr-3 text-xs outline-none focus:border-violet-400/60"
          />
        </label>
      </div>

      {modelsRes?.live_error && (
        <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
          Live NVIDIA sync issue (showing built-in catalog): {modelsRes.live_error}
        </p>
      )}

      <div
        className={`mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 ${dragging ? "lg:pr-44" : ""}`}
      >
        {models.map((m) => {
          const deps = deployedByModel.get(m.nim_id) ?? [];
          return (
            <div
              key={m.nim_id}
              draggable={m.downloadable}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", m.nim_id);
                e.dataTransfer.effectAllowed = "copy";
                setDragging(true);
              }}
              onDragEnd={() => setDragging(false)}
              className={`group flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] transition-all hover:border-white/25 ${
                m.downloadable ? "cursor-grab active:cursor-grabbing hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-900/20" : ""
              }`}
            >
              <div className={`bg-gradient-to-r ${FAMILY_GRADIENTS[m.family] ?? FAMILY_GRADIENTS.Speech} px-4 py-2.5`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/90">
                    {m.family}
                  </span>
                  {m.size_gb != null && (
                    <span className="rounded-md bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-zinc-100">
                      {m.size_gb} GB
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate font-mono text-xs text-white/95">{m.nim_id}</p>
              </div>

              <div className="flex flex-1 flex-col p-4">
                <p className="line-clamp-2 min-h-[32px] text-xs leading-relaxed text-zinc-400">
                  {m.description}
                </p>
                {m.hf_repo && (
                  <a
                    href={`https://huggingface.co/${m.hf_repo}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 inline-flex w-fit items-center gap-1 text-[10px] text-zinc-600 hover:text-violet-300"
                  >
                    {m.hf_repo} <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}

                {deps.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {deps.map((d, i) => (
                      <span
                        key={i}
                        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] ${
                          d.online
                            ? "border-emerald-400/30 bg-emerald-400/5 text-emerald-300"
                            : "border-white/10 text-zinc-500"
                        }`}
                      >
                        <CheckCircle2 className="h-2.5 w-2.5" /> {d.machine_name}
                        {d.disk_size && ` · ${d.disk_size}`}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="min-h-[22px]" />
                )}

                <div className="mt-auto pt-3">
                  {m.downloadable ? (
                    <button
                      onClick={() => openDeploy(m)}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold hover:bg-violet-500"
                    >
                      <ArrowDownToLine className="h-3.5 w-3.5" /> Deploy…
                    </button>
                  ) : (
                    <span className="block rounded-lg border border-white/10 px-3 py-1.5 text-center text-[10px] text-zinc-600">
                      NIM container · GPU only
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Fleet drop dock */}
      <div
        className={`fixed right-5 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-2 lg:flex`}
      >
        {(machines ?? []).map((mc) => {
          const isOver = dragOver === mc.id;
          return (
            <div
              key={mc.id}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(mc.id);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => handleDrop(e, mc.id, mc.name)}
              className={`flex w-36 items-center gap-2 rounded-xl border px-3 py-2.5 backdrop-blur transition-all ${
                isOver
                  ? "scale-105 border-violet-400 bg-violet-500/25 shadow-lg shadow-violet-900/50"
                  : dragging
                    ? "border-dashed border-violet-400/40 bg-zinc-900/90 opacity-80"
                    : "border-white/10 bg-zinc-900/70 opacity-70 hover:opacity-100"
              }`}
              title="Drop a model here to deploy"
            >
              <Server
                className={`h-4 w-4 shrink-0 ${isOver ? "text-white" : ""}`}
                style={{ color: !isOver ? colorForMachine(mc.id) : undefined }}
              />
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium leading-tight">{mc.name}</p>
                <p className="text-[9px] leading-tight text-zinc-500">
                  {mc.status === "online" ? `${fmtGB(mc.specs?.disk_free_gb)} free` : mc.status.replace("_", " ")}
                </p>
              </div>
            </div>
          );
        })}
        {dragging && (
          <p className="w-36 text-center text-[9px] uppercase tracking-widest text-violet-300/70">
            drop to deploy
          </p>
        )}
      </div>

      {deployTarget && (
        <DeployDialog
          model={deployTarget}
          initialMachineId={preselectMachine}
          onClose={() => setDeployTarget(null)}
          onChanged={reloadDeps}
        />
      )}
    </section>
  );
}

function DeployDialog({
  model,
  initialMachineId,
  onClose,
  onChanged,
}: {
  model: NvidiaModelInfo;
  initialMachineId?: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data: machines } = usePoll<Machine[]>(api.listMachines, 10000);
  const { data: rootRes } = usePoll(() => api.modelsRoot(), 60000);
  const online = (machines ?? []).filter((m) => m.status === "online");
  const [machineId, setMachineId] = useState(initialMachineId || online[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = online.find((m) => m.id === machineId);
  const effectiveRoot =
    selected?.models_root || rootRes?.value || "~/infervoice_models";
  const targetDir = `${effectiveRoot.replace(/\/$/, "")}/${model.nim_id.toLowerCase().replace(/\//g, "_")}`;

  async function go() {
    if (!machineId) return;
    setBusy(true);
    setError(null);
    try {
      await api.startDownload(machineId, model.nim_id);
      onChanged();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-zinc-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <Download className="h-5 w-5 text-violet-400" />
            <h2 className="font-semibold">Deploy model</h2>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <dl className="mt-4 space-y-1 rounded-lg bg-black/30 p-3 text-xs">
          <div className="flex justify-between gap-4">
            <dt className="shrink-0 text-zinc-500">Model</dt>
            <dd className="truncate font-mono text-zinc-200">{model.nim_id}</dd>
          </div>
          {model.size_gb != null && (
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Download size</dt>
              <dd className="font-mono text-zinc-200">{model.size_gb} GB</dd>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt className="shrink-0 text-zinc-500">Weights</dt>
            <dd className="truncate font-mono text-zinc-200">{model.hf_repo}</dd>
          </div>
        </dl>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-zinc-400">Target machine</span>
          {online.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-xs text-zinc-500">
              No machines online right now.
            </p>
          ) : (
            <select
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-violet-400/60 [&>option]:bg-zinc-900"
            >
              {online.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {fmtGB(m.specs?.disk_free_gb)} free
                </option>
              ))}
            </select>
          )}
        </label>

        {selected?.specs?.disk_free_gb != null && (
          <p
            className={`mt-2 flex items-center gap-1.5 text-xs ${
              selected.specs.disk_free_gb < (model.size_gb ?? 5) * 1.2 ? "text-amber-300" : "text-zinc-500"
            }`}
          >
            <HardDrive className="h-3.5 w-3.5" />
            {fmtGB(selected.specs.disk_free_gb, 1)} free
            {model.size_gb != null && ` · needs ~${model.size_gb} GB`}
          </p>
        )}

        <p className="mt-3 truncate rounded-lg bg-black/30 px-3 py-2 font-mono text-[11px] text-zinc-500">
          → {targetDir}
        </p>

        {error && (
          <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
            {error.includes("HuggingFace CLI") && selected ? (
              <InstallHint machineId={selected.id} onDone={() => setError(null)} />
            ) : (
              error
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm hover:bg-white/5">
            Cancel
          </button>
          <button
            onClick={go}
            disabled={busy || !machineId}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold hover:bg-violet-500 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Start download
          </button>
        </div>
      </div>
    </div>
  );
}

function InstallHint({ machineId, onDone }: { machineId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function install() {
    setBusy(true);
    try {
      await api.installHfCli(machineId);
      onDone();
    } catch {}
    setBusy(false);
  }
  return (
    <span className="flex flex-col gap-2">
      <span>The HuggingFace CLI is missing on that Mac.</span>
      <button
        onClick={install}
        disabled={busy}
        className="self-start rounded-lg bg-amber-400/20 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-400/30 disabled:opacity-50"
      >
        {busy ? "Installing…" : "Install HF CLI now"}
      </button>
    </span>
  );
}

function DownloadsPanel() {
  const { history } = useMetricStream<DownloadJob[]>(() => api.nvidiaDownloads(), 2500, "jobs");
  const [, forceTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const jobs = history[history.length - 1] ?? [];
  const active = jobs.filter((j) => j.status === "downloading" || j.status === "queued");
  const past = jobs.filter((j) => j.status !== "downloading" && j.status !== "queued");

  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium text-zinc-300">Downloads</h2>
      {jobs.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-xs text-zinc-600">
          No downloads yet — deploy a model above or drag one onto a Mac.
        </p>
      ) : (
        <div className="space-y-3">
          {active.map((j) => (
            <ActiveJobCard key={j.id} job={j} onCancel={cancelFactory(j.id)} />
          ))}
          {past.length > 0 && (
            <div className="space-y-1.5">
              {past.map((j) => (
                <PastJobRow key={j.id} job={j} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );

  async function cancel(jobId: string) {
    try {
      await api.cancelDownload(jobId);
    } catch {}
  }

  function cancelFactory(id: string) {
    return () => cancel(id);
  }
}

function elapsed(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h) return `${h}h ${m % 60}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function ActiveJobCard({ job, onCancel }: { job: DownloadJob; onCancel: () => void }) {
  const pct = job.progress_pct;
  return (
    <div className="overflow-hidden rounded-xl border border-sky-400/30 bg-gradient-to-r from-sky-400/[0.06] to-transparent">
      <div className="h-0.5 w-full overflow-hidden bg-sky-400/10">
        <div
          className={`h-full bg-gradient-to-r from-sky-400 to-violet-400 transition-all duration-700 ${
            pct == null ? "animate-pulse" : ""
          }`}
          style={{ width: pct != null ? `${Math.max(3, pct)}%` : "35%" }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
        <Loader2 className="h-4 w-4 animate-spin text-sky-300" />
        <span className="font-mono text-sm font-medium">{job.nim_id}</span>
        <span className="text-xs text-zinc-500">→ {job.machine_name}</span>
        <span className="ml-auto flex items-center gap-3 text-[11px]">
          {job.phase && <span className="text-zinc-400">{job.phase}</span>}
          {job.files_total != null && (
            <span className="font-mono text-zinc-400">
              files {job.files_done ?? 0}/{job.files_total}
            </span>
          )}
          {pct != null ? (
            <span className="font-mono font-semibold text-sky-300">{pct.toFixed(0)}%</span>
          ) : (
            <span className="text-zinc-600">starting…</span>
          )}
          <span className="text-zinc-600">{elapsed(job.created_at)}</span>
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-zinc-400 hover:bg-white/5"
          >
            <Trash2 className="h-3 w-3" /> Cancel
          </button>
        </span>
      </div>
    </div>
  );
}

function PastJobRow({ job }: { job: DownloadJob }) {
  const failed = job.status === "failed";
  return (
    <details className="group rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 text-xs [&::-webkit-details-marker]:hidden">
        {failed ? (
          <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
        ) : job.status === "done" ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
        ) : (
          <XCircle className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
        )}
        <span className="font-mono font-medium text-zinc-300">{job.nim_id}</span>
        <span className="text-zinc-600">→ {job.machine_name}</span>
        <span
          className={`ml-auto rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase ${
            job.status === "done"
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
              : failed
                ? "border-red-400/30 bg-red-400/10 text-red-300"
                : "border-white/10 text-zinc-500"
          }`}
        >
          {job.status}
        </span>
      </summary>
      <div className="mt-2 space-y-1.5 pl-6">
        <p className="truncate font-mono text-[10px] text-zinc-600">{job.target_dir}</p>
        {job.error && <p className="break-all text-[11px] text-red-300/90">{job.error}</p>}
        {job.log_tail && (
          <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-2 font-mono text-[10px] text-zinc-500">
            {job.log_tail}
          </pre>
        )}
      </div>
    </details>
  );
}
