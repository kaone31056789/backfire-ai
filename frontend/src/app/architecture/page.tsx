"use client";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Logo } from "@/components/auth-form";
import { EngineFilmSection } from "@/components/engine-film-section";
import { TOUR } from "@/components/architecture-tour";
import { EDGES, GROUP_COLOR, NODES } from "@/components/three/architecture-3d";
import { cn } from "@/lib/format";

const Architecture3D = dynamic(() => import("@/components/three/architecture-3d").then((m) => m.Architecture3D), { ssr: false });

const LANES = ["You", "Website", "API", "Job runner", "Agents", "Science engine", "Database"];
const SEQ: [number, number, string][] = [
  [0, 1, "Press Run"], [1, 2, "POST /investigations"], [2, 6, "Save plan + audit"], [2, 3, "Start job"], [3, 0, "Live updates (WebSocket)"],
  [3, 4, "Run 8 agents"], [4, 5, "Simulate thousands of futures"], [5, 4, "Results"], [4, 6, "Save claims, evidence, runs, report"], [1, 2, "GET results"], [2, 1, "Verdict, film, certificate"],
];

const DATA = [
  ["👤", "Users & roles", "Who you are; admin / analyst / viewer.", "User, Organisation"],
  ["🔐", "AI keys (locked)", "Your Ollama/Claude/GPT keys, encrypted. Never sent to the browser.", "ApiKey (Fernet)"],
  ["📋", "Investigations", "Each plan you test: place, promise, settings.", "Investigation, Intervention"],
  ["📜", "Claims & assumptions", "Promises as numbers, plus hidden assumptions.", "Claim, Assumption"],
  ["📚", "Evidence", "Papers, passages and the climate record.", "EvidenceSource, EvidencePassage"],
  ["🔗", "Cause-and-effect map", "Variables and arrows with their evidence.", "CausalGraph, CausalNode, CausalEdge"],
  ["🎛️", "Parameters", "Every uncertain number with its plausible range.", "EnvironmentalParameter, ModelConfiguration"],
  ["🔨", "Search runs", "Every method's run and every simulation it made.", "OptimisationRun, OptimisationEvaluation"],
  ["💥", "Breaking points", "Counterexamples and whether they were verified.", "Counterexample, VerificationResult"],
  ["📊", "Analyses", "Sobol, Monte Carlo, alternative designs.", "AnalysisResult, ScenarioComparison"],
  ["📄", "Reports", "Certificate versions with SHA-256 fingerprints.", "InvestigationReport"],
  ["🧾", "Logs", "Agent events, AI usage and an audit trail.", "AgentExecution, AgentEvent, LlmUsage, AuditLog"],
];

const GUARDS = [
  ["🔑", "Login", "httpOnly JWT cookies with refresh; passwords hashed with bcrypt."],
  ["🛂", "Roles", "Viewers can look, analysts can run, admins manage."],
  ["🧱", "CSRF shield", "Every change must carry a special header a malicious site can't add."],
  ["🚦", "Rate limits", "Heavy endpoints are throttled per user."],
  ["🌐", "Allow-list", "The server can only call NASA, OpenAlex, Crossref, GBIF and the chosen AI — nothing else (SSRF guard)."],
  ["🔒", "Locked keys", "AI keys are encrypted at rest and never returned to the browser."],
  ["🔢", "No invented numbers", "Any AI sentence containing a number the engine didn't compute is rejected."],
  ["🧾", "Audit trail", "Every important action is logged with who, what and when."],
];

const STACK = [
  ["Website", "Next.js 15, React 19, Tailwind v4, three.js, MapLibre, ECharts"],
  ["API", "Python, FastAPI, Pydantic v2, WebSockets"],
  ["AI agents", "LangGraph; Ollama / Claude / GPT for text only"],
  ["Science", "NumPy, SciPy, pymoo (NSGA-II), SALib (Sobol), NetworkX"],
  ["Storage", "SQLAlchemy 2 + Alembic; SQLite locally, PostgreSQL + PostGIS + pgvector in production"],
  ["Reports", "ReportLab PDF, SHA-256"],
  ["Deploy", "Docker Compose / Coolify"],
];

