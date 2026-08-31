"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileAudio,
  FileText,
  Loader2,
  Trash2,
  Download,
  Clock,
  Zap,
} from "lucide-react";
import type { MachineFile } from "@/lib/api";
import { api, audioUrl, relTime, transcriptUrl } from "@/lib/api";
import { InlineRename } from "@/components/InlineRename";

export function MachineFiles({ machineId }: { machineId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [files, setFiles] = useState<MachineFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await api.machineFiles(machineId);
      setFiles(res.files);
    } catch {}
  }, [machineId]);

  async function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    setLoading(true);
    await load();
    setLoading(false);
  }

  useEffect(() => {
    if (!expanded) return;
    const id = setInterval(() => void load(), 10000);
    return () => clearInterval(id);
  }, [expanded, load]);

  function toggleFile(taskId: string) {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  async function del(f: MachineFile) {
    if (!window.confirm(`Delete "${f.audio_name || f.audio_file}" from this machine?`)) return;
    try {
      await api.deleteTask(f.task_id);
      setExpandedFiles((prev) => {
        const next = new Set(prev);
        next.delete(f.task_id);
        return next;
      });
      await load();
    } catch {}
  }

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02]">
      <button
        onClick={toggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
      >
        <FileAudio className="h-3.5 w-3.5 text-violet-300" />
        <span className="font-medium text-zinc-300">Files</span>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-zinc-400">
          {loading ? "..." : files.length}
        </span>
        <span className="ml-auto text-zinc-500">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-white/10 px-3 py-2">
          {files.length === 0 ? (
            <p className="text-[11px] text-zinc-600">No audio processed on this machine yet.</p>
          ) : (
            <div className="space-y-2">
              {files.map((f) => {
                const isOpen = expandedFiles.has(f.task_id);
                const statusColor =
                  f.status === "done"
                    ? "text-emerald-300"
                    : f.status === "failed"
                      ? "text-red-300"
                      : "text-zinc-400";
                const statusBg =
                  f.status === "done"
                    ? "border-emerald-400/30 bg-emerald-400/10"
                    : f.status === "failed"
                      ? "border-red-400/30 bg-red-400/10"
                      : "border-zinc-500/30 bg-zinc-500/10";

                return (
                  <div
                    key={f.task_id}
                    className="rounded-md border border-white/[0.06] bg-black/20"
                  >
                    {/* Header row - clickable */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleFile(f.task_id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleFile(f.task_id);
                        }
                      }}
                      className="flex w-full cursor-pointer select-none items-center gap-2 px-2.5 py-2 text-left"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" />
                      ) : (
                        <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />
                      )}
                      <FileAudio className="h-3 w-3 shrink-0 text-violet-300" />
                      <span
                        className="min-w-0 flex-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <InlineRename
                          value={f.audio_name || f.audio_file || "unknown"}
                          onSave={async (name) => {
                            await api.renameRun(f.run_id, name);
                            await load();
                          }}
                          className="flex-1 truncate text-[11px] font-medium text-zinc-300"
                        />
                      </span>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] ${statusBg} ${statusColor}`}>
                        {f.status}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-[10px] text-zinc-600">
                        <Clock className="h-2.5 w-2.5" />
                        {relTime(f.created_at)}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          del(f);
                        }}
                        title="Delete"
                        className="shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-red-400/10 hover:text-red-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Expanded content */}
                    {isOpen && (
                      <div className="border-t border-white/[0.04] px-2.5 py-2.5">
                        {/* Input section */}
                        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-zinc-500">
                          <FileAudio className="h-3 w-3" />
                          Input audio
                        </div>
                        <audio
                          controls
                          preload="none"
                          src={audioUrl(f.run_id)}
                          className="mt-1.5 h-8 w-full"
                        />

                        {/* Output section */}
                        {f.transcript ? (
                          <div className="mt-3">
                            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-zinc-500">
                              <FileText className="h-3 w-3" />
                              Response output
                              <Zap className="h-2.5 w-2.5 text-violet-400" />
                              <span className="text-[9px] normal-case tracking-normal text-violet-300/80">
                                {f.model_id}
                              </span>
                              {f.wall_ms != null && (
                                <span className="ml-auto text-[9px] normal-case text-zinc-600">
                                  {(f.wall_ms / 1000).toFixed(1)}s
                                </span>
                              )}
                            </div>
                            <pre className="mt-1 max-h-36 overflow-auto rounded bg-black/30 p-2 font-mono text-[10px] leading-snug text-zinc-300">
                              {f.transcript}
                            </pre>
                            <a
                              href={transcriptUrl(f.task_id)}
                              download
                              onClick={(e) => e.stopPropagation()}
                              className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-violet-300/70 hover:text-violet-200"
                            >
                              <Download className="h-2.5 w-2.5" />
                              download .txt
                            </a>
                          </div>
                        ) : f.error ? (
                          <div className="mt-2">
                            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-red-400/60">
                              <Zap className="h-3 w-3" />
                              Error
                            </div>
                            <p className="mt-1 text-[10px] text-red-300/80">{f.error}</p>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
