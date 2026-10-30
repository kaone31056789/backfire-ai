"use client";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Crosshair, FlaskConical, Globe2, Loader2, MapPin, ShieldCheck, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth";
import { Counter } from "@/components/landing/motion";
import type { Landscape } from "@/components/three/failure-landscape";
import { useScene } from "@/components/scene";
import { api } from "@/lib/api";
import { cn, fmt, METRIC_META, pct, signed } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { BoundaryMap, Counterexample, MonteCarlo, SimResult } from "@/lib/types";

const FailureLandscape = dynamic(() => import("@/components/three/failure-landscape").then((m) => m.FailureLandscape), { ssr: false });

interface Stats {
  investigations: { id: string; title: string; category: string; status: string; latitude: number; longitude: number; location_name: string; country: string; created_at: string; evidence_sources: number; mpfs_min_distance: number | null }[];
  totals: Record<string, number>;
}

const spring = { type: "spring" as const, stiffness: 210, damping: 28 };
const STATUS_DOT: Record<string, string> = { completed: "bg-[#ff5b2e]", running: "bg-[#4cc9f0]", analysing: "bg-[#4cc9f0]", analysed: "bg-white/60", draft: "bg-white/30", failed: "bg-[#f5b84a]" };

export default function MissionControl() {
  const { data } = useApi<Stats>("/stats/global");
  const { user } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const first = (user?.full_name || "").split(" ")[0];
  const invs = useMemo(() => data?.investigations || [], [data]);

  const sel = invs.find((i) => i.id === selected) || null;
  const scene = useScene();

  // clicking a column on the globe selects it here; selection drives the shared camera
  useEffect(() => {
    scene.setSelectHandler((id) => setSelected(id));
    return () => scene.setSelectHandler(null);
  }, [scene]);
  useEffect(() => {
    scene.setOverride(sel ? { kind: "site", lon: sel.longitude, lat: sel.latitude, zoom: 15, pitch: 66, bearing: -30, orbit: true } : { kind: "globe" });
  }, [sel, scene]);

  return (
    <div className="pointer-events-none fixed inset-0 z-10">
      {/* ------------------------------------------------------------------ HUD header */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.1 }} className="pointer-events-none absolute left-1/2 top-[88px] -translate-x-1/2 text-center">
        <div className="hud inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] text-white/75">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff5b2e]" /> Mission control · {first ? `${first}'s` : "your"} workspace · live
        </div>
        <AnimatePresence mode="wait">
          <motion.h1 key={sel?.id || "globe"} initial={{ opacity: 0, y: 10, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.5 }} className="mt-3 whitespace-nowrap text-[30px] font-semibold tracking-[-0.035em] text-white drop-shadow-[0_2px_20px_rgba(0,0,0,0.8)] md:text-[40px]">
            {sel ? sel.location_name || sel.title : <>Where promises <span className="font-serif font-normal italic text-[#ff7a4d]">break</span>.</>}
          </motion.h1>
        </AnimatePresence>
      </motion.div>

      {/* ------------------------------------------------------------------ left: investigation rail */}
      <motion.aside initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay: 0.2 }} className="pointer-events-auto absolute bottom-24 left-4 top-[88px] hidden w-[280px] flex-col overflow-hidden hud rounded-3xl md:flex">
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <div>
            <div className="text-[12px] uppercase tracking-[0.18em] text-white/45">Investigations</div>
            <div className="text-[20px] font-semibold tracking-[-0.02em] text-white">{invs.length} on Earth</div>
          </div>
          <Link href="/lab" aria-label="New investigation" className="grid h-9 w-9 place-items-center rounded-full bg-white text-black transition-transform hover:scale-110"><FlaskConical className="h-4 w-4" /></Link>
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
          {!data && <div className="flex items-center gap-2 px-2 py-4 text-[13px] text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
          {data && !invs.length && (
            <div className="px-2 py-6 text-[13.5px] leading-relaxed text-white/55">
              <Globe2 className="mb-2 h-5 w-5 text-white/40" />No sites yet. <Link href="/lab" className="text-[#ff7a4d] hover:underline">Start an investigation</Link> and it will rise on the globe.
            </div>
          )}
          {invs.map((i, k) => (
            <motion.button
              key={i.id}
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...spring, delay: 0.3 + k * 0.05 }}
              whileHover={{ x: 3 }}
              onClick={() => setSelected(selected === i.id ? null : i.id)}
              className={cn("block w-full rounded-2xl border p-3.5 text-left transition-colors", selected === i.id ? "border-[#ff5b2e]/50 bg-[#ff5b2e]/12" : "border-transparent hover:bg-white/[0.06]")}
            >
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[i.status] || "bg-white/40", i.status === "running" && "animate-pulse")} />
                <span className="truncate text-[14px] font-medium text-white">{i.title}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between pl-4 text-[12.5px] text-white/50">
                <span className="truncate">{i.location_name || "—"} · {i.status}</span>
                {i.mpfs_min_distance !== null && <span className="font-mono text-[#ff7a4d]">d* {fmt(i.mpfs_min_distance, 2)}</span>}
              </div>
            </motion.button>
          ))}
        </div>
      </motion.aside>

      {/* ------------------------------------------------------------------ right: selected site */}
      <AnimatePresence>{sel && <SitePanel key={sel.id} id={sel.id} title={sel.title} onClose={() => setSelected(null)} />}</AnimatePresence>

      {/* ------------------------------------------------------------------ bottom: three key numbers */}
      {data && (
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.35 }} className="hud pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full px-2 py-2">
          {[
            ["🌍", data.totals.investigations, "investigations"],
            ["✅", data.totals.verified, "verified breaking points"],
            ["📚", data.totals.evidence_sources, "scientific sources"],
          ].map(([e, v, k]) => (
            <div key={k as string} className="flex items-center gap-2 rounded-full px-4 py-1.5">
              <span className="text-[16px]">{e as string}</span>
              <span className="text-[18px] font-semibold text-white"><Counter value={v as number} format={(x) => Math.round(x).toLocaleString("en-GB")} /></span>
              <span className="text-[13px] text-white/50">{k as string}</span>
            </div>
          ))}
        </motion.div>
      )}
    </div>
  );
}

