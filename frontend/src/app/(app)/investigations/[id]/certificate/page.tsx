"use client";
import { Download, FileJson, FileText, RefreshCw } from "lucide-react";
import { useState } from "react";

import { useInvestigation } from "@/components/investigation-context";
import { Button } from "@/components/ui/button";
import { Badge, ErrorState, LoadingBlock, Panel } from "@/components/ui/primitives";
import { api, download } from "@/lib/api";
import { cn, fmt, metricValue, pct, shortId, signed } from "@/lib/format";
import { useApi } from "@/lib/hooks";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Report = Record<string, any>;

const VERDICT_TONE: Record<string, string> = {
  "FALSIFIABLE UNDER PLAUSIBLE CONDITIONS": "text-fail border-fail/40",
  "CLAIM FAILS UNDER NOMINAL CONDITIONS": "text-fail border-fail/40",
  "NOT FALSIFIED WITHIN SEARCH BUDGET": "text-holds border-holds/40",
  "NOT YET TESTED": "text-ink-3 border-line-2",
  "COUNTEREXAMPLES NOT VERIFIED": "text-caution border-caution/40",
};

export default function CertificatePage() {
  const { inv, version } = useInvestigation();
  const { data: r, error, loading, reload, setData } = useApi<Report>(`/investigations/${inv.id}/report`, [version]);
  const [busy, setBusy] = useState<string | null>(null);

  async function regen() {
    setBusy("regen");
    try {
      setData(await api<Report>(`/investigations/${inv.id}/report?regenerate=true`));
    } finally {
      setBusy(null);
    }
  }
  async function dl(kind: "pdf" | "json") {
    setBusy(kind);
    try {
      await download(`/investigations/${inv.id}/report/${kind}`, `backfire-certificate-${shortId(inv.id)}.${kind}`);
    } finally {
      setBusy(null);
    }
  }

  if (loading && !r) return <Panel><LoadingBlock rows={10} /></Panel>;
  if (error) return <ErrorState error={error} onRetry={() => reload()} />;
  if (!r) return null;
  const cert = r.certificate;
  const m = r.mathematical_model;
  const nr = m.nominal_result;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" onClick={regen} loading={busy === "regen"}><RefreshCw className="h-4 w-4" /> Regenerate (new version)</Button>
        <Button variant="outline" onClick={() => dl("json")} loading={busy === "json"}><FileJson className="h-4 w-4" /> Export JSON</Button>
        <Button variant="primary" onClick={() => dl("pdf")} loading={busy === "pdf"}><Download className="h-4 w-4" /> Export PDF</Button>
      </div>

      <Panel ticks className="mx-auto max-w-[980px] overflow-hidden">
        <div className="relative border-b border-line px-8 py-8 md:px-12">
          <div className="absolute inset-0 lab-grid-fine opacity-40" />
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-2xs uppercase tracking-[0.2em] text-ink-4">
              <span>BACKFIRE AI · Falsification certificate</span>
              <span>v{cert.version} · sha-256 {String(cert.content_sha256 || "").slice(0, 16)}…</span>
            </div>
            <h1 className="mt-4 font-display text-[40px] leading-[1.05]">{r.intervention.title}</h1>
            <div className="mt-2 text-[14px] text-ink-3">
              {r.intervention.location.name}{r.intervention.location.country && `, ${r.intervention.location.country}`} · {r.intervention.location.latitude.toFixed(3)}, {r.intervention.location.longitude.toFixed(3)} · investigation <span className="font-mono">{cert.investigation_id}</span>
            </div>
            <div className={cn("mt-6 inline-flex flex-col rounded-[var(--radius-sm)] border bg-void/60 px-5 py-3", VERDICT_TONE[cert.verdict])}>
              <span className="font-mono text-[11.5px] uppercase tracking-[0.25em] text-ink-4">Verdict</span>
              <span className="mt-1 font-mono text-[17px] tracking-wide">{cert.verdict}</span>
            </div>
            <p className="mt-3 max-w-2xl text-[13px] text-ink-4">{cert.verdict_note}</p>
          </div>
        </div>

        <div className="space-y-9 px-8 py-8 md:px-12">
          <Section n="1" title="Intervention">
            <p className="whitespace-pre-line text-[14.5px] leading-relaxed text-ink-2">{r.intervention.description}</p>
            {r.intervention.source_document && <p className="mt-2 text-[13px] text-ink-4">Source document: {r.intervention.source_document}</p>}
          </Section>

          <Section n="2" title="Original claims & success criteria">
            <Table head={["Claim", "Criterion", "Support", "Source"]} rows={r.claims.map((c: any) => [c.text, c.threshold !== null ? `${c.metric} ${c.operator} ${c.threshold}` : "not measurable", c.support_status, c.source])} />
            <p className="mt-2 font-mono text-[13px] text-ink-3">{r.net_benefit_definition}</p>
          </Section>

          <Section n="3" title="Mathematical model">
            <div className="text-[14px] text-ink-2">{m.name} <span className="font-mono text-ink-4">v{m.version}</span> · horizon {m.horizon_years} y · cooling response {m.cooling_response}</div>
            <ul className="mt-2 space-y-1 text-[13.5px] text-ink-2">{m.components.map((c: string) => <li key={c} className="font-mono text-[13px]">· {c}</li>)}</ul>
            <div className="mt-3 text-[13px] text-ink-3">Climate: {m.climatology_source}{m.synthetic_climate && <Badge tone="caution" className="ml-2">synthetic</Badge>}</div>
            <div className="mt-3 grid grid-cols-2 gap-3 rounded-[var(--radius-sm)] border border-line bg-abyss/50 p-3 md:grid-cols-5">
              {["cooling_c", "survival_rate", "water_stress_index", "irrigation_m3_ha"].map((k) => <Mini key={k} k={k} v={metricValue(k, nr[k])} />)}
              <Mini k="Nominal B" v={signed(nr.net_benefit)} tone={nr.success ? "text-holds" : "text-fail"} />
            </div>
          </Section>

          <Section n="4" title="Parameter ranges">
            <Table head={["Parameter", "Unit", "Nominal", "Range", "Status", "Sources"]} rows={r.parameter_ranges.map((p: any) => [p.label, p.unit, fmt(p.nominal), `${fmt(p.lower)} – ${fmt(p.upper)}`, p.status, p.sources.join(", ") || "—"])} mono={[2, 3]} />
          </Section>

          <Section n="5" title="Optimisation algorithm">
            <p className="font-mono text-[13px] text-ink-2">{r.optimisation.objective}</p>
            <p className="mt-1 text-[13px] text-ink-3">{r.optimisation.algorithm} v{r.optimisation.mpfs_version}</p>
            {r.optimisation.runs.length ? (
              <div className="mt-3"><Table head={["Method", "Version", "Budget", "Seed", "Found", "Min distance", "1st failure at"]} rows={r.optimisation.runs.map((x: any) => [x.method, x.version, x.budget, x.seed, x.found ? "yes" : "no", x.best_distance !== null ? fmt(x.best_distance, 4) : "—", x.first_failure_at ?? "—"])} mono={[1, 2, 3, 5, 6]} /></div>
            ) : <p className="mt-2 text-[13.5px] text-ink-4">Not yet run.</p>}
          </Section>

          <Section n="6" title="Discovered counterexamples">
            {r.counterexamples.length ? r.counterexamples.slice(0, 6).map((c: any) => (
              <div key={c.id} className="mb-3 rounded-[var(--radius-sm)] border border-line p-3">
                <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
                  <span className="text-ink">{c.method} #{c.rank}</span>
                  <span className="font-mono text-signal">d = {fmt(c.distance, 4)}</span>
                  <span className="font-mono text-fail">B = {signed(c.net_benefit, 4)}</span>
                  <span className="text-ink-3">violates {c.binding_criterion}</span>
                  <Badge tone={c.status.startsWith("verified") ? "holds" : c.status === "rejected" ? "fail" : "muted"}>{c.status.replace(/_/g, " ")}</Badge>
                </div>
                {Object.keys(c.deltas).length > 0 && (
                  <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-0.5 md:grid-cols-2">
                    {Object.values(c.deltas).sort((a: any, b: any) => Math.abs(b.normalised) - Math.abs(a.normalised)).slice(0, 6).map((d: any) => (
                      <div key={d.label} className="flex justify-between text-[13px]"><span className="text-ink-3">{d.label}</span><span className="font-mono text-ink-2">{fmt(d.from)} → {fmt(d.to)} <span className="text-ink-4">({signed(d.normalised, 2)})</span></span></div>
                    ))}
                  </div>
                )}
              </div>
            )) : <p className="text-[13.5px] text-ink-4">None.</p>}
          </Section>

          <Section n="7" title="Uncertainty & sensitivity analysis">
            {r.uncertainty_analysis ? (
              <>
                <p className="text-[14px] text-ink-2">{r.uncertainty_analysis.method}; n = {r.uncertainty_analysis.n_valid}. Failure probability <b className="font-mono">{pct(r.uncertainty_analysis.failure_probability)}</b> (95% Wilson CI {pct(r.uncertainty_analysis.failure_ci95[0])}–{pct(r.uncertainty_analysis.failure_ci95[1])}).</p>
                <p className="mt-1 text-[13px] text-ink-4">{r.uncertainty_analysis.note}</p>
              </>
            ) : <p className="text-[13.5px] text-ink-4">Not yet run.</p>}
            {r.sensitivity_analysis && (
              <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
                {r.sensitivity_analysis.names.map((n: string, i: number) => ({ n, st: r.sensitivity_analysis.total_order_net_benefit[i] })).sort((a: any, b: any) => b.st - a.st).slice(0, 8).map((x: any) => (
                  <div key={x.n} className="flex items-center gap-2 text-[13px]"><span className="w-40 truncate font-mono text-ink-3">{x.n}</span><div className="h-1 flex-1 rounded-full bg-line"><div className="h-full rounded-full bg-violet" style={{ width: `${Math.min(100, Math.max(0, x.st) * 100)}%` }} /></div><span className="w-10 text-right font-mono text-ink-2">{x.st.toFixed(2)}</span></div>
                ))}
              </div>
            )}
          </Section>

          <Section n="8" title="Verification results">
            {r.verification.length ? r.verification.slice(0, 6).map((v: any) => (
              <div key={v.counterexample_id} className="mb-2 text-[13px]">
                <span className="font-mono text-ink-4">{v.counterexample_id.slice(0, 8)}</span> <Badge tone={v.status === "rejected" ? "fail" : v.status === "verified" ? "holds" : "caution"}>{v.status.replace(/_/g, " ")}</Badge>{" "}
                <span className="text-ink-3">by {v.verifier} v{v.verifier_version} · recomputed B {v.recomputed_b.toFixed(5)} · robustness {pct(v.robustness, 0)}</span>
                <div className="mt-1 flex flex-wrap gap-1">{v.checks.map((c: any) => <span key={c.name} className={cn("font-mono text-[12px]", c.passed ? "text-holds/80" : "text-fail")}>{c.passed ? "✓" : "✗"} {c.name}</span>)}</div>
              </div>
            )) : <p className="text-[13.5px] text-ink-4">No verification yet.</p>}
          </Section>

          {r.alternatives && (
            <Section n="9" title="Alternative interventions (model-evaluated)">
              <Table head={["Alternative", "P(failure)", "Survives counterexamples", "Nominal cooling", "Nominal irrigation"]} rows={r.alternatives.map((a: any) => [a.label, pct(a.failure_probability), a.survives_counterexamples, `${a.nominal.cooling_c.toFixed(2)} °C`, `${fmt(a.nominal.irrigation_m3_ha, 0)} m³/ha`])} mono={[1, 2, 3, 4]} />
            </Section>
          )}

          <Section n="10" title={`Evidence sources · ${r.evidence_sources.length}`}>
            <ol className="space-y-1.5">
              {r.evidence_sources.map((s: any, i: number) => (
                <li key={i} className="text-[13px] leading-snug text-ink-2">
                  <span className="mr-1.5 font-mono text-ink-4">[{i + 1}]</span>{s.title} {s.year && `(${s.year})`}. <span className="text-ink-3">{s.venue}</span>{" "}
                  {s.doi && <a className="font-mono text-signal/80 hover:text-signal" href={`https://doi.org/${s.doi}`} target="_blank" rel="noreferrer noopener">doi:{s.doi}</a>}
                  <span className="ml-1.5 text-[12px] text-ink-4">{s.type}{s.doi && !s.doi_verified && " · DOI unverified"}</span>
                </li>
              ))}
            </ol>
          </Section>

          <Section n="11" title="Reproducibility configuration">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Mini k="Seed" v={String(r.reproducibility.seed)} />
              <Mini k="Model config SHA-256" v={String(r.reproducibility.model_config_hash || "—").slice(0, 20) + "…"} />
              <Mini k="Python" v={r.reproducibility.python} />
            </div>
            <pre className="mt-3 max-h-60 overflow-auto rounded-[var(--radius-sm)] border border-line bg-void/70 p-3 font-mono text-[12px] leading-relaxed text-ink-3">{JSON.stringify({ algorithm_versions: r.reproducibility.algorithm_versions, settings: r.reproducibility.settings }, null, 2)}</pre>
            <p className="mt-2 text-[13px] text-ink-4">{r.reproducibility.how_to_reproduce}</p>
          </Section>

          <Section n="12" title="Known limitations">
            <ul className="space-y-1.5">{r.known_limitations.map((l: string) => <li key={l} className="flex gap-2 text-[13.5px] leading-relaxed text-ink-2"><span className="text-caution">⚑</span>{l}</li>)}</ul>
          </Section>
        </div>
        <div className="flex items-center justify-between border-t border-line px-8 py-3 font-mono text-[11.5px] uppercase tracking-[0.2em] text-ink-4 md:px-12">
          <span><FileText className="mr-1.5 inline h-3 w-3" />Generated {new Date(cert.created_at).toLocaleDateString()} · status {cert.status}</span>
          <span>{cert.investigation_id}</span>
        </div>
      </Panel>
    </div>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-baseline gap-3 border-b border-line pb-2 font-display text-[22px]">
        <span className="font-mono text-[13px] text-ink-4">§{n}</span>{title}
      </h2>
      {children}
    </section>
  );
}

function Mini({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11.5px] text-ink-4">{k.replace(/_/g, " ")}</div>
      <div className={cn("mt-0.5 truncate font-mono text-[14px] text-ink", tone)}>{v}</div>
    </div>
  );
}

function Table({ head, rows, mono = [] }: { head: string[]; rows: (string | number)[][]; mono?: number[] }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-line">
      <table className="w-full text-[13px]">
        <thead><tr className="bg-abyss/70 text-left text-[11.5px] uppercase tracking-[0.1em] text-ink-4">{head.map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line/60">{r.map((c, j) => <td key={j} className={cn("px-3 py-1.5 align-top text-ink-2", mono.includes(j) && "font-mono")}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
