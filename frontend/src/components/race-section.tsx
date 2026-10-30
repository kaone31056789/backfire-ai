"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play, RotateCcw } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import type { RaceData } from "@/components/three/race-3d";
import { RACER_STYLE } from "@/components/three/race-3d";
import { cn } from "@/lib/format";
import { useApi } from "@/lib/hooks";

const Race3D = dynamic(() => import("@/components/three/race-3d").then((m) => m.Race3D), { ssr: false });

const COURSES = [
  { key: "decoy", emoji: "🎭", name: "The Decoy", hint: "A big failure far away, a tiny one close by." },
  { key: "pit", emoji: "🕳️", name: "Hidden Pit", hint: "A small hole that is easy to miss." },
  { key: "straight", emoji: "🏔️", name: "Straight Cliff", hint: "One straight edge. The warm-up." },
];
const DURATION = 45; // seconds for the full race (slow enough to follow each explorer)

export function RaceSection() {
  const [course, setCourse] = useState("decoy");
  const { data, loading } = useApi<RaceData>(`/benchmarks/race?course=${course}`, [course]);
  const clock = useRef(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    clock.current = 0;
    setPlaying(true);
  }, [data]);
  useEffect(() => {
    let raf = 0, last = performance.now(), lastUi = 0;
    const loop = (now: number) => {
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); // rAF time can precede performance.now()
      last = now;
      if (playing) clock.current = Math.min(DURATION + 2, clock.current + dt * speed);
      if (now - lastUi > 100) {
        lastUi = now;
        setTick(clock.current);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  const rate = data ? data.budget / DURATION : 10;
  const tries = Math.min(data?.budget ?? 0, Math.floor(tick * rate) + 1);
  const board = (data?.racers || []).map((r) => {
    const n = Math.min(r.tries.length, Math.floor(tick * rate) + 1);
    let best: number | null = null;
    for (let q = 0; q < n; q++) if (r.tries[q][2]) { const d = Math.hypot(r.tries[q][0], r.tries[q][1]); if (best === null || d < best) best = d; }
    const gap = best !== null && data ? (best - data.true_distance) / data.true_distance : null;
    return { ...r, n, best, gap };
  }).sort((a, b) => (a.gap ?? 99) - (b.gap ?? 99));
  const finished = data && tick * rate >= data.budget;

  return (
    <div className="hud overflow-hidden rounded-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
        <div>
          <div className="text-[18px] font-semibold text-white">Watch the race 🏁</div>
          <div className="text-[13.5px] text-white/55">Each explorer replays the real tries its method made. Footprints turn <span className="text-[#ff6a3d]">red</span> when a try lands in the failure canyon.</div>
        </div>
        <div className="flex gap-1.5">
          {COURSES.map((c) => (
            <button key={c.key} onClick={() => setCourse(c.key)} title={c.hint} className={cn("rounded-xl px-3 py-2 text-[13.5px] font-medium transition-colors", course === c.key ? "bg-white text-black" : "bg-white/[0.06] text-white/75 hover:bg-white/[0.12]")}>
              {c.emoji} {c.name}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        {loading || !data ? (
          <div className="grid h-[520px] place-items-center text-[14px] text-white/50">
            <div className="flex gap-2">{Object.values(RACER_STYLE).map((r, i) => <motion.span key={r.name} className="text-[26px]" animate={{ y: [0, -14, 0] }} transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.1 }}>{r.emoji}</motion.span>)}</div>
          </div>
        ) : (
          <Race3D key={data.course} data={data} clock={clock} rate={rate} />
        )}
        <AnimatePresence>
          {data && tick < 3 && (() => {
            const c = COURSES.find((x) => x.key === data.course);
            return c ? (
              <motion.div key={c.key} className="pointer-events-none absolute inset-x-0 top-[38%] text-center" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, y: -20 }} transition={{ type: "spring", stiffness: 200, damping: 20 }}>
                <div className="inline-block rounded-3xl bg-black/65 px-7 py-4">
                  <div className="text-[40px] leading-none">{c.emoji}</div>
                  <div className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-white">{c.name}</div>
                  <div className="mt-1 text-[14px] text-white/70">{c.hint} Ready… go!</div>
                </div>
              </motion.div>
            ) : null;
          })()}
        </AnimatePresence>
        {data && (
          <div className="pointer-events-none absolute right-4 top-4 w-[250px] rounded-2xl bg-black/70 p-3.5">
            <div className="mb-2 flex justify-between text-[12px] text-white/55"><span>Scoreboard</span><span className="font-mono">try {tries}/{data.budget}</span></div>
            {board.map((r, i) => {
              const st = RACER_STYLE[r.key];
              return (
                <motion.div layout key={r.key} className="flex items-center gap-2 py-1 text-[13px]">
                  <span className="w-4 text-white/40">{i + 1}</span>
                  <span>{st.emoji}</span>
                  <span className="flex-1 font-medium" style={{ color: st.color }}>{st.name}</span>
                  <span className="font-mono text-white/85">{r.gap === null ? "searching…" : r.gap <= 0.05 ? "⭐ on target" : `${(r.gap * 100).toFixed(0)}% off`}</span>
                </motion.div>
              );
            })}
            {finished && <div className="mt-2 border-t border-white/10 pt-2 text-[12px] text-white/55">Finished! “% off” = how much further than the golden star each explorer&apos;s best find is.</div>}
          </div>
        )}
        <div className="absolute bottom-4 left-4 flex gap-1.5">
          <button onClick={() => setPlaying((p) => !p)} className="grid h-10 w-10 place-items-center rounded-xl bg-white text-black" aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-black" />}</button>
          <button onClick={() => { clock.current = 0; setPlaying(true); }} className="grid h-10 w-10 place-items-center rounded-xl bg-black/60 text-white" aria-label="Replay"><RotateCcw className="h-4 w-4" /></button>
          <button onClick={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 0.5 : 1))} className="h-10 rounded-xl bg-black/60 px-3 font-mono text-[13px] text-white">{speed}×</button>
        </div>
        <div className="pointer-events-none absolute bottom-4 right-4 rounded-xl bg-black/60 px-3 py-2 text-[12px] text-white/70">🟩 safe plateau · 🟥 failure canyon · ⭐ closest failure (the answer)</div>
      </div>
    </div>
  );
}
