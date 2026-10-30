"use client";
/**
 * App chrome as a floating HUD inside the persistent 3D world: no sidebar, no top bar.
 * top-left logo · top-centre navigation dock · top-right search, status and profile.
 */
import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, BookOpen, Boxes, CornerDownLeft, FlaskConical, Globe2, LogOut, Search, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Logo } from "@/components/auth-form";
import { useAuth } from "@/components/auth";
import { SceneProvider, useScene } from "@/components/scene";
import { useApi } from "@/lib/hooks";
import { cn } from "@/lib/format";
import type { InvestigationSummary } from "@/lib/types";

const NAV = [
  { href: "/dashboard", label: "Mission control", sub: "The globe", icon: Globe2 },
  { href: "/lab", label: "New investigation", sub: "Intervention lab", icon: FlaskConical },
  { href: "/benchmarks", label: "Benchmarks", sub: "Method validation", icon: BarChart3 },
  { href: "/settings", label: "Settings", sub: "Keys, models, usage", icon: Settings },
  { href: "/how-it-works", label: "How it works", sub: "Plain-language guide & judge Q&A", icon: BookOpen },
  { href: "/architecture", label: "Architecture", sub: "3D map of the backend", icon: Boxes },
];

export const STATUS_TONE: Record<string, "neutral" | "signal" | "holds" | "fail" | "caution" | "muted"> = {
  draft: "muted",
  analysing: "signal",
  analysed: "neutral",
  running: "signal",
  completed: "holds",
  failed: "fail",
};

const spring = { type: "spring" as const, stiffness: 260, damping: 30 };

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#02040a]">
        <div className="flex flex-col items-center gap-4">
          <Logo size={40} />
          <div className="flex items-center gap-2 text-[13px] text-white/60"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff5b2e]" /> Opening your lab…</div>
        </div>
      </div>
    );
  }
  return (
    <SceneProvider>
      <Hud />
      <main className="scene-content relative z-10 min-h-screen">
        <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-[96px] md:px-8">{children}</div>
      </main>
    </SceneProvider>
  );
}

function Hud() {
  const { user, logout } = useAuth();
  const path = usePathname();
  const { investigations } = useScene();
  const health = useApi<{ status: string }>("/health");
  const [palette, setPalette] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => {
    setMenu(false);
  }, [path]);

  const online = health.data?.status === "ok";
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-start justify-between gap-3 p-4">
        {/* logo */}
        <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
          <Link href="/dashboard" className="hud pointer-events-auto flex h-12 items-center gap-2.5 rounded-2xl pl-2 pr-4">
            <Logo size={32} />
            <span className="hidden text-[15px] font-semibold tracking-[-0.01em] text-white sm:inline">BACKFIRE<span className="text-[#ff5b2e]"> AI</span></span>
          </Link>
        </motion.div>

        {/* navigation dock */}
        <motion.nav initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.05 }} className="hud pointer-events-auto flex h-12 items-center gap-1 rounded-2xl p-1.5" aria-label="Main">
          {NAV.map((n) => {
            const active = path.startsWith(n.href) || (n.href === "/dashboard" && path.startsWith("/investigations"));
            return (
              <Link key={n.href} href={n.href} title={n.label} className={cn("relative flex h-9 items-center gap-2 rounded-xl px-3 text-[13.5px] font-medium transition-colors", active ? "text-black" : "text-white/70 hover:text-white")}>
                {active && <motion.span layoutId="dock-active" className="absolute inset-0 rounded-xl bg-white" transition={spring} />}
                <n.icon className="relative h-4 w-4" strokeWidth={1.9} />
                <span className="relative hidden lg:inline">{n.label}</span>
              </Link>
            );
          })}
        </motion.nav>

        {/* search · status · profile */}
        <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.1 }} className="pointer-events-auto flex items-center gap-2">
          <button onClick={() => setPalette(true)} className="hud hidden h-12 items-center gap-2.5 rounded-2xl px-4 text-[13.5px] text-white/60 transition-colors hover:text-white md:flex">
            <Search className="h-4 w-4" /> Search <kbd className="rounded-md bg-white/10 px-1.5 font-mono text-[11px] text-white/60">⌘K</kbd>
          </button>
          <div className="relative">
            <button onClick={() => setMenu((m) => !m)} className="hud flex h-12 items-center gap-2.5 rounded-2xl pl-1.5 pr-3" aria-label="Profile menu">
              <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#ff5b2e] to-[#ff9a6b] text-[12.5px] font-semibold text-black">
                {(user?.full_name || user?.email || "?").slice(0, 2).toUpperCase()}
                <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0b0d11]", online ? "bg-[#3ee6a8]" : health.error ? "bg-[#ff5b2e]" : "bg-white/40")} title={online ? "Engine online" : "Engine offline"} />
              </span>
              <span className="hidden text-left leading-tight xl:block">
                <span className="block max-w-[140px] truncate text-[13px] font-medium text-white">{user?.full_name || user?.email}</span>
                <span className="block text-[11.5px] capitalize text-white/50">{user?.role}</span>
              </span>
            </button>
            <AnimatePresence>
              {menu && (
                <motion.div initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={{ duration: 0.16 }} className="hud absolute right-0 top-14 w-64 rounded-2xl p-2">
                  <div className="px-3 py-2.5">
                    <div className="truncate text-[14px] font-medium text-white">{user?.full_name || user?.email}</div>
                    <div className="truncate text-[12.5px] text-white/50">{user?.email}</div>
                    <div className="mt-1 text-[12px] text-white/40"><span className="capitalize text-[#3ee6a8]">{user?.role}</span> · {user?.organisation?.name}</div>
                    <div className="mt-2 flex items-center gap-1.5 text-[12px] text-white/50"><span className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-[#3ee6a8]" : "bg-[#ff5b2e]")} />{online ? "Scientific engine online" : "Engine offline"}</div>
                  </div>
                  <Link href="/settings" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] text-white/75 hover:bg-white/10 hover:text-white"><Settings className="h-4 w-4" /> Settings</Link>
                  <button onClick={logout} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13.5px] text-white/75 hover:bg-white/10 hover:text-white"><LogOut className="h-4 w-4" /> Sign out</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} invs={investigations} />
    </>
  );
}

