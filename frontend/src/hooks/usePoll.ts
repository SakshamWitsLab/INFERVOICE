"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function usePoll<T>(fn: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const tick = useCallback(async () => {
    try {
      const d = await fnRef.current();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const loop = () => tick().finally(() => {});
    loop();
    const id = setInterval(() => {
      if (alive) void tick();
    }, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [tick, intervalMs]);

  return { data, error, reload: tick };
}
