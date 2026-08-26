"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  let length = 0;
  for (const c of chunks) length += c.length;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, length * 2, true);
  let off = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++, off += 2) {
      const s = Math.max(-1, Math.min(1, c[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return new Blob([view], { type: "audio/wav" });
}

export function AudioRecorder({
  onRecorded,
}: {
  onRecorded: (file: File, durationSec: number) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const rafRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => stopAll(), []);

  function stopAll() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    streamRef.current = null;
  }

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      chunksRef.current = [];
      const targetRate = 16000;

      proc.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const ratio = ctx.sampleRate / targetRate;
        if (ratio <= 1) {
          chunksRef.current.push(new Float32Array(input));
          return;
        }
        const outLen = Math.floor(input.length / ratio);
        const out = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) out[i] = input[Math.floor(i * ratio)];
        chunksRef.current.push(out);
      };
      source.connect(proc);
      proc.connect(ctx.destination);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tickLevel = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
        rafRef.current = requestAnimationFrame(tickLevel);
      };
      tickLevel();

      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setRecording(true);

      (proc as unknown as { __ctx: AudioContext }).__ctx = ctx;
      (
        proc as unknown as { onended?: unknown }
      ).onended = null;

      return () => {
        proc.disconnect();
        source.disconnect();
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function stop() {
    setRecording(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    setLevel(0);
    const ctx = ctxRef.current;
    const chunks = chunksRef.current;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => {});
    ctxRef.current = null;
    streamRef.current = null;
    const rate = ctx?.sampleRate ? 16000 : 16000;
    if (chunks.length > 0) {
      const blob = encodeWav(chunks, rate);
      const file = new File([blob], `recording-${Date.now()}.wav`, { type: "audio/wav" });
      onRecorded(file, seconds);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          onClick={() => (recording ? stop() : start())}
          className={`inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
            recording
              ? "bg-red-500 hover:bg-red-400 animate-pulse"
              : "bg-violet-600 hover:bg-violet-500"
          }`}
          title={recording ? "Stop recording" : "Start recording"}
        >
          {recording ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
        </button>
        {recording && (
          <>
            <span className="font-mono text-sm text-zinc-300">
              {String(Math.floor(seconds / 60)).padStart(2, "0")}:
              {String(seconds % 60).padStart(2, "0")}
            </span>
            <div className="flex h-6 flex-1 items-end gap-0.5 overflow-hidden">
              {Array.from({ length: 28 }).map((_, i) => {
                const center = 1 - Math.abs(i - 14) / 15;
                const h = Math.max(2, level * center * 100 + Math.random() * 4);
                return (
                  <div
                    key={i}
                    className="w-1 rounded-sm bg-emerald-400/80"
                    style={{ height: `${Math.min(100, h)}%` }}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
      {!recording && (
        <p className="text-xs text-zinc-500">Tap the mic and speak — records 16 kHz mono WAV locally.</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
