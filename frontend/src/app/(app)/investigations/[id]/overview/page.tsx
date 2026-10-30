"use client";
import { motion } from "framer-motion";
import { ArrowRight, Check, CircleDashed, Crosshair, FileCheck2, GitCompare, Loader2, Microscope, PencilLine, Radar, ShieldCheck, Sprout } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { canWrite, useAuth } from "@/components/auth";
import { useInvestigation } from "@/components/investigation-context";
import { Button } from "@/components/ui/button";
import { Badge, Notice, Panel, PanelHeader, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn, fmt, metricValue, METRIC_META, pct, signed } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { AlternativeRow, Counterexample, MonteCarlo, SimResult } from "@/lib/types";

const fade = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } } };

export default function OverviewPage() {
  const { inv, version, start, busy } = useInvestigation();
  const { user } = useAuth();
  const id = inv.id;
  const cexs = useApi<Counterexample[]>(`/investigations/${id}/counterexamples`, [version]);
  const analysis = useApi<{ monte_carlo?: MonteCarlo }>(`/investigations/${id}/analysis`, [version]);
  const alts = useApi<{ alternatives: { rows: AlternativeRow[] } | null }>(`/investigations/${id}/alternatives`, [version]);
  const [nominal, setNominal] = useState<SimResult | null>(null);

  useEffect(() => {
    api<SimResult>(`/investigations/${id}/simulate`, { body: { series: false } }).then(setNominal).catch(() => setNominal(null));
  }, [id, version, inv.stage]);

  const running = inv.running || inv.status === "running" || inv.status === "analysing";
  const analysed = ["analysed", "completed"].includes(inv.status) || inv.counts.evidence_sources > 0;
  const tested = inv.status === "completed" || (cexs.data?.length ?? 0) > 0;
  const best = cexs.data?.find((c) => c.method === "MPFS" && c.rank === 1) || cexs.data?.[0];
  const mc = analysis.data?.monte_carlo;
  const altRows = alts.data?.alternatives?.rows || [];
  const proposal = altRows.find((r) => r.key === "proposal");
  const bestAlt = [...altRows].filter((r) => r.key !== "proposal").sort((a, b) => a.failure_probability - b.failure_probability)[0];
  const verifiedBest = best && best.status !== "rejected" && best.status !== "unverified";

  // ------------------------------------------------------------------ the story, in plain language
  let tone: "holds" | "fail" | "neutral" = "neutral";
  let headline = "Not tested yet";
  let story: React.ReactNode = "Run the analysis to extract the claims and gather evidence, then run BACKFIRE to search for the smallest plausible change that would make this intervention miss its targets.";
  if (tested && nominal) {
    if (!nominal.success) {
      tone = "fail";
      headline = "The claim fails even under the stated conditions";
      story = <>Under the proposal&apos;s own nominal assumptions the model already misses the <b>{METRIC_META[nominal.binding_criterion]?.label.toLowerCase()}</b> target. No adverse change is needed to falsify it.</>;
    } else if (best && verifiedBest) {
      tone = "fail";
      const top = Object.values(best.deltas).sort((a, b) => Math.abs(b.normalised) - Math.abs(a.normalised)).slice(0, 2);
      const crit = nominal.criteria.find((c) => c.metric === best.binding_criterion);
      headline = "A small, plausible change can break this claim";
      story = (
        <>
          If {top.map((d, i) => <span key={d.label}>{i > 0 && " and "}<b>{d.label.toLowerCase()}</b> moves from {fmt(d.from)} to {fmt(d.to)} {d.unit !== "–" && d.unit}</span>)}, the{" "}
          <b>{METRIC_META[best.binding_criterion]?.label.toLowerCase()}</b> drops to <b>{metricValue(best.binding_criterion, best.metrics[best.binding_criterion])}</b>
          {crit && <> — the claim needs {crit.op === ">=" ? "at least" : "at most"} {METRIC_META[best.binding_criterion]?.asPct ? pct(crit.threshold, 0) : crit.threshold}</>}. An independent agent reproduced this result.
        </>
      );
    } else if (inv.status === "completed") {
      tone = "holds";
      headline = "No plausible failure found within the search budget";
      story = "None of the search methods found a combination of plausible conditions that breaks the claim. This is not proof of success — widen the ranges or increase the budget to search harder.";
    }
  } else if (running) {
    headline = "Investigation in progress…";
    story = "Agents are working through the pipeline. This page updates automatically when results arrive.";
  } else if (analysed) {
    headline = "Ready to stress-test";
    story = "Claims and evidence are in. Run BACKFIRE to search for minimum plausible failures with MPFS and the baseline optimisers.";
  }

  const steps = [
    { title: "Define the claim", body: "Proposal, thresholds and plausible ranges", done: true, href: `/investigations/${id}/claims`, icon: PencilLine },
    { title: "Analyse", body: "Extract claims, retrieve evidence, build the causal graph", done: analysed, href: `/investigations/${id}/evidence`, icon: Microscope, action: !analysed ? "analyse" : null },
    { title: "Run BACKFIRE", body: "Search, verify and quantify uncertainty", done: tested, href: `/investigations/${id}/engine`, icon: Crosshair, action: analysed && !tested ? "run-backfire" : null },
    { title: "Explore the boundary", body: "Move sliders, see where the claim breaks", done: false, href: `/investigations/${id}/boundary`, icon: Radar, enabled: tested },
    { title: "Compare alternatives", body: "Species, density and irrigation options", done: false, href: `/investigations/${id}/alternatives`, icon: GitCompare, enabled: tested },
    { title: "Export certificate", body: "Reproducible PDF and JSON report", done: false, href: `/investigations/${id}/certificate`, icon: FileCheck2, enabled: tested },
  ];
  const nextIdx = steps.findIndex((s) => !s.done);

  return (
    <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.07 } } }} className="space-y-5">
      {/* ---------------------------------------------------------------- the live 3D city shows through here */}
      <motion.div variants={fade} className="pointer-events-none relative flex h-[300px] items-end">
        <div className="hud pointer-events-auto rounded-2xl px-5 py-4">
          <div className="text-[12.5px] font-medium uppercase tracking-[0.18em] text-[#ff7a4d]">{inv.location_name}{inv.country && ` · ${inv.country}`}</div>
          <div className="mt-1 max-w-2xl text-[22px] font-semibold leading-tight tracking-[-0.02em] text-white">{headline}</div>
        </div>
      </motion.div>

      {/* ---------------------------------------------------------------- verdict hero */}
      <motion.div variants={fade}>
        <Panel ticks className="relative overflow-hidden">
          <div className={cn("pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl", tone === "fail" ? "bg-fail/15" : tone === "holds" ? "bg-holds/15" : "bg-signal/10")} />
          <div className="relative grid grid-cols-1 gap-8 p-6 md:p-8 xl:grid-cols-[1.4fr_1fr]">
            <div>
              <div className="flex items-center gap-2 text-[13px] font-medium">
                {running ? <Loader2 className="h-4 w-4 animate-spin text-signal" /> : <span className={cn("h-2 w-2 rounded-full", tone === "fail" ? "bg-fail" : tone === "holds" ? "bg-holds" : "bg-ink-4")} />}
                <span className={tone === "fail" ? "text-fail" : tone === "holds" ? "text-holds" : "text-ink-3"}>{tested ? "Verdict" : "Status"}</span>
              </div>
              <h2 className="mt-3 text-[28px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink md:text-[32px]">{headline}</h2>
              <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-2 [&_b]:font-semibold [&_b]:text-ink">{story}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {tested ? (
                  <>
                    <Link href={`/investigations/${id}/film`}><Button variant="primary">▶ Watch the simulation film</Button></Link>
                    <Link href={`/investigations/${id}/boundary`}><Button variant="outline">Explore the failure boundary <ArrowRight className="h-4 w-4" /></Button></Link>
                    <Link href={`/investigations/${id}/certificate`}><Button variant="outline"><FileCheck2 className="h-4 w-4" /> View certificate</Button></Link>
                  </>
                ) : canWrite(user) && !running ? (
                  <Button variant="primary" loading={!!busy} onClick={() => start(analysed ? "run-backfire" : "analyse")}>
                    {analysed ? <><Crosshair className="h-4 w-4" /> Run BACKFIRE</> : <><Microscope className="h-4 w-4" /> Start analysis</>}
                  </Button>
                ) : running ? (
                  <Link href={`/investigations/${id}/engine`}><Button variant="signal">Watch the agents live <ArrowRight className="h-4 w-4" /></Button></Link>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <Stat label="Nominal net benefit" value={nominal ? signed(nominal.net_benefit) : null} tone={nominal ? (nominal.success ? "holds" : "fail") : undefined} hint={nominal ? (nominal.success ? `Claim holds at stated conditions · binding: ${METRIC_META[nominal.binding_criterion]?.label.toLowerCase()}` : "Claim fails at stated conditions") : "Computed by the model"} />
              <Stat label="Smallest breaking change (d*)" value={best ? fmt(best.distance) : tested ? "none found" : null} tone={best ? "fail" : undefined} hint={best ? `${best.method} · ${best.status.replace(/_/g, " ")} · 1.0 = edge of plausible range` : "Normalised distance found by MPFS"} />
              <Stat label="Failure probability" value={mc ? pct(mc.failure_probability) : null} tone={mc ? (mc.failure_probability > 0.5 ? "fail" : mc.failure_probability > 0.1 ? "caution" : "holds") : undefined} hint={mc ? `95% CI ${pct(mc.failure_ci95[0])}–${pct(mc.failure_ci95[1])} · ${mc.n_valid} Monte Carlo draws` : "Under uncertain environmental conditions"} />
            </div>
          </div>
        </Panel>
      </motion.div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_420px]">
        {/* ---------------------------------------------------------------- criteria */}
        <motion.div variants={fade}>
          <Panel className="h-full">
            <PanelHeader title="Success criteria at nominal conditions" />
            <div className="space-y-5 p-5">
              {!nominal ? <><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></> : nominal.criteria.map((c) => {
                const v = (nominal as unknown as Record<string, number>)[c.metric];
                const m = nominal.margins[c.metric];
                const ok = m >= 0;
                const max = Math.max(v, c.threshold) * 1.25 || 1;
                return (
                  <div key={c.metric}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[14.5px] text-ink">{METRIC_META[c.metric]?.label}</span>
                      <span className="text-[14px]">
                        <span className={cn("font-semibold tabular", ok ? "text-holds" : "text-fail")}>{metricValue(c.metric, v)}</span>
                        <span className="text-ink-4"> · needs {c.op === ">=" ? "≥" : "≤"} {METRIC_META[c.metric]?.asPct ? pct(c.threshold, 0) : c.threshold}</span>
                      </span>
                    </div>
                    <div className="relative mt-2 h-2 rounded-full bg-line">
                      <div className={cn("h-full rounded-full", ok ? "bg-gradient-to-r from-holds/50 to-holds" : "bg-gradient-to-r from-fail/50 to-fail")} style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />
                      <div className="absolute -top-1 h-4 w-0.5 rounded bg-ink" style={{ left: `${Math.min(100, (c.threshold / max) * 100)}%` }} title="threshold" />
                    </div>
                    <div className="mt-1.5 text-[12.5px] text-ink-4">Margin {signed(m)} {ok ? "— satisfied" : "— not satisfied"}</div>
                  </div>
                );
              })}
              {nominal && <p className="border-t border-line pt-4 text-[13px] leading-relaxed text-ink-4">The claim holds only if every criterion holds: B = min(margins) ≥ 0. Edit thresholds on the Claims tab.</p>}
            </div>
          </Panel>
        </motion.div>

        {/* ---------------------------------------------------------------- next steps */}
        <motion.div variants={fade}>
          <Panel className="h-full">
            <PanelHeader title="Your path through the investigation" />
            <ol className="p-3">
              {steps.map((s, i) => {
                const isNext = i === nextIdx;
                const enabled = s.done || isNext || s.enabled;
                const Icon = s.icon;
                return (
                  <li key={s.title}>
                    <Link href={enabled ? s.href : "#"} aria-disabled={!enabled} className={cn("group flex items-start gap-3.5 rounded-[var(--radius-sm)] p-3 transition-colors", enabled ? "hover:bg-raise/60" : "pointer-events-none opacity-45", isNext && "bg-holds/[0.06] ring-1 ring-inset ring-holds/25")}>
                      <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ring-1", s.done ? "bg-holds/15 text-holds ring-holds/30" : isNext ? "bg-raise text-ink ring-line-2" : "bg-abyss text-ink-4 ring-line")}>
                        {s.done ? <Check className="h-4 w-4" /> : running && isNext ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-[14.5px] font-medium text-ink">{s.title}{isNext && !running && <Badge tone="holds">Next</Badge>}</span>
                        <span className="mt-0.5 block text-[13px] text-ink-4">{s.body}</span>
                      </span>
                      {enabled && <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-2" />}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </Panel>
        </motion.div>
      </div>

      {(bestAlt || best) && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {best && Object.keys(best.deltas).length > 0 && (
            <motion.div variants={fade}>
              <Panel className="h-full">
                <PanelHeader title="What changed in the breaking scenario">
                  <Badge tone={verifiedBest ? "holds" : "muted"}><ShieldCheck className="h-3 w-3" /> {best.status.replace(/_/g, " ")}</Badge>
                </PanelHeader>
                <ul className="divide-y divide-line/70">
                  {Object.values(best.deltas).sort((a, b) => Math.abs(b.normalised) - Math.abs(a.normalised)).slice(0, 6).map((d) => (
                    <li key={d.label} className="flex items-center gap-4 px-5 py-3">
                      <span className="min-w-0 flex-1 truncate text-[14px] text-ink-2">{d.label}</span>
                      <span className="font-mono text-[13px] text-ink-3">{fmt(d.from)} → <span className="text-ink">{fmt(d.to)}</span></span>
                      <div className="hidden w-28 sm:block"><div className="h-1.5 rounded-full bg-line"><div className="h-full rounded-full bg-fail/70" style={{ width: `${Math.min(100, Math.abs(d.normalised) * 100)}%` }} /></div></div>
                    </li>
                  ))}
                </ul>
                <p className="border-t border-line px-5 py-3 text-[12.5px] text-ink-4">Bars show how far each parameter moved as a share of its documented plausible range.</p>
              </Panel>
            </motion.div>
          )}
          {bestAlt && proposal && (
            <motion.div variants={fade}>
              <Panel className="h-full">
                <PanelHeader title="Most robust alternative found" />
                <div className="p-5">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-holds/12 ring-1 ring-holds/25"><Sprout className="h-5 w-5 text-holds" /></div>
                    <div>
                      <div className="text-[16px] font-semibold text-ink">{bestAlt.label}</div>
                      <div className="mt-0.5 font-mono text-[12.5px] text-ink-4">{Object.entries(bestAlt.changes).map(([k, v]) => `${k} = ${fmt(v)}`).join(" · ")}</div>
                    </div>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-4">
                    <Compare label="Failure probability" a={pct(proposal.failure_probability)} b={pct(bestAlt.failure_probability)} better={bestAlt.failure_probability < proposal.failure_probability} />
                    <Compare label="Median cooling" a={`${proposal.cooling_p50.toFixed(2)} °C`} b={`${bestAlt.cooling_p50.toFixed(2)} °C`} better={bestAlt.cooling_p50 >= proposal.cooling_p50} />
                    <Compare label="Median irrigation" a={`${fmt(proposal.water_p50, 0)} m³/ha`} b={`${fmt(bestAlt.water_p50, 0)} m³/ha`} better={bestAlt.water_p50 <= proposal.water_p50} />
                    <Compare label="Survives counterexamples" a={`${proposal.survives_counterexamples}`} b={`${bestAlt.survives_counterexamples}`} better={bestAlt.survives_counterexamples >= proposal.survives_counterexamples} />
                  </div>
                  <Link href={`/investigations/${id}/alternatives`} className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-holds hover:underline">Compare all alternatives <ArrowRight className="h-4 w-4" /></Link>
                </div>
              </Panel>
            </motion.div>
          )}
        </div>
      )}

      <motion.div variants={fade}>
        <Notice tone={inv.climatology?.synthetic ? "caution" : "signal"}>
          {inv.climatology?.synthetic ? <><b>Synthetic climate.</b> NASA POWER was unavailable, so results are exploratory only. </> : null}
          A simulated failure does not mean the intervention is harmful — it shows conditions under which this model says the claimed benefit is not delivered. Parameters marked as assumptions are uncalibrated.
        </Notice>
      </motion.div>
      {!tested && !running && !analysed && <div className="flex items-center gap-2 text-[13px] text-ink-4"><CircleDashed className="h-4 w-4" /> Tip: press ⌘K anywhere to jump between investigations.</div>}
    </motion.div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string | null; tone?: "holds" | "fail" | "caution"; hint: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-line bg-abyss/60 p-4">
      <div className="text-[13px] text-ink-3">{label}</div>
      {value === null ? <Skeleton className="mt-2 h-7 w-24" /> : (
        <div className={cn("mt-1 text-[28px] font-semibold leading-tight tracking-[-0.02em] tabular", tone === "holds" ? "text-holds" : tone === "fail" ? "text-fail" : tone === "caution" ? "text-caution" : "text-ink")}>{value}</div>
      )}
      <div className="mt-1 text-[12.5px] leading-snug text-ink-4">{hint}</div>
    </div>
  );
}

function Compare({ label, a, b, better }: { label: string; a: string; b: string; better: boolean }) {
  return (
    <div>
      <div className="text-[12.5px] text-ink-4">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[13.5px] text-ink-4 line-through decoration-ink-4/50">{a}</span>
        <span className={cn("text-[16px] font-semibold", better ? "text-holds" : "text-ink")}>{b}</span>
      </div>
    </div>
  );
}
