"use client";
/** The eight-agent investigation pipeline: a stepper on the left; on the right the active
 *  agent's job, how it works on the data step by step, a small animation of that work and
 *  what it actually produced on the demo investigation (live numbers). Auto-advances. */
import { AnimatePresence, motion, useInView } from "framer-motion";
import { BookOpen, Brain, Crosshair, FileCheck2, GitBranch, Network, ShieldCheck, Sprout } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface AgentStory {
  claims: { text: string; metric: string | null; op: string | null; threshold: number | null; measurable: boolean }[];
  climate: { source: string; annual_rain_mm: number; hottest_month: string; hottest_tmax_c: number };
  evidence: { sources: number; peer_reviewed: number; doi_verified: number; example: string | null };
  causal: { nodes: number; edges: number; acyclic: boolean };
  sensitivity: { parameter: string; index: number }[];
  optimisation: { evaluations: number; methods: number };
  verification: { checked: number; verified: number };
  alternatives: null | { design: string; failure_probability: number; proposal_failure_probability: number | null; tested: number };
  report: null | { version: number; sha256: string };
}

const AGENTS = [
  { key: "claims", icon: Brain, name: "Claim Extraction", ai: "Language model (Ollama / Claude / GPT) or rules",
    does: "Reads the proposal and turns promises into measurable success criteria.", input: "Proposal text, PDF report", output: "Structured claims, thresholds, assumptions",
    steps: ["Splits the proposal into sentences and finds promises (\"cool by 0.5 °C\", \"50% survive\").", "The language model fills a strict JSON schema: metric, operator (≥ / ≤), threshold, quote.", "Pydantic validates the JSON; the quote must appear word-for-word in the source.", "Vague promises (\"improve wellbeing\") are kept but marked not measurable."],
    tools: ["LLM structured output", "Pydantic validation", "Source tracing"], guard: "A quote the model cannot trace back to the document is discarded." },
  { key: "evidence", icon: BookOpen, name: "Evidence Research", ai: "Semantic retrieval",
    does: "Finds peer-reviewed studies and the site's real climate.", input: "Topics, site coordinates", output: "Papers, passages, climate record",
    steps: ["Downloads 30-year monthly climate for the exact coordinates from NASA POWER.", "Searches OpenAlex for studies on tree cooling, drought mortality and irrigation.", "Checks every DOI against Crossref; unresolvable ones are flagged.", "Splits abstracts into passages and embeds them for semantic search."],
    tools: ["OpenAlex", "Crossref DOI check", "NASA POWER", "Embedding search"], guard: "Every DOI is resolved; nothing is cited that was not retrieved." },
  { key: "causal", icon: Network, name: "Causal Analysis", ai: "Causal reasoning",
    does: "Builds the cause-and-effect graph and links evidence to each edge.", input: "Model structure, passages", output: "Causal graph, confounders",
    steps: ["Turns the simulator's equations into a directed graph: weather → water → trees → results.", "Attaches retrieved passages that support or contradict each arrow.", "NetworkX checks the graph has no loops and finds common causes (confounders).", "Each arrow is labelled equation, literature, assumption or hypothesis."],
    tools: ["NetworkX DAG", "Evidence linking"], guard: "Association is never labelled as causation." },
  { key: "sensitivity", icon: GitBranch, name: "Adversarial Research", ai: "Global sensitivity analysis",
    does: "Asks which assumptions, if wrong, would break the claim.", input: "Parameter ranges", output: "Ranked failure hypotheses",
    steps: ["Samples thousands of combinations of all uncertain inputs (Saltelli design).", "Runs the 10-year simulation for each one.", "Computes Sobol indices: how much of the outcome's variation each input explains.", "The top inputs become hypotheses for the attacker to test."],
    tools: ["SALib Sobol indices", "One-at-a-time stress"], guard: "Hypotheses come from computed sensitivity, not guesses." },
  { key: "optimisation", icon: Crosshair, name: "Optimisation", ai: "Search & evolutionary algorithms",
    does: "Hunts for the smallest plausible change that makes the claim fail.", input: "Model, bounds, budget", output: "Counterexamples, convergence",
    steps: ["Measures distance from the plan in a normalised 'plausibility space' (0 = as planned, 1 = edge of plausible).", "MPFS walks downhill on the success margin and bisects onto the failure boundary.", "Random search, differential evolution and NSGA-II get the same budget and seed.", "The closest verified failure across all methods is the answer, d*."],
    tools: ["MPFS", "Differential evolution", "NSGA-II", "Monte Carlo"], guard: "Same budget and seed for every method; all runs are logged." },
  { key: "verification", icon: ShieldCheck, name: "Independent Verification", ai: "Independent re-computation",
    does: "Re-runs every counterexample from scratch before it is trusted.", input: "Counterexample, config hash", output: "Verified / rejected",
    steps: ["Builds a fresh model instance from the stored configuration (hash must match).", "Re-simulates the counterexample and confirms the claim really fails.", "Nudges it slightly to check the failure is robust, not a numerical fluke.", "Cross-checks reference evapotranspiration against FAO-56 worked examples."],
    tools: ["Fresh model instance", "Robustness probe", "ET₀ cross-check"], guard: "It can never approve a result it produced itself." },
  { key: "alternatives", icon: Sprout, name: "Alternatives", ai: "Design search",
    does: "Re-designs the intervention and stress-tests every option.", input: "Verified failures", output: "Safer designs, trade-offs",
    steps: ["Keeps the harsh future that broke the plan.", "Tries other designs: drought-tolerant species, more water, better irrigation, lower density.", "Runs Monte Carlo on each to get a failure probability with a 95% interval.", "Ranks designs by how rarely they fail and what they cost."],
    tools: ["Species classes", "Irrigation strategies", "Monte Carlo"], guard: "Only design choices change; the climate is never 'fixed'." },
  { key: "report", icon: FileCheck2, name: "Report Compilation", ai: "Document generation",
    does: "Signs a reproducible falsification certificate.", input: "Everything above", output: "PDF + JSON, SHA-256 hash",
    steps: ["Collects claims, evidence, counterexamples, verification and alternatives.", "Writes the verdict in plain language with every limitation listed.", "Stores seeds, model version and configuration so anyone can re-run it.", "Hashes the report with SHA-256; any later edit changes the fingerprint."],
    tools: ["ReportLab", "Reproducibility config"], guard: "Seeds, versions and limitations are always included." },
] as const;
const STEP_MS = 9000;

