"use client";
import { Check, ExternalLink, Microscope, Pencil, Plus, Quote, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { canWrite, useAuth } from "@/components/auth";
import { useInvestigation } from "@/components/investigation-context";
import { Button } from "@/components/ui/button";
import { Badge, Dialog, EmptyState, ErrorState, Input, Label, LoadingBlock, Notice, Panel, PanelHeader, Select, Switch, Textarea, type Tone } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn, metricValue, METRIC_META, signed } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Assumption, Claim, MetricKey, SimResult } from "@/lib/types";

interface ClaimsResp {
  claims: Claim[];
  assumptions: Assumption[];
  criteria: { metric: string; op: string; threshold: number; label: string }[];
}

const SUPPORT: Record<string, { tone: Tone; label: string }> = {
  supported: { tone: "holds", label: "evidence supports" },
  contested: { tone: "caution", label: "contested" },
  unsupported: { tone: "fail", label: "unsupported" },
  untested: { tone: "muted", label: "no evidence linked" },
};

const METRIC_OPTS: MetricKey[] = ["cooling_c", "survival_rate", "water_stress_index", "irrigation_m3_ha", "annual_cost_usd_ha"];

export default function ClaimsPage() {
  const { inv, version } = useInvestigation();
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi<ClaimsResp>(`/investigations/${inv.id}/claims`, [version, inv.stage]);
  const [nominal, setNominal] = useState<SimResult | null>(null);
  const [editing, setEditing] = useState<Claim | "new" | null>(null);
  const writable = canWrite(user);
  const criteriaKey = JSON.stringify(data?.criteria ?? null);

  // nominal margins are recomputed by the engine whenever the criteria change
  useEffect(() => {
    if (!data) return;
    let live = true;
    api<SimResult>(`/investigations/${inv.id}/simulate`, { body: { series: false } })
      .then((r) => live && setNominal(r))
      .catch(() => live && setNominal(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteriaKey, inv.id]);

  async function remove(c: Claim) {
    await api(`/claims/${c.id}`, { method: "DELETE" });
    reload(true);
  }

  if (loading && !data) return <Panel><LoadingBlock rows={6} /></Panel>;
  if (error) return <ErrorState error={error} onRetry={() => reload()} />;
  if (!data) return null;

  if (!data.claims.length && !data.assumptions.length) {
    return (
      <Panel>
        <EmptyState
          icon={Microscope}
          title="Claims have not been extracted yet"
          body={inv.running ? "The Claim Extraction Agent is reading the proposal — this page updates when it finishes." : "Run Analyse to extract measurable claims, success criteria and assumptions from the proposal."}
        />
      </Panel>
    );
  }

  const measurable = data.claims.filter((c) => c.measurable);
  const vague = data.claims.filter((c) => !c.measurable);
  const stated = data.assumptions.filter((a) => a.source !== "model");
  const modelA = data.assumptions.filter((a) => a.source === "model");
  const nominalOk = !!nominal?.margins;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        <Panel ticks>
          <PanelHeader code="03.1" title={`Measurable claims · ${measurable.length}`}>
            {writable && <Button size="sm" variant="ghost" onClick={() => setEditing("new")}><Plus className="h-3.5 w-3.5" /> Add claim</Button>}
          </PanelHeader>
          <ul className="divide-y divide-line/70">
            {measurable.map((c) => (
              <li key={c.id} className="group px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-4" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] leading-relaxed text-ink">{c.text}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {c.metric && (
                        <span className="rounded-[3px] border border-line-2 bg-abyss px-2 py-0.5 font-mono text-[13px] text-ink-2">
                          {c.metric} {c.operator === ">=" ? "≥" : "≤"} {c.threshold}
                          {c.unit && <span className="text-ink-4"> {c.unit}</span>}
                        </span>
                      )}
                      {c.is_success_criterion && <Badge tone="signal">success criterion</Badge>}
                      <Badge tone={SUPPORT[c.support_status].tone}>{SUPPORT[c.support_status].label}</Badge>
                      <Badge tone="muted">{c.source === "user" ? "user-defined" : c.source === "llm" ? "LLM-extracted · traced" : "rule-extracted"}</Badge>
                      {c.edited && <Badge tone="violet">edited</Badge>}
                      {c.horizon_years && <span className="font-mono text-[12.5px] text-ink-4">horizon {c.horizon_years} y</span>}
                    </div>
                    {c.evidence && c.evidence.length > 0 && (
                      <details className="mt-2.5">
                        <summary className="cursor-pointer text-[13px] text-ink-3 hover:text-ink-2">{c.evidence.length} linked evidence passage(s)</summary>
                        <ul className="mt-2 space-y-2 border-l border-line-2 pl-3">
                          {c.evidence.map((e) => (
                            <li key={e.id} className="text-[13px] leading-relaxed">
                              <Badge tone={e.stance === "supports" ? "holds" : e.stance === "contradicts" ? "fail" : "muted"} className="mr-1.5">{e.stance}</Badge>
                              <span className="text-ink-2">“{e.text}”</span>
                              <div className="mt-0.5 text-[12.5px] text-ink-4">
                                {e.source_title} {e.year && `(${e.year})`}{" "}
                                {e.doi && <a href={`https://doi.org/${e.doi}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-signal/80 hover:text-signal">doi <ExternalLink className="h-3 w-3" /></a>}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                  {writable && (
                    <div className="flex shrink-0 gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                      <Button size="icon" variant="ghost" aria-label="Edit claim" onClick={() => setEditing(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" aria-label="Delete claim" onClick={() => remove(c)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
            {!measurable.length && <li className="px-4 py-6 text-[13.5px] text-ink-4">No quantified claims found in the text. Add success criteria manually or in the Intervention Lab.</li>}
          </ul>
        </Panel>

        {vague.length > 0 && (
          <Panel>
            <PanelHeader code="03.2" title={`Unsupported / non-measurable claims · ${vague.length}`} />
            <ul className="divide-y divide-line/70">
              {vague.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                  <Badge tone="fail" className="mt-0.5">not testable</Badge>
                  <p className="flex-1 text-[14px] leading-relaxed text-ink-2">{c.text}</p>
                  {writable && <Button size="icon" variant="ghost" aria-label="Make measurable" onClick={() => setEditing(c)}><Pencil className="h-3.5 w-3.5" /></Button>}
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-4 py-2.5 text-[13px] text-ink-4">These statements contain no quantity that can be checked against the model. Edit one to give it a metric and threshold if it should be tested.</div>
          </Panel>
        )}

        <Panel>
          <PanelHeader code="03.3" title={`Assumptions · ${stated.length} stated · ${modelA.length} model`} />
          <div className="grid grid-cols-1 divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
            <div className="p-4">
              <div className="mb-2 text-[12px] text-ink-4">Stated in the proposal</div>
              {stated.length ? (
                <ul className="space-y-2.5">
                  {stated.map((a) => (
                    <li key={a.id} className="text-[13.5px] leading-relaxed text-ink-2">
                      {a.text}
                      {a.parameter_name && <span className="ml-1.5 font-mono text-[12px] text-signal/80">→ {a.parameter_name}</span>}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[13.5px] text-ink-4">None detected.</p>}
            </div>
            <div className="p-4">
              <div className="mb-2 text-[12px] text-ink-4">Built into the computational model</div>
              <ul className="space-y-2.5">
                {modelA.map((a) => <li key={a.id} className="text-[13.5px] leading-relaxed text-ink-3">{a.text}</li>)}
              </ul>
            </div>
          </div>
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel ticks>
          <PanelHeader code="B(x,θ)" title="Active success criteria" />
          <div className="p-4">
            <p className="mb-3 font-mono text-[13px] leading-relaxed text-ink-3">B = min<sub>k</sub> margin<sub>k</sub>; claim holds iff B ≥ 0. Margins are normalised by the threshold.</p>
            <div className="space-y-2.5">
              {data.criteria.map((c) => {
                const m = nominalOk ? nominal!.margins[c.metric] : undefined;
                return (
                  <div key={c.metric} className="rounded-[var(--radius-sm)] border border-line bg-abyss/60 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[13.5px] text-ink-2">{METRIC_META[c.metric]?.label || c.metric}</span>
                      <span className="font-mono text-[13px] text-ink">{c.op === ">=" ? "≥" : "≤"} {c.threshold}</span>
                    </div>
                    {nominalOk && (
                      <div className="mt-2 flex items-center justify-between font-mono text-[13px]">
                        <span className="text-ink-4">nominal {metricValue(c.metric, (nominal as unknown as Record<string, number>)[c.metric])}</span>
                        <span className={cn(m !== undefined && m >= 0 ? "text-holds" : "text-fail")}>margin {m !== undefined ? signed(m) : "—"}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {nominalOk && (
              <div className={cn("mt-4 rounded-[var(--radius-sm)] border p-3", nominal!.success ? "border-holds/30 bg-holds/5" : "border-fail/30 bg-fail/5")}>
                <div className="text-[12px] text-ink-4">Nominal scenario (model)</div>
                <div className={cn("mt-1 font-mono text-[22px]", nominal!.success ? "text-holds" : "text-fail")}>B = {signed(nominal!.net_benefit)}</div>
                <div className="mt-1 text-[13px] text-ink-3">{nominal!.success ? "Claim holds under nominal conditions." : `Claim already fails at nominal: ${nominal!.binding_criterion}.`}</div>
              </div>
            )}
          </div>
        </Panel>
        <Notice tone="signal">Numbers in proposals are treated as <b>claims to test</b>, never as evidence. All computed values on this page come from the scientific engine, not from a language model.</Notice>
      </div>

      <ClaimEditor claim={editing} invId={inv.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(true); }} />
    </div>
  );
}

function ClaimEditor({ claim, invId, onClose, onSaved }: { claim: Claim | "new" | null; invId: string; onClose: () => void; onSaved: () => void }) {
  const isNew = claim === "new";
  const c = claim && claim !== "new" ? claim : null;
  const [form, setForm] = useState({ text: "", metric: "cooling_c" as MetricKey, operator: ">=" as ">=" | "<=", threshold: "", criterion: true });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const k = claim === "new" ? "new" : c?.id ?? null;
  if (k !== key) {
    setKey(k);
    setErr(null);
    setForm({ text: c?.text || "", metric: (c?.metric || "cooling_c") as MetricKey, operator: (c?.operator || ">=") as ">=" | "<=", threshold: c?.threshold?.toString() ?? "", criterion: c ? c.is_success_criterion || !c.measurable : true });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body = { text: form.text, metric: form.metric, operator: form.operator, threshold: form.threshold === "" ? null : Number(form.threshold), measurable: true, is_success_criterion: form.criterion };
      if (isNew) await api(`/investigations/${invId}/claims`, { body });
      else await api(`/claims/${c!.id}`, { method: "PATCH", body });
      onSaved();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!claim} onClose={onClose} title={isNew ? "Add claim" : "Edit claim structure"}>
      <div className="space-y-3.5">
        <div><Label htmlFor="ct">Claim text</Label><Textarea id="ct" rows={3} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></div>
        <div className="grid grid-cols-[1fr_80px_120px] gap-2">
          <div><Label htmlFor="cm">Metric</Label><Select id="cm" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value as MetricKey })}>{METRIC_OPTS.map((m) => <option key={m} value={m}>{METRIC_META[m].label}</option>)}</Select></div>
          <div><Label htmlFor="co">Op</Label><Select id="co" value={form.operator} onChange={(e) => setForm({ ...form, operator: e.target.value as ">=" | "<=" })}><option value=">=">≥</option><option value="<=">≤</option></Select></div>
          <div><Label htmlFor="cth">Threshold</Label><Input id="cth" type="number" step="any" className="font-mono" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} /></div>
        </div>
        <label className="flex items-center justify-between text-[14px] text-ink-2">Use as success criterion in B(x, θ)<Switch checked={form.criterion} onChange={(v) => setForm({ ...form, criterion: v })} /></label>
        <p className="text-[13px] text-ink-4">Changes apply to the next BACKFIRE run. Survival is a fraction (0.5 = 50 %). Only one criterion per metric is used; user-edited claims take precedence.</p>
        {err ? <ErrorState error={err} compact /> : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}><X className="h-4 w-4" /> Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={form.text.trim().length < 3 || (form.criterion && form.threshold === "")}><Check className="h-4 w-4" /> Save</Button>
        </div>
      </div>
    </Dialog>
  );
}
