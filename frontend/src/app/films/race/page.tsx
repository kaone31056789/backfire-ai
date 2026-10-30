"use client";
/** The benchmark race on all three courses, one after another (needs a signed-in user). */
import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { useRecordMode } from "@/components/record-seed";
import type { RaceData } from "@/components/three/race-3d";
import { RACER_STYLE } from "@/components/three/race-3d";
import { api } from "@/lib/api";

const Race3D = dynamic(() => import("@/components/three/race-3d").then((m) => m.Race3D), { ssr: false });

const COURSES = [
  { key: "straight", emoji: "🏔️", name: "Straight Cliff", hint: "One straight edge. The warm-up." },
  { key: "pit", emoji: "🕳️", name: "Hidden Pit", hint: "A small hole that is easy to miss." },
  { key: "decoy", emoji: "🎭", name: "The Decoy", hint: "A big failure far away, a tiny one close by." },
];
const RUN = 24; // seconds of racing per course
const HOLD = 4; // seconds on the final scoreboard

export default function RaceFilmPage() {
  const { ready, record } = useRecordMode();
  const [data, setData] = useState<RaceData[] | null>(null);
  const [error, setError] = useState(false);
  const [k, setK] = useState(0);
  const clock = useRef(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!ready) return;
    Promise.all(COURSES.map((c) => api<RaceData>(`/benchmarks/race?course=${c.key}`))).then(setData).catch(() => setError(true));
  }, [ready]);

  useEffect(() => {
    if (!data) return;
    (window as unknown as { __filmStarted?: number }).__filmStarted = performance.now();
    let raf = 0, last = performance.now(), lastUi = 0;
    const loop = (now: number) => {
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); // rAF time can precede performance.now()
      last = now;
      clock.current += dt;
      if (clock.current >= RUN + HOLD) {
        setK((x) => {
          if (x >= COURSES.length - 1) { (window as unknown as { __filmDone?: boolean }).__filmDone = true; return x; }
          clock.current = 0;
          return x + 1;
        });
      }
      if (now - lastUi > 100) { lastUi = now; setTick(clock.current); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [data]);

  if (error) return <div className="py-20 text-center text-white/60">Sign in first to watch the race.</div>;
  if (!data) return null;
  const d = data[k];
  const rate = d.budget / RUN;
  const board = d.racers.map((r) => {
    const n = Math.min(r.tries.length, Math.floor(tick * rate) + 1);
    let best: number | null = null;
    for (let q = 0; q < n; q++) if (r.tries[q][2]) { const v = Math.hypot(r.tries[q][0], r.tries[q][1]); if (best === null || v < best) best = v; }
    return { ...r, gap: best !== null ? (best - d.true_distance) / d.true_distance : null };
  }).sort((a, b) => (a.gap ?? 99) - (b.gap ?? 99));
  const c = COURSES[k];

  return (
    <div className={record ? "fixed inset-0 bg-black" : "relative aspect-video w-full overflow-hidden rounded-3xl"}>
      <Race3D key={c.key} data={d} clock={clock} rate={rate} height={record ? (typeof window !== "undefined" ? window.innerHeight : 720) : 640} />
      <div className="pointer-events-none absolute left-[3%] top-[5%] text-white">
        <div className="text-[13px] uppercase tracking-[0.25em] text-[#ff7a4d]">Benchmark race · course {k + 1} of 3</div>
        <div className="mt-1 text-[30px] font-semibold tracking-[-0.02em]">{c.emoji} {c.name}</div>
        <div className="text-[15px] text-white/70">Each explorer replays its method&apos;s real tries. Closest red footprint to the ⭐ wins.</div>
      </div>
      <div className="pointer-events-none absolute right-[3%] top-[5%] w-[300px] rounded-2xl bg-black/70 p-4 text-white">
        <div className="mb-2 flex justify-between text-[13px] text-white/55"><span>Scoreboard</span><span className="font-mono">try {Math.min(d.budget, Math.floor(tick * rate) + 1)}/{d.budget}</span></div>
        {board.map((r, i) => {
          const st = RACER_STYLE[r.key];
          return (
            <motion.div layout key={r.key} className="flex items-center gap-2 py-1 text-[15px]">
              <span className="w-4 text-white/40">{i + 1}</span><span>{st.emoji}</span>
              <span className="flex-1 font-medium" style={{ color: st.color }}>{st.name}</span>
              <span className="font-mono">{r.gap === null ? "searching…" : r.gap <= 0.05 ? "⭐ on target" : `${(r.gap * 100).toFixed(0)}% off`}</span>
            </motion.div>
          );
        })}
      </div>
      <AnimatePresence>
        {tick < 3 && (
          <motion.div key={c.key} className="pointer-events-none absolute inset-x-0 top-[38%] text-center" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, y: -20 }}>
            <div className="inline-block rounded-3xl bg-black/70 px-8 py-5 text-white">
              <div className="text-[46px] leading-none">{c.emoji}</div>
              <div className="mt-2 text-[28px] font-semibold">{c.name}</div>
              <div className="mt-1 text-[16px] text-white/70">{c.hint} Ready… go!</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
