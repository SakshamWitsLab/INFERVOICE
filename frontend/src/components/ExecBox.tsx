"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { api, type ExecResult } from "@/lib/api";

export function ExecBox({ machineId }: { machineId: string }) {
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExecResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!cmd.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.execCommand(machineId, cmd.trim()));
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <form onSubmit={run} className="flex gap-2">
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder="one-shot command, e.g. top -l 1 -n 5 | head -20"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm outline-none placeholder:text-zinc-600 focus:border-violet-400/60"
        />
        <button
          type="submit"
          disabled={busy || !cmd.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-semibold hover:bg-violet-500 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run
        </button>
      </form>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      {result && (
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 text-xs leading-relaxed text-zinc-300">
          {result.stdout}
          {result.stderr && <span className="text-red-300">{result.stderr}</span>}
          <span className="mt-2 block text-zinc-600">
            exit {result.exit_code ?? "timeout"} · {result.duration_ms}ms
          </span>
        </pre>
      )}
    </div>
  );
}
