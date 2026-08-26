"use client";

import Link from "next/link";
import { Plus, Server } from "lucide-react";
import { api, type Machine } from "@/lib/api";
import { usePoll } from "@/hooks/usePoll";
import { MachineCard } from "@/components/MachineCard";

export default function Dashboard() {
  const { data: machines, reload } = usePoll<Machine[]>(api.listMachines, 5000);

  const total = machines?.length ?? 0;
  const online = machines?.filter((m) => m.status === "online").length ?? 0;
  const issues = machines?.filter((m) => m.status === "auth_error").length ?? 0;

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
        <Link
          href="/add"
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
        >
          <Plus className="h-4 w-4" /> Add machine
        </Link>
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
        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {machines!.map((m) => (
            <MachineCard key={m.id} machine={m} onChanged={reload} />
          ))}
        </section>
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
