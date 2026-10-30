"use client";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Dices, Dna, Flag, Mountain, Play, Scale, Target, Trophy } from "lucide-react";
import { useState } from "react";

import { canWrite, useAuth } from "@/components/auth";
import { RaceSection } from "@/components/race-section";
import { Button } from "@/components/ui/button";
import { ErrorState, Input, Label, LoadingBlock, Switch } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { ago, cn, fmt, pct } from "@/lib/format";
import { useApi } from "@/lib/hooks";

interface Summary { variant: string; method: string; runs: number; found_rate: number; within_tol_rate: number; median_relative_gap: number | null; mean_relative_gap: number | null; median_evals_to_tol: number | null; mean_runtime_s: number; constraint_or_bound_violations: number }
interface Bench { id: string; created_at: string; version: string; config: { dims: number[]; seeds: number[]; budget: number; tolerance: number; ablations: boolean }; summary: Summary[]; rows: unknown[]; runtime_s: number; interpretation_note: string }

const RACERS = [
  { key: "mpfs", name: "MPFS", who: "Our method", icon: Target, color: "#ff5b2e", how: "Scans outward from the starting point in rings, then walks along the edge it finds to the closest spot." },
  { key: "nsga2", name: "NSGA-II", who: "Well-known method", icon: Scale, color: "#f5b84a", how: "Balances two goals at once — “small change” and “causes failure” — and keeps the best compromises." },
  { key: "de", name: "Differential evolution", who: "Well-known method", icon: Dna, color: "#a78bfa", how: "Breeds a population of guesses, keeping the better children each generation." },
  { key: "random", name: "Random search", who: "Baseline", icon: Dices, color: "#9aa3b2", how: "Tries random spots and keeps the closest failure it stumbles on. Any method should beat this." },
];

const COURSES = [
  { name: "Straight cliff", text: "A simple straight edge. Tests the basics." },
  { name: "Hidden pit", text: "A small hole away from the start — easy to miss." },
  { name: "Decoy", text: "A big obvious failure far away and a tiny one close by. Does the method find the close one?" },
  { name: "Fenced-off cliff", text: "Some directions are forbidden, like real-world limits. The method must respect them." },
];

