"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Activity, Gauge, Globe2, HardDrive, Loader2, MemoryStick, Plus, WifiOff } from "lucide-react";
import { api, type FleetEntry, type MetricSample } from "@/lib/api";
import { colorForMachine } from "@/lib/colors";
import { useMetricStream } from "@/hooks/useMetricStream";
import { MultiLine, type SeriesDef } from "@/components/MultiLine";

const POLL_MS = 3000;

type MetricKey = "cpu_pct" | "mem_pct" | "net_rx_kbps" | "net_tx_kbps";

export default function MonitorPage() {
  const { history, status, error } = useMetricStream<FleetEntry[]>(
    () => api.fleetMetrics(),
    POLL_MS,
    "fleet"
  );

  const machines = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string }>();
    for (const snap of history) {
      for (const e of snap) {
        if (!map.has(e.machine_id)) {
          map.set(e.machine_id, {
            id: e.machine_id,
            name: e.name,
            color: colorForMachine(e.machine_id),
          });
        }
      }
    }
    return [...map.values()];
  }, [history]);

  const seriesFor = (get: (s: MetricSample) => number | null): SeriesDef[] =>
    machines.map((m) => ({
      id: m.id,
      color: m.color,
      data: history.map((snap) => {
        const e = snap.find((x) => x.machine_id === m.id);
        return e?.sample ? get(e.sample) : null;
      }),
    }));

  const diskSeries = (): SeriesDef[] =>
    machines.map((m) => ({
      id: m.id,
      color: m.color,
      data: history.map((snap) => snap.find((x) => x.machine_id === m.id)?.disk_pct ?? null),
    }));

  const latest = history[history.length - 1] ?? [];
  const onlineCount = latest.filter((e) => e.sample).length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
            <Activity className="h-6 w-6 text-violet-400" /> Fleet Monitor
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            All systems on one graph — each machine keeps its own color.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          {status === "loading" && (
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> sampling…
            </span>
          )}
          {status === "live" && (
            <>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                live · every {POLL_MS / 1000}s
              </span>
              <span>
                {onlineCount}/{machines.length} online
              </span>
            </>
          )}
          {status === "error" && (
            <span className="flex items-center gap-1.5 text-red-400">
              <WifiOff className="h-3 w-3" /> retrying — {error}
            </span>
          )}
          <Link
            href="/add"
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-medium hover:bg-white/10"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Link>
        </div>
      </header>

      {machines.length === 0 ? (
        <div className="mt-16 flex flex-col items-center rounded-xl border border-dashed border-white/10 py-20 text-center">
          <Activity className="h-10 w-10 text-zinc-600" />
          <p className="mt-4 text-sm text-zinc-500">Waiting for the first sample…</p>
          <Link href="/add" className="mt-4 text-sm text-violet-300 hover:text-violet-200">
            Add a Mac →
          </Link>
        </div>
      ) : (
        <>
          <Legend machines={machines} latest={latest} />

          <div className="mt-6 space-y-4">
            <Chart
              title="CPU usage"
              icon={<Gauge className="h-4 w-4 text-violet-300" />}
              series={seriesFor((s) => s.cpu_pct)}
              fixedMax={100}
              unit="%"
            />
            <Chart
              title="Memory"
              icon={<MemoryStick className="h-4 w-4 text-sky-300" />}
              series={seriesFor((s) => s.mem_pct)}
              fixedMax={100}
              unit="%"
            />
            <Chart
              title="Network ↓ receive"
              icon={<Globe2 className="h-4 w-4 text-emerald-300" />}
              series={seriesFor((s) => s.net_rx_kbps)}
              unit=" KB/s"
            />
            <Chart
              title="Network ↑ send"
              icon={<Globe2 className="h-4 w-4 text-amber-300" />}
              series={seriesFor((s) => s.net_tx_kbps)}
              unit=" KB/s"
            />
            <Chart
              title="Disk used"
              icon={<HardDrive className="h-4 w-4 text-zinc-300" />}
              series={diskSeries()}
              fixedMax={100}
              unit="%"
              hint="updates with each machine's spec refresh"
            />
          </div>
        </>
      )}
    </main>
  );
}

function Legend({
  machines,
  latest,
}: {
  machines: { id: string; name: string; color: string }[];
  latest: FleetEntry[];
}) {
  return (
    <div className="mt-6 flex flex-wrap gap-2">
      {machines.map((m) => {
        const e = latest.find((x) => x.machine_id === m.id);
        const cpu = e?.sample?.cpu_pct;
        const live = !!e?.sample;
        return (
          <Link
            key={m.id}
            href={`/machines/${m.id}`}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs hover:bg-white/[0.06]"
          >
            <span
              className={`h-2 w-2 rounded-full ${live ? "" : "opacity-30"}`}
              style={{ backgroundColor: m.color }}
            />
            <span className="font-medium">{m.name}</span>
            {cpu != null && <span className="font-mono text-zinc-500">{cpu.toFixed(0)}%</span>}
            {!live && <span className="text-zinc-600">offline</span>}
          </Link>
        );
      })}
    </div>
  );
}

function Chart({
  title,
  icon,
  series,
  fixedMax,
  unit,
  hint,
}: {
  title: string;
  icon: React.ReactNode;
  series: SeriesDef[];
  fixedMax?: number;
  unit: string;
  hint?: string;
}) {
  const values = series.flatMap((s) => s.data);
  const lastVal = [...values].reverse().find((v) => v != null) ?? null;
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          {icon} {title}
        </h2>
        <span className="text-xs text-zinc-500">
          {lastVal != null
            ? unit === "%"
              ? `${lastVal.toFixed(1)}%`
              : `${fmtKb(lastVal)}`
            : ""}
          {hint && <span className="ml-2 italic text-zinc-600">{hint}</span>}
        </span>
      </div>
      <MultiLine series={series} fixedMax={fixedMax} height={130} />
    </section>
  );
}

function fmtKb(v: number): string {
  if (v >= 1024) return `${(v / 1024).toFixed(1)} MB/s`;
  return `${v.toFixed(1)} KB/s`;
}
