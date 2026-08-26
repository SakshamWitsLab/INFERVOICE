"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AudioLines,
  CheckCircle2,
  Copy,
  Crown,
  FileAudio,
  Loader2,
  Mic,
  Play,
  Radio,
  Timer,
  Upload,
  Wrench,
  XCircle,
} from "lucide-react";
import {
  api,
  type InferenceRunDetail,
  type RunnableModel,
} from "@/lib/api";
import { usePoll } from "@/hooks/usePoll";
import { AudioRecorder } from "@/components/AudioRecorder";

export default function PlaygroundPage() {
  const { data: catalogRes } = usePoll(() => api.inferenceCatalog(), 60000);
  const runnableModels = useMemo(
    () => (catalogRes?.models ?? []).filter((m) => m.runnable && m.downloadable),
    [catalogRes]
  );
  const [modelId, setModelId] = useState("");
  const model = runnableModels.find((m) => m.nim_id === modelId) ?? null;

  const { data: deployedRes, reload: reloadDeployed } = usePoll<{
    machines: { id: string; name: string }[];
  }>(
    () => api.deployedFor(modelId),
    15000
  );
  const targets = deployedRes?.machines ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelected(new Set(targets.map((t) => t.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, targets.length]);

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  const [runId, setRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: runDetail } = usePoll<InferenceRunDetail | null>(
    () => (runId ? api.getRun(runId) : Promise.resolve(null)),
    2500
  );
  const liveRun = runDetail?.run.id === runId ? runDetail : null;
  const running =
    !!liveRun &&
    liveRun.tasks.some((t) =>
      ["queued", "uploading", "inferring"].includes(t.status)
    );

  const { data: historyRes } = usePoll(() => api.listRuns(), 10000);

  function pickFile(f: File | null) {
    if (!f) return;
    setAudioFile(f);
    setDuration(0);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const url = URL.createObjectURL(f);
    setAudioUrl(url);
  }

  async function start() {
    if (!audioFile || !model || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const probe = new Audio();
      const dur = await new Promise<number>((resolve) => {
        probe.preload = "metadata";
        probe.onloadedmetadata = () => resolve(probe.duration || duration || 0);
        probe.onerror = () => resolve(duration || 0);
        probe.src = audioUrl!;
      });
      const res = await api.createRun(
        audioFile,
        model.nim_id,
        [...selected],
        dur
      );
      setRunId(res.run_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const tasks = liveRun?.tasks ?? [];
  const doneTasks = tasks.filter((t) => t.status === "done" && t.wall_ms);
  const fastestMs = doneTasks.length
    ? Math.min(...doneTasks.map((t) => t.wall_ms!))
    : null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex items-center gap-2.5">
        <AudioLines className="h-6 w-6 text-violet-400" />
        <h1 className="text-2xl font-semibold tracking-tight">Inference Playground</h1>
      </header>
      <p className="mt-1 text-sm text-zinc-400">
        One audio clip → parallel STT across your fleet → compare transcripts and speed.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Radio className="h-4 w-4 text-violet-300" /> Audio source
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-3">
              <span className="text-xs font-medium text-zinc-400">Record live</span>
              <AudioRecorder onRecorded={pickFile} />
            </div>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 bg-black/20 p-3 text-center hover:border-violet-400/40">
              <Upload className="h-5 w-5 text-zinc-500" />
              <span className="text-xs text-zinc-400">Drop / choose a file</span>
              <span className="text-[10px] text-zinc-600">wav · mp3 · flac · m4a</span>
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          {audioFile && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2">
              <FileAudio className="h-4 w-4 text-emerald-300" />
              <span className="truncate text-xs text-zinc-200">{audioFile.name}</span>
              <span className="text-[11px] text-zinc-500">{(audioFile.size / 1024).toFixed(0)} KB</span>
              {audioUrl && (
                <audio controls src={audioUrl} className="ml-auto h-8 max-w-full" />
              )}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Wrench className="h-4 w-4 text-violet-300" /> Model & targets
          </h2>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="mt-4 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-violet-400/60 [&>option]:bg-zinc-900"
          >
            <option value="">Select Parakeet model…</option>
            {runnableModels.map((m) => (
              <option key={m.nim_id} value={m.nim_id}>
                {m.nim_id} ({m.size_gb ?? "?"} GB)
              </option>
            ))}
          </select>

          <div className="mt-4 space-y-2">
            {!modelId && (
              <p className="text-xs text-zinc-500">Pick a model to see eligible machines.</p>
            )}
            {modelId && targets.length === 0 && (
              <p className="text-xs text-zinc-500">
                Not deployed anywhere yet — deploy it from the{" "}
                <Link href="/models" className="text-violet-300">Models tab</Link> first.
              </p>
            )}
            {targets.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-white/10 px-3 py-2 hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={() => toggle(t.id)}
                  className="h-4 w-4 accent-violet-500"
                />
                <span className="text-sm">{t.name}</span>
              </label>
            ))}
          </div>

          {error && (
            <p className="mt-4 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-300">{error}</p>
          )}

          <button
            onClick={start}
            disabled={busy || !audioFile || selected.size === 0 || !modelId || running}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold hover:bg-violet-500 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run parallel inference ({selected.size})
          </button>
        </section>
      </div>

      {(running || tasks.length > 0) && (
        <section className="mt-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Timer className="h-4 w-4 text-violet-300" />
            Comparison {liveRun?.run.audio_name && (
              <span className="text-zinc-600">· {liveRun.run.audio_name}</span>
            )}
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {tasks.map((t) => {
              const isFastest = fastestMs != null && t.wall_ms === fastestMs;
              return (
                <div
                  key={t.id}
                  className={`relative rounded-xl border p-4 ${
                    isFastest
                      ? "border-amber-400/40 bg-amber-400/5"
                      : "border-white/10 bg-white/[0.03]"
                  }`}
                >
                  {isFastest && (
                    <span className="absolute -top-2.5 right-3 inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-black">
                      <Crown className="h-3 w-3" /> FASTEST
                    </span>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{t.machine_name}</span>
                    <TaskChip status={t.status} />
                  </div>
                  <div className="mt-2 flex gap-2 text-[11px]">
                    {t.wall_ms != null && (
                      <span className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-zinc-300">
                        {(t.wall_ms / 1000).toFixed(2)}s
                      </span>
                    )}
                    {t.wall_ms != null && liveRun?.run.audio_duration ? (
                      <span className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-zinc-400">
                        RTF {((t.wall_ms / 1000) / liveRun.run.audio_duration).toFixed(2)}x
                      </span>
                    ) : null}
                  </div>
                  {t.status === "failed" && (
                    <div className="mt-3 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-[11px] leading-relaxed text-red-300">
                      {t.error}
                      {t.error?.includes("runtime") && (
                        <InstallRuntimeBtn machineId={t.machine_id} />
                      )}
                    </div>
                  )}
                  {t.transcript && (
                    <>
                      <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-3 font-mono text-xs leading-relaxed text-zinc-200">
                        {t.transcript}
                      </pre>
                      <button
                        onClick={() => navigator.clipboard.writeText(t.transcript || "")}
                        className="mt-2 inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-200"
                      >
                        <Copy className="h-3 w-3" /> copy
                      </button>
                    </>
                  )}
                  {(t.status === "uploading" || t.status === "inferring" || t.status === "queued") && (
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-violet-400" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-medium text-zinc-300">Recent runs</h2>
        {(historyRes?.runs ?? []).length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-zinc-600">
            No runs yet.
          </p>
        ) : (
          <div className="space-y-1.5">
            {historyRes!.runs.map((r) => (
              <button
                key={r.id}
                onClick={() => setRunId(r.id)}
                className={`flex w-full flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                  r.id === runId
                    ? "border-violet-400/40 bg-violet-400/10"
                    : "border-white/10 hover:bg-white/5"
                }`}
              >
                <Mic className="h-3 w-3 text-zinc-600" />
                <span className="font-medium">{r.model_id}</span>
                <span className="truncate text-zinc-500">{r.audio_name}</span>
                <span className="ml-auto text-zinc-600">
                  {r.done}/{r.machines.length} · {new Date(r.created_at).toLocaleTimeString()}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function InstallRuntimeBtn({ machineId }: { machineId: string }) {
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  async function install() {
    setBusy(true);
    try {
      await api.installAsrRuntime(machineId);
      setOk(true);
    } catch {}
    setBusy(false);
  }
  if (ok) return <CheckCircle2 className="mt-2 h-4 w-4 text-emerald-400" />;
  return (
    <button
      onClick={install}
      disabled={busy}
      className="mt-2 block rounded-lg bg-amber-400/20 px-3 py-1.5 text-[11px] font-semibold text-amber-100 hover:bg-amber-400/30 disabled:opacity-50"
    >
      {busy ? "Installing…" : "Install ASR runtime"}
    </button>
  );
}

function TaskChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    done: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
    failed: "text-red-300 border-red-400/30 bg-red-400/10",
    inferring: "text-sky-300 border-sky-400/30 bg-sky-400/10",
    uploading: "text-violet-300 border-violet-400/30 bg-violet-400/10",
    queued: "text-zinc-400 border-white/20 bg-white/5",
  };
  const icon =
    status === "done" ? (
      <CheckCircle2 className="h-3 w-3" />
    ) : status === "failed" ? (
      <XCircle className="h-3 w-3" />
    ) : (
      <Loader2 className="h-3 w-3 animate-spin" />
    );
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${map[status]}`}
    >
      {icon} {status}
    </span>
  );
}