export function AgentConstellation({ story, subject }: { story?: AgentStory | null; subject?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!inView || paused) return;
    const t = setTimeout(() => setActive((a) => (a + 1) % AGENTS.length), STEP_MS);
    return () => clearTimeout(t);
  }, [inView, paused, active]);

  const A = AGENTS[active];
  return (
    <div ref={ref} className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,380px)_1fr]" onMouseLeave={() => setPaused(false)}>
      {/* stepper */}
      <div className="relative self-start rounded-3xl border border-white/10 bg-white/[0.03] p-3">
        <div className="mb-2 flex items-center justify-between px-3 pt-2 text-[12.5px] text-white/45">
          <span>Orchestrator · LangGraph</span>
          <span className="font-mono">{String(active + 1).padStart(2, "0")} / 08</span>
        </div>
        <ol className="relative">
          <span className="absolute bottom-6 left-[29px] top-6 w-px bg-white/10" aria-hidden />
          {AGENTS.map((a, i) => {
            const on = i === active;
            const done = i < active;
            return (
              <li key={a.name}>
                <button onClick={() => { setPaused(true); setActive(i); }} onMouseEnter={() => { setPaused(true); setActive(i); }} onFocus={() => setActive(i)} className={`relative flex w-full items-center gap-3.5 rounded-2xl px-3 py-2.5 text-left transition-colors ${on ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"}`}>
                  <span className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-xl border transition-colors ${on ? "border-[#ff5b2e] bg-[#ff5b2e] text-white" : done ? "border-white/20 bg-[#16191f] text-white/80" : "border-white/10 bg-[#0e1015] text-white/40"}`}>
                    <a.icon className="h-4 w-4" strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[14.5px] font-medium ${on ? "text-white" : "text-white/65"}`}>{a.name}</span>
                    <span className="block truncate text-[12.5px] text-white/40">{story ? headline(a.key, story) : a.ai}</span>
                  </span>
                  {on && !paused && (
                    <span className="absolute inset-x-3 bottom-1 h-[2px] overflow-hidden rounded-full bg-white/5">
                      <motion.span key={active} className="block h-full bg-[#ff5b2e]" initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: STEP_MS / 1000, ease: "linear" }} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* active agent */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.01] p-6 md:p-8">
        <AnimatePresence mode="wait">
          <motion.div key={active} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#ff5b2e]/15 text-[#ff7a4d] ring-1 ring-[#ff5b2e]/30"><A.icon className="h-7 w-7" strokeWidth={1.6} /></span>
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium uppercase tracking-[0.16em] text-[#ff7a4d]">Agent {active + 1} · {A.ai}</div>
                <h3 className="mt-1 text-[28px] font-semibold leading-tight tracking-[-0.03em] text-white md:text-[34px]">{A.name}</h3>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-white/75">{A.does}</p>

            <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
              {/* how it works on the data */}
              <div>
                <div className="mb-2.5 text-[12px] font-medium uppercase tracking-[0.14em] text-white/45">How it works on the data</div>
                <ol className="space-y-2">
                  {A.steps.map((s, i) => (
                    <motion.li key={s} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.35 }} className="flex gap-3 text-[14px] leading-snug text-white/75">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 font-mono text-[11.5px] text-white">{i + 1}</span>
                      <span>{s}</span>
                    </motion.li>
                  ))}
                </ol>
                <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3"><div className="text-[11px] text-white/40">Input</div><div className="mt-0.5 text-[13.5px] text-white">{A.input}</div></div>
                  <motion.div className="h-px w-8 bg-gradient-to-r from-white/20 via-[#ff5b2e] to-white/20" animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.6, repeat: Infinity }} />
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3"><div className="text-[11px] text-white/40">Output</div><div className="mt-0.5 text-[13.5px] text-white">{A.output}</div></div>
                </div>
              </div>

              {/* live result */}
              <div className="rounded-2xl border border-white/10 bg-black/35 p-4">
                <div className="mb-3 flex items-center justify-between gap-2 text-[12px]">
                  <span className="font-medium uppercase tracking-[0.14em] text-[#3ee6a8]">{story ? "Live result" : "Example"}</span>
                  {subject && story && <span className="truncate text-white/40">{subject}</span>}
                </div>
                {story ? <Live k={A.key} s={story} /> : <div className="text-[14px] text-white/50">Live numbers appear once the demo investigation has run.</div>}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {A.tools.map((t) => <span key={t} className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-[13px] text-white/75">{t}</span>)}
            </div>
            <div className="mt-5 flex items-start gap-2.5 border-t border-white/10 pt-4 text-[14px] leading-relaxed text-white/60">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#3ee6a8]" /> {A.guard}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function headline(k: string, s: AgentStory): string {
  switch (k) {
    case "claims": return `${s.claims.filter((c) => c.measurable).length} measurable promises found`;
    case "evidence": return `${s.evidence.sources} sources · ${s.climate.source} climate`;
    case "causal": return `${s.causal.nodes} variables · ${s.causal.edges} arrows`;
    case "sensitivity": return s.sensitivity[0] ? `Top driver: ${s.sensitivity[0].parameter}` : "Sobol indices";
    case "optimisation": return `${s.optimisation.evaluations.toLocaleString("en-GB")} simulations`;
    case "verification": return `${s.verification.verified}/${s.verification.checked} confirmed`;
    case "alternatives": return s.alternatives ? `${s.alternatives.tested} designs tested` : "Design search";
    default: return s.report ? `Certificate v${s.report.version}` : "Certificate";
  }
}

const ease = [0.22, 1, 0.36, 1] as const;
const UNIT: Record<string, string> = { cooling_c: " °C", survival_rate: "", water_stress_index: "", irrigation_m3_ha: " m³/ha", annual_cost_usd_ha: " USD/ha" };
const fixText = (t: string) => t.replace(/Â°/g, "°");

/** What the agent produced on the demo investigation, animated. */
function Live({ k, s }: { k: string; s: AgentStory }) {
  if (k === "claims")
    return (
      <div className="space-y-2">
        {s.claims.slice(0, 3).map((c, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.5, ease }} className="rounded-xl bg-white/[0.04] p-2.5">
            <div className="line-clamp-2 text-[12.5px] italic text-white/55">“{fixText(c.text)}”</div>
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.6 + i * 0.5 }} className="mt-1.5">
              {c.measurable && c.metric ? (
                <span className="rounded-md bg-[#3ee6a8]/15 px-2 py-0.5 font-mono text-[12px] text-[#3ee6a8]">{c.metric} {c.op} {c.metric === "survival_rate" ? `${Math.round((c.threshold ?? 0) * 100)}%` : `${c.threshold}${UNIT[c.metric] ?? ""}`}</span>
              ) : <span className="rounded-md bg-white/10 px-2 py-0.5 text-[12px] text-white/55">not measurable: kept, not tested</span>}
            </motion.div>
          </motion.div>
        ))}
      </div>
    );
  if (k === "evidence")
    return (
      <div>
        <div className="grid grid-cols-3 gap-2">
          {[["Sources", s.evidence.sources], ["Peer-reviewed", s.evidence.peer_reviewed], ["DOI checked", s.evidence.doi_verified]].map(([l, v], i) => (
            <motion.div key={l as string} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.2 }} className="rounded-xl bg-white/[0.04] p-2.5 text-center">
              <div className="text-[22px] font-semibold text-white"><Count to={v as number} /></div>
              <div className="text-[11px] text-white/45">{l as string}</div>
            </motion.div>
          ))}
        </div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }} className="mt-3 rounded-xl bg-white/[0.04] p-2.5 text-[12.5px] text-white/70">
          🌦️ {s.climate.source}: {s.climate.annual_rain_mm} mm rain a year, hottest month {s.climate.hottest_month} at {s.climate.hottest_tmax_c} °C
        </motion.div>
        {s.evidence.example && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3 }} className="mt-2 line-clamp-2 text-[12.5px] italic text-white/50">📄 “{s.evidence.example}”</motion.div>}
      </div>
    );
  if (k === "causal") return <MiniGraph s={s} />;
  if (k === "sensitivity")
    return (
      <div className="space-y-3">
        <div className="text-[12.5px] text-white/55">Share of the outcome&apos;s variation each input explains (Sobol total index):</div>
        {s.sensitivity.map((r, i) => (
          <div key={r.parameter}>
            <div className="flex justify-between text-[13px]"><span className="text-white/80">{r.parameter}</span><span className="font-mono text-white">{r.index.toFixed(2)}</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
              <motion.div className="h-full rounded-full bg-gradient-to-r from-[#ff5b2e] to-[#f5b84a]" initial={{ width: 0 }} animate={{ width: `${Math.min(100, r.index * 100 / Math.max(0.01, s.sensitivity[0].index))}%` }} transition={{ delay: 0.3 + i * 0.3, duration: 0.9, ease }} />
            </div>
          </div>
        ))}
      </div>
    );
  if (k === "optimisation") return <MiniSearch s={s} />;
  if (k === "verification")
    return (
      <div>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: s.verification.checked }, (_, i) => (
            <motion.span key={i} initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.2 + i * 0.18, type: "spring", stiffness: 300, damping: 16 }} className={`grid h-9 w-9 place-items-center rounded-xl text-[16px] ${i < s.verification.verified ? "bg-[#3ee6a8]/15 text-[#3ee6a8]" : "bg-[#ff5b2e]/15 text-[#ff7a4d]"}`}>{i < s.verification.verified ? "✓" : "✕"}</motion.span>
          ))}
        </div>
        <div className="mt-3 text-[13.5px] text-white/70"><b className="text-white">{s.verification.verified} of {s.verification.checked}</b> breaking points re-computed from scratch and confirmed.</div>
      </div>
    );
  if (k === "alternatives")
    return s.alternatives ? (
      <div className="space-y-3">
        {[["Original plan", s.alternatives.proposal_failure_probability ?? 0, "#ff5b2e"], [s.alternatives.design, s.alternatives.failure_probability, "#3ee6a8"]].map(([l, v, c], i) => (
          <div key={l as string}>
            <div className="flex justify-between gap-2 text-[13px]"><span className="truncate text-white/80">{l as string}</span><span className="font-mono text-white">fails {Math.round((v as number) * 100)}%</span></div>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/10">
              <motion.div className="h-full rounded-full" style={{ background: c as string }} initial={{ width: 0 }} animate={{ width: `${Math.max(2, (v as number) * 100)}%` }} transition={{ delay: 0.3 + i * 0.5, duration: 1, ease }} />
            </div>
          </div>
        ))}
        <div className="text-[12.5px] text-white/50">Same harsh future for both; {s.alternatives.tested} designs tested with Monte Carlo.</div>
      </div>
    ) : <div className="text-[14px] text-white/50">No alternatives computed yet.</div>;
  return s.report ? (
    <div className="rounded-xl bg-white/[0.04] p-3.5">
      <div className="text-[13px] text-white/60">Falsification certificate · version {s.report.version}</div>
      <div className="mt-2 font-mono text-[13px] text-[#3ee6a8]">SHA-256 <Typed text={`${s.report.sha256}…`} /></div>
      <div className="mt-2 text-[12.5px] text-white/50">PDF + JSON with seeds, model version and limitations. Change one character and the fingerprint changes.</div>
    </div>
  ) : <div className="text-[14px] text-white/50">The report is generated at the end of a run.</div>;
}

