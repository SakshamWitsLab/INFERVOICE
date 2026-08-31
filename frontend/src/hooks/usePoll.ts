"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

export function usePoll<T>(fn: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestRef = useRef<T | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const tick = useCallback(async () => {
    try {
      const d = await fnRef.current();
      if (!deepEqual(d, latestRef.current)) {
        latestRef.current = d;
        setData(d);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const loop = () => {
      if (!alive || document.hidden) return;
      void tick().finally(() => {
        if (alive) {
          const id = setTimeout(loop, intervalMs);
          // store id on a ref for cleanup
          (loop as unknown as { timerId: ReturnType<typeof setTimeout> }).timerId = id;
        }
      });
    };
    // first tick immediately (not inside setTimeout)
    void tick();
    const id = setInterval(() => {
      if (alive && !document.hidden) void tick();
    }, intervalMs);

    const onVis = () => {
      if (!document.hidden && alive) void tick();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [tick, intervalMs]);

  return { data, error, reload: tick };
}
