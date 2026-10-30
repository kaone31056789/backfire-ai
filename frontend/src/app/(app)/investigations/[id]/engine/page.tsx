"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, AlertTriangle, CheckCircle2, Circle, Crosshair, Loader2, Radar, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { C, EChart, axisBase, tooltipBase } from "@/components/charts/echart";
import { useInvestigation } from "@/components/investigation-context";
import { Badge, EmptyState, ErrorState, Panel, PanelHeader, Readout, Tabs } from "@/components/ui/primitives";
import { AGENT_META, PIPELINE, METHOD_COLORS, cn, fmt } from "@/lib/format";
import { useApi, useInvestigationEvents } from "@/lib/hooks";
import type { AgentEvent, Execution, OptRun } from "@/lib/types";

const TYPE_STYLE: Record<string, { tone: string; label: string }> = {
  started: { tone: "text-signal", label: "START" },
  completed: { tone: "text-holds", label: "DONE" },
  info: { tone: "text-ink-3", label: "INFO" },
  progress: { tone: "text-ink-4", label: "PROG" },
  finding: { tone: "text-violet", label: "FIND" },
  failure_found: { tone: "text-fail", label: "FAIL" },
  warning: { tone: "text-caution", label: "WARN" },
  error: { tone: "text-fail", label: "ERR" },
};

interface Hypotheses { hypotheses: { parameter: string; label: string; direction: string; sobol_total: number; one_at_a_time_B: number; single_factor_falsifies: boolean; status: string }[] }