function Count({ to }: { to: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 900);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{v.toLocaleString("en-GB")}</>;
}

function Typed({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((x) => (x >= text.length ? x : x + 1)), 60);
    return () => clearInterval(id);
  }, [text]);
  return <>{text.slice(0, n)}<span className="animate-pulse">▍</span></>;
}

/** Four layers of the causal graph lighting up left to right. */
function MiniGraph({ s }: { s: AgentStory }) {
  const cols = [["🌡️ Heat", "🌧️ Rain", "💨 Wind"], ["💧 Water demand", "🪣 Soil water"], ["😰 Tree stress", "🍂 Mortality"], ["❄️ Cooling", "🌳 Survival"]];
  return (
    <div>
      <div className="relative grid grid-cols-4 gap-2">
        {cols.map((c, ci) => (
          <div key={ci} className="flex flex-col justify-center gap-1.5">
            {c.map((n, ni) => (
              <motion.div key={n} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 + ci * 0.45 + ni * 0.1 }} className="rounded-lg border border-white/10 bg-white/[0.05] px-1.5 py-1 text-center text-[11px] leading-tight text-white/80">{n}</motion.div>
            ))}
          </div>
        ))}
        <motion.div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-transparent via-[#ff5b2e]/30 to-transparent" initial={{ x: 0 }} animate={{ x: "1100%" }} transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }} />
      </div>
      <div className="mt-3 text-[13px] text-white/70"><b className="text-white">{s.causal.nodes}</b> variables, <b className="text-white">{s.causal.edges}</b> arrows · {s.causal.acyclic ? "no loops ✓" : "loop found"}</div>
    </div>
  );
}