function SitePanel({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  const cexs = useApi<Counterexample[]>(`/investigations/${id}/counterexamples`);
  const analysis = useApi<{ monte_carlo?: MonteCarlo }>(`/investigations/${id}/analysis`);
  const [nominal, setNominal] = useState<SimResult | null>(null);
  const best = cexs.data?.find((c) => c.method === "MPFS" && c.rank === 1) || cexs.data?.[0];
  const mc = analysis.data?.monte_carlo;

  useEffect(() => {
    api<SimResult>(`/investigations/${id}/simulate`, { body: { series: false } }).then(setNominal).catch(() => setNominal(null));
  }, [id]);

  const top = best ? Object.values(best.deltas).sort((a, b) => Math.abs(b.normalised) - Math.abs(a.normalised)).slice(0, 2) : [];
  const verdict = !nominal ? null : !nominal.success ? "Fails even as planned" : best ? "Breaks with a small change" : cexs.data ? "Held up in every test" : null;
  const bad = verdict !== null && verdict !== "Held up in every test";
  return (
    <motion.aside
      initial={{ opacity: 0, x: 60, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.97 }}
      transition={spring}
      className="hud pointer-events-auto absolute right-4 top-[88px] flex max-h-[calc(100%-200px)] w-[360px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-3xl"
    >
      <div className="flex items-start justify-between gap-3 p-6 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12.5px] text-white/50"><MapPin className="h-3.5 w-3.5" /> Selected</div>
          <div className="mt-1 text-[19px] font-semibold leading-snug tracking-[-0.02em] text-white">{title}</div>
        </div>
        <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white"><X className="h-4 w-4" /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6">
        {verdict ? (
          <div className={cn("rounded-2xl px-4 py-3 text-[17px] font-semibold", bad ? "bg-[#ff5b2e]/12 text-[#ff8a5b]" : "bg-[#3ee6a8]/12 text-[#3ee6a8]")}>{bad ? "⚠️ " : "✅ "}{verdict}</div>
        ) : <div className="h-12 animate-pulse rounded-2xl bg-white/10" />}
        <div className="grid grid-cols-2 gap-3">
          <Big label="Fails in" value={mc ? `${Math.round(mc.failure_probability * 100)}%` : "—"} sub="of possible futures" bad={!!mc && mc.failure_probability > 0.5} />
          <Big label="Trees still alive" value={nominal ? `${Math.round(nominal.survival_rate * 100)}%` : "—"} sub="after 10 years, as planned" />
        </div>
        {top.length > 0 && (
          <div>
            <div className="mb-2 text-[13px] text-white/50">What breaks it</div>
            {top.map((d) => (
              <div key={d.label} className="flex items-center justify-between gap-3 py-1.5 text-[14px]">
                <span className="truncate text-white/80">{d.label}</span>
                <span className="font-mono text-white/90">{fmt(d.from)} → <span className="text-[#ff8a5b]">{fmt(d.to)}</span></span>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2">
          <Link href={`/investigations/${id}/overview`} className="group flex items-center justify-between rounded-2xl bg-white px-4 py-3.5 text-[15px] font-semibold text-black">
            Open investigation <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
          <Link href={`/investigations/${id}/film`} className="flex items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-[14px] font-medium text-white hover:bg-white/15">▶ Watch the simulation film</Link>
        </div>
      </div>
    </motion.aside>
  );
}

function Big({ label, value, sub, bad }: { label: string; value: string; sub: string; bad?: boolean }) {
  return (
    <div className="rounded-2xl bg-white/[0.05] p-4">
      <div className="text-[12.5px] text-white/50">{label}</div>
      <div className={cn("mt-1 text-[30px] font-semibold leading-none tracking-[-0.03em]", bad ? "text-[#ff8a5b]" : "text-white")}>{value}</div>
      <div className="mt-1.5 text-[12px] text-white/40">{sub}</div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | null; tone?: "ok" | "bad" }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <div className="text-[11.5px] text-white/45">{label}</div>
      {value === null ? <div className="mt-1.5 h-6 w-12 animate-pulse rounded bg-white/10" /> : <div className={cn("mt-0.5 text-[20px] font-semibold tracking-[-0.02em]", tone === "bad" ? "text-[#ff7a4d]" : tone === "ok" ? "text-[#3ee6a8]" : "text-white")}>{value}</div>}
    </div>
  );
}
