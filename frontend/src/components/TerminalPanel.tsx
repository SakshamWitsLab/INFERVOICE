"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { wsTerminalUrl } from "@/lib/api";

export default function TerminalPanel({ machineId }: { machineId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"connecting" | "ready" | "error">("connecting");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let term: import("@xterm/xterm").Terminal | null = null;
    const disposers: Array<() => void> = [];

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !hostRef.current) return;

      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
        theme: {
          background: "#0a0a0b",
          foreground: "#e4e4e7",
          cursor: "#a78bfa",
          selectionBackground: "#7c3aed55",
          black: "#18181b",
          brightBlack: "#52525b",
        },
        allowProposedApi: true,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      try {
        fit.fit();
      } catch {}

      ws = new WebSocket(wsTerminalUrl(machineId));
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        setState("ready");
        sendResize();
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === "error") setErrMsg(msg.message);
            if (msg.type === "exit") term?.write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
            return;
          } catch {}
        }
        term?.write(new Uint8Array(ev.data));
      };
      ws.onerror = () => setState("error");
      ws.onclose = () => setState((s) => (s === "error" ? s : "connecting"));

      const dataSub = term.onData((d) => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(d);
      });
      disposers.push(() => dataSub.dispose());

      function sendResize() {
        if (!ws || ws.readyState !== WebSocket.OPEN || !term) return;
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }

      const resizeSub = term.onResize(() => sendResize());
      disposers.push(() => resizeSub.dispose());

      const ro = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {}
      });
      ro.observe(hostRef.current);
      disposers.push(() => ro.disconnect());
    })();

    return () => {
      disposed = true;
      disposers.forEach((d) => d());
      ws?.close();
      term?.dispose();
    };
  }, [machineId]);

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0b]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="text-xs font-medium text-zinc-400">Remote shell</span>
        <span className="flex items-center gap-2 text-[11px] text-zinc-500">
          {state === "connecting" && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> connecting…
            </>
          )}
          {state === "ready" && (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> live
            </>
          )}
          {state === "error" && <span className="text-red-400">connection failed</span>}
        </span>
      </div>
      {errMsg && (
        <p className="border-b border-amber-400/20 bg-amber-400/10 px-4 py-1.5 text-[11px] text-amber-200">{errMsg}</p>
      )}
      <div ref={hostRef} className="h-[420px] p-2 [&_.xterm]:h-full" />
    </div>
  );
}