/** Dots searching a plane and converging on the failure boundary. */
function MiniSearch({ s }: { s: AgentStory }) {
  const dots = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2;
    return { x: 50 + Math.cos(a) * (18 + (i % 4) * 9), y: 55 + Math.sin(a) * (14 + (i % 3) * 8) };
  });
  return (
    <div>
      <div className="relative h-[130px] overflow-hidden rounded-xl bg-gradient-to-br from-[#3ee6a8]/15 via-[#3ee6a8]/5 to-[#ff5b2e]/30">
        <div className="absolute right-0 top-0 h-full w-[34%] bg-[#ff5b2e]/25" style={{ clipPath: "polygon(30% 0, 100% 0, 100% 100%, 0 100%)" }} />
        <div className="absolute left-[48%] top-[50%] text-[13px]">🏁</div>
        {dots.map((d, i) => (
          <motion.span key={i} className="absolute h-2 w-2 rounded-full bg-white/80" initial={{ left: `${d.x}%`, top: `${d.y}%`, opacity: 0 }} animate={{ left: ["50%", `${d.x}%`, "71%"], top: ["52%", `${d.y}%`, "48%"], opacity: [0, 1, i < 4 ? 1 : 0.15] }} transition={{ duration: 3.2, delay: i * 0.08, repeat: Infinity, repeatDelay: 0.8 }} />
        ))}
        <motion.span className="absolute left-[71%] top-[48%] text-[16px]" animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }}>⭐</motion.span>
      </div>
      <div className="mt-3 text-[13px] text-white/70"><b className="text-white"><Count to={s.optimisation.evaluations} /></b> full 10-year simulations across <b className="text-white">{s.optimisation.methods}</b> search methods.</div>
    </div>
  );
}
