"use client";
/**
 * "Where the AI is used": six uses, each with an animated mini-demo (input → AI → output → safety
 * check) and the details behind it. `AiReel` plays all six full-screen as a film (for recording).
 * Examples use the demo investigation's real computed values (New Delhi).
 */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { cn } from "@/lib/format";

interface Use {
  key: string; emoji: string; title: string; kind: string; simple: string;
  input: string; engine: string; outputs: string[]; check: { ok: boolean; text: string }; reject?: string;
  steps: string[]; where: string;
}

export const AI_USES: Use[] = [
  { key: "read", emoji: "📜", title: "Reading proposals", kind: "Language model (Ollama / Claude / GPT)",
    simple: "Turns a written plan into exact, testable targets.",
    input: "“The programme will reduce summer daytime air temperatures by 0.5 °C within 10 years, with at least 50% of planted trees surviving.”",
    engine: "Claim Extraction Agent", outputs: ["🌡️ cooling ≥ 0.5 °C", "🌳 survival ≥ 50%", "⏱️ horizon 10 years", "⚠️ assumption: water available all dry season"],
    check: { ok: true, text: "Every quote found word-for-word in the document" },
    steps: ["The proposal (text or PDF) is sent to the language model with a strict JSON schema.", "The model returns claims: metric, operator, threshold and the exact quote.", "Pydantic validates the JSON; quotes that are not in the document are discarded.", "Without an AI key a rule-based reader does the same job with patterns."],
    where: "Investigation → Claims tab" },
  { key: "build", emoji: "🪄", title: "Building your scenario", kind: "Language model",
    simple: "Type an idea in plain words and the AI fills in the whole investigation.",
    input: "“Plant 300 trees per hectare in Jaipur to cool the streets by 1 °C and keep 70% of trees alive, using drip irrigation.”",
    engine: "Scenario builder", outputs: ["📍 Jaipur, India · 26.91, 75.79", "🌡️ cooling ≥ 1 °C", "🌳 survival ≥ 70%", "🌱 300 trees / ha · drip irrigation"],
    check: { ok: true, text: "Known city → exact coordinates from the gazetteer; targets limited to 5 allowed metrics" },
    steps: ["Your idea goes to the model with a schema for title, place, coordinates and targets.", "Known cities are pinned to exact coordinates; unknown ones must be within ±66° latitude.", "Only five metrics and the operators ≥ / ≤ are accepted.", "Leave the box empty and press “Surprise me” — it invents a realistic plan for a hot city."],
    where: "New investigation → “Let AI build it”" },
  { key: "ask", emoji: "💬", title: "Answering questions", kind: "AI Copilot",
    simple: "Ask why something happened and get an answer built only from the computed numbers.",
    input: "“Why does the plan fail?”",
    engine: "Copilot (grounded)", outputs: ["The smallest breaking change has d* = 0.29:", "drought mortality sensitivity 0.15 → 0.19", "baseline annual mortality 0.040 → 0.045", "→ tree survival drops below the 50% target"],
    check: { ok: true, text: "Every number in the answer exists in the computed fact sheet" },
    steps: ["BACKFIRE builds a fact sheet: verdict, breaking change, Sobol ranks, Monte Carlo, alternatives.", "The model may only use that sheet to write a short plain-language answer.", "Every number in the answer is checked against the sheet.", "If one doesn't match, the answer is thrown away and the grounded engine answers instead."],
    where: "Any investigation → “Ask AI” button" },
  { key: "narrate", emoji: "🎬", title: "Narrating the film", kind: "Language model",
    simple: "Writes the movie's subtitles in friendly words.",
    input: "Facts: breaking change · 49.8% trees alive at year 10 · 0.62 °C cooling · target 50% · breaks in year 10",
    engine: "Film narrator", outputs: ["“Ten summers pass. In year 10 only 49.8% of the trees are still standing, just under the 50% promise, so it breaks.”"],
    check: { ok: false, text: "A draft said “2.3 °C” — not in the facts → rejected, the grounded narrator is used" },
    reject: "“…streets end up 2.3 °C cooler…”",
    steps: ["The film's scenes are computed first: survival per year, monthly stress, rain, irrigation.", "The model gets only those numbers and writes ≤ 45 words per scene.", "Numbers in the subtitles are checked against the scene data.", "Any invented number → all AI subtitles are rejected and the grounded narrator is used."],
    where: "Investigation → ▶ Simulation film" },
  { key: "search", emoji: "🔨", title: "Finding the breaking point", kind: "Search & evolutionary algorithms",
    simple: "Hunts through thousands of possible futures for the smallest realistic change that breaks the promise.",
    input: "13 uncertain inputs, each with a plausible range (heat, rain, water supply, soil, species…)",
    engine: "MPFS · Differential evolution · NSGA-II · Random", outputs: ["6,020 full 10-year simulations", "closest failure: d* = 0.29", "verified 8 / 8 breaking points", "fails in 60% of plausible futures"],
    check: { ok: true, text: "Same budget and same seed for every method; every evaluation is stored" },
    steps: ["Distances are measured in a normalised “plausibility space”: 0 = as planned, 1 = edge of plausible.", "MPFS walks downhill on the success margin and bisects onto the failure edge.", "Three classic methods get the same budget so the comparison is fair.", "Every candidate is re-computed by the independent verifier."],
    where: "Investigation → Adversarial engine · Failure boundary" },
  { key: "coord", emoji: "🎼", title: "Coordinating everything", kind: "Multi-agent system (LangGraph)",
    simple: "A conductor runs eight specialist agents in order, with time limits, retries and an independent checker.",
    input: "Press “Run the simulation”",
    engine: "LangGraph orchestrator", outputs: ["1 📜 claims", "2 📚 evidence", "3 🔗 cause & effect", "4 🎯 sensitivity", "5 🔨 optimisation", "6 🛡️ verification", "7 🌱 alternatives", "8 📄 report"],
    check: { ok: true, text: "Per-agent timeouts, retries and a loop guard; the checker never approves its own results" },
    steps: ["Each agent is a node in a state graph; the state carries results between them.", "Every agent run and event is logged and streamed live to your screen.", "Failures are retried; loops are stopped by a guard.", "The final report is hashed (SHA-256) so it can't be quietly changed."],
    where: "Investigation → Agents timeline (live)" },
];

