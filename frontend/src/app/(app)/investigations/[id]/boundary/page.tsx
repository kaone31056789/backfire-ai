"use client";
import { Bookmark, Crosshair, Loader2, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import dynamic from "next/dynamic";

import { C, EChart, axisBase, tooltipBase } from "@/components/charts/echart";
import { canWrite, useAuth } from "@/components/auth";
import { useInvestigation } from "@/components/investigation-context";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, ErrorState, LoadingBlock, Notice, Panel, PanelHeader, Readout, Select, Tabs, type Tone } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn, fmt, metricValue, METRIC_META, pct, signed } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import type { BoundaryMap, Counterexample, MonteCarlo, Parameter, SimResult, Sobol } from "@/lib/types";

const FailureLandscape = dynamic(() => import("@/components/three/failure-landscape").then((m) => m.FailureLandscape), { ssr: false });

const STATUS_TONE: Record<string, Tone> = { verified: "holds", verified_with_warnings: "caution", rejected: "fail", unverified: "muted" };
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export default function BoundaryPage() {
  const { inv, version } = useInvestigation();
  const { user } = useAuth();
  const params = useApi<Parameter[]>(`/investigations/${inv.id}/parameters`, [version]);
  const cexs = useApi<Counterexample[]>(`/investigations/${inv.id}/counterexamples`, [version]);
  const analysis = useApi<{ sobol?: Sobol; monte_carlo?: MonteCarlo }>(`/investigations/${inv.id}/analysis`, [version]);

  const [values, setValues] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | "nominal">("nominal");
  const [sim, setSim] = useState<SimResult | null>(null);
  const [simErr, setSimErr] = useState<unknown>(null);
  const [axes, setAxes] = useState<{ x: string; y: string }>({ x: "", y: "" });
  const [map, setMap] = useState<BoundaryMap | null>(null);
  const [mapBusy, setMapBusy] = useState(false);
  const [tornado, setTornado] = useState<{ rows: { name: string; label: string; low: number; high: number; swing: number }[]; base: number } | null>(null);
  const [mc, setMc] = useState<MonteCarlo | null>(null);
  const [mcBusy, setMcBusy] = useState(false);
  const [scenarios, setScenarios] = useState<{ name: string; values: Record<string, number>; result: SimResult }[]>([]);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [sensTab, setSensTab] = useState<"local" | "sobol">("local");
  const [view, setView] = useState<"3d" | "2d">("3d");

  const nominal = useMemo(() => Object.fromEntries((params.data || []).map((p) => [p.name, p.nominal])), [params.data]);

  // initialise from the best verified MPFS counterexample (or nominal)
  useEffect(() => {
    if (!params.data || !cexs.data || Object.keys(values).length) return;
    const best = cexs.data.find((c) => c.method === "MPFS" && c.status !== "rejected" && c.distance > 0);
    if (best) {
      setSelected(best.id);
      setValues({ ...nominal, ...best.parameters });
      const top = Object.entries(best.deltas).sort((a, b) => Math.abs(b[1].normalised) - Math.abs(a[1].normalised)).map(([k]) => k);
      setAxes({ x: top[0] || "warming_c", y: top[1] || "supply_reliability" });
    } else {
      setValues(nominal);
      setAxes({ x: "warming_c", y: "supply_reliability" });
    }
  }, [params.data, cexs.data, nominal, values]);

  const debounced = useDebounced(values, 220);
  useEffect(() => {
    if (!Object.keys(debounced).length) return;
    let live = true;
    api<SimResult>(`/investigations/${inv.id}/simulate`, { body: { parameters: debounced, series: true } })
      .then((r) => live && (setSim(r), setSimErr(null)))
      .catch((e) => live && setSimErr(e));
    return () => {
      live = false;
    };
  }, [debounced, inv.id]);

  const computeMap = useCallback(async () => {
    if (!axes.x || !axes.y || axes.x === axes.y || !Object.keys(values).length) return;
    setMapBusy(true);
    try {
      setMap(await api<BoundaryMap>(`/investigations/${inv.id}/boundary`, { body: { x: axes.x, y: axes.y, parameters: values, resolution: 44 } }));
    } catch (e) {
      setSimErr(e);
    } finally {
      setMapBusy(false);
    }
    api<typeof tornado>(`/investigations/${inv.id}/sensitivity`, { body: { parameters: values, series: false } }).then(setTornado).catch(() => {});
  }, [axes, values, inv.id]);

  // recompute the map when axes change or the user releases sliders
  const mapKey = useDebounced(JSON.stringify([axes, values]), 700);
  useEffect(() => {
    computeMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey]);

  async function runMc() {
    setMcBusy(true);
    try {
      setMc(await api<MonteCarlo>(`/investigations/${inv.id}/uncertainty`, { body: { parameters: values, n: 1500 } }));
    } finally {
      setMcBusy(false);
    }
  }

  async function verify(id: string) {
    setVerifying(id);
    try {
      await api(`/counterexamples/${id}/verify`, { method: "POST" });
      await cexs.reload(true);
    } finally {
      setVerifying(null);
    }
  }

  function selectCex(id: string | "nominal") {
    setSelected(id);
    if (id === "nominal") return setValues(nominal);
    const c = cexs.data!.find((x) => x.id === id)!;
    setValues({ ...nominal, ...c.parameters });
  }

  if (params.loading || cexs.loading) return <Panel><LoadingBlock rows={8} /></Panel>;
  if (params.error) return <ErrorState error={params.error} onRetry={() => params.reload()} />;
  const P = params.data || [];
  const byName = Object.fromEntries(P.map((p) => [p.name, p]));
  const cex = cexs.data || [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[340px_1fr]">
        {/* ---------------------------------------------------------------- counterexamples */}
        <Panel ticks className="flex flex-col">
          <PanelHeader code="06.1" title={`Counterexamples · ${cex.length}`} />
          <div className="max-h-[560px] flex-1 overflow-y-auto">
            <button onClick={() => selectCex("nominal")} className={cn("block w-full border-b border-line/70 px-4 py-3 text-left transition-colors", selected === "nominal" ? "bg-raise/70" : "hover:bg-raise/30")}>
              <div className="flex items-center justify-between"><span className="text-[13.5px] text-ink">Nominal scenario</span><Badge tone="muted">baseline</Badge></div>
              <div className="mt-0.5 text-[12.5px] text-ink-4">Proposal as stated, nominal conditions</div>
            </button>
            {cex.length === 0 && <EmptyState icon={Crosshair} title="No counterexamples" body="Run BACKFIRE to search for plausible failure conditions." />}
            {cex.map((c) => {
              const top = Object.values(c.deltas).sort((a, b) => Math.abs(b.normalised) - Math.abs(a.normalised)).slice(0, 3);
              return (
                <div key={c.id} className={cn("border-b border-line/70 transition-colors", selected === c.id ? "bg-raise/70" : "hover:bg-raise/30")}>
                  <button onClick={() => selectCex(c.id)} className="block w-full px-4 pb-1.5 pt-3 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13.5px] text-ink">{c.method} <span className="font-mono text-ink-4">#{c.rank}</span></span>
                      <Badge tone={STATUS_TONE[c.status]}>{c.status.replace(/_/g, " ")}</Badge>
                    </div>
                    <div className="mt-1 flex gap-3 font-mono text-[12.5px]">
                      <span className="text-signal">d {fmt(c.distance)}</span>
                      <span className="text-fail">B {signed(c.net_benefit)}</span>
                      <span className="truncate text-ink-4">✗ {c.binding_criterion}</span>
                    </div>
                    <ul className="mt-1.5 space-y-0.5">
                      {top.length ? top.map((d) => (
                        <li key={d.label} className="flex justify-between text-[12.5px] text-ink-3"><span className="truncate">{d.label}</span><span className="font-mono">{fmt(d.from)} → {fmt(d.to)}</span></li>
                      )) : <li className="text-[12.5px] text-ink-4">Fails at nominal (no change needed)</li>}
                    </ul>
                  </button>
                  <div className="flex items-center justify-between px-4 pb-2.5">
                    <span className="font-mono text-[11.5px] text-ink-4">{c.verification ? `robustness ${pct(c.verification.robustness, 0)}` : "not verified"}</span>
                    {canWrite(user) && <Button size="sm" variant="ghost" onClick={() => verify(c.id)} loading={verifying === c.id}><ShieldCheck className="h-3.5 w-3.5" /> Re-verify</Button>}
                  </div>
                  {selected === c.id && c.verification && (
                    <div className="space-y-1 border-t border-line/60 bg-void/30 px-4 py-2.5">
                      {c.verification.checks.map((ck) => (
                        <div key={ck.name} className="flex items-start gap-2 text-[12.5px]">
                          <span className={ck.passed ? "text-holds" : ck.severity === "critical" ? "text-fail" : "text-caution"}>{ck.passed ? "✓" : "✗"}</span>
                          <span className="text-ink-3"><span className="text-ink-2">{ck.name.replace(/_/g, " ")}</span> — {ck.detail}</span>
                        </div>
                      ))}
                      {c.verification.flags.map((f) => <p key={f} className="pt-1 text-[12px] leading-snug text-caution/80">⚑ {f}</p>)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>

        {/* ---------------------------------------------------------------- live readout + map */}
        <div className="space-y-5">
          <Panel ticks>
            <PanelHeader code="06.2" title="Live simulation at current parameters">
              {sim && <Badge tone={sim.success ? "holds" : "fail"} dot>{sim.success ? "claim holds" : `falsified · ${sim.binding_criterion}`}</Badge>}
              {sim && sim.plausibility_violation > 0 && <Badge tone="caution">violates plausibility dependency</Badge>}
            </PanelHeader>
            {simErr ? <ErrorState error={simErr} compact /> : null}
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 p-4 md:grid-cols-3 2xl:grid-cols-6">
              <Readout label="Net benefit B" value={sim ? signed(sim.net_benefit) : "…"} tone={sim ? (sim.success ? "holds" : "fail") : undefined} sub="success iff B ≥ 0" />
              {["cooling_c", "survival_rate", "water_stress_index", "irrigation_m3_ha", "et0_mm"].map((k) => (
                <Readout key={k} label={METRIC_META[k].label} value={sim ? metricValue(k, (sim as unknown as Record<string, number>)[k]).replace(/ [^ ]+$/, "") : "…"} unit={METRIC_META[k].asPct ? "" : METRIC_META[k].unit} tone={sim?.margins[k] !== undefined ? (sim.margins[k] >= 0 ? "holds" : "fail") : undefined} sub={sim?.margins[k] !== undefined ? `margin ${signed(sim.margins[k])}` : undefined} />
              ))}
            </div>
            {sim?.series && (
              <EChart
                height={190}
                option={{
                  grid: { left: 46, right: 16, top: 26, bottom: 24 },
                  legend: { top: 0, textStyle: { color: C.ink3, fontSize: 10.5 }, itemWidth: 10, itemHeight: 2 },
                  tooltip: { ...tooltipBase, trigger: "axis", valueFormatter: (v) => `${Number(v).toFixed(1)} mm` },
                  xAxis: { type: "category", data: MONTHS, ...axisBase },
                  yAxis: { type: "value", name: "mm / month", ...axisBase },
                  series: [
                    { name: "Effective rain", type: "bar", stack: "in", data: sim.series.effective_rain_mm, itemStyle: { color: C.signal + "55" }, barWidth: 12 },
                    { name: "Irrigation (gross)", type: "bar", stack: "in", data: sim.series.irrigation_mm, itemStyle: { color: C.violet + "88" } },
                    { name: "Demand ETL", type: "line", data: sim.series.etl_mm, symbol: "none", lineStyle: { color: C.caution, width: 1.5 } },
                    { name: "Actual ETa", type: "line", data: sim.series.eta_mm, symbol: "none", lineStyle: { color: C.holds, width: 1.5 } },
                  ],
                }}
              />
            )}
            {sim && <p className="border-t border-line px-4 py-2 text-[12.5px] text-ink-4">Climate: {sim.climatology.source}. Gap between demand and actual ET is water stress.</p>}
          </Panel>

          <Panel>
            <PanelHeader code="06.3" title="Failure boundary · parameter space">
              <Select aria-label="X axis" className="h-7 w-44 text-[13px]" value={axes.x} onChange={(e) => setAxes({ ...axes, x: e.target.value })}>{P.map((p) => <option key={p.name} value={p.name} disabled={p.name === axes.y}>{p.label}</option>)}</Select>
              <span className="text-ink-4">×</span>
              <Select aria-label="Y axis" className="h-7 w-44 text-[13px]" value={axes.y} onChange={(e) => setAxes({ ...axes, y: e.target.value })}>{P.map((p) => <option key={p.name} value={p.name} disabled={p.name === axes.x}>{p.label}</option>)}</Select>
              {mapBusy && <Loader2 className="h-4 w-4 animate-spin text-signal" />}
            </PanelHeader>
            <div className="flex items-center gap-2 border-b border-line/70 px-5 py-2.5">
              <Tabs value={view} onChange={setView} items={[{ value: "3d", label: "3D landscape" }, { value: "2d", label: "2D heatmap" }]} />
              <span className="text-[13px] text-ink-4">{view === "3d" ? "Height = net benefit B. Red sea = failure. Drag to orbit." : "Colour = net benefit B; white cells trace B = 0."}</span>
            </div>
            {map ? (view === "3d" ? (
              <div className="bg-gradient-to-b from-[#0b0f18] to-[#05070b]">
                <FailureLandscape data={{ x: map.x, y: map.y, z: map.net_benefit, point: [values[map.x.name], values[map.y.name]], nominal: [nominal[map.x.name], nominal[map.y.name]] }} height={470} autoRotate={false} />
              </div>
            ) : <BoundaryHeatmap map={map} current={values} nominal={nominal} />) : <LoadingBlock rows={6} />}
            {map && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line px-4 py-2 text-[12.5px] text-ink-3">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[1px] bg-gradient-to-r from-fail to-fail/20" /> failure (B &lt; 0)</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[1px] bg-gradient-to-r from-holds/20 to-holds" /> success</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 bg-white" /> B = 0 boundary</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rotate-45 border border-signal" /> current</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-ink-2" /> nominal</span>
                <span className="ml-auto font-mono text-ink-4">{map.evaluations} model evaluations · {pct(map.failure_fraction)} of slice fails · other parameters at current values</span>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* ---------------------------------------------------------------- sliders */}
      <Panel>
        <PanelHeader code="06.4" title="Parameter sliders · re-run simulation">
          <Button size="sm" variant="ghost" onClick={() => { setSelected("nominal"); setValues(nominal); }}><RotateCcw className="h-3.5 w-3.5" /> Reset to nominal</Button>
          <Button size="sm" variant="outline" disabled={!sim || scenarios.length >= 4} onClick={() => sim && setScenarios([...scenarios, { name: `Scenario ${String.fromCharCode(65 + scenarios.length)}`, values: { ...values }, result: sim }])}><Bookmark className="h-3.5 w-3.5" /> Save scenario</Button>
        </PanelHeader>
        <div className="grid grid-cols-1 gap-x-8 gap-y-1 p-4 md:grid-cols-2 xl:grid-cols-3">
          {P.map((p) => {
            const v = values[p.name] ?? p.nominal;
            const changed = Math.abs(v - p.nominal) > 1e-9 * Math.max(1, Math.abs(p.nominal));
            const step = (p.upper - p.lower) / 200;
            return (
              <div key={p.name} className="py-1.5">
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className={cn("truncate", changed ? "text-ink" : "text-ink-3")}>
                    {p.label}
                    {p.status === "assumption" && <span className="ml-1 text-[11.5px] text-caution">●</span>}
                  </span>
                  <span className={cn("shrink-0 font-mono tabular", changed ? "text-signal" : "text-ink-3")}>{fmt(v, 3)} <span className="text-ink-4">{p.unit}</span></span>
                </div>
                <div className="relative">
                  <input type="range" className="instrument" min={p.lower} max={p.upper} step={step || 0.001} value={v} aria-label={p.label} onChange={(e) => setValues({ ...values, [p.name]: Number(e.target.value) })} />
                  <span className="pointer-events-none absolute top-[5px] h-2 w-px bg-ink-3" style={{ left: `${((p.nominal - p.lower) / (p.upper - p.lower || 1)) * 100}%` }} title="nominal" />
                </div>
              </div>
            );
          })}
        </div>
        <p className="border-t border-line px-4 py-2 text-[12.5px] text-ink-4">Tick marks show nominal values. <span className="text-caution">●</span> uncalibrated assumption. Every change is re-evaluated by the model; nothing is interpolated.</p>
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* ---------------------------------------------------------------- sensitivity */}
        <Panel>
          <PanelHeader code="06.5" title="Sensitivity">
            <Tabs value={sensTab} onChange={setSensTab} items={[{ value: "local", label: "At current point" }, { value: "sobol", label: "Global (Sobol)" }]} />
          </PanelHeader>
          {sensTab === "local" ? (
            tornado ? (
              <EChart
                height={Math.max(260, tornado.rows.length * 20 + 40)}
                option={{
                  grid: { left: 170, right: 30, top: 10, bottom: 30 },
                  tooltip: { ...tooltipBase, trigger: "axis", axisPointer: { type: "shadow" } },
                  xAxis: { type: "value", name: "B at bound − B at current", nameLocation: "middle", nameGap: 22, ...axisBase },
                  yAxis: { type: "category", inverse: true, data: tornado.rows.map((r) => r.label), ...axisBase, axisLabel: { ...axisBase.axisLabel, fontFamily: "var(--font-hanken)", fontSize: 11, color: C.ink2 } },
                  series: [
                    { name: "at lower bound", type: "bar", stack: "s", barWidth: 9, data: tornado.rows.map((r) => r.low - tornado.base), itemStyle: { color: C.signal + "aa" } },
                    { name: "at upper bound", type: "bar", stack: "t", barWidth: 9, barGap: "-100%", data: tornado.rows.map((r) => r.high - tornado.base), itemStyle: { color: C.violet + "aa" } },
                  ],
                }}
              />
            ) : <LoadingBlock rows={6} />
          ) : analysis.data?.sobol ? (
            <>
              <EChart
                height={Math.max(240, analysis.data.sobol.names.length * 22 + 40)}
                option={{
                  grid: { left: 170, right: 30, top: 24, bottom: 24 },
                  legend: { top: 0, textStyle: { color: C.ink3, fontSize: 10.5 }, itemWidth: 10, itemHeight: 8 },
                  tooltip: { ...tooltipBase, trigger: "axis", axisPointer: { type: "shadow" } },
                  xAxis: { type: "value", min: 0, ...axisBase },
                  yAxis: { type: "category", inverse: true, data: analysis.data.sobol.labels, ...axisBase, axisLabel: { ...axisBase.axisLabel, fontFamily: "var(--font-hanken)", fontSize: 11, color: C.ink2 } },
                  series: [
                    { name: "Total-order Sₜ", type: "bar", barWidth: 7, data: analysis.data.sobol.results.net_benefit.ST.map((v) => Math.max(0, v)), itemStyle: { color: C.violet } },
                    { name: "First-order S₁", type: "bar", barWidth: 7, data: analysis.data.sobol.results.net_benefit.S1.map((v) => Math.max(0, v)), itemStyle: { color: C.signal + "aa" } },
                  ],
                }}
              />
              <p className="border-t border-line px-4 py-2 text-[12.5px] text-ink-4">{analysis.data.sobol.method}; {analysis.data.sobol.n_evaluations} evaluations; environmental parameters over uniform plausible ranges, output B. {analysis.data.sobol.note}</p>
            </>
          ) : <p className="p-4 text-[13.5px] text-ink-4">Sobol indices are computed by the Adversarial Research Agent during a BACKFIRE run.</p>}
        </Panel>

        {/* ---------------------------------------------------------------- uncertainty */}
        <Panel>
          <PanelHeader code="06.6" title="Uncertainty intervals · Monte Carlo">
            <Button size="sm" variant="signal" onClick={runMc} loading={mcBusy}>Run at current design</Button>
          </PanelHeader>
          {(() => {
            const m = mc || analysis.data?.monte_carlo;
            if (!m) return <p className="p-4 text-[13.5px] text-ink-4">No uncertainty analysis yet. Run Monte Carlo at the current design, or run BACKFIRE.</p>;
            const h = m.metrics.cooling_c.histogram;
            return (
              <div>
                <div className="grid grid-cols-3 gap-4 p-4">
                  <Readout label="P(failure)" value={pct(m.failure_probability)} tone={m.failure_probability > 0.5 ? "fail" : m.failure_probability > 0.1 ? "caution" : "holds"} sub={`95% CI ${pct(m.failure_ci95[0])}–${pct(m.failure_ci95[1])}`} />
                  <Readout label="Cooling p05–p95" value={`${m.metrics.cooling_c.p05.toFixed(2)}–${m.metrics.cooling_c.p95.toFixed(2)}`} unit="°C" sub={`median ${m.metrics.cooling_c.p50.toFixed(2)}`} />
                  <Readout label="Survival p05–p95" value={`${pct(m.metrics.survival_rate.p05, 0)}–${pct(m.metrics.survival_rate.p95, 0)}`} sub={`n = ${m.n_valid} (${m.rejected_by_constraints} rejected)`} />
                </div>
                <EChart
                  height={170}
                  option={{
                    grid: { left: 40, right: 16, top: 10, bottom: 34 },
                    tooltip: { ...tooltipBase, trigger: "axis" },
                    xAxis: { type: "category", data: h.counts.map((_, i) => ((h.edges[i] + h.edges[i + 1]) / 2).toFixed(2)), name: "cooling °C", nameLocation: "middle", nameGap: 22, ...axisBase },
                    yAxis: { type: "value", ...axisBase },
                    series: [{ type: "bar", barCategoryGap: "8%", data: h.counts, itemStyle: { color: C.holds + "99" } }],
                  }}
                />
                <div className="space-y-1.5 border-t border-line px-4 py-3">
                  {m.per_criterion.map((c) => (
                    <div key={c.metric} className="flex items-center gap-3 text-[13px]">
                      <span className="w-40 truncate text-ink-3">{METRIC_META[c.metric]?.label}</span>
                      <div className="h-1 flex-1 rounded-full bg-line"><div className="h-full rounded-full bg-fail/80" style={{ width: `${c.failure_probability * 100}%` }} /></div>
                      <span className="w-32 text-right font-mono text-ink-2">{pct(c.failure_probability)} <span className="text-ink-4">±CI</span></span>
                    </div>
                  ))}
                  <p className="pt-1 text-[12.5px] leading-relaxed text-ink-4">{m.note}</p>
                </div>
              </div>
            );
          })()}
        </Panel>
      </div>

      {/* ---------------------------------------------------------------- scenario comparison */}
      <Panel>
        <PanelHeader code="06.7" title="Scenario comparison" />
        {scenarios.length === 0 ? (
          <p className="p-4 text-[13.5px] text-ink-4">Save up to four slider configurations to compare their model outcomes side by side.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] uppercase tracking-[0.1em] text-ink-4">
                  <th className="px-4 py-2 font-medium">Quantity</th>
                  {scenarios.map((s, i) => (
                    <th key={i} className="px-4 py-2 font-medium">
                      <span className="flex items-center gap-2">{s.name}<button aria-label={`Remove ${s.name}`} onClick={() => setScenarios(scenarios.filter((_, j) => j !== i))} className="text-ink-4 hover:text-fail"><Trash2 className="h-3 w-3" /></button></span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {["net_benefit", "cooling_c", "survival_rate", "water_stress_index", "irrigation_m3_ha", "annual_cost_usd_ha"].map((k) => (
                  <tr key={k} className="border-b border-line/60">
                    <td className="px-4 py-2 text-ink-3">{METRIC_META[k].label}</td>
                    {scenarios.map((s, i) => {
                      const v = (s.result as unknown as Record<string, number>)[k];
                      const ok = k === "net_benefit" ? v >= 0 : s.result.margins[k] !== undefined ? s.result.margins[k] >= 0 : undefined;
                      return <td key={i} className={cn("px-4 py-2 font-mono", ok === undefined ? "text-ink-2" : ok ? "text-holds" : "text-fail")}>{k === "net_benefit" ? signed(v) : metricValue(k, v)}</td>;
                    })}
                  </tr>
                ))}
                <tr>
                  <td className="px-4 py-2 align-top text-ink-3">Changed parameters</td>
                  {scenarios.map((s, i) => (
                    <td key={i} className="px-4 py-2 align-top text-[12.5px] text-ink-3">
                      {Object.entries(s.values).filter(([k, v]) => Math.abs(v - (nominal[k] ?? v)) > 1e-9).map(([k, v]) => <div key={k}>{byName[k]?.label}: <span className="font-mono text-ink-2">{fmt(v)}</span></div>)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {inv.climatology?.synthetic && <Notice tone="caution">This investigation uses a <b>synthetic</b> baseline climate. All boundaries are exploratory simulations.</Notice>}
    </div>
  );
}

function BoundaryHeatmap({ map, current, nominal }: { map: BoundaryMap; current: Record<string, number>; nominal: Record<string, number> }) {
  const n = map.x.values.length;
  const zmax = Math.max(0.05, ...map.net_benefit.flat().map(Math.abs));
  const data: [number, number, number][] = [];
  const edge: [number, number][] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const b = map.net_benefit[j][i];
      data.push([i, j, b]);
      const right = i + 1 < n ? map.net_benefit[j][i + 1] : b;
      const up = j + 1 < n ? map.net_benefit[j + 1][i] : b;
      if ((b < 0) !== (right < 0) || (b < 0) !== (up < 0)) edge.push([i, j]);
    }
  const idx = (vals: number[], v: number) => vals.reduce((best, x, k) => (Math.abs(x - v) < Math.abs(vals[best] - v) ? k : best), 0);
  const cur: [number, number] = [idx(map.x.values, current[map.x.name]), idx(map.y.values, current[map.y.name])];
  const nom: [number, number] = [idx(map.x.values, nominal[map.x.name]), idx(map.y.values, nominal[map.y.name])];
  const label = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3));
  return (
    <EChart
      height={430}
      option={{
        grid: { left: 70, right: 80, top: 16, bottom: 56 },
        tooltip: {
          ...tooltipBase,
          formatter: (p: unknown) => {
            const d = (p as { data: number[] }).data;
            if (d.length < 3) return "";
            const crit = map.criteria[map.binding[d[1]][d[0]]];
            return `${map.x.label}: ${label(map.x.values[d[0]])} ${map.x.unit}<br/>${map.y.label}: ${label(map.y.values[d[1]])} ${map.y.unit}<br/>B = ${d[2].toFixed(3)} · binding: ${crit}${map.implausible[d[1]][d[0]] ? "<br/><span style='color:#fbbf24'>violates plausibility dependency</span>" : ""}`;
          },
        },
        xAxis: { type: "category", data: map.x.values.map(label), name: `${map.x.label} (${map.x.unit})`, nameLocation: "middle", nameGap: 34, ...axisBase, axisLabel: { ...axisBase.axisLabel, interval: Math.floor(n / 6) }, splitLine: { show: false } },
        yAxis: { type: "category", data: map.y.values.map(label), name: `${map.y.label} (${map.y.unit})`, nameLocation: "middle", nameGap: 52, ...axisBase, axisLabel: { ...axisBase.axisLabel, interval: Math.floor(n / 6) }, splitLine: { show: false } },
        visualMap: { min: -zmax, max: zmax, calculable: false, orient: "vertical", right: 8, top: "middle", itemHeight: 160, itemWidth: 10, text: ["success", "fail"], textStyle: { color: C.ink3, fontSize: 10 }, inRange: { color: ["#fb7185", "#7a2a3a", "#1a1420", "#0d2a24", "#34d399"] }, seriesIndex: 0 },
        series: [
          { type: "heatmap", data, progressive: 0, emphasis: { itemStyle: { borderColor: "#fff", borderWidth: 1 } } },
          { type: "scatter", data: edge, symbol: "rect", symbolSize: 3, itemStyle: { color: "#e6edf7" }, silent: true, z: 3 },
          { type: "scatter", data: [nom], symbol: "circle", symbolSize: 11, itemStyle: { color: "transparent", borderColor: C.ink2, borderWidth: 1.5 }, z: 4 },
          { type: "scatter", data: [cur], symbol: "diamond", symbolSize: 14, itemStyle: { color: "transparent", borderColor: C.signal, borderWidth: 2 }, z: 5 },
        ],
      }}
    />
  );
}
