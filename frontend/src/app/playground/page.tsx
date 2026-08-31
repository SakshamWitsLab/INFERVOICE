"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AudioLines,
  CheckCircle2,
  Copy,
  Crown,
  Download,
  FileAudio,
  Loader2,
  Mic,
  Play,
  Radio,
  Square,
  Timer,
  Trash2,
  Upload,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import {
  api,
  audioOutUrl,
  fmtGB,
  type Deployment,
  type InferenceRunDetail,
  type InferenceTask,
  type RunnableModel,
} from "@/lib/api";
import { usePoll } from "@/hooks/usePoll";
import { AudioRecorder } from "@/components/AudioRecorder";
import { colorForMachine } from "@/lib/colors";

const FAMILY_GRADIENTS: Record<string, string> = {
  Parakeet: "from-violet-600/40 to-fuchsia-600/20",
  Canary: "from-amber-500/40 to-orange-600/20",
  Kokoro: "from-rose-600/40 to-pink-600/20",
  Riva: "from-sky-500/40 to-cyan-600/20",
  Speech: "from-emerald-500/40 to-teal-600/20",
  TTS: "from-fuchsia-600/40 to-purple-600/20",
};

export default function PlaygroundPage() {
  const [task, setTask] = useState<"stt" | "tts">("stt");

  const { data: catalogRes } = usePoll(() => api.inferenceCatalog(), 60000);
  const runnableModels = useMemo(
    () => (catalogRes?.models ?? []).filter((m) => m.runnable && m.downloadable),
    [catalogRes]
  );

  const { data: deploymentsRes } = usePoll(() => api.deployments(), 15000);
  const deployments = deploymentsRes?.deployments ?? [];

  const deployedByModel = useMemo(() => {
    const map = new Map<string, Deployment[]>();
    for (const d of deployments) {
      const arr = map.get(d.nim_id) ?? [];
      arr.push(d);
      map.set(d.nim_id, arr);
    }
    return map;
  }, [deployments]);

  // A model is available locally if it is runnable AND deployed somewhere.
  const localByModel = useMemo(() => {
    const set = new Set<string>();
    for (const m of runnableModels) {
      if ((deployedByModel.get(m.nim_id) ?? []).length > 0) set.add(m.nim_id);
    }
    return set;
  }, [runnableModels, deployedByModel]);

  const taskModels = useMemo(() => {
    const all = catalogRes?.models ?? [];
    return all.filter((m) => (m.task ?? "stt") === task);
  }, [catalogRes, task]);

  // Every model selectable for the current task: either local-capable or API-capable.
  const targetModels = useMemo(
    () => taskModels.filter((m) => localByModel.has(m.nim_id) || m.api_supported),
    [taskModels, localByModel]
  );

  const [selectedTargets, setSelectedTargets] = useState<Map<string, Set<string>>>(new Map());
  const [cloudTargets, setCloudTargets] = useState<Set<string>>(new Set());
  const [textInput, setTextInput] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFileName, setAudioFileName] = useState<string>("");
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
      ["queued", "uploading", "downloading_model", "inferring", "installing_runtime"].includes(t.status)
    );

  const { data: historyRes } = usePoll(() => api.listRuns(), 10000);

  function pickFile(f: File | null) {
    if (!f) return;
    setAudioFile(f);
    setAudioFileName(f.name.replace(/\.[^.]+$/, ""));
    setDuration(0);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(URL.createObjectURL(f));
  }

  function toggleLocal(nimId: string) {
    // Selecting/managing the local (download) delivery for a model.
    setSelectedTargets((prev) => {
      const next = new Map(prev);
      const machines = deployedByModel.get(nimId) ?? [];
      if (next.has(nimId)) {
        next.delete(nimId);
      } else {
        next.set(nimId, new Set(machines.map((d) => d.machine_id)));
      }
      return next;
    });
  }

  function toggleCloud(nimId: string) {
    setCloudTargets((prev) => {
      const next = new Set(prev);
      if (next.has(nimId)) next.delete(nimId);
      else next.add(nimId);
      return next;
    });
  }

  function toggleMachine(nimId: string, machineId: string) {
    setSelectedTargets((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(nimId) ?? []);
      if (current.has(machineId)) current.delete(machineId);
      else current.add(machineId);
      if (current.size === 0) next.delete(nimId);
      else next.set(nimId, current);
      return next;
    });
  }

  const totalTargets = useMemo(() => {
    let n = 0;
    for (const ids of selectedTargets.values()) n += ids.size;
    n += cloudTargets.size;
    return n;
  }, [selectedTargets, cloudTargets]);

  async function start() {
    if (task === "stt") {
      if (!audioFile) return;
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
        const targets = buildTargets();
        const name = audioFileName.trim() || audioFile.name;
        const res = await api.createMultiRun(audioFile, targets, dur, name);
        setRunId(res.run_id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      setBusy(false);
      return;
    }

    // TTS
    if (!textInput.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const targets = buildTargets();
      const res = await api.createTtsRun(
        textInput,
        targets,
        "download",
        audioFileName.trim() || ""
      );
      setRunId(res.run_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  function buildTargets(): {
    model_id: string;
    machine_ids: string[];
    delivery: "download" | "api";
    task_type: "stt" | "tts";
  }[] {
    const out: { model_id: string; machine_ids: string[]; delivery: "download" | "api"; task_type: "stt" | "tts" }[] = [];
    for (const [model_id, machine_ids] of selectedTargets.entries()) {
      if (machine_ids.size === 0) continue;
      out.push({
        model_id,
        machine_ids: [...machine_ids],
        delivery: "download",
        task_type: task,
      });
    }
    for (const model_id of cloudTargets) {
      out.push({ model_id, machine_ids: [], delivery: "api", task_type: task });
    }
    return out;
  }

  async function stopRun() {
    if (!runId) return;
    try {
      await api.stopRun(runId);
    } catch {}
  }

  async function deleteRun(id: string) {
    if (!window.confirm("Delete this run from history?")) return;
    try {
      await api.deleteRun(id);
      if (runId === id) setRunId(null);
      setRunId((cur) => (cur === id ? null : cur));
    } catch {}
  }

  const tasks = liveRun?.tasks ?? [];
  const doneTasks = tasks.filter((t) => t.status === "done" && t.wall_ms);
  const fastestMs = doneTasks.length
    ? Math.min(...doneTasks.map((t) => t.wall_ms!))
    : null;
  const isMultiModel = tasks.length > 0 && new Set(tasks.map((t) => t.nim_id)).size > 1;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex items-center gap-2.5">
        <AudioLines className="h-6 w-6 text-violet-400" />
        <h1 className="text-2xl font-semibold tracking-tight">Inference Playground</h1>
      </header>
      <p className="mt-1 text-sm text-zinc-400">
        Select models &amp; machines, upload audio, compare transcripts and speed across your fleet.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <Radio className="h-4 w-4 text-violet-300" /> Task
            </h2>
            <div className="inline-flex overflow-hidden rounded-lg border border-white/10">
              <button
                onClick={() => { setTask("stt"); setSelectedTargets(new Map()); setCloudTargets(new Set()); }}
                className={`px-3 py-1.5 text-xs font-semibold ${
                  task === "stt" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                STT
              </button>
              <button
                onClick={() => { setTask("tts"); setSelectedTargets(new Map()); setCloudTargets(new Set()); }}
                className={`px-3 py-1.5 text-xs font-semibold ${
                  task === "tts" ? "bg-fuchsia-600 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                TTS
              </button>
            </div>
          </div>

          {task === "stt" ? (
            <>
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
                <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <FileAudio className="h-4 w-4 shrink-0 text-emerald-300" />
                    <span className="text-[10px] uppercase tracking-wide text-zinc-500">audio file</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={audioFileName}
                      onChange={(e) => setAudioFileName(e.target.value)}
                      placeholder="recording name"
                      className="flex-1 rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-xs text-zinc-200 placeholder-zinc-600 focus:border-violet-400/50 focus:outline-none"
                    />
                    <span className="text-[11px] text-zinc-500">
                      {audioFile.name.split(".").pop()?.toUpperCase()} · {(audioFile.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                  {audioUrl && (
                    <audio controls src={audioUrl} className="mt-2 h-8 w-full" />
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="mt-4 rounded-lg border border-fuchsia-400/20 bg-fuchsia-400/5 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <AudioLines className="h-4 w-4 shrink-0 text-fuchsia-300" />
                <span className="text-[10px] uppercase tracking-wide text-zinc-500">text to speak</span>
              </div>
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Type some text to synthesize…"
                rows={5}
                className="mt-2 w-full resize-y rounded border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs text-zinc-200 placeholder-zinc-600 focus:border-violet-400/50 focus:outline-none"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={audioFileName}
                  onChange={(e) => setAudioFileName(e.target.value)}
                  placeholder="output name"
                  className="flex-1 min-w-32 rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-xs text-zinc-200 placeholder-zinc-600 focus:border-fuchsia-400/50 focus:outline-none"
                />
                <span className="text-[10px] text-zinc-500">
                  choose Local and/or Cloud per model below
                </span>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Wrench className="h-4 w-4 text-violet-300" /> Models &amp; targets
          </h2>

          <div className="mt-4 space-y-2">
            {targetModels.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No {task === "stt" ? "STT" : "TTS"} models available.{" "}
                <Link href="/models" className="text-violet-300">Deploy local models</Link>{" "}
                or add an NVIDIA API key to unlock cloud models.
              </p>
            ) : (
              targetModels.map((m) => {
                const deps = deployedByModel.get(m.nim_id) ?? [];
                const hasLocal = localByModel.has(m.nim_id);
                const hasCloud = !!m.api_supported;
                const localSelected = selectedTargets.has(m.nim_id);
                const cloudSelected = cloudTargets.has(m.nim_id);
                const selectedMachines = selectedTargets.get(m.nim_id) ?? new Set();
                return (
                  <div
                    key={m.nim_id}
                    className={`rounded-lg border p-3 transition-all ${
                      localSelected || cloudSelected
                        ? "border-violet-400/50 bg-violet-400/10"
                        : "border-white/10 bg-white/[0.02]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={`h-2 w-2 shrink-0 rounded-full bg-gradient-to-br ${
                            FAMILY_GRADIENTS[m.family] ?? "from-zinc-400 to-zinc-600"
                          }`}
                        />
                        <span className="truncate font-mono text-xs font-medium">{m.nim_id}</span>
                      </div>
                      <span className="shrink-0 text-[10px] text-zinc-500">
                        {m.size_gb != null ? `${m.size_gb} GB` : m.api_supported ? "cloud" : ""}
                      </span>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {hasLocal && (
                        <span
                          onClick={() => toggleLocal(m.nim_id)}
                          className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                            localSelected
                              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                              : "border-white/15 text-zinc-500 hover:border-white/30"
                          }`}
                        >
                          Local
                          {localSelected ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/50" />
                          )}
                        </span>
                      )}
                      {hasCloud && (
                        <span
                          onClick={() => toggleCloud(m.nim_id)}
                          className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                            cloudSelected
                              ? "border-sky-400/40 bg-sky-400/10 text-sky-300"
                              : "border-white/15 text-zinc-500 hover:border-white/30"
                          }`}
                        >
                          ☁ API
                          {cloudSelected && <CheckCircle2 className="h-3 w-3" />}
                        </span>
                      )}
                    </div>
                    {localSelected && (
                      <div className="mt-2 flex flex-wrap gap-1 border-t border-white/5 pt-2">
                        {deps.map((d) => (
                          <label
                            key={d.machine_id}
                            onClick={(e) => e.stopPropagation()}
                            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                              selectedMachines.has(d.machine_id)
                                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                                : "border-white/10 text-zinc-500 hover:border-white/25"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedMachines.has(d.machine_id)}
                              onChange={() => toggleMachine(m.nim_id, d.machine_id)}
                              className="sr-only"
                            />
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: colorForMachine(d.machine_id) }}
                            />
                            {d.machine_name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {error && (
            <p className="mt-4 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-300">{error}</p>
          )}

          <button
            onClick={start}
            disabled={
              busy ||
              (task === "stt" ? !audioFile : !textInput.trim()) ||
              totalTargets === 0 ||
              running
            }
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold hover:bg-violet-500 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {task === "stt" ? "Run parallel inference" : "Synthesize speech"} ({totalTargets})
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
            <span className="ml-auto flex items-center gap-2">
              {running && (
                <button
                  onClick={stopRun}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-1.5 text-[11px] font-medium text-red-300 transition-colors hover:bg-red-400/20"
                >
                  <Square className="h-3 w-3" /> Stop run
                </button>
              )}
              <button
                onClick={() => runId && deleteRun(runId)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-zinc-400 transition-colors hover:border-red-400/30 hover:bg-red-400/10 hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" /> delete
              </button>
            </span>
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
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colorForMachine(t.machine_id) }} />
                      <span className="truncate text-sm font-medium">{t.machine_name}</span>
                      {isMultiModel && (
                        <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">
                          {t.nim_id}
                        </span>
                      )}
                    </div>
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
                    </div>
                  )}
                  {t.status === "installing_runtime" && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Installing {t.task_type === "tts" ? "TTS" : "ASR"} runtime on {t.machine_name}…
                    </div>
                  )}
                  {t.phase && !t.transcript && t.status !== "failed" && (
                    <p className="mt-2 text-[11px] text-zinc-500">{t.phase}</p>
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
                  {t.audio_out && (
                    <div className="mt-3 rounded-lg border border-fuchsia-400/20 bg-fuchsia-400/5 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
                          <AudioLines className="h-3 w-3 text-fuchsia-300" /> generated audio
                        </span>
                        <a
                          href={audioOutUrl(t.id)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-fuchsia-300 hover:text-fuchsia-200"
                        >
                          <Download className="h-3 w-3" /> save
                        </a>
                      </div>
                      <audio controls src={audioOutUrl(t.id)} className="mt-2 h-8 w-full" />
                    </div>
                  )}
                  {t.log_text && (
                    <details className="group mt-3 rounded-lg border border-white/10 bg-black/25">
                      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-[11px] font-medium text-zinc-400 hover:text-zinc-200">
                        <span className="transition-transform group-open:rotate-90">▸</span>
                        process log
                        <span className="ml-auto text-[10px] text-zinc-600">
                          {t.log_text.trim().split("\n").length} lines
                        </span>
                      </summary>
                      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words border-t border-white/10 p-3 font-mono text-[10px] leading-relaxed text-zinc-400">
                        {t.log_text}
                      </pre>
                    </details>
                  )}
                  {(t.status === "uploading" || t.status === "downloading_model" || t.status === "inferring" || t.status === "queued" || t.status === "installing_runtime") && (
                    <div className="mt-3">
                      <div className="h-1 overflow-hidden rounded-full bg-white/10">
                        {t.progress_pct != null ? (
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-violet-400 to-sky-400 transition-all duration-700"
                            style={{ width: `${Math.max(3, t.progress_pct)}%` }}
                          />
                        ) : (
                          <div className="h-full w-1/3 animate-pulse rounded-full bg-violet-400" />
                        )}
                      </div>
                      {t.progress_pct != null && (
                        <p className="mt-1 text-right text-[10px] font-mono text-zinc-500">
                          {t.progress_pct.toFixed(0)}%
                        </p>
                      )}
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
            {historyRes!.runs.map((r) => {
              const modelLabel =
                r.model_ids && r.model_ids.length > 1
                  ? `multi (${r.model_ids.length} models)`
                  : r.model_id;
              return (
                <div
                  key={r.id}
                  className={`flex items-stretch gap-0 rounded-lg border ${
                    r.id === runId
                      ? "border-violet-400/40 bg-violet-400/10"
                      : "border-white/10 hover:bg-white/5"
                  }`}
                >
                  <button
                    onClick={() => setRunId(r.id)}
                    className="flex w-full flex-wrap items-center gap-3 px-3 py-2 text-left text-xs"
                  >
                    <Mic className="h-3 w-3 text-zinc-600" />
                    <span className="font-medium">{modelLabel}</span>
                    <span className="truncate text-zinc-500">{r.audio_name}</span>
                    {r.status === "cancelled" && (
                      <span className="rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-[9px] text-zinc-400">
                        cancelled
                      </span>
                    )}
                    <span className="ml-auto text-zinc-600">
                      {r.done}/{r.machines.length} · {new Date(r.created_at).toLocaleTimeString()}
                    </span>
                  </button>
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
    </main>
  );
}

function TaskChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    done: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
    failed: "text-red-300 border-red-400/30 bg-red-400/10",
    inferring: "text-sky-300 border-sky-400/30 bg-sky-400/10",
    uploading: "text-violet-300 border-violet-400/30 bg-violet-400/10",
    downloading_model: "text-amber-300 border-amber-400/30 bg-amber-400/10",
    installing_runtime: "text-amber-300 border-amber-400/30 bg-amber-400/10",
    queued: "text-zinc-400 border-white/20 bg-white/5",
    cancelled: "text-zinc-400 border-zinc-500/30 bg-zinc-500/10",
  };
  const labels: Record<string, string> = {
    downloading_model: "downloading",
    installing_runtime: "installing",
    cancelled: "cancelled",
  };
  const icon =
    status === "done" ? (
      <CheckCircle2 className="h-3 w-3" />
    ) : status === "failed" ? (
      <XCircle className="h-3 w-3" />
    ) : status === "cancelled" ? (
      <X className="h-3 w-3" />
    ) : (
      <Loader2 className="h-3 w-3 animate-spin" />
    );
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${map[status] ?? map.queued}`}
    >
      {icon} {labels[status] ?? status.replace("_", " ")}
    </span>
  );
}
