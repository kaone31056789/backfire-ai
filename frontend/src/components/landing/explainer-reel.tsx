"use client";
/** Auto-playing animated explainer: five short motion-graphics scenes, story-style. */
import { AnimatePresence, motion, useInView } from "framer-motion";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface ReelFacts {
  place: string;
  cooling: number;
  survival: number;
  sources: number;
  dStar: number | null;
  pFail: number | null;
  changes: string[];
  bestAlt: string | null;
}

const SCENE_MS = 6500;

export function ExplainerReel({ facts }: { facts: ReelFacts }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const running = inView && !paused;

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setI((x) => (x + 1) % 5), SCENE_MS);
    return () => clearTimeout(t);
  }, [i, running]);

  const scenes = [
    { cap: "1 · A city makes a promise", sub: `“Plant trees in ${facts.place} and the streets will be ${facts.cooling} °C cooler, with ${Math.round(facts.survival * 100)}% of trees alive in 10 years.”`, art: <Promise /> },
    { cap: "2 · BACKFIRE gathers the facts", sub: `Real climate from NASA satellites and ${facts.sources} scientific sources about trees, heat and drought.`, art: <Facts sources={facts.sources} /> },
    { cap: "3 · It simulates 10 years", sub: "Day by day: sun, rain, thirsty soil, watering, trees growing — and some trees dying.", art: <Years /> },
    { cap: "4 · Then it tries to break the promise", sub: facts.dStar !== null ? `It searches thousands of futures for the smallest realistic change that makes the promise fail — here just ${facts.dStar.toFixed(2)} of the plausible range${facts.changes.length ? ` (${facts.changes.slice(0, 2).join(", ")})` : ""}.` : "It searches thousands of futures for the smallest realistic change that makes the promise fail.", art: <Break pFail={facts.pFail} /> },
    { cap: "5 · …and shows how to fix it", sub: facts.bestAlt ? `A second agent double-checks the result, then tests better plans. Safest here: ${facts.bestAlt.toLowerCase()}.` : "A second agent double-checks the result, then tests better plans that survive the same future.", art: <Fix /> },
  ];

  return (
    <div ref={ref} className="relative overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-b from-[#0e1422] to-[#070a12]" onClick={() => setPaused((p) => !p)}>
      {/* story progress */}
      <div className="absolute inset-x-4 top-4 z-10 flex gap-1.5">
        {scenes.map((_, k) => (
          <div key={k} className="h-1 flex-1 overflow-hidden rounded-full bg-white/15">
            {k < i && <div className="h-full w-full bg-white" />}
            {k === i && <motion.div key={`${i}-${running}`} className="h-full bg-white" initial={{ width: "0%" }} animate={{ width: running ? "100%" : "0%" }} transition={{ duration: running ? SCENE_MS / 1000 : 0, ease: "linear" }} />}
          </div>
        ))}
      </div>
      <button aria-label={paused ? "Play" : "Pause"} className="absolute right-4 top-8 z-10 grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white">{paused ? <Play className="h-4 w-4 fill-white" /> : <Pause className="h-4 w-4" />}</button>

      <div className="grid min-h-[440px] grid-cols-1 items-center gap-6 p-8 pt-14 md:grid-cols-[1.1fr_1fr] md:p-10 md:pt-16">
        <AnimatePresence mode="wait">
          <motion.div key={`art-${i}`} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.04 }} transition={{ duration: 0.5 }} className="flex h-[300px] items-center justify-center">
            {scenes[i].art}
          </motion.div>
        </AnimatePresence>
        <AnimatePresence mode="wait">
          <motion.div key={`cap-${i}`} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.45 }}>
            <div className="text-[14px] font-medium uppercase tracking-[0.16em] text-[#ff7a4d]">{scenes[i].cap}</div>
            <p className="mt-3 text-[24px] font-medium leading-snug tracking-[-0.015em] text-white md:text-[28px]">{scenes[i].sub}</p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ scene illustrations */
function Promise() {
  return (
    <svg viewBox="0 0 360 260" className="h-full w-full">
      {[30, 80, 140, 220, 280].map((x, k) => (
        <motion.rect key={x} x={x} width={44} rx={4} fill="#2a3346" initial={{ y: 230, height: 0 }} animate={{ y: 230 - (70 + (k % 3) * 35), height: 70 + (k % 3) * 35 }} transition={{ delay: k * 0.08, type: "spring", stiffness: 120 }} />
      ))}
      <rect x={0} y={228} width={360} height={32} fill="#1b2230" />
      {[50, 110, 170, 230, 290].map((x, k) => (
        <motion.g key={x} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.6 + k * 0.12, type: "spring", stiffness: 260, damping: 12 }} style={{ originX: `${x}px`, originY: "228px" }}>
          <rect x={x - 3} y={205} width={6} height={24} fill="#7a5a3a" />
          <circle cx={x} cy={198} r={18} fill="#4fbf6a" />
        </motion.g>
      ))}
      <motion.g initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.4 }}>
        <rect x={150} y={18} width={190} height={56} rx={16} fill="#fff" />
        <path d="M200 74 l12 16 l4 -16z" fill="#fff" />
        <text x={245} y={42} textAnchor="middle" fontSize="14" fontWeight="700" fill="#0b0d11" fontFamily="var(--font-geist)">“Cooler streets,</text>
        <text x={245} y={60} textAnchor="middle" fontSize="14" fontWeight="700" fill="#0b0d11" fontFamily="var(--font-geist)">we promise!” 🌳</text>
      </motion.g>
      <motion.circle cx={40} cy={40} r={18} fill="#ffcf4a" animate={{ scale: [1, 1.12, 1] }} transition={{ duration: 2, repeat: Infinity }} />
    </svg>
  );
}

