"use client";
import { GitCompare, Plus, RefreshCw, Sprout, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { C, EChart, axisBase, tooltipBase } from "@/components/charts/echart";
import { canWrite, useAuth } from "@/components/auth";
import { useInvestigation } from "@/components/investigation-context";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, ErrorState, Input, Label, LoadingBlock, Notice, Panel, PanelHeader, Select, Tabs } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn, fmt, pct, signed } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { AlternativeRow, Parameter } from "@/lib/types";

interface Resp { alternatives: { rows: AlternativeRow[]; created_at: string; inputs: { n_stress_points: number } } | null; custom: { rows: AlternativeRow[]; created_at: string } | null }
const CAT_COLOR: Record<string, string> = { baseline: C.ink, species: C.holds, density: C.violet, irrigation: C.signal, combined: C.caution, custom: "#f0abfc" };

export default function AlternativesPage() {
  const { inv, version } = useInvestigation();
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi<Resp>(`/investigations/${inv.id}/alternatives`, [version]);
  const params = useApi<Parameter[]>(`/investigations/${inv.id}/parameters`, [version]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [cat, setCat] = useState("all");
  const [custom, setCustom] = useState<{ label: string; changes: Record<string, string> }[]>([]);
  const [customRows, setCustomRows] = useState<AlternativeRow[] | null>(null);

  const designParams = (params.data || []).filter((p) => p.kind === "intervention");
  const rows = data?.alternatives?.rows || [];
  const nStress = data?.alternatives?.inputs.n_stress_points ?? 0;
  const allRows = useMemo(() => [...rows, ...((customRows || data?.custom?.rows || []).filter((r) => r.key !== "proposal"))], [rows, customRows, data]);
  const shown = allRows.filter((r) => cat === "all" || r.category === cat || r.key === "proposal");
  const base = rows.find((r) => r.key === "proposal");

  async function recalc() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/investigations/${inv.id}/alternatives`, { body: {} });
      await reload(true);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function runCustom() {
    setBusy(true);
    setErr(null);
    try {
      const body = { custom: custom.map((c) => ({ label: c.label || "Custom design", changes: Object.fromEntries(Object.entries(c.changes).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])) })) };
      const r = await api<{ rows: AlternativeRow[] }>(`/investigations/${inv.id}/alternatives`, { body });
      setCustomRows(r.rows);
      setCat("all");
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Panel><LoadingBlock rows={8} /></Panel>;
  if (error) return <ErrorState error={error} onRetry={() => reload()} />;

  return (
    <div className="space-y-5">
      {!rows.length ? (
        <Panel>
          <EmptyState icon={GitCompare} title="No alternatives evaluated yet" body="Alternatives are generated after counterexamples are verified, so each option can be tested against the conditions that broke the original proposal." action={canWrite(user) ? <Button variant="signal" onClick={recalc} loading={busy}><RefreshCw className="h-4 w-4" /> Evaluate now</Button> : undefined} />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
            <Panel ticks>
              <PanelHeader code="07.1" title="Environmental trade-offs · cooling vs water">
                {canWrite(user) && <Button size="sm" variant="ghost" onClick={recalc} loading={busy}><RefreshCw className="h-3.5 w-3.5" /> Recalculate</Button>}
              </PanelHeader>
              <EChart
                height={380}
                option={{
                  grid: { left: 60, right: 30, top: 30, bottom: 50 },
                  tooltip: {
                    ...tooltipBase,
                    formatter: (p: unknown) => {
                      const r = allRows[(p as { dataIndex: number }).dataIndex];
                      return `<b>${r.label}</b><br/>median cooling ${r.cooling_p50.toFixed(2)} °C (p05 ${r.cooling_p05.toFixed(2)})<br/>median irrigation ${fmt(r.water_p50, 0)} m³/ha/yr<br/>P(failure) ${pct(r.failure_probability)}`;
                    },
                  },
                  xAxis: { type: "value", name: "median gross irrigation (m³/ha/yr)", nameLocation: "middle", nameGap: 30, ...axisBase },
                  yAxis: { type: "value", name: "median cooling (°C)", ...axisBase },
                  series: [{
                    type: "scatter",
                    data: allRows.map((r) => ({
                      value: [r.water_p50, r.cooling_p50],
                      symbolSize: 8 + (1 - r.failure_probability) * 14,
                      itemStyle: { color: (CAT_COLOR[r.category] || C.ink) + (r.key === "proposal" ? "" : "cc"), borderColor: r.key === "proposal" ? "#fff" : "transparent", borderWidth: 1.5 },
                      label: { show: r.key === "proposal", formatter: "proposal", position: "right", color: C.ink2, fontSize: 10.5 },
                    })),
                  }],
                }}
              />
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[12.5px] text-ink-3">
                {Object.entries(CAT_COLOR).map(([k, c]) => <span key={k} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{k}</span>)}
                <span className="ml-auto text-ink-4">marker size ∝ 1 − P(failure)</span>
              </div>
            </Panel>
            <div className="space-y-5">
              <Panel>
                <PanelHeader code="07.2" title="How alternatives are scored" />
                <div className="space-y-2 p-4 text-[13.5px] leading-relaxed text-ink-2">
                  <p>Each alternative changes <b>only design parameters (θ)</b>. It is then evaluated by the model under:</p>
                  <ol className="ml-4 list-decimal space-y-1 text-ink-3">
                    <li>nominal environmental conditions;</li>
                    <li>the environmental conditions of the {nStress} best verified counterexample(s);</li>
                    <li>600 Monte Carlo draws of environmental uncertainty.</li>
                  </ol>
                  <p className="text-ink-4">Species classes are WUCOLS water-use categories, not named species — a local species list must be matched to each class. Check candidate species presence with the GBIF tool on the Evidence page.</p>
                </div>
              </Panel>
              {base && (
                <Panel className="p-4">
                  <div className="text-[12px] text-ink-4">Original proposal</div>
                  <div className="mt-2 grid grid-cols-2 gap-3 font-mono text-[13px]">
                    <div><div className="text-ink-4">P(failure)</div><div className="text-[18px] text-fail">{pct(base.failure_probability)}</div></div>
                    <div><div className="text-ink-4">survives counterex.</div><div className="text-[18px] text-ink">{base.survives_counterexamples}/{nStress}</div></div>
                  </div>
                </Panel>
              )}
            </div>
          </div>

          <Panel>
            <PanelHeader code="07.3" title="Comparison">
              <Tabs value={cat} onChange={setCat} items={[{ value: "all", label: "All" }, { value: "species", label: "Species" }, { value: "density", label: "Density" }, { value: "irrigation", label: "Irrigation" }, { value: "combined", label: "Combined" }, { value: "custom", label: "Custom" }]} />
            </PanelHeader>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-[13.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-[0.1em] text-ink-4">
                    <th className="px-4 py-2 font-medium">Alternative</th>
                    <th className="px-3 py-2 font-medium">Changes</th>
                    <th className="px-3 py-2 text-right font-medium">P(fail) · 95% CI</th>
                    <th className="px-3 py-2 text-right font-medium">Survives cex.</th>
                    <th className="px-3 py-2 text-right font-medium">B nominal</th>
                    <th className="px-3 py-2 text-right font-medium">Cooling</th>
                    <th className="px-3 py-2 text-right font-medium">Survival</th>
                    <th className="px-3 py-2 text-right font-medium">WSI</th>
                    <th className="px-3 py-2 text-right font-medium">Water m³/ha</th>
                    <th className="px-3 py-2 text-right font-medium">Cost $/ha</th>
                  </tr>
                </thead>
                <tbody>
                  {[...shown].sort((a, b) => (a.key === "proposal" ? -1 : b.key === "proposal" ? 1 : a.failure_probability - b.failure_probability)).map((r) => {
                    const better = base && r.key !== "proposal" && r.failure_probability < base.failure_probability;
                    return (
                      <tr key={r.key + r.label} className={cn("border-b border-line/60", r.key === "proposal" && "bg-raise/40")}>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CAT_COLOR[r.category] }} /><span className="text-ink">{r.label}</span></div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[12px] text-ink-3">{Object.entries(r.changes).map(([k, v]) => `${k}=${fmt(v)}`).join(" · ") || "—"}</td>
                        <td className={cn("px-3 py-2.5 text-right font-mono", better ? "text-holds" : r.key === "proposal" ? "text-ink" : "text-ink-2")}>
                          {pct(r.failure_probability)} <span className="text-[12px] text-ink-4">[{pct(r.failure_ci95[0], 0)}–{pct(r.failure_ci95[1], 0)}]</span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">{nStress ? <span className={r.survives_counterexamples === nStress ? "text-holds" : r.survives_counterexamples ? "text-caution" : "text-fail"}>{r.survives_counterexamples}/{nStress}</span> : "—"}</td>
                        <td className={cn("px-3 py-2.5 text-right font-mono", r.nominal.success ? "text-holds" : "text-fail")}>{signed(r.nominal.net_benefit)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-ink-2">{r.nominal.cooling_c.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-ink-2">{pct(r.nominal.survival_rate, 0)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-ink-2">{r.nominal.water_stress_index.toFixed(3)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-ink-2">{fmt(r.nominal.irrigation_m3_ha, 0)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-ink-2">{fmt(r.nominal.annual_cost_usd_ha, 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line px-4 py-2 text-[12.5px] text-ink-4">A lower failure probability under the stated priors is not evidence that an alternative will succeed in the field. Cost uses an assumed water tariff of {inv.settings.water_price_usd_m3} USD/m³.</p>
          </Panel>
        </>
      )}

      {canWrite(user) && (
        <Panel>
          <PanelHeader code="07.4" title="Design a custom alternative">
            <Button size="sm" variant="ghost" disabled={custom.length >= 6} onClick={() => setCustom([...custom, { label: `Custom ${custom.length + 1}`, changes: {} }])}><Plus className="h-3.5 w-3.5" /> Add design</Button>
          </PanelHeader>
          <div className="space-y-3 p-4">
            {custom.length === 0 && <p className="text-[13.5px] text-ink-3">Add a design to change species water use, planting density, irrigation efficiency, allocation, deficit strategy, maintenance or canopy target. Environmental conditions cannot be changed here.</p>}
            {custom.map((c, i) => (
              <div key={i} className="rounded-[var(--radius-sm)] border border-line bg-abyss/50 p-3">
                <div className="mb-2.5 flex items-center gap-2">
                  <Sprout className="h-4 w-4 text-holds" />
                  <Input aria-label="Design name" className="h-7 max-w-xs" value={c.label} onChange={(e) => { const n = [...custom]; n[i] = { ...c, label: e.target.value }; setCustom(n); }} />
                  <Button size="icon" variant="ghost" aria-label="Remove design" onClick={() => setCustom(custom.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
                <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
                  {designParams.map((p) => (
                    <div key={p.name}>
                      <Label htmlFor={`${i}-${p.name}`} className="normal-case tracking-normal">{p.label} <span className="font-mono text-ink-4">[{fmt(p.lower)}–{fmt(p.upper)}]</span></Label>
                      {p.name === "species_factor" ? (
                        <Select id={`${i}-${p.name}`} value={c.changes[p.name] ?? ""} onChange={(e) => { const n = [...custom]; n[i] = { ...c, changes: { ...c.changes, [p.name]: e.target.value } }; setCustom(n); }}>
                          <option value="">unchanged ({p.nominal})</option>
                          <option value="0.1">very low (0.1)</option><option value="0.25">low (0.25)</option><option value="0.5">moderate (0.5)</option><option value="0.8">high (0.8)</option>
                        </Select>
                      ) : (
                        <Input id={`${i}-${p.name}`} type="number" step="any" min={p.lower} max={p.upper} placeholder={`unchanged (${fmt(p.nominal)})`} className="h-8 font-mono text-[13px]" value={c.changes[p.name] ?? ""} onChange={(e) => { const n = [...custom]; n[i] = { ...c, changes: { ...c.changes, [p.name]: e.target.value } }; setCustom(n); }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {err ? <ErrorState error={err} compact /> : null}
            {custom.length > 0 && <Button variant="signal" onClick={runCustom} loading={busy}><RefreshCw className="h-4 w-4" /> Evaluate {custom.length} design(s) with the model</Button>}
            {customRows && <Badge tone="holds">custom designs added to the comparison above</Badge>}
          </div>
        </Panel>
      )}
      {inv.climatology?.synthetic && <Notice tone="caution">Synthetic baseline climate — results are exploratory.</Notice>}
    </div>
  );
}