export default function EnginePage() {
  const { inv, version } = useInvestigation();
  const { events, mode } = useInvestigationEvents(inv.id);
  const execs = useApi<Execution[]>(`/investigations/${inv.id}/executions`, [version, events.filter((e) => e.type === "completed" || e.type === "error").length]);
  const opt = useApi<{ runs: OptRun[] }>(`/investigations/${inv.id}/optimisation`, [version, events.filter((e) => e.agent === "optimisation" && e.type === "completed").length]);
  const analysis = useApi<{ hypotheses?: Hypotheses }>(`/investigations/${inv.id}/analysis`, [version, events.filter((e) => e.agent === "adversarial_research" && e.type === "completed").length]);
  const [filter, setFilter] = useState<"all" | "findings" | "errors">("all");

  // current run = events since the latest orchestrator "started"
  const runStart = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) if (events[i].agent === "orchestrator" && events[i].type === "started") return i;
    return 0;
  }, [events]);
  const current = events.slice(runStart);
  const plan = (current[0]?.data?.plan as string[] | undefined) || PIPELINE;
  const agentState = (a: string): "pending" | "running" | "done" | "failed" => {
    const ev = current.filter((e) => e.agent === a);
    if (ev.some((e) => e.type === "error")) return "failed";
    if (ev.some((e) => e.type === "completed")) return "done";
    if (ev.some((e) => e.type === "started")) return "running";
    return "pending";
  };
  const progress = [...current].reverse().find((e) => e.agent === "optimisation" && e.type === "progress");
  const totalEvals = (progress?.data?.total_evaluations as number | undefined) ?? 0;
  const failures = current.filter((e) => e.type === "failure_found");
  const running = inv.running || inv.status === "running" || inv.status === "analysing";
  // started from "Let AI build & run it": open the film automatically once the run is complete
  const router = useRouter();
  const thenFilm = useSearchParams().get("then") === "film";
  const finished = !running && inv.stage === "done";
  useEffect(() => {
    if (!thenFilm || !finished) return;
    const t = setTimeout(() => router.push(`/investigations/${inv.id}/film`), 2800);
    return () => clearTimeout(t);
  }, [thenFilm, finished, router, inv.id]);
  const shown = events.filter((e) => (filter === "all" ? true : filter === "findings" ? ["finding", "failure_found"].includes(e.type) : ["error", "warning"].includes(e.type)));

  return (
    <div className="space-y-5">
      {thenFilm && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className={cn("hud flex flex-wrap items-center gap-4 rounded-2xl p-4", finished && "border-[#3ee6a8]/40")}>
          <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", finished ? "bg-[#3ee6a8]/15" : "bg-[#ff5b2e]/15")}>
            {finished ? <CheckCircle2 className="h-5 w-5 text-[#3ee6a8]" /> : <Loader2 className="h-5 w-5 animate-spin text-[#ff7a4d]" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold text-white">{finished ? "Simulation complete — opening the film…" : inv.status === "failed" || inv.stage === "halted" ? "The run stopped early" : "The AI built your scenario. Running the full simulation…"}</div>
            <div className="text-[13.5px] text-white/55">{finished ? "Ten simulated years, the breaking change and a safer design, in 3D." : "8 agents: evidence, 10-year model, breaking-point search, verification. About a minute; the film opens automatically when it's done."}</div>
          </div>
          {finished && <Link href={`/investigations/${inv.id}/film`} className="rounded-full bg-white px-4 py-2 text-[14px] font-semibold text-black">▶ Watch now</Link>}
        </motion.div>
      )}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        <Panel ticks>
          <PanelHeader code="05.1" title="Agent pipeline">
            <span className="flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-wider text-ink-4">
              <span className={cn("h-1.5 w-1.5 rounded-full", mode === "live" ? "bg-holds pulse-dot" : mode === "polling" ? "bg-caution" : "bg-ink-4")} />
              {mode === "live" ? "websocket live" : mode === "polling" ? "polling" : mode}
            </span>
          </PanelHeader>
          <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
            {plan.map((a, i) => {
              const st = agentState(a);
              const ex = [...(execs.data || [])].reverse().find((x) => x.agent === a);
              return (
                <div key={a} className={cn("relative bg-panel p-3.5", st === "running" && "bg-signal/[0.04]")}>
                  {st === "running" && <div className="absolute inset-x-0 top-0 h-px scan" />}
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11.5px] text-ink-4">{String(i + 1).padStart(2, "0")} · {AGENT_META[a]?.code}</span>
                    {st === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-holds" /> : st === "failed" ? <XCircle className="h-3.5 w-3.5 text-fail" /> : st === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-signal" /> : <Circle className="h-3.5 w-3.5 text-ink-4" />}
                  </div>
                  <div className={cn("mt-1.5 text-[13.5px] font-medium", st === "pending" ? "text-ink-3" : "text-ink")}>{AGENT_META[a]?.label}</div>
                  <div className="mt-1 line-clamp-3 text-[12.5px] leading-snug text-ink-4">{st === "pending" ? "waiting" : ex?.summary || (st === "running" ? "working…" : "")}</div>
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel className="grid grid-cols-2 content-start gap-x-4 gap-y-5 p-4">
          <Readout label="Search evaluations" value={fmt(totalEvals || (opt.data?.runs.reduce((s, r) => s + r.evaluations, 0) ?? 0), 0)} tone="signal" sub={running && progress ? String(progress.data.method) : "this run"} />
          <Readout label="Failures discovered" value={failures.length} tone={failures.length ? "fail" : undefined} sub="rank-1 per method" />
          <Readout label="Events" value={current.length} sub={`${events.length} total`} />
          <Readout label="Status" value={<span className="text-[15px]">{running ? "running" : inv.status}</span>} tone={running ? "signal" : inv.status === "completed" ? "holds" : inv.status === "failed" ? "fail" : undefined} sub={inv.stage.replace(/_/g, " ")} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel>
          <PanelHeader code="05.2" title="Failure discovery events" />
          <div className="max-h-[300px] overflow-y-auto">
            <AnimatePresence initial={false}>
              {failures.length ? failures.map((e) => (
                <motion.div key={e.seq} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex gap-3 border-b border-line/70 px-4 py-3 last:border-0">
                  <Crosshair className="mt-0.5 h-4 w-4 shrink-0 text-fail" />
                  <div className="min-w-0">
                    <p className="text-[13.5px] leading-relaxed text-ink">{e.message}</p>
                    <div className="mt-1 font-mono text-[12px] text-ink-4">
                      d = {fmt(e.data.distance as number)} · found at evaluation {String(e.data.evaluation)} · {new Date(e.created_at).toLocaleTimeString()}
                    </div>
                  </div>
                </motion.div>
              )) : <EmptyState icon={Radar} title={running ? "Searching…" : "No failures discovered"} body={running ? "Counterexamples appear here the moment a method finds one." : "Run BACKFIRE to search for minimum plausible failures."} />}
            </AnimatePresence>
          </div>
        </Panel>
        <Panel>
          <PanelHeader code="05.3" title="Hypothesis generation · Adversarial agent" />
          {analysis.data?.hypotheses?.hypotheses.length ? (
            <ul className="divide-y divide-line/70">
              {analysis.data.hypotheses.hypotheses.map((h) => (
                <li key={h.parameter} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13.5px] text-ink">{h.label} <span className="text-ink-4">→ {h.direction} bound</span></span>
                    <div className="flex items-center gap-1.5">
                      {h.status === "assumption" && <Badge tone="caution">assumption</Badge>}
                      {h.single_factor_falsifies && <Badge tone="fail">falsifies alone</Badge>}
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3">
                    <div className="h-1 flex-1 rounded-full bg-line"><div className="h-full rounded-full bg-violet/80" style={{ width: `${Math.min(100, h.sobol_total * 100)}%` }} /></div>
                    <span className="w-36 text-right font-mono text-[12px] text-ink-3">S<sub>T</sub> {h.sobol_total.toFixed(2)} · B {h.one_at_a_time_B.toFixed(3)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="p-4 text-[13.5px] text-ink-4">Hypotheses are generated from Sobol and one-at-a-time sensitivity once the Adversarial Research Agent runs.</p>}
        </Panel>
      </div>

      <Panel>
        <PanelHeader code="05.4" title="Optimisation execution · best counterexample distance vs evaluations" />
        {opt.error ? <ErrorState error={opt.error} compact /> : opt.data?.runs.length ? (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px]">
            <EChart
              height={300}
              option={{
                grid: { left: 52, right: 20, top: 30, bottom: 40 },
                legend: { top: 4, textStyle: { color: C.ink3, fontSize: 11 }, icon: "rect", itemWidth: 10, itemHeight: 2 },
                tooltip: { ...tooltipBase, trigger: "axis" },
                xAxis: { type: "value", name: "evaluations", nameLocation: "middle", nameGap: 26, ...axisBase },
                yAxis: { type: "value", name: "min distance ‖Δ‖_W", ...axisBase },
                series: opt.data.runs.filter((r) => r.found).map((r) => ({
                  name: r.method,
                  type: "line",
                  step: "end",
                  symbol: "none",
                  lineStyle: { width: r.method_key === "mpfs" ? 2 : 1.3, color: METHOD_COLORS[r.method] },
                  data: r.convergence.filter(([, d]) => d >= 0).map(([n, d]) => [n, d]),
                })),
              }}
            />
            <div className="overflow-x-auto border-t border-line xl:border-l xl:border-t-0">
              <table className="w-full text-[13px]">
                <thead><tr className="text-left text-[11.5px] uppercase tracking-[0.1em] text-ink-4"><th className="px-3 py-2 font-medium">Method</th><th className="px-3 py-2 text-right font-medium">d*</th><th className="px-3 py-2 text-right font-medium">1st fail</th><th className="px-3 py-2 text-right font-medium">Evals</th><th className="px-3 py-2 text-right font-medium">Time</th></tr></thead>
                <tbody>
                  {opt.data.runs.map((r) => (
                    <tr key={r.id} className="border-t border-line/60">
                      <td className="px-3 py-2"><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: METHOD_COLORS[r.method] }} />{r.method} <span className="font-mono text-[11.5px] text-ink-4">v{r.version}</span></td>
                      <td className="px-3 py-2 text-right font-mono">{r.found ? fmt(r.best_distance) : "none"}</td>
                      <td className="px-3 py-2 text-right font-mono text-ink-3">{r.first_failure_at ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-mono text-ink-3">{r.evaluations}</td>
                      <td className="px-3 py-2 text-right font-mono text-ink-3">{r.runtime_s.toFixed(2)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-4">Same problem, budget and seed for every method; the reported result is the smallest valid evaluated failure. Single-instance results — see Method Benchmarks for comparisons on problems with known answers.</p>
            </div>
          </div>
        ) : <p className="p-4 text-[13.5px] text-ink-4">No optimisation runs yet.</p>}
      </Panel>

      <Panel>
        <PanelHeader code="05.5" title="Execution log">
          <Tabs value={filter} onChange={setFilter} items={[{ value: "all", label: "All" }, { value: "findings", label: "Findings" }, { value: "errors", label: "Warnings & errors" }]} />
        </PanelHeader>
        <div className="max-h-[440px] overflow-y-auto bg-void/40 py-1 font-mono text-[13px]">
          {shown.length ? [...shown].reverse().map((e: AgentEvent) => {
            const t = TYPE_STYLE[e.type] || TYPE_STYLE.info;
            return (
              <div key={e.seq} className="grid grid-cols-[46px_74px_42px_44px_1fr] gap-2 px-4 py-[3px] hover:bg-raise/40">
                <span className="text-ink-4">#{e.seq}</span>
                <span className="text-ink-4">{new Date(e.created_at).toLocaleTimeString()}</span>
                <span className="text-ink-3">{AGENT_META[e.agent]?.code || e.agent}</span>
                <span className={t.tone}>{t.label}</span>
                <span className={cn("break-words", e.type === "progress" ? "text-ink-4" : "text-ink-2")}>{e.message}</span>
              </div>
            );
          }) : <div className="flex items-center gap-2 px-4 py-6 text-ink-4"><Activity className="h-4 w-4" /> No events yet.</div>}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-2 text-[12.5px] text-ink-4">
          <AlertTriangle className="h-3.5 w-3.5" /> Agent messages are concise execution summaries generated from computed results; no hidden model reasoning is shown or stored.
        </div>
      </Panel>
    </div>
  );
}
