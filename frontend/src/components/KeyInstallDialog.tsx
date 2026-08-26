"use client";

import { useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";

export function KeyInstallDialog({
  machineId,
  machineName,
  onDone,
  onClose,
}: {
  machineId: string;
  machineName: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.installKey(machineId, password);
      onDone();
      onClose();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-white/10 bg-zinc-900 p-6 shadow-2xl"
      >
        <div className="flex items-center gap-2.5">
          <KeyRound className="h-5 w-5 text-violet-400" />
          <h2 className="font-semibold">Install SSH key on {machineName}</h2>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Enter the macOS account password once. The control center&apos;s public key will be added to{" "}
          <code className="rounded bg-white/5 px-1 py-0.5 text-xs">~/.ssh/authorized_keys</code> and the password
          discarded immediately.
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Account password"
          autoFocus
          required
          className="mt-4 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-violet-400/60"
        />
        {error && (
          <p className="mt-3 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-300">{error}</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm hover:bg-white/5"
          >
            Later
          </button>
          <button
            type="submit"
            disabled={busy || !password}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold hover:bg-violet-500 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Install key
          </button>
        </div>
      </form>
    </div>
  );
}