function CommandPalette({ open, onClose, invs }: { open: boolean; onClose: () => void; invs: InvestigationSummary[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const items = useMemo(() => {
    const base = [
      ...NAV.map((n) => ({ label: n.label, hint: n.sub, href: n.href, group: "Navigate" })),
      ...invs.flatMap((i) => [
        { label: i.title, hint: `${i.location_name || "—"} · ${i.status}`, href: `/investigations/${i.id}/overview`, group: "Investigations" },
        { label: `${i.title} — failure boundary`, hint: "Explore counterexamples in 3D", href: `/investigations/${i.id}/boundary`, group: "Investigations" },
        { label: `${i.title} — certificate`, hint: "Report & exports", href: `/investigations/${i.id}/certificate`, group: "Investigations" },
      ]),
    ];
    const t = q.trim().toLowerCase();
    return t ? base.filter((b) => (b.label + " " + b.hint).toLowerCase().includes(t)) : base.slice(0, 12);
  }, [q, invs]);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);
  useEffect(() => {
    setIdx(0);
  }, [q]);

  function go(href: string) {
    onClose();
    router.push(href);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 p-4 pt-[14vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div role="dialog" aria-label="Command palette" className="hud w-full max-w-xl overflow-hidden rounded-3xl" initial={{ y: -10, scale: 0.97, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: -6, opacity: 0 }} transition={{ duration: 0.18 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-white/10 px-5">
              <Search className="h-4 w-4 text-white/40" />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onClose();
                  if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
                  if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
                  if (e.key === "Enter" && items[idx]) go(items[idx].href);
                }}
                placeholder="Search investigations and pages…"
                className="h-14 flex-1 bg-transparent text-[15px] text-white placeholder:text-white/35 focus:outline-none"
                aria-label="Search"
              />
              <kbd className="rounded-md bg-white/10 px-1.5 font-mono text-[11px] text-white/50">esc</kbd>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto p-2">
              {items.length ? items.map((it, i) => (
                <li key={it.href + i}>
                  <button onMouseEnter={() => setIdx(i)} onClick={() => go(it.href)} className={cn("flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left", i === idx ? "bg-white/10" : "")}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-white">{it.label}</span>
                      <span className="block truncate text-[12.5px] text-white/45">{it.group} · {it.hint}</span>
                    </span>
                    {i === idx && <CornerDownLeft className="h-4 w-4 text-white/40" />}
                  </button>
                </li>
              )) : <li className="px-3 py-6 text-center text-[14px] text-white/40">No matches.</li>}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