const STAGE_MS = 9000;

/** Animated mini-demo for one use: input types in → AI thinks → outputs pop → check stamp. */
function Stage({ u, big = false }: { u: Use; big?: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const id = setInterval(() => setN((x) => x + 1), 40);
    return () => clearInterval(id);
  }, [u.key]);
  const typed = u.input.slice(0, Math.min(u.input.length, n * 2));
  const tIn = Math.ceil(u.input.length / 2) * 40; // ms to finish typing
  const ms = n * 40;
  const thinking = ms > tIn && ms < tIn + 1200;
  const shown = ms < tIn + 1200 ? 0 : Math.min(u.outputs.length, Math.floor((ms - tIn - 1200) / 450) + 1);
  const checked = shown >= u.outputs.length && ms > tIn + 1200 + u.outputs.length * 450 + 500;
  return (
    <div className={cn("grid gap-3", big ? "grid-cols-[1fr_auto_1fr] items-center" : "grid-cols-1 md:grid-cols-[1fr_auto_1fr] md:items-center")}>
      <div className={cn("rounded-2xl border border-white/10 bg-black/40 p-4", big && "p-6")}>
        <div className="text-[11.5px] uppercase tracking-[0.16em] text-white/40">In</div>
        <div className={cn("mt-1.5 leading-relaxed text-white/85", big ? "text-[20px]" : "text-[14px]")}>{typed}<span className="animate-pulse">{typed.length < u.input.length ? "▍" : ""}</span></div>
        {u.reject && checked && <div className={cn("mt-2 rounded-lg bg-[#ff5b2e]/15 px-2 py-1 text-[#ff8a5b] line-through", big ? "text-[16px]" : "text-[12.5px]")}>{u.reject}</div>}
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <motion.div animate={thinking ? { scale: [1, 1.15, 1], rotate: [0, 8, -8, 0] } : { scale: 1 }} transition={{ duration: 0.8, repeat: thinking ? Infinity : 0 }}
          className={cn("grid place-items-center rounded-2xl bg-[#ff5b2e]/15 ring-1 ring-[#ff5b2e]/40", big ? "h-24 w-24 text-[44px]" : "h-14 w-14 text-[26px]")}>{u.emoji}</motion.div>
        <div className={cn("max-w-[160px] text-center text-white/55", big ? "text-[14px]" : "text-[11.5px]")}>{thinking ? "thinking…" : u.engine}</div>
        <div className="relative h-1 w-16 overflow-hidden rounded-full bg-white/10">{thinking && <motion.span className="absolute inset-y-0 w-6 bg-[#ff5b2e]" animate={{ x: [-24, 64] }} transition={{ duration: 0.7, repeat: Infinity }} />}</div>
      </div>
      <div className={cn("rounded-2xl border border-white/10 bg-black/40 p-4", big && "p-6")}>
        <div className="text-[11.5px] uppercase tracking-[0.16em] text-white/40">Out</div>
        <div className={cn("mt-1.5 flex flex-wrap gap-1.5", u.key === "ask" || u.key === "narrate" ? "flex-col" : "")}>
          {u.outputs.slice(0, shown).map((o) => (
            <motion.span key={o} initial={{ opacity: 0, y: 8, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} className={cn("rounded-lg bg-[#3ee6a8]/12 px-2.5 py-1 text-[#bff5df]", big ? "text-[18px]" : "text-[13px]")}>{o}</motion.span>
          ))}
          {shown === 0 && <span className={cn("text-white/30", big ? "text-[16px]" : "text-[13px]")}>waiting…</span>}
        </div>
        <AnimatePresence>
          {checked && (
            <motion.div initial={{ opacity: 0, scale: 1.4, rotate: -6 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 18 }}
              className={cn("mt-3 inline-flex items-start gap-2 rounded-xl border px-3 py-1.5 font-semibold", u.check.ok ? "border-[#3ee6a8]/50 text-[#3ee6a8]" : "border-[#ff5b2e]/60 text-[#ff8a5b]", big ? "text-[16px]" : "text-[12.5px]")}>
              {u.check.ok ? "✓" : "✗"} {u.check.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Interactive section: pick a use (auto-advances), watch its demo, read the details. */
export function AiUses() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setI((x) => (x + 1) % AI_USES.length), STAGE_MS + 3000);
    return () => clearTimeout(t);
  }, [i, paused]);
  const u = AI_USES[i];
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
      <div className="flex gap-2 overflow-x-auto lg:flex-col">
        {AI_USES.map((x, k) => (
          <button key={x.key} onClick={() => { setPaused(true); setI(k); }} className={cn("relative flex shrink-0 items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 text-left transition-colors", k === i ? "border-[#ff5b2e]/60 bg-[#ff5b2e]/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]")}>
            <span className="text-[22px]">{x.emoji}</span>
            <span><span className="block text-[15px] font-semibold text-white">{x.title}</span><span className="block text-[12px] text-white/45">{x.kind}</span></span>
            {k === i && !paused && <motion.span key={i} className="absolute bottom-0 left-0 h-[2px] bg-[#ff5b2e]" initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ duration: (STAGE_MS + 3000) / 1000, ease: "linear" }} />}
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={u.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[24px] font-semibold tracking-[-0.02em] text-white">{u.emoji} {u.title}</div>
            <span className="rounded-full bg-[#ff5b2e]/15 px-3 py-1 text-[12.5px] text-[#ff9a73]">{u.kind}</span>
          </div>
          <p className="mt-1 text-[16px] text-white/70">{u.simple}</p>
          <div className="mt-5"><Stage u={u} /></div>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-[1.4fr_1fr]">
            <div>
              <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.14em] text-white/45">How it works</div>
              <ol className="space-y-1.5">
                {u.steps.map((s, k) => <li key={s} className="flex gap-2.5 text-[14px] leading-snug text-white/75"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 font-mono text-[11px]">{k + 1}</span>{s}</li>)}
              </ol>
            </div>
            <div className="space-y-3">
              <div className="rounded-2xl bg-[#3ee6a8]/[0.07] p-3.5"><div className="text-[12px] font-medium uppercase tracking-[0.14em] text-[#3ee6a8]">Safety check</div><div className="mt-1 text-[14px] text-white/80">{u.check.text}</div></div>
              <div className="rounded-2xl bg-white/[0.04] p-3.5"><div className="text-[12px] font-medium uppercase tracking-[0.14em] text-white/45">Where to see it</div><div className="mt-1 text-[14px] text-white/80">{u.where}</div></div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Full-screen film of all six uses (sets window.__filmDone at the end). */
export function AiReel({ record = false }: { record?: boolean }) {
  const [i, setI] = useState(-1); // -1 = title card
  useEffect(() => {
    (window as unknown as { __filmStarted?: number }).__filmStarted = performance.now();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      if (i < AI_USES.length - 1) setI(i + 1);
      else if (record) (window as unknown as { __filmDone?: boolean }).__filmDone = true;
      else setI(-1); // loop on the website
    }, i < 0 ? 4000 : STAGE_MS + 2500);
    return () => clearTimeout(t);
  }, [i, record]);
  const u = i >= 0 ? AI_USES[i] : null;
  return (
    <div className={cn("overflow-hidden bg-[radial-gradient(ellipse_at_top,#1a1f2e,#05070c_70%)] text-white", record ? "fixed inset-0" : "relative aspect-video w-full rounded-3xl border border-white/10")}>
      <AnimatePresence mode="wait">
        {u ? (
          <motion.div key={u.key} className="absolute inset-0 flex flex-col justify-center px-[6%]" initial={{ opacity: 0, x: 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -60 }} transition={{ duration: 0.5 }}>
            <div className="text-[14px] uppercase tracking-[0.25em] text-[#ff7a4d]">Where the AI is used · {i + 1} of {AI_USES.length}</div>
            <div className="mt-2 text-[44px] font-semibold tracking-[-0.03em]">{u.emoji} {u.title}</div>
            <div className="mt-1 text-[20px] text-white/65">{u.simple} <span className="text-white/40">· {u.kind}</span></div>
            <div className="mt-8"><Stage u={u} big /></div>
          </motion.div>
        ) : (
          <motion.div key="title" className="absolute inset-0 grid place-items-center text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div>
              <div className="text-[14px] uppercase tracking-[0.3em] text-white/55">BACKFIRE AI</div>
              <div className="mt-3 text-[60px] font-semibold tracking-[-0.03em]">Where the AI is used</div>
              <div className="mt-2 text-[22px] text-white/65">AI reads, writes, searches and coordinates. Every number comes from the simulation.</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
