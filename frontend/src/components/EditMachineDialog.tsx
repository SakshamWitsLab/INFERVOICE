"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { api, type Machine } from "@/lib/api";

export function EditMachineDialog({
  machine,
  onClose,
  onSaved,
}: {
  machine: Machine;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(machine.name);
  const [root, setRoot] = useState(machine.models_root ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(machine.name);
    setRoot(machine.models_root ?? "");
  }, [machine]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.updateMachine(machine.id, {
        name: name.trim() || machine.name,
        models_root: root.trim(),
      });
      onSaved();
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
        onSubmit={save}
        className="w-full max-w-md rounded-xl border border-white/10 bg-zinc-900 p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Edit machine</h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-zinc-400">Display name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-violet-400/60"
          />
        </label>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-zinc-400">
            Models install path <span className="text-zinc-600">(optional, overrides global)</span>
          </span>
          <input
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            placeholder="~/infervoice_models"
            spellCheck={false}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 font-mono text-xs outline-none placeholder:text-zinc-600 focus:border-violet-400/60"
          />
          <span className="mt-1.5 block text-[11px] text-zinc-600">
            Downloads for this Mac land here instead of the global models folder.
          </span>
        </label>

        {error && (
          <p className="mt-3 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-300">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm hover:bg-white/5">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold hover:bg-violet-500 disabled:opacity-40"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </button>
        </div>
      </form>
    </div>
  );
}
