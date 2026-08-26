"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Radar, Search, Wifi } from "lucide-react";
import { api, type DiscoveredHost } from "@/lib/api";

export default function AddMachinePage() {
  const router = useRouter();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<DiscoveredHost[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [mdns, setMdns] = useState<DiscoveredHost[]>([]);

  async function loadMdns() {
    try {
      const res = await api.mdnsList();
      setMdns(res.hosts.filter((h) => !h.registered));
    } catch {}
  }
  void loadMdns;

  async function scan() {
    setScanning(true);
    setScanError(null);
    try {
      const [subnet, mdnsRes] = await Promise.all([
        api.subnetScan(),
        api.mdnsList(),
      ]);
      const merged = [...mdnsRes.hosts.filter((h) => !h.registered), ...subnet.hosts.filter((h) => !h.registered)];
      const seen = new Set<string>();
      setFound(merged.filter((h) => (seen.has(h.host) ? false : (seen.add(h.host), true))));
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!host.trim() || !username.trim()) {
      setError("Host and username are required");
      return;
    }
    setBusy(true);
    try {
      const m = await api.addMachine({
        host: host.trim(),
        port: Number(port) || 22,
        username: username.trim(),
        name: name.trim() || undefined,
      });
      router.push(`/machines/${m.id}?welcome=1`);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  function pick(h: DiscoveredHost) {
    setHost(h.host);
    setPort(String(h.port));
    if (h.name && !name) setName(h.name);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1 mb-8">
        ← Dashboard
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Add a Mac</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Make sure <code className="rounded bg-white/5 px-1 py-0.5 text-zinc-300">Remote Login</code> is enabled on the target Mac
        (System Settings → General → Sharing).
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-medium flex items-center gap-2">
              <Radar className="h-4 w-4 text-violet-400" /> Discover on network
            </h2>
            <button
              onClick={scan}
              disabled={scanning}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium hover:bg-white/10 disabled:opacity-50"
            >
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Scan LAN
            </button>
          </div>

          {scanError && <p className="mt-3 text-xs text-red-400">{scanError}</p>}

          <div className="mt-4 space-y-2">
            {[...mdns, ...found].length === 0 && (
              <p className="text-sm text-zinc-500">
                No devices yet. Run a scan to find Macs with SSH open on your subnet.
              </p>
            )}
            {Array.from(new Map([...mdns, ...found].map((h) => [h.host, h])).values()).map((h) => (
              <button
                key={`${h.source}-${h.host}`}
                onClick={() => pick(h)}
                className="flex w-full items-center justify-between rounded-lg border border-white/10 px-3 py-2.5 text-left hover:border-violet-400/40 hover:bg-violet-400/5"
              >
                <span className="flex items-center gap-2 text-sm">
                  <Wifi className="h-3.5 w-3.5 text-emerald-400" />
                  {h.name || h.host}
                </span>
                <span className="text-xs text-zinc-500">{h.host}{h.name ? ` · ${h.host}` : ""}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="font-medium flex items-center gap-2">
            <Plus className="h-4 w-4 text-violet-400" /> Manual entry
          </h2>
          <form onSubmit={submit} className="mt-4 space-y-4">
            <Field label="IP address / hostname" value={host} onChange={setHost} placeholder="192.168.1.42" required />
            <div className="grid grid-cols-2 gap-4">
              <Field label="SSH port" value={port} onChange={setPort} placeholder="22" />
              <Field label="macOS username" value={username} onChange={setUsername} placeholder="saksham" required />
            </div>
            <Field label="Display name (optional)" value={name} onChange={setName} placeholder="Studio Mac" />

            {error && (
              <p className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-300">{error}</p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add machine
            </button>
            <p className="text-[11px] leading-relaxed text-zinc-500">
              After adding you&apos;ll be asked for the account password once to install this control center&apos;s SSH key.
              The password is never stored.
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-zinc-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-violet-400/60 focus:ring-1 focus:ring-violet-400/40"
      />
    </label>
  );
}
