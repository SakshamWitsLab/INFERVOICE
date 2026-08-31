"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";

export function InlineRename({
  value,
  onSave,
  className = "",
}: {
  value: string;
  onSave: (next: string) => void | Promise<void>;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  async function save() {
    const next = draft.trim();
    if (!next || next === value) {
      setEditing(false);
      setDraft(value);
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      setDraft(value);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
          className="w-40 rounded border border-white/15 bg-black/30 px-1.5 py-0.5 font-mono text-[11px] text-zinc-200 focus:border-violet-400/50 focus:outline-none"
        />
        <button
          onClick={() => void save()}
          title="Save"
          className="shrink-0 rounded p-0.5 text-emerald-400 hover:bg-emerald-400/10"
        >
          <Check className={`h-3 w-3 ${busy ? "animate-pulse" : ""}`} />
        </button>
        <button
          onClick={() => {
            setDraft(value);
            setEditing(false);
          }}
          title="Cancel"
          className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-white/10"
        >
          <X className="h-3 w-3" />
        </button>
      </span>
    );
  }

  return (
    <span className={`group/name inline-flex min-w-0 items-center gap-1 ${className}`}>
      <span className="truncate">{value}</span>
      <button
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        title="Rename"
        className="shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity hover:bg-white/10 hover:text-zinc-300 group-hover/name:opacity-100"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </span>
  );
}