function Facts({ sources }: { sources: number }) {
  const items = ["🛰️ NASA climate", "📄 Peer-reviewed papers", "🔗 Verified DOIs", "🌡️ Heat & humidity", "🌧️ Monthly rain"];
  return (
    <div className="relative h-[260px] w-[340px]">
      <motion.div className="absolute left-1/2 top-1/2 grid h-28 w-28 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#ff5b2e]/15 text-[54px] ring-2 ring-[#ff5b2e]/40" animate={{ rotate: [0, -8, 8, 0] }} transition={{ duration: 2.4, repeat: Infinity }}>🔎</motion.div>
      {items.map((t, k) => {
        const a = (k / items.length) * Math.PI * 2;
        return (
          <motion.div key={t} className="absolute left-1/2 top-1/2 whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-[13px] font-semibold text-black shadow-lg" initial={{ x: Math.cos(a) * 260 - 60, y: Math.sin(a) * 200 - 14, opacity: 0 }} animate={{ x: Math.cos(a) * 130 - 60, y: Math.sin(a) * 100 - 14, opacity: 1 }} transition={{ delay: 0.2 + k * 0.18, type: "spring", stiffness: 90, damping: 14 }}>{t}</motion.div>
        );
      })}
      <motion.div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[13px] text-white/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6 }}>{sources} sources gathered</motion.div>
    </div>
  );
}

function Years() {
  const [y, setY] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setY((v) => (v < 10 ? v + 1 : v)), 520);
    return () => clearInterval(t);
  }, []);
  const rain = y % 3 === 1;
  return (
    <div className="relative h-[260px] w-[340px]">
      <motion.div className="absolute right-6 top-2 text-[46px]" animate={{ y: rain ? 6 : 0 }}>{rain ? "🌧️" : "☀️"}</motion.div>
      <div className="absolute left-4 top-4 font-mono text-[44px] font-bold text-white">Year {y}</div>
      <div className="absolute bottom-6 left-0 right-0 flex items-end justify-center gap-6">
        {[0, 1, 2, 3, 4].map((k) => {
          const dead = y >= 6 + k && k >= 3;
          return (
            <motion.div key={k} className="flex flex-col items-center" animate={{ rotate: dead ? 80 : 0, opacity: dead ? 0.5 : 1 }} transition={{ type: "spring", stiffness: 80 }} style={{ originY: 1 }}>
              <motion.div className="rounded-full" style={{ background: y > 7 && k >= 2 ? "#c9a13b" : "#4fbf6a" }} animate={{ width: 22 + y * 3.2, height: 22 + y * 3.2 }} />
              <div className="h-10 w-2 rounded bg-[#7a5a3a]" />
            </motion.div>
          );
        })}
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-6 rounded bg-[#2f4b2a]" />
    </div>
  );
}

function Break({ pFail }: { pFail: number | null }) {
  return (
    <div className="w-[340px] space-y-5">
      {[["🌡️ A bit hotter", 0.62], ["💧 A bit less water", 0.48], ["🌳 Trees a bit weaker", 0.7]].map(([t, v], k) => (
        <div key={t as string}>
          <div className="mb-1.5 text-[14px] font-medium text-white/80">{t as string}</div>
          <div className="relative h-3 rounded-full bg-white/10">
            <motion.div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#4fbf6a] to-[#ff5b2e]" initial={{ width: "20%" }} animate={{ width: `${(v as number) * 100}%` }} transition={{ delay: 0.3 + k * 0.35, duration: 1.2, ease: "easeInOut" }} />
            <motion.span className="absolute -top-1 h-5 w-5 rounded-full bg-white shadow" initial={{ left: "18%" }} animate={{ left: `calc(${(v as number) * 100}% - 10px)` }} transition={{ delay: 0.3 + k * 0.35, duration: 1.2, ease: "easeInOut" }} />
          </div>
        </div>
      ))}
      <motion.div className="rounded-2xl border-[3px] border-[#ff5b2e] py-3 text-center text-[22px] font-black uppercase tracking-[0.06em] text-[#ff5b2e]" initial={{ scale: 2.2, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: -4 }} transition={{ delay: 1.8, type: "spring", stiffness: 260, damping: 14 }}>
        Promise broken{pFail !== null ? ` · ${Math.round(pFail * 100)}% of futures` : ""}
      </motion.div>
    </div>
  );
}

function Fix() {
  return (
    <div className="relative flex w-[340px] items-end justify-center gap-10">
      <motion.div className="flex flex-col items-center" initial={{ opacity: 1 }} animate={{ opacity: 0.35, scale: 0.85 }} transition={{ delay: 0.6 }}>
        <div className="text-[64px]">🥀</div>
        <div className="text-[13px] text-white/60">old plan</div>
      </motion.div>
      <motion.div className="text-[34px] text-white/60" initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.9 }}>→</motion.div>
      <motion.div className="flex flex-col items-center" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.2, type: "spring", stiffness: 220, damping: 12 }}>
        <div className="text-[84px]">🌳</div>
        <div className="text-[13px] font-semibold text-[#3ee6a8]">safer design</div>
      </motion.div>
      <motion.div className="absolute -top-6 right-6 grid h-14 w-14 place-items-center rounded-full bg-[#3ee6a8] text-[28px] font-black text-black" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 1.8, type: "spring" }}>✓</motion.div>
    </div>
  );
}
