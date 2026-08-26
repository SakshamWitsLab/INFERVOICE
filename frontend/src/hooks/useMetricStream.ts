"use client";

import { useEffect, useRef, useState } from "react";

const MAX_HISTORY = 90;

export type StreamStatus = "loading" | "live" | "error";

export function useMetricStream<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  key: string
) {
  const [history, setHistory] = useState<T[]>([]);
  const [status, setStatus] = useState<StreamStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setHistory([]);
    setStatus("loading");
    setError(null);

    const sleep = (ms: number) =>
      new Promise<void>((r) => {
        timer = setTimeout(r, ms);
      });

    async function loop() {
      while (!cancelled) {
        if (typeof document !== "undefined" && document.hidden) {
          await sleep(800);
          continue;
        }
        try {
          const d = await fnRef.current();
          if (cancelled) return;
          setHistory((h) => [...h.slice(-(MAX_HISTORY - 1)), d]);
          setStatus("live");
          setError(null);
        } catch (e) {
          if (cancelled) return;
          setStatus("error");
          setError(e instanceof Error ? e.message : String(e));
        }
        await sleep(intervalMs);
      }
    }

    void loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [key, intervalMs]);

  return { history, status, error };
}

export { MAX_HISTORY };