export default function ArchitecturePage() {
  const [step, setStep] = useState<number | null>(null);
  const [auto, setAuto] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (!auto || step === null) return;
    const t = setTimeout(() => (step < TOUR.length - 1 ? setStep(step + 1) : setAuto(false)), 6500);
    return () => clearTimeout(t);
  }, [auto, step]);

  const view = useMemo(() => {
    if (step !== null) {
      const s = TOUR[step];
      return { nodes: new Set(s.nodes), edges: new Set(s.edges.map(([a, b]) => `${a}>${b}`)), focus: NODES.find((n) => n.id === s.focus)?.pos ?? null };
    }
    if (picked) {
      const es = EDGES.filter((e) => e.from === picked || e.to === picked);
      return { nodes: new Set([picked, ...es.flatMap((e) => [e.from, e.to])]), edges: new Set(es.map((e) => `${e.from}>${e.to}`)), focus: NODES.find((n) => n.id === picked)?.pos ?? null };
    }
    return { nodes: null, edges: null, focus: null };
  }, [step, picked]);

  const node = picked ? NODES.find((n) => n.id === picked) : null;

  return (
    <main className="min-h-screen bg-[#05070c] text-white">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#05070c]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5"><Logo size={28} /><span className="font-semibold">BACKFIRE<span className="text-[#ff5b2e]"> AI</span></span></Link>
          <nav className="flex items-center gap-1 text-[14px]">
            <a href="#map" className="rounded-full px-3 py-1.5 text-white/65 hover:text-white">3D map</a>
            <a href="#journey" className="hidden rounded-full px-3 py-1.5 text-white/65 hover:text-white sm:block">Journey</a>
            <a href="#data" className="hidden rounded-full px-3 py-1.5 text-white/65 hover:text-white sm:block">Data</a>
            <a href="#film" className="hidden rounded-full px-3 py-1.5 text-white/65 hover:text-white sm:block">Film</a>
            <Link href="/how-it-works" className="rounded-full px-3 py-1.5 text-white/65 hover:text-white">Guide</Link>
            <Link href="/" className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 font-semibold text-black"><ArrowLeft className="h-4 w-4" /> Home</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-6 pb-28">
        <section className="pt-16 text-center">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-[13px] font-medium uppercase tracking-[0.22em] text-[#ff7a4d]">Inside BACKFIRE</motion.div>
          <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mx-auto mt-4 max-w-4xl text-[44px] font-semibold leading-[1.03] tracking-[-0.035em] md:text-[68px]">How the backend works, explained like a city.</motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mx-auto mt-6 max-w-2xl text-[18px] leading-relaxed text-white/65">
            A front door checks visitors, a conductor directs eight specialist AI agents, a science lab runs the simulations, and a vault remembers everything. Spin the map, tap any building, or take the guided tour.
          </motion.p>
        </section>

        {/* ---------------------------------------------------------------- 3D map */}
        <section id="map" className="mt-14 scroll-mt-20">
          <div className="relative overflow-hidden rounded-[28px] border border-white/10">
            <Architecture3D activeNodes={view.nodes} activeEdges={view.edges} selected={picked} onPick={(id) => { setStep(null); setAuto(false); setPicked(id); }} focus={view.focus} />
            <div className="absolute left-4 top-4 z-30 flex flex-wrap gap-2">
              <button onClick={() => { setPicked(null); setStep(0); setAuto(true); }} className="inline-flex items-center gap-2 rounded-full bg-[#ff5b2e] px-4 py-2 text-[14px] font-semibold text-white shadow-lg"><Play className="h-4 w-4 fill-white" /> Follow one investigation</button>
              {(step !== null || picked) && <button onClick={() => { setStep(null); setAuto(false); setPicked(null); }} className="rounded-full bg-black/60 px-4 py-2 text-[14px] text-white/80 hover:text-white">Show everything</button>}
            </div>
            <div className="pointer-events-none absolute right-4 top-4 z-30 hidden flex-col gap-1 rounded-2xl bg-black/60 p-3 text-[12px] md:flex">
              {([["you", "You"], ["web", "Website"], ["api", "Front door & job runner"], ["brain", "Conductor"], ["agent", "AI agents"], ["science", "Science engine"], ["memory", "Storage & reports"], ["world", "Outside services"]] as const).map(([g, l]) => (
                <span key={g} className="flex items-center gap-2 text-white/75"><span className="h-2.5 w-2.5 rounded-full" style={{ background: GROUP_COLOR[g] }} />{l}</span>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {step !== null ? (
                <motion.div key={`t${step}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="absolute inset-x-4 bottom-4 z-30 rounded-2xl bg-black/80 p-4 md:right-auto md:max-w-[620px] md:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] font-medium uppercase tracking-[0.2em] text-[#ff7a4d]">Step {step + 1} of {TOUR.length}</div>
                    <div className="flex gap-1">
                      <button onClick={() => { setAuto(false); setStep(Math.max(0, step - 1)); }} className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 hover:bg-white/20" aria-label="Previous"><ChevronLeft className="h-4 w-4" /></button>
                      <button onClick={() => setAuto((a) => !a)} className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 hover:bg-white/20" aria-label={auto ? "Pause" : "Play"}>{auto ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
                      <button onClick={() => { setAuto(false); setStep(Math.min(TOUR.length - 1, step + 1)); }} className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 hover:bg-white/20" aria-label="Next"><ChevronRight className="h-4 w-4" /></button>
                    </div>
                  </div>
                  <div className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">{TOUR[step].title}</div>
                  <p className="mt-1 text-[15px] leading-relaxed text-white/80">{TOUR[step].simple}</p>
                  <p className="mt-2 border-t border-white/10 pt-2 font-mono text-[12px] leading-relaxed text-[#9fe3c6]">{TOUR[step].tech}</p>
                  <div className="mt-3 flex gap-1">{TOUR.map((_, k) => <button key={k} onClick={() => { setAuto(false); setStep(k); }} className={cn("h-1.5 flex-1 rounded-full", k <= step ? "bg-[#ff5b2e]" : "bg-white/15")} aria-label={`Step ${k + 1}`} />)}</div>
                </motion.div>
              ) : node ? (
                <motion.div key={node.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute inset-x-4 bottom-4 z-30 rounded-2xl bg-black/80 p-4 md:right-auto md:max-w-[560px] md:p-5">
                  <div className="flex items-center gap-3"><span className="text-[28px]">{node.emoji}</span><div><div className="text-[20px] font-semibold">{node.label}</div><div className="text-[12px] uppercase tracking-[0.16em]" style={{ color: GROUP_COLOR[node.group] }}>{node.group === "agent" ? "AI agent" : node.group}</div></div></div>
                  <p className="mt-2 text-[15px] leading-relaxed text-white/80">{node.simple}</p>
                  <p className="mt-2 border-t border-white/10 pt-2 font-mono text-[12px] leading-relaxed text-[#9fe3c6]">{node.tech}</p>
                  {node.files.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{node.files.map((f) => <span key={f} className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11px] text-white/70">{f}</span>)}</div>}
                </motion.div>
              ) : (
                <motion.div key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-[13.5px] text-white/60">👆 Tap a building · drag to spin · scroll to zoom</motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* ---------------------------------------------------------------- the three layers in words */}
        <section className="mt-20 grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            ["🚪", "The front", "Website + API", "What you click, and the door that checks every request before anything happens."],
            ["🧠", "The brain", "Conductor + 8 agents", "Specialists that read, research, reason, attack, check, improve and report — in a fixed, logged order."],
            ["🧪", "The lab & vault", "Science engine + database", "Physics-based simulations run thousands of times; every input, run and result is kept so it can be re-checked."],
          ].map(([e, t, s, d], i) => (
            <motion.div key={t} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }} className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <div className="text-[34px]">{e}</div>
              <div className="mt-2 text-[22px] font-semibold">{t}</div>
              <div className="text-[13px] uppercase tracking-[0.14em] text-[#ff7a4d]">{s}</div>
              <p className="mt-2 text-[15.5px] leading-relaxed text-white/65">{d}</p>
            </motion.div>
          ))}
        </section>

        {/* ---------------------------------------------------------------- sequence diagram */}
        <section id="journey" className="mt-24 scroll-mt-20">
          <h2 className="text-[34px] font-semibold tracking-[-0.03em]">The journey of one request</h2>
          <p className="mt-2 max-w-2xl text-[16px] text-white/60">Read top to bottom. Each arrow is a message between two parts of the system.</p>
          <div className="mt-8 overflow-x-auto rounded-3xl border border-white/10 bg-white/[0.02] p-5">
            <svg viewBox={`0 0 ${LANES.length * 150} ${90 + SEQ.length * 46}`} className="min-w-[900px]" style={{ width: "100%" }}>
              <defs><marker id="seq-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#ff7a4d" /></marker></defs>
              {LANES.map((l, i) => (
                <g key={l}>
                  <rect x={i * 150 + 15} y={8} width={120} height={36} rx={12} fill="#141a26" stroke="#ffffff22" />
                  <text x={i * 150 + 75} y={31} textAnchor="middle" fill="#fff" fontSize="13" fontWeight="600">{l}</text>
                  <line x1={i * 150 + 75} y1={46} x2={i * 150 + 75} y2={70 + SEQ.length * 46} stroke="#ffffff1f" strokeDasharray="4 5" />
                </g>
              ))}
              {SEQ.map(([a, b, t], k) => {
                const y = 76 + k * 46, x1 = a * 150 + 75, x2 = b * 150 + 75;
                return (
                  <motion.g key={k} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.15 * k }}>
                    <line x1={x1} y1={y} x2={x2 + (x2 > x1 ? -6 : 6)} y2={y} stroke="#ff7a4d" strokeWidth={1.8} markerEnd="url(#seq-ar)" />
                    <circle cx={Math.min(x1, x2) - 0} cy={y} r={0} />
                    <rect x={(x1 + x2) / 2 - 92} y={y - 21} width={184} height={17} rx={8} fill="#05070c" />
                    <text x={(x1 + x2) / 2} y={y - 8.5} textAnchor="middle" fill="#e5e7eb" fontSize="11.5">{k + 1}. {t}</text>
                  </motion.g>
                );
              })}
            </svg>
          </div>
        </section>

        {/* ---------------------------------------------------------------- data */}
        <section id="data" className="mt-24 scroll-mt-20">
          <h2 className="text-[34px] font-semibold tracking-[-0.03em]">What the vault remembers</h2>
          <p className="mt-2 max-w-2xl text-[16px] text-white/60">Everything is saved, so any result can be traced back to its inputs and re-run. Grey text shows the real table names.</p>
          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {DATA.map(([e, t, d, tech], i) => (
              <motion.div key={t} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: (i % 4) * 0.06 }} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-[24px]">{e}</div>
                <div className="mt-1 text-[16px] font-semibold">{t}</div>
                <p className="mt-1 text-[14px] text-white/65">{d}</p>
                <div className="mt-2 font-mono text-[11.5px] text-white/35">{tech}</div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- guards */}
        <section className="mt-24">
          <h2 className="text-[34px] font-semibold tracking-[-0.03em]">The guards at every door</h2>
          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {GUARDS.map(([e, t, d]) => (
              <div key={t} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-2 text-[16px] font-semibold"><span className="text-[22px]">{e}</span>{t}</div>
                <p className="mt-1.5 text-[14px] text-white/65">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- stack */}
        <section className="mt-24">
          <h2 className="text-[34px] font-semibold tracking-[-0.03em]">Built with</h2>
          <div className="mt-6 overflow-hidden rounded-3xl border border-white/10">
            {STACK.map(([k, v], i) => (
              <div key={k} className={cn("grid grid-cols-[140px_1fr] gap-4 px-5 py-3.5 text-[15px] md:grid-cols-[200px_1fr]", i % 2 ? "bg-white/[0.02]" : "bg-white/[0.04]")}>
                <span className="font-semibold">{k}</span><span className="text-white/70">{v}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- film */}
        <section id="film" className="mt-24 scroll-mt-20">
          <h2 className="text-[34px] font-semibold tracking-[-0.03em]">Watch the engine calculate 🎬</h2>
          <p className="mt-2 max-w-2xl text-[16px] text-white/60">What happens inside the science engine, step by step, with the real formulas and numbers from the demo investigation.</p>
          <div className="mt-8"><EngineFilmSection /></div>
        </section>
      </div>
    </main>
  );
}
