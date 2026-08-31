"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Download, Loader2, XCircle } from "lucide-react";
import type { InstallStatus, Machine } from "@/lib/api";
import { api } from "@/lib/api";

export function InstallAsrButton({ machine }: { machine: Machine }) {
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<InstallStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const running = status?.status === "queued" || status?.status === "running";
  const offline = machine.status !== "online" && machine.status !== "unknown";
  const done = status?.status === "done";
  const failed = status?.status === "failed";

  const stopPoll = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    let s: InstallStatus;
    try {
      s = await api.installRuntimeStatus(machine.id);
    } catch {
      stopPoll();
      return;
    }
    setStatus(s);
    if (s.status === "queued" || s.status === "running") {
      if (!timer.current) {
        timer.current = setInterval(() => {
          api
            .installRuntimeStatus(machine.id)
            .then((s2) => {
              setStatus(s2);
              if (s2.status === "done" || s2.status === "failed") stopPoll();
            })
            .catch(stopPoll);
        }, 2000);
      }
    } else {
      stopPoll();
    }
  }, [machine.id, stopPoll]);

  useEffect(() => {
    let cancelled = false;
    api
      .installRuntimeStatus(machine.id)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stopPoll();
    };
  }, [machine.id, stopPoll]);

  async function start() {
    setStarting(true);
    setExpanded(true);
    try {
      const res = await api.installAsrRuntime(machine.id);
      setStatus(res.job);
      await refresh();
    } catch {
      setStatus({
        machine_id: machine.id,
        status: "failed",
        ok: false,
        log_text: "",
        error: "Failed to start install",
        started_at: null,
        finished_at: null,
      });
    }
    setStarting(false);
  }

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02]">
      <div className="flex items-center gap-2 px-3 py-2">
        {(running || starting) && (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-300" />
        )}
        {done && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
        {failed && <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
        <button
          onClick={running ? () => setExpanded((e) => !e) : start}
          disabled={offline || running || starting}
          title={
            offline
              ? "Machine is offline"
              : done
                ? "Runtime already installed"
                : failed
                  ? "Retry installation"
                  : "Pre-install ASR runtime on this machine"
          }
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          {running || starting
            ? "Installing..."
            : done
              ? "ASR installed"
              : failed
                ? "Retry install"
                : "Pre-install ASR"}
        </button>
        {(running || status) && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="ml-auto flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500 hover:text-zinc-300"
          >
            {running ? "View progress" : "Details"}
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>

      {(expanded || running) && status && (
        <div className="border-t border-white/10 px-3 py-2">
          {done && <p className="text-[11px] text-emerald-300">Runtime ready — transcription will use it directly.</p>}
          {failed && (
            <p className="text-[11px] text-red-300">
              Install failed: {status.error || "unknown error"}
            </p>
          )}
          {running && <p className="text-[11px] text-sky-300">Installing on {machine.name}…</p>}
          {status.log_text ? (
            <pre className="mt-1.5 max-h-40 overflow-auto rounded-md bg-black/30 p-2 font-mono text-[10px] leading-snug text-zinc-400">
              {status.log_text}
            </pre>
          ) : (
            !done && !failed && (
              <pre className="mt-1.5 max-h-40 overflow-auto rounded-md bg-black/30 p-2 font-mono text-[10px] leading-snug text-zinc-500">
                Starting…
              </pre>
            )
          )}
        </div>
      )}
    </div>
  );
}