"use client";
/** The guided "follow one investigation" tour of the backend, shared by /architecture and /films/architecture. */
import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { NODES } from "@/components/three/architecture-3d";

const Architecture3D = dynamic(() => import("@/components/three/architecture-3d").then((m) => m.Architecture3D), { ssr: false });

/** A guided tour: one investigation travelling through the system. */
export const TOUR: { title: string; simple: string; tech: string; nodes: string[]; edges: [string, string][]; focus: string }[] = [
  { title: "You press “Run”", simple: "Your browser sends the plan (place, promise, trees) to the website, which passes it to the front door.", tech: "POST /api/investigations then POST /api/investigations/{id}/run-backfire. httpOnly JWT cookie + CSRF header.", nodes: ["browser", "web", "api"], edges: [["browser", "web"], ["web", "api"]], focus: "web" },
  { title: "The front door checks you", simple: "It checks you are logged in, that you are allowed to do this, and that nobody is flooding the server.", tech: "JWT verification, role check (viewer cannot write), rate limiter, Pydantic validation of every field, audit log entry saved to the database.", nodes: ["api", "db"], edges: [["api", "db"]], focus: "api" },
  { title: "The job runner takes over", simple: "The work takes about a minute, so it runs in the background. Your page stays smooth and shows live progress.", tech: "Thread-pool worker starts the workflow; each agent event is saved and streamed over a WebSocket (60-second ticket).", nodes: ["api", "worker", "browser"], edges: [["api", "worker"], ["worker", "browser"]], focus: "worker" },
  { title: "The conductor wakes the agents", simple: "A conductor sends the job to 8 specialist AI agents, one after another, and retries if one stumbles.", tech: "LangGraph StateGraph: per-agent timeout, retries, loop guard; AgentExecution + AgentEvent rows.", nodes: ["worker", "orch"], edges: [["worker", "orch"]], focus: "orch" },
  { title: "Agent 1 reads the promise", simple: "The language model reads the plan and writes the promises as exact numbers: “cooling ≥ 0.5 °C”, “50% of trees alive”.", tech: "Structured output against a Pydantic schema; quotes must appear in the source; rule-based fallback if no AI key is set.", nodes: ["orch", "claims", "llm"], edges: [["orch", "claims"], ["claims", "llm"]], focus: "claims" },
  { title: "Agent 2 gathers the facts", simple: "It downloads 30 years of the place's real weather from NASA and finds scientific papers, checking each one exists.", tech: "NASA POWER climatology, OpenAlex search, Crossref DOI verification, GBIF species check. Outgoing calls only to an allow-list (SSRF guard).", nodes: ["orch", "evidence", "nasa", "openalex", "crossref", "gbif"], edges: [["orch", "evidence"], ["evidence", "nasa"], ["evidence", "openalex"], ["evidence", "crossref"], ["evidence", "gbif"]], focus: "evidence" },
  { title: "Agent 3 draws cause and effect", simple: "It draws how heat, rain and water lead to thirsty trees and finally to cooling, and attaches evidence to each arrow.", tech: "NetworkX DAG (26 nodes), acyclicity and confounder analysis; stored as CausalGraph / CausalNode / CausalEdge.", nodes: ["orch", "causal", "db"], edges: [["orch", "causal"], ["causal", "db"]], focus: "causal" },
  { title: "Agents 4 & 5 try to break it", simple: "Thousands of pretend futures are simulated. First we find which unknowns matter most, then we hunt for the smallest change that breaks the promise.", tech: "SALib Sobol indices; MPFS vs random search, differential evolution, NSGA-II with equal budget and seed; every evaluation stored.", nodes: ["orch", "sensitivity", "optimisation", "science"], edges: [["orch", "sensitivity"], ["orch", "optimisation"], ["sensitivity", "science"], ["optimisation", "science"]], focus: "science" },
  { title: "Agent 6 double-checks", simple: "A separate checker rebuilds the mini-world from scratch and repeats every breaking point. If it doesn't repeat, it's thrown out.", tech: "Fresh model instance from the stored config (hash must match), robustness probe, FAO-56 ET₀ cross-check.", nodes: ["orch", "verification", "science"], edges: [["orch", "verification"], ["verification", "science"]], focus: "verification" },
  { title: "Agent 7 designs safer plans", simple: "Keeping the same harsh future, it tries tougher tree species and smarter watering and measures how often each still fails.", tech: "Design-only changes, Monte Carlo failure probability with Wilson 95% interval, cost trade-off.", nodes: ["orch", "alternatives", "science"], edges: [["orch", "alternatives"], ["alternatives", "science"]], focus: "alternatives" },
  { title: "Agent 8 signs the certificate", simple: "Everything is written into a report with a fingerprint: change one letter and the fingerprint changes.", tech: "ReportLab PDF + JSON, SHA-256, seeds, versions, limitations; stored in the database.", nodes: ["orch", "report", "pdf", "db"], edges: [["orch", "report"], ["report", "pdf"], ["report", "db"]], focus: "report" },
  { title: "Back to you", simple: "Your screen updates live: the verdict, the breaking change, the 3D film and the safer designs.", tech: "WebSocket events → React state; results read via REST (/counterexamples, /analysis, /film, /certificate).", nodes: ["worker", "browser", "web", "api"], edges: [["worker", "browser"], ["browser", "web"], ["web", "api"]], focus: "browser" },
];


export const STEP_SECONDS = 6.5;

/** Full-screen autoplaying tour (used for recording). Sets window.__filmDone at the end. */
export function TourPlayer({ record = false }: { record?: boolean }) {
  const [step, setStep] = useState(-1); // -1 = title card
  useEffect(() => {
    (window as unknown as { __filmStarted?: number }).__filmStarted = performance.now();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      if (step < TOUR.length - 1) setStep(step + 1);
      else (window as unknown as { __filmDone?: boolean }).__filmDone = true;
    }, (step < 0 ? 4 : STEP_SECONDS) * 1000);
    return () => clearTimeout(t);
  }, [step]);
  const s = step >= 0 ? TOUR[step] : null;
  const view = useMemo(() => s ? { nodes: new Set(s.nodes), edges: new Set(s.edges.map(([a, b]) => `${a}>${b}`)), focus: NODES.find((n) => n.id === s.focus)?.pos ?? null } : { nodes: null, edges: null, focus: null }, [s]);
  return (
    <div className={record ? "fixed inset-0 bg-[#080c16]" : "relative aspect-video w-full overflow-hidden rounded-3xl bg-[#080c16]"}>
      <Architecture3D activeNodes={view.nodes} activeEdges={view.edges} selected={null} onPick={() => undefined} focus={view.focus} height={record ? undefined : 620} fill={record} />
      <AnimatePresence mode="wait">
        {s ? (
          <motion.div key={step} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.45 }} className="pointer-events-none absolute bottom-[5%] left-[3%] z-30 max-w-[42%] rounded-2xl bg-black/80 p-5 text-white">
            <div className="text-[12px] font-medium uppercase tracking-[0.2em] text-[#ff7a4d]">Step {step + 1} of {TOUR.length}</div>
            <div className="mt-1 text-[26px] font-semibold tracking-[-0.02em]">{s.title}</div>
            <p className="mt-1 text-[16px] leading-relaxed text-white/85">{s.simple}</p>
            <p className="mt-2 border-t border-white/10 pt-2 font-mono text-[12.5px] leading-relaxed text-[#9fe3c6]">{s.tech}</p>
            <div className="mt-3 flex gap-1">{TOUR.map((_, k) => <span key={k} className={`h-1.5 flex-1 rounded-full ${k <= step ? "bg-[#ff5b2e]" : "bg-white/15"}`} />)}</div>
          </motion.div>
        ) : (
          <motion.div key="title" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-black/55 text-center text-white">
            <div>
              <div className="text-[13px] uppercase tracking-[0.3em] text-white/60">Inside BACKFIRE</div>
              <div className="mt-3 text-[54px] font-semibold tracking-[-0.03em]">How the backend works</div>
              <div className="mt-2 text-[20px] text-white/70">Follow one investigation through the system</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
