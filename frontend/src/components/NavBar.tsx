"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, AudioLines, Boxes, Plus, Server } from "lucide-react";

const TABS = [
  { href: "/", label: "Fleet", icon: Server },
  { href: "/monitor", label: "Monitor", icon: Activity },
  { href: "/models", label: "Models", icon: Boxes },
  { href: "/playground", label: "Playground", icon: AudioLines },
];

export function NavBar() {
  const pathname = usePathname();
  return (
    <nav className="sticky top-0 z-40 border-b border-white/10 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-600">
            <Server className="h-3.5 w-3.5 text-white" />
          </span>
          <span className="text-sm font-semibold tracking-tight">InferVoice</span>
        </Link>
        <div className="flex items-center gap-1">
          {TABS.map((t) => {
            const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-white/10 font-medium text-zinc-100"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </Link>
            );
          })}
          <Link
            href="/add"
            className={`ml-1 flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors ${
              pathname.startsWith("/add")
                ? "bg-violet-600/20 text-violet-200"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Link>
        </div>
      </div>
    </nav>
  );
}
