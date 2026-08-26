"use client";

import { useMemo } from "react";
import { Activity, Loader2, WifiOff } from "lucide-react";
import { api, type MetricSample } from "@/lib/api";
import { useMetricStream } from "@/hooks/useMetricStream";
import { Sparkline } from "@/components/Sparkline";

const POLL_MS = 2000;

export function LiveMetrics({ machineId, online }: { machineId: string; online: boolean }) {
  const { history, status, error } = useMetricStream<MetricSample>(
    () => api.getMetrics(machineId),
    POLL_MS,
    machineId
  );

  const series = useMemo(() => {
    const pick = (get: (s: MetricSample) => number | null) =>
      history.map((s) => get(s));
    return {
      cpu: pick((s) => s.cpu_pct),
      mem: pick((s) => s.mem_pct),
      rx: pick((s) => s.net_rx_kbps),
      tx: pick((s) => s.net_tx_kbps),
    };
  }, [history]);

  if (!online && status === "error") {
    return (
      <section className="mt-4 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-6 text-sm text-zinc-500">
        <WifiOff className="h-4 w-4" />
        Monitoring unavailable — machine must be online.
      </section>
    );
  }

  const latest = history[history.length - 1];

  return (
    <section className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Activity className="h-4 w-4 text-violet-300" /> Live monitoring
        </h2>
        <span className="flex items-center gap-3 text-[11px] text-zinc-500">
          {status === "loading" && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> sampling…
            </>
          )}
          {status === "live" && (
            <>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> live · every {POLL_MS / 1000}s
              </span>
              {latest && (
                <span className="font-mono">
                  cpu {latest.cpu_pct.toFixed(0)}% · mem {latest.mem_pct.toFixed(0)}%
                  {latest.net_rx_kbps != null && ` · ↓${fmtRate(latest.net_rx_kbps)}`}
                </span>
              )}
            </>
          )}
          {status === "error" && (
            <>
              <span className="flex items-center gap-1.5 text-red-400">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" /> retrying
              </span>
              <span className="max-w-[280px] truncate">{error}</span>
            </>
          )}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ChartCard label="CPU" value={lastOf(series.cpu)} unit="%" color="#a78bfa" data={series.cpu} />
        <ChartCard label="Memory" value={lastOf(series.mem)} unit="%" color="#38bdf8" data={series.mem} />
        <ChartCard label="Net ↓" value={lastOf(series.rx)} unit=" KB/s" color="#34d399" data={series.rx} autoScale />
        <ChartCard label="Net ↑" value={lastOf(series.tx)} unit=" KB/s" color="#fbbf24" data={series.tx} autoScale />
      </div>
    </section>
  );
}

function lastOf(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return null;
}

function fmtRate(v: number): string {
  if (v >= 1024) return `${(v / 1024).toFixed(1)}MB/s`;
  return `${v.toFixed(0)}KB/s`;
}

function ChartCard({
  label,
  value,
  unit,
  color,
  data,
  autoScale,
}: {
  label: string;
  value: number | null;
  unit: string;
  color: string;
  data: (number | null)[];
  autoScale?: boolean;
}) {
  const display = value == null ? "—" : unit === "%" ? `${value.toFixed(1)}%` : fmtRateLong(value);
  return (
    <div className="rounded-lg border border-white/5 bg-black/20 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-zinc-400">{label}</span>
        <span className="font-mono text-sm font-semibold" style={{ color }}>
          {display}
        </span>
      </div>
      <div className="mt-2">
        <Sparkline data={data} color={color} fixedMax={autoScale ? undefined : 100} />
      </div>
    </div>
  );
}

function fmtRateLong(v: number): string {
  if (v >= 1024) return `${(v / 1024).toFixed(1)} MB/s`;
  return `${v.toFixed(v >= 10 ? 0 : 1)} KB/s`;
}
