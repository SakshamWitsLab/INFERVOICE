"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Activity, Cpu, Gauge, Globe2, HardDrive, Loader2, MemoryStick,
  Plus, WifiOff,
} from "lucide-react";
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

  const latest = history[history.length - 1] ?? [];
  const onlineCount = latest.filter((e) => e.sample).length;

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

  const labelsMap = Object.fromEntries(machines.map((m) => [m.id, m.name]));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
            <Activity className="h-6 w-6 text-violet-400" /> Fleet Monitor
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Live system metrics across your Mac fleet.
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
          {/* Machine cards grid */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {machines.map((m) => {
              const entry = latest.find((x) => x.machine_id === m.id);
              const s = entry?.sample;
              const live = !!s;
              return (
                <Link
                  key={m.id}
                  href={`/machines/${m.id}`}
                  className="group rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:bg-white/[0.06]"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${live ? "animate-pulse" : "opacity-30"}`}
                      style={{ backgroundColor: m.color }}
                    />
                    <span className="font-medium text-zinc-200">{m.name}</span>
                    {!live && <span className="ml-auto text-[11px] text-zinc-600">offline</span>}
                  </div>

                  {s && (
                    <div className="mt-3 space-y-2.5">
                      <MetricBar
                        label="CPU"
                        icon={<Cpu className="h-3 w-3" />}
                        value={s.cpu_pct}
                        max={100}
                        unit="%"
                        color="violet"
                      />
                      <MetricBar
                        label="Memory"
                        icon={<MemoryStick className="h-3 w-3" />}
                        value={s.mem_pct}
                        max={100}
                        unit="%"
                        color="sky"
                      />
                      <MetricBar
                        label="Disk"
                        icon={<HardDrive className="h-3 w-3" />}
                        value={entry?.disk_pct ?? null}
                        max={100}
                        unit="%"
                        color="zinc"
                      />
                      <div className="flex items-center gap-4 pt-1 text-[10px] text-zinc-500">
                        <span className="flex items-center gap-1">
                          <Globe2 className="h-3 w-3 text-emerald-400" />
                          {s.net_rx_kbps != null ? fmtKb(s.net_rx_kbps) : "—"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Globe2 className="h-3 w-3 text-amber-400" />
                          {s.net_tx_kbps != null ? fmtKb(s.net_tx_kbps) : "—"}
                        </span>
                      </div>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>

          {/* Charts */}
          <div className="mt-8 space-y-3">
            <Chart
              title="CPU usage"
              icon={<Gauge className="h-4 w-4 text-violet-300" />}
              series={seriesFor((s) => s.cpu_pct)}
              fixedMax={100}
              unit="%"
              labels={labelsMap}
            />
            <Chart
              title="Memory"
              icon={<MemoryStick className="h-4 w-4 text-sky-300" />}
              series={seriesFor((s) => s.mem_pct)}
              fixedMax={100}
              unit="%"
              labels={labelsMap}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Chart
                title="Network ↓ receive"
                icon={<Globe2 className="h-4 w-4 text-emerald-300" />}
                series={seriesFor((s) => s.net_rx_kbps)}
                unit=" KB/s"
                labels={labelsMap}
              />
              <Chart
                title="Network ↑ send"
                icon={<Globe2 className="h-4 w-4 text-amber-300" />}
                series={seriesFor((s) => s.net_tx_kbps)}
                unit=" KB/s"
                labels={labelsMap}
              />
            </div>
            <Chart
              title="Disk used"
              icon={<HardDrive className="h-4 w-4 text-zinc-300" />}
              series={diskSeries()}
              fixedMax={100}
              unit="%"
              hint="updates with spec refresh"
              labels={labelsMap}
            />
          </div>
        </>
      )}
    </main>
  );
}

function MetricBar({
  label,
  icon,
  value,
  max,
  unit,
  color,
}: {
  label: string;
  icon: React.ReactNode;
  value: number | null;
  max: number;
  unit: string;
  color: "violet" | "sky" | "zinc";
}) {
  const pct = value != null ? Math.min((value / max) * 100, 100) : 0;
  const barColor =
    color === "violet"
      ? "bg-violet-500"
      : color === "sky"
        ? "bg-sky-500"
        : "bg-zinc-500";
  const trackColor =
    color === "violet"
      ? "bg-violet-500/15"
      : color === "sky"
        ? "bg-sky-500/15"
        : "bg-zinc-500/15";

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px]">
        <span className="flex items-center gap-1 text-zinc-500">
          {icon} {label}
        </span>
        <span className="font-mono text-zinc-400">
          {value != null ? `${value.toFixed(1)}${unit}` : "—"}
        </span>
      </div>
      <div className={`h-1.5 overflow-hidden rounded-full ${trackColor}`}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
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
  labels,
}: {
  title: string;
  icon: React.ReactNode;
  series: SeriesDef[];
  fixedMax?: number;
  unit: string;
  hint?: string;
  labels?: Record<string, string>;
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
      <MultiLine series={series} fixedMax={fixedMax} height={130} labels={labels} />
    </section>
  );
}

function fmtKb(v: number): string {
  if (v >= 1024) return `${(v / 1024).toFixed(1)} MB/s`;
  return `${v.toFixed(1)} KB/s`;
}