export default function BenchmarksPage() {
  const { user } = useAuth();
  const latest = useApi<Bench | null>("/benchmarks/latest");
  const [cfg, setCfg] = useState({ dims: "4,8", seeds: 3, budget: 1500, ablations: true });
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const dims = cfg.dims.split(",").map((x) => parseInt(x.trim(), 10)).filter((x) => x >= 2 && x <= 16);
      latest.setData(await api<Bench>("/benchmarks", { body: { dims, seeds: cfg.seeds, budget: cfg.budget, ablations: cfg.ablations } }));
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  const b = latest.data;
  const main = b ? RACERS.map((r) => ({ ...r, s: b.summary.find((x) => x.variant === r.key) })).filter((r) => r.s) : [];
  const ranked = [...main].sort((a, z) => (z.s!.within_tol_rate - a.s!.within_tol_rate) || ((a.s!.median_relative_gap ?? 9) - (z.s!.median_relative_gap ?? 9)));
  const winner = ranked[0];
  const ablations = b?.summary.filter((s) => s.variant.startsWith("mpfs-")) || [];
  const tol = b ? pct(b.config.tolerance, 0) : "5%";

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- the idea in one picture */}
      <div className="hud rounded-3xl p-7 md:p-10">
        <div className="text-[13px] font-medium uppercase tracking-[0.18em] text-[#ff7a4d]">Benchmarks · is our search method actually good?</div>
        <h1 className="mt-3 max-w-3xl text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] text-white md:text-[46px]">
          Finding the edge of a cliff <span className="font-serif font-normal italic text-white/70">in the fog</span>.
        </h1>
        <p className="mt-4 max-w-3xl text-[17px] leading-relaxed text-white/70">
          BACKFIRE&apos;s job is to find the <b className="text-white">smallest change</b> that makes a climate promise fail — like finding the closest point to a cliff edge
          while walking in fog. To check our method works, we built practice courses where <b className="text-white">we already know exactly where the edge is</b>,
          then race four methods on them. Same number of steps, same starting conditions. The closer a method gets to the true edge, the better.
        </p>
        <div className="mt-7 grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            [Flag, "1 · Practice courses", "Made-up landscapes with a known answer, so scoring is exact."],
            [Mountain, "2 · The race", `Each method gets ${b?.config.budget ?? cfg.budget} tries per course to find the closest failure.`],
            [Trophy, "3 · The score", `Did it find a failure? Was it within ${tol} of the true closest point? How many tries did it need?`],
          ].map(([Icon, t, d]) => {
            const I = Icon as typeof Flag;
            return (
              <div key={t as string} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <I className="h-5 w-5 text-[#ff7a4d]" />
                <div className="mt-2 text-[15px] font-semibold text-white">{t as string}</div>
                <div className="mt-1 text-[14px] leading-relaxed text-white/60">{d as string}</div>
              </div>
            );
          })}
        </div>
      </div>

      <RaceSection />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
        {/* ---------------------------------------------------------------- results */}
        <div className="space-y-6">
          {latest.loading && !b ? (
            <div className="hud rounded-3xl"><LoadingBlock rows={6} /></div>
          ) : busy ? (
            <div className="hud grid place-items-center rounded-3xl px-6 py-16 text-center">
              <div className="flex gap-2">{RACERS.map((r, i) => <motion.span key={r.key} className="h-3 w-3 rounded-full" style={{ background: r.color }} animate={{ y: [0, -12, 0] }} transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.12 }} />)}</div>
              <div className="mt-5 text-[18px] font-semibold text-white">The race is on…</div>
              <p className="mt-1 text-[14px] text-white/55">Four methods × four courses × {cfg.seeds} rounds. This takes about 15–30 seconds.</p>
            </div>
          ) : !b ? (
            <div className="hud rounded-3xl px-6 py-14 text-center">
              <Trophy className="mx-auto h-8 w-8 text-[#ff7a4d]" />
              <div className="mt-3 text-[20px] font-semibold text-white">No race run yet</div>
              <p className="mx-auto mt-2 max-w-md text-[15px] text-white/60">Press <b className="text-white">Run the race</b> to see, with real measured numbers, how often each method finds the true weakest point.</p>
            </div>
          ) : (
            <>
              {winner?.s && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="hud rounded-3xl p-6 md:p-8">
                  <div className="text-[13px] text-white/50">Result of the last race · {ago(b.created_at)}</div>
                  <p className="mt-2 text-[24px] font-semibold leading-snug tracking-[-0.02em] text-white md:text-[28px]">
                    <span style={{ color: winner.color }}>{winner.name}</span> found the true weakest point (within {tol}) in{" "}
                    <span style={{ color: winner.color }}>{pct(winner.s.within_tol_rate, 0)}</span> of tests.
                  </p>
                  <p className="mt-2 text-[15px] text-white/60">
                    {ranked.slice(1).map((r) => `${r.name} ${pct(r.s!.within_tol_rate, 0)}`).join(" · ")}. Higher is better.
                  </p>
                </motion.div>
              )}

              <div className="hud rounded-3xl p-6">
                <div className="mb-4 text-[16px] font-semibold text-white">Leaderboard</div>
                <div className="space-y-4">
                  {ranked.map((r, i) => (
                    <div key={r.key}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: r.color + "22", color: r.color }}><r.icon className="h-4 w-4" /></span>
                          <div>
                            <div className="text-[15px] font-semibold text-white">{i === 0 && "🏆 "}{r.name}</div>
                            <div className="text-[12.5px] text-white/45">{r.who}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[20px] font-semibold text-white">{pct(r.s!.within_tol_rate, 0)}</div>
                          <div className="text-[12px] text-white/45">hit the true edge</div>
                        </div>
                      </div>
                      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <motion.div className="h-full rounded-full" style={{ background: r.color }} initial={{ width: 0 }} animate={{ width: `${r.s!.within_tol_rate * 100}%` }} transition={{ duration: 1.1, delay: 0.1 * i, ease: [0.22, 1, 0.36, 1] }} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-white/55">
                        <span>Found a failure: <b className="text-white/80">{pct(r.s!.found_rate, 0)}</b></span>
                        <span>Typical miss: <b className="text-white/80">{r.s!.median_relative_gap !== null ? pct(r.s!.median_relative_gap, 1) : "—"}</b> away from the true edge</span>
                        <span>Tries needed: <b className="text-white/80">{r.s!.median_evals_to_tol !== null ? fmt(r.s!.median_evals_to_tol, 0) : "never got close"}</b></span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {ablations.length > 0 && (
                <div className="hud rounded-3xl p-6">
                  <div className="text-[16px] font-semibold text-white">What makes MPFS work? (we switched parts off)</div>
                  <p className="mt-1 text-[14px] text-white/55">Each row is MPFS with one ingredient removed. A big drop means that ingredient matters.</p>
                  <div className="mt-4 space-y-2.5">
                    {ablations.map((a) => {
                      const part = a.variant.replace("mpfs-no-", "");
                      const name = { shells: "ring-by-ring scanning", bisection: "edge pinpointing", refinement: "sliding along the edge", descent: "walking downhill toward failure" }[part] || part;
                      return (
                        <div key={a.variant} className="flex items-center gap-3 text-[14px]">
                          <span className="w-56 shrink-0 text-white/70">Without {name}</span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-[#ff5b2e]/70" style={{ width: `${a.within_tol_rate * 100}%` }} /></div>
                          <span className="w-12 text-right font-mono text-white">{pct(a.within_tol_rate, 0)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="px-1 text-[13px] leading-relaxed text-white/45">Honest note: these practice courses are simplified. Winning here shows the method is sound on problems with known answers — it does not prove it is always better. {b.rows.length} individual runs took {b.runtime_s.toFixed(0)} s.</p>
            </>
          )}
        </div>

        {/* ---------------------------------------------------------------- racers, courses, run */}
        <div className="space-y-6">
          <div className="hud rounded-3xl p-5">
            <Button variant="primary" size="lg" className="w-full" onClick={run} loading={busy} disabled={!canWrite(user)}><Play className="h-4 w-4" /> {busy ? "Racing…" : b ? "Run the race again" : "Run the race"}</Button>
            {err ? <div className="mt-3"><ErrorState error={err} compact /></div> : null}
            <button onClick={() => setAdvanced((a) => !a)} className="mt-4 flex w-full items-center justify-between text-[13.5px] text-white/55 hover:text-white">
              Advanced settings <ChevronDown className={cn("h-4 w-4 transition-transform", advanced && "rotate-180")} />
            </button>
            <AnimatePresence>
              {advanced && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="space-y-3 pt-3">
                    <div><Label htmlFor="dims">Course complexity (number of dials, comma-separated)</Label><Input id="dims" className="font-mono" value={cfg.dims} onChange={(e) => setCfg({ ...cfg, dims: e.target.value })} /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label htmlFor="seeds">Rounds per course</Label><Input id="seeds" type="number" min={1} max={10} className="font-mono" value={cfg.seeds} onChange={(e) => setCfg({ ...cfg, seeds: Number(e.target.value) })} /></div>
                      <div><Label htmlFor="bud">Tries per method</Label><Input id="bud" type="number" min={200} max={5000} step={100} className="font-mono" value={cfg.budget} onChange={(e) => setCfg({ ...cfg, budget: Number(e.target.value) })} /></div>
                    </div>
                    <label className="flex items-center justify-between text-[13.5px] text-white/70">Also test MPFS with parts switched off<Switch checked={cfg.ablations} onChange={(v) => setCfg({ ...cfg, ablations: v })} /></label>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="hud rounded-3xl p-5">
            <div className="text-[15px] font-semibold text-white">Who is racing?</div>
            <p className="mt-1 text-[13.5px] leading-relaxed text-white/55">Four different computer strategies for searching. They all hunt for the same thing — the closest point where the promise fails — with the same number of tries. MPFS is ours; the others are the competition.</p>
            <ul className="mt-3 space-y-3.5">
              {RACERS.map((r) => (
                <li key={r.key} className="flex gap-3">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl" style={{ background: r.color + "22", color: r.color }}><r.icon className="h-4 w-4" /></span>
                  <span><span className="text-[14.5px] font-medium text-white">{r.name}</span> <span className="text-[12.5px] text-white/40">· {r.who}</span><span className="mt-0.5 block text-[13.5px] leading-snug text-white/60">{r.how}</span></span>
                </li>
              ))}
            </ul>
          </div>

          <div className="hud rounded-3xl p-5">
            <div className="text-[15px] font-semibold text-white">The practice courses</div>
            <ul className="mt-3 space-y-2.5">
              {COURSES.map((c) => (
                <li key={c.name} className="text-[13.5px] leading-snug text-white/60"><b className="text-white/90">{c.name}</b> — {c.text}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
