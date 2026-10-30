"use client";
import { ChevronDown, FileText, Loader2, MapPin, Plus, Rocket, Sparkles, Trash2, Upload, Wand2, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { canWrite, useAuth } from "@/components/auth";
import { Button } from "@/components/ui/button";
import { Badge, ErrorState, Input, Label, LoadingBlock, Notice, PageHeader, Panel, PanelHeader, Select, Switch, Textarea, Tip } from "@/components/ui/primitives";
import { useScene } from "@/components/scene";
import { api } from "@/lib/api";
import { cn, fmt } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Investigation, MethodKey, MetricKey, Registry, RegistryParam } from "@/lib/types";
import type { Film } from "@/components/film-player";

const FilmPlayer = dynamic(() => import("@/components/film-player").then((m) => m.FilmPlayer), { ssr: false });

const EXAMPLE = `The Green Canopy Programme will plant 250 trees per hectare across 40 hectares of dense residential blocks, raising tree canopy cover to 35% at maturity. The programme will reduce summer daytime air temperatures by 0.5 °C within 10 years, with at least 50% of planted trees surviving. Trees will be watered with drip irrigation from the municipal supply, and we assume sufficient water is available throughout the dry season. Irrigation will not exceed 2,500 m3 per hectare per year. The programme will improve residents' wellbeing and neighbourhood resilience.`;

const SITES = [
  { name: "New Delhi", country: "India", lat: 28.6139, lon: 77.209 },
  { name: "Phoenix", country: "United States", lat: 33.4484, lon: -112.074 },
  { name: "Madrid", country: "Spain", lat: 40.4168, lon: -3.7038 },
  { name: "Cairo", country: "Egypt", lat: 30.0444, lon: 31.2357 },
  { name: "Adelaide", country: "Australia", lat: -34.9285, lon: 138.6007 },
  { name: "Mexico City", country: "Mexico", lat: 19.4326, lon: -99.1332 },
  { name: "Riyadh", country: "Saudi Arabia", lat: 24.7136, lon: 46.6753 },
  { name: "Nairobi", country: "Kenya", lat: -1.2921, lon: 36.8219 },
];

const SITUATIONS = [
  { emoji: "🌳", title: "Cool a hot city with trees", place: "New Delhi", site: SITES[0], text: EXAMPLE, goals: { cooling: 0.5, survival: 0.5 } },
  { emoji: "🏜️", title: "Green a desert city", place: "Riyadh", site: SITES[6], text: "The Riyadh Shade Streets project will plant 200 drought-tolerant trees per hectare along residential streets, reaching 30% canopy cover. It aims to cool summer streets by 0.7 °C within 10 years with at least 60% of trees surviving, using drip irrigation from treated wastewater.", goals: { cooling: 0.7, survival: 0.6 } },
  { emoji: "🌇", title: "Shade a Mediterranean heat island", place: "Madrid", site: SITES[2], text: "Madrid's Green Ring will plant 250 trees per hectare in dense blocks to reach 35% canopy cover, reducing summer air temperatures by 0.6 °C within 10 years while keeping 70% of trees alive. Spray irrigation is supplied by the municipal network.", goals: { cooling: 0.6, survival: 0.7 } },
  { emoji: "🌵", title: "Tree-lined streets in a dry US city", place: "Phoenix", site: SITES[1], text: "Phoenix Cool Corridors will plant 150 trees per hectare along bus routes, reaching 25% canopy. The city promises 0.5 °C cooler summer streets within 10 years, with 55% of trees surviving, using drip irrigation.", goals: { cooling: 0.5, survival: 0.55 } },
  { emoji: "🌧️", title: "A monsoon city park", place: "Nairobi", site: SITES[7], text: "The Nairobi Pocket Parks programme will plant 300 trees per hectare to reach 40% canopy, cooling surrounding streets by 0.8 °C within 10 years with 65% of trees alive. Trees rely on seasonal rain plus spray irrigation in dry months.", goals: { cooling: 0.8, survival: 0.65 } },
];

const DEMO_IDEAS = [
  "We want to plant 300 trees per hectare in Jaipur to cool the streets by 1 °C and keep 70% of trees alive for 10 years, using drip irrigation.",
  "Plant 200 trees per hectare along the main roads of Cairo so summer streets are 0.8 °C cooler, with at least 60% of the trees surviving.",
  "Our Mumbai school-yard programme will reach 35% canopy with 250 trees per hectare, cool the yards by 0.6 °C and keep 75% of trees alive.",
];

const METRICS: { value: MetricKey; label: string; unit: string; op: ">=" | "<=" }[] = [
  { value: "cooling_c", label: "Daytime air cooling", unit: "°C", op: ">=" },
  { value: "survival_rate", label: "Tree survival at horizon", unit: "fraction 0–1", op: ">=" },
  { value: "water_stress_index", label: "Water-stress index", unit: "0–1", op: "<=" },
  { value: "irrigation_m3_ha", label: "Gross irrigation", unit: "m³/ha/yr", op: "<=" },
  { value: "annual_cost_usd_ha", label: "Annual cost", unit: "USD/ha/yr", op: "<=" },
];

const METHODS: { key: MethodKey; label: string; note: string }[] = [
  { key: "mpfs", label: "MPFS", note: "experimental method under test" },
  { key: "random", label: "Random search", note: "baseline" },
  { key: "de", label: "Differential evolution", note: "SciPy baseline" },
  { key: "nsga2", label: "NSGA-II", note: "pymoo multi-objective baseline" },
];

type ParamState = Record<string, { nominal: number; lower: number; upper: number; active: boolean }>;
interface Obj { metric: MetricKey; operator: ">=" | "<="; threshold: string }

export default function InterventionLab() {
  const router = useRouter();
  const { user } = useAuth();
  const reg = useApi<Registry>("/registry");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [site, setSite] = useState({ name: "", country: "", lat: "", lon: "" });
  const [objectives, setObjectives] = useState<Obj[]>([]);
  const [params, setParams] = useState<ParamState>({});
  const [settings, setSettings] = useState({ budget: 2000, lambda: 4, methods: ["mpfs", "random", "de", "nsga2"] as MethodKey[], horizon_years: 10, cooling_response: "saturating", include_intervention_params: true, seed: 42 });
  const [upload, setUpload] = useState<{ upload_id: string; filename: string; pages: number; characters: number; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [autostart, setAutostart] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [idea, setIdea] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftInfo, setDraftInfo] = useState<{ mode: string; model: string; note: string | null } | null>(null);
  const [preview, setPreview] = useState<Film | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewSeq = useRef(0);

  /** Animated preview of the chosen scenario (computed by the real model, nothing saved yet). */
  async function loadPreview(p: { title: string; name: string; lat: number; lon: number; objectives: { metric: string; operator: string; threshold: number }[]; hints?: Record<string, number> }) {
    const seq = ++previewSeq.current;
    setPreviewing(true);
    setPreview(null);
    try {
      const f = await api<Film>("/scenario/preview", { body: { title: p.title, location_name: p.name, latitude: p.lat, longitude: p.lon, objectives: p.objectives, parameter_hints: p.hints || {} } });
      if (seq === previewSeq.current) setPreview(f);
    } catch {
      if (seq === previewSeq.current) setPreview(null);
    } finally {
      if (seq === previewSeq.current) setPreviewing(false);
    }
  }

  function applyGoals(cooling: number, survival: number) {
    setObjectives([
      { metric: "cooling_c", operator: ">=", threshold: String(cooling) },
      { metric: "survival_rate", operator: ">=", threshold: String(survival) },
    ]);
  }
  function chooseSituation(sit: (typeof SITUATIONS)[number]) {
    setChosen(sit.title);
    setTitle(`${sit.title} — ${sit.place}`);
    setDescription(sit.text);
    setSite({ name: sit.site.name, country: sit.site.country, lat: String(sit.site.lat), lon: String(sit.site.lon) });
    applyGoals(sit.goals.cooling, sit.goals.survival);
    setDraftInfo(null);
    loadPreview({ title: `${sit.title} — ${sit.place}`, name: sit.site.name, lat: sit.site.lat, lon: sit.site.lon,
      objectives: [{ metric: "cooling_c", operator: ">=", threshold: sit.goals.cooling }, { metric: "survival_rate", operator: ">=", threshold: sit.goals.survival }] });
  }
  const [typing, setTyping] = useState(false);
  const demoIdx = useRef(0);
  async function typeInto(text: string) {
    setTyping(true);
    setIdea("");
    for (let k = 1; k <= text.length; k += 2) {
      setIdea(text.slice(0, k));
      await new Promise((res) => setTimeout(res, 14));
    }
    setIdea(text);
    setTyping(false);
  }
  async function typeDemoIdea() {
    const text = DEMO_IDEAS[demoIdx.current++ % DEMO_IDEAS.length];
    await typeInto(text);
    await buildWithAi(text);
  }

  async function buildWithAi(text?: string) {
    const description = (text ?? idea).trim();
    setDrafting(true);
    setError(null);
    try {
      // an empty box means "surprise me": the AI invents a scenario for a hot city and we type it in
      const d = await api<{ idea: string; invented: boolean; title: string; location_name: string; country: string; latitude: number | null; longitude: number | null; description: string; objectives: { metric: MetricKey; operator: ">=" | "<="; threshold: number }[]; parameter_hints: Record<string, number>; mode: string; model: string; note: string | null }>("/scenario/draft", { body: { description: description.length >= 10 ? description : "" } });
      if (d.invented) await typeInto(d.idea);
      setChosen("ai");
      setTitle(d.title);
      setDescription(d.description);
      if (d.latitude !== null && d.longitude !== null) setSite({ name: d.location_name, country: d.country, lat: String(d.latitude), lon: String(d.longitude) });
      setObjectives(d.objectives.map((o) => ({ metric: o.metric, operator: o.operator, threshold: String(o.threshold) })));
      setParams((prev) => {
        const next = { ...prev };
        Object.entries(d.parameter_hints || {}).forEach(([k, v]) => { if (next[k]) next[k] = { ...next[k], nominal: Math.min(next[k].upper, Math.max(next[k].lower, v)) }; });
        return next;
      });
      setDraftInfo({ mode: d.mode, model: d.model, note: d.note });
      if (d.latitude !== null && d.longitude !== null)
        loadPreview({ title: d.title, name: d.location_name, lat: d.latitude, lon: d.longitude, objectives: d.objectives, hints: d.parameter_hints });
    } catch (e) {
      setError(e);
    } finally {
      setDrafting(false);
    }
  }
  const fileRef = useRef<HTMLInputElement>(null);

  // the shared 3D Earth becomes the site picker while the lab is open
  const scene = useScene();
  useEffect(() => {
    scene.setPickHandler((la, lo) => setSite((st) => ({ ...st, lat: String(la), lon: String(lo) })));
    return () => {
      scene.setPickHandler(null);
      scene.setPicked(null);
    };
  }, [scene]);

  useEffect(() => {
    const p = (user?.preferences || {}) as { default_budget?: number; default_lambda?: number; default_methods?: MethodKey[] };
    setSettings((s) => ({ ...s, budget: p.default_budget ?? s.budget, lambda: p.default_lambda ?? s.lambda, methods: p.default_methods?.length ? p.default_methods : s.methods }));
  }, [user]);

  useEffect(() => {
    if (!reg.data || Object.keys(params).length) return;
    const p: ParamState = {};
    reg.data.parameters.forEach((r) => (p[r.name] = { nominal: r.nominal, lower: r.lower, upper: r.upper, active: true }));
    setParams(p);
  }, [reg.data, params]);

  const lat = parseFloat(site.lat);
  const lon = parseFloat(site.lon);
  const validSite = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 66 && Math.abs(lon) <= 180;

  useEffect(() => {
    scene.setPicked(validSite ? { lat, lon } : null);
  }, [scene, validSite, lat, lon]);

  const paramErrors = useMemo(() => {
    const e: Record<string, string> = {};
    Object.entries(params).forEach(([k, v]) => {
      if (!(v.lower <= v.nominal && v.nominal <= v.upper)) e[k] = "Requires lower ≤ nominal ≤ upper";
    });
    return e;
  }, [params]);

  const issues: string[] = [];
  if (title.trim().length < 3) issues.push("Title (≥ 3 characters)");
  if (description.trim().length < 20 && !upload) issues.push("Intervention description (≥ 20 characters)");
  if (!validSite) issues.push("Site location (latitude within ±66°)");
  if (Object.keys(paramErrors).length) issues.push("Valid parameter ranges");
  if (objectives.some((o) => o.threshold === "" || !Number.isFinite(Number(o.threshold)))) issues.push("Numeric thresholds");
  if (!settings.methods.length) issues.push("At least one search method");

  async function doUpload(f: File) {
    setUploadError(null);
    if (!f.name.toLowerCase().endsWith(".pdf")) return setUploadError(new Error("Only PDF files are accepted."));
    if (f.size > 15 * 1024 * 1024) return setUploadError(new Error("File exceeds 15 MB."));
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      setUpload(await api("/uploads", { form: fd }));
    } catch (e) {
      setUploadError(e);
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const reged = reg.data!.parameters;
      const changed: Record<string, Partial<{ nominal: number; lower: number; upper: number; active: boolean }>> = {};
      reged.forEach((r) => {
        const v = params[r.name];
        if (!v) return;
        if (v.nominal !== r.nominal || v.lower !== r.lower || v.upper !== r.upper || !v.active) changed[r.name] = v;
      });
      const inv = await api<Investigation>("/investigations", {
        body: {
          title: title.trim(),
          description: (description.trim() || `Intervention described in uploaded document ${upload?.filename}.`).padEnd(20, "."),
          location_name: site.name.trim(),
          country: site.country.trim(),
          latitude: lat,
          longitude: lon,
          objectives: objectives.map((o) => ({ metric: o.metric, operator: o.operator, threshold: Number(o.threshold), label: `${METRICS.find((m) => m.value === o.metric)?.label} ${o.operator} ${o.threshold}` })),
          parameters: changed,
          settings: { budget: settings.budget, lambda: settings.lambda, methods: settings.methods, horizon_years: settings.horizon_years, cooling_response: settings.cooling_response, include_intervention_params: settings.include_intervention_params },
          seed: settings.seed,
          upload_id: upload?.upload_id,
        },
      });
      if (autostart) {
        await api(`/investigations/${inv.id}/run-backfire`, { method: "POST" });
        router.push(`/investigations/${inv.id}/engine`);
      } else router.push(`/investigations/${inv.id}/overview`);
    } catch (e) {
      setError(e);
      setSubmitting(false);
    }
  }

  if (!canWrite(user)) return <Notice tone="caution">Your role (viewer) cannot create investigations.</Notice>;

  const groups: [string, RegistryParam[]][] = reg.data
    ? [
        ["Environmental conditions · x", reg.data.parameters.filter((p) => p.kind === "environment")],
        ["Intervention design · θ", reg.data.parameters.filter((p) => p.kind === "intervention")],
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- what is this? */}
      <div className="hud rounded-3xl p-7 md:p-9">
        <div className="text-[13px] font-medium uppercase tracking-[0.18em] text-[#ff7a4d]">New investigation</div>
        <h1 className="mt-2 text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] text-white md:text-[44px]">Test a climate promise 🌍</h1>
        <p className="mt-3 max-w-3xl text-[17px] leading-relaxed text-white/70">
          Someone promises: <i>“If we plant these trees, the city will be cooler.”</i> BACKFIRE checks that promise by simulating the next 10 years —
          and then searches for the <b className="text-white">smallest realistic change</b> (a bit hotter, a bit less water…) that would make it fail.
        </p>
      </div>

      {/* ---------------------------------------------------------------- step 1 */}
      <div className="hud rounded-3xl p-6 md:p-7">
        <StepTitle n={1} title="Pick a situation" sub="Start from a ready-made scenario, or describe your own idea and let the AI build it." />
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {SITUATIONS.map((sit, i) => (
            <motion.button key={sit.title} type="button" onClick={() => chooseSituation(sit)} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} whileHover={{ y: -3 }}
              className={`rounded-2xl border p-4 text-left transition-colors ${chosen === sit.title ? "border-[#ff5b2e] bg-[#ff5b2e]/10" : "border-white/10 bg-white/[0.03] hover:border-white/25"}`}>
              <div className="text-[30px]">{sit.emoji}</div>
              <div className="mt-2 text-[15.5px] font-semibold text-white">{sit.title}</div>
              <div className="mt-1 flex items-center gap-1 text-[13px] text-white/50"><MapPin className="h-3.5 w-3.5" />{sit.place} · cool by {sit.goals.cooling} °C · {Math.round(sit.goals.survival * 100)}% trees alive</div>
            </motion.button>
          ))}
          <div className={`rounded-2xl border p-4 sm:col-span-2 xl:col-span-1 ${chosen === "ai" ? "border-[#a78bfa] bg-[#a78bfa]/10" : "border-dashed border-[#a78bfa]/50 bg-[#a78bfa]/[0.05]"}`}>
            <div className="flex items-center gap-2 text-[15.5px] font-semibold text-white"><Sparkles className="h-4 w-4 text-[#a78bfa]" /> Describe your own idea</div>
            <textarea value={idea} onChange={(e) => setIdea(e.target.value)} rows={3} maxLength={4000} placeholder="e.g. Plant 300 trees per hectare in Jaipur to cool streets by 1 °C and keep 70% of trees alive with drip irrigation"
              className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-black/30 p-3 text-[14px] text-white placeholder:text-white/35 focus:border-[#a78bfa]/60 focus:outline-none" />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button variant="ghost" className="border border-white/10" onClick={typeDemoIdea} disabled={typing || drafting}><Sparkles className="h-4 w-4" /> {typing ? "Typing…" : "Demo idea"}</Button>
              <Button variant="outline" className="border-[#a78bfa]/60 bg-[#a78bfa]/15 text-white hover:bg-[#a78bfa]/25" onClick={() => buildWithAi()} loading={drafting} disabled={typing}><Wand2 className="h-4 w-4" /> {drafting ? "AI is thinking…" : idea.trim().length >= 10 ? "Let AI build it" : "Surprise me (AI)"}</Button>
            </div>
            <div className="mt-2 text-[12px] text-white/45">{draftInfo ? (draftInfo.mode === "llm" ? `✨ Built by ${draftInfo.model}` : "Built by the rule-based reader.") + (draftInfo.note ? ` ${draftInfo.note}` : "") : "Type an idea, or leave it empty and the AI invents one for you."}</div>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- step 2 */}
      <AnimatePresence>
        {title && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="hud rounded-3xl p-6 md:p-7">
            <StepTitle n={2} title="Check the promise" sub="This is what BACKFIRE will try to break. Change any number you like." />
            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <Label htmlFor="t2">Name</Label>
                <Input id="t2" value={title} onChange={(e) => setTitle(e.target.value)} />
                <div className="mt-3 flex items-center gap-2 text-[14px] text-white/75"><MapPin className="h-4 w-4 text-[#ff7a4d]" />{site.name || "No place yet"}{site.country && `, ${site.country}`} {validSite && <span className="font-mono text-[12px] text-white/40">({Number(site.lat).toFixed(2)}, {Number(site.lon).toFixed(2)})</span>}</div>
                <div className="mt-1 text-[12.5px] text-white/45">Tip: click anywhere on the globe behind this page to move the site.</div>
                <details className="mt-3"><summary className="cursor-pointer text-[13px] text-white/55">Read the full proposal</summary><Textarea rows={5} className="mt-2" value={description} onChange={(e) => setDescription(e.target.value)} /></details>
              </div>
              <div className="space-y-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-[13px] text-white/55">The promise must keep all of these:</div>
                {objectives.length === 0 && <div className="text-[14px] text-white/60">Default targets: cool by 0.5 °C and keep 50% of trees alive.</div>}
                {objectives.map((o, i) => {
                  const isSurv = o.metric === "survival_rate";
                  const label = { cooling_c: "🌡️ Cool the streets by at least", survival_rate: "🌳 Keep at least", water_stress_index: "💧 Keep tree thirst below", irrigation_m3_ha: "🚿 Use at most", annual_cost_usd_ha: "💰 Cost at most" }[o.metric];
                  const unit = { cooling_c: "°C", survival_rate: "% of trees alive", water_stress_index: "(0–1)", irrigation_m3_ha: "m³ water / ha / yr", annual_cost_usd_ha: "USD / ha / yr" }[o.metric];
                  const shown = isSurv ? String(Math.round(Number(o.threshold) * 100)) : o.threshold;
                  return (
                    <div key={i} className="flex items-center gap-2 text-[14.5px] text-white">
                      <span className="flex-1">{label}</span>
                      <Input aria-label={label} type="number" step="any" className="h-9 w-24 font-mono" value={shown} onChange={(e) => { const n = [...objectives]; n[i] = { ...o, threshold: isSurv ? String(Number(e.target.value) / 100) : e.target.value }; setObjectives(n); }} />
                      <span className="w-36 text-[13px] text-white/55">{unit}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------------------------------------------------------- preview film */}
      <AnimatePresence>
        {(previewing || preview) && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="hud rounded-3xl p-6 md:p-7">
            <StepTitle n="▶" title="Watch it first 🎬" sub={preview?.biome ? `${preview.biome.label}: ${preview.biome.why} The model plays the plan, then a hotter & drier what-if.` : "Building the city, trees and weather for this place…"} />
            <div className="mt-5">
              {preview ? <FilmPlayer key={`${preview.title}-${preview.location}`} film={preview} compact /> : (
                <div className="grid aspect-video w-full place-items-center rounded-3xl border border-white/10 bg-black/40">
                  <div className="flex items-center gap-3 text-[15px] text-white/60"><Loader2 className="h-5 w-5 animate-spin" /> Fetching the local climate and simulating 10 years…</div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------------------------------------------------------- step 3 */}
      <div className="hud flex flex-col items-start gap-4 rounded-3xl p-6 md:flex-row md:items-center md:justify-between md:p-7">
        <div>
          <StepTitle n={3} title="Run the simulation" sub="Agents gather evidence, simulate 10 years, search for the breaking point and make a short film of the result (about a minute)." />
          {issues.length > 0 && <div className="mt-2 pl-12 text-[13px] text-[#f5b84a]">Still needed: {issues.join(" · ")}</div>}
          {error ? <div className="mt-3 pl-12"><ErrorState error={error} compact /></div> : null}
        </div>
        <Button variant="primary" size="lg" className="h-14 shrink-0 rounded-2xl px-8 text-[16px]" disabled={issues.length > 0 || !reg.data} loading={submitting} onClick={submit}>
          <Rocket className="h-5 w-5" /> Run the simulation
        </Button>
      </div>

      {/* ---------------------------------------------------------------- advanced */}
      <button type="button" onClick={() => setAdvanced((a) => !a)} className="flex w-full items-center justify-center gap-2 py-2 text-[14px] text-white/55 hover:text-white">
        Advanced options (proposal text, PDF, parameter ranges, search settings) <ChevronDown className={`h-4 w-4 transition-transform ${advanced ? "rotate-180" : ""}`} />
      </button>
      {advanced && (
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_420px]">
        <div className="space-y-5">
          <Panel ticks>
            <PanelHeader code="A" title="Intervention proposal" />
            <div className="space-y-4 p-4">
              <div>
                <Label htmlFor="title">Investigation title</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Green Canopy Programme — Phase 1" maxLength={300} />
              </div>
              <div>
                <Label htmlFor="desc">Intervention description and claims</Label>
                <Textarea id="desc" rows={8} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Paste the proposal text. Quantified claims (e.g. 'reduce air temperature by 1 °C', '80% survival', 'no more than 2,000 m3 per hectare') are extracted automatically." maxLength={50000} />
                <div className="mt-1 flex justify-between text-[12.5px] text-ink-4"><span>Numbers in your text are read as claims to test — never as evidence.</span><span className="font-mono">{description.length}/50000</span></div>
              </div>
              <div>
                <Label>Supporting PDF report (optional)</Label>
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) doUpload(f); }}
                  className="flex items-center gap-4 rounded-[var(--radius-sm)] border border-dashed border-line-2 bg-abyss/50 px-4 py-3.5"
                >
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin text-signal" /> : <Upload className="h-5 w-5 text-ink-4" />}
                  <div className="flex-1 text-[13.5px]">
                    {upload ? (
                      <div>
                        <div className="text-ink">{upload.filename}</div>
                        <div className="font-mono text-[12.5px] text-ink-3">{upload.pages} pages · {fmt(upload.characters, 0)} characters extracted (sandboxed, text only)</div>
                      </div>
                    ) : (
                      <span className="text-ink-3">Drop a PDF here or <button className="text-signal hover:underline" onClick={() => fileRef.current?.click()}>browse</button>. Max 15 MB. Text is extracted in an isolated process; nothing in the file is executed.</span>
                    )}
                  </div>
                  {upload && <button onClick={() => setUpload(null)} aria-label="Remove upload" className="text-ink-4 hover:text-ink"><X className="h-4 w-4" /></button>}
                  <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => e.target.files?.[0] && doUpload(e.target.files[0])} />
                </div>
                {uploadError ? <div className="mt-2"><ErrorState error={uploadError} compact /></div> : null}
                {upload?.preview && <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-[3px] border border-line bg-void/60 p-2.5 font-mono text-[12px] leading-relaxed text-ink-3">{upload.preview}</pre>}
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader code="B" title="Environmental objectives · success thresholds">
              <Button size="sm" variant="ghost" onClick={() => setObjectives([...objectives, { metric: "cooling_c", operator: ">=", threshold: "" }])} disabled={objectives.length >= 5}>
                <Plus className="h-3.5 w-3.5" /> Add threshold
              </Button>
            </PanelHeader>
            <div className="p-4">
              {objectives.length === 0 ? (
                <p className="text-[13.5px] text-ink-3">
                  Optional. If none are given, thresholds are taken from claims extracted from the text, falling back to the case-study defaults
                  {reg.data && <> ({reg.data.criteria.map((c) => `${c.metric} ${c.op} ${c.threshold}`).join(", ")})</>}.
                </p>
              ) : (
                <div className="space-y-2">
                  {objectives.map((o, i) => (
                    <div key={i} className="grid grid-cols-[1fr_80px_130px_32px] items-center gap-2">
                      <Select value={o.metric} aria-label="Metric" onChange={(e) => { const m = METRICS.find((x) => x.value === e.target.value)!; const n = [...objectives]; n[i] = { ...o, metric: m.value, operator: m.op }; setObjectives(n); }}>
                        {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label} ({m.unit})</option>)}
                      </Select>
                      <Select value={o.operator} aria-label="Operator" onChange={(e) => { const n = [...objectives]; n[i] = { ...o, operator: e.target.value as ">=" | "<=" }; setObjectives(n); }}>
                        <option value=">=">≥</option>
                        <option value="<=">≤</option>
                      </Select>
                      <Input type="number" step="any" aria-label="Threshold" value={o.threshold} placeholder="threshold" onChange={(e) => { const n = [...objectives]; n[i] = { ...o, threshold: e.target.value }; setObjectives(n); }} className="font-mono" />
                      <Button size="icon" variant="ghost" aria-label="Remove threshold" onClick={() => setObjectives(objectives.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <p className="pt-1 text-[13px] text-ink-4">Survival is a fraction (0.6 = 60 %). Success means every threshold holds: B = min normalised margin ≥ 0.</p>
                </div>
              )}
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader code="C" title="Parameter configuration · plausible ranges" />
            {reg.loading ? <LoadingBlock rows={8} /> : reg.error ? <ErrorState error={reg.error} onRetry={() => reg.reload()} /> : (
              <div className="overflow-x-auto">
                {groups.map(([g, ps]) => (
                  <div key={g}>
                    <div className="border-y border-line bg-abyss/60 px-4 py-1.5 font-mono text-[12px] text-ink-3">{g}</div>
                    <table className="w-full min-w-[820px] text-[13.5px]">
                      <thead>
                        <tr className="text-left text-[11.5px] uppercase tracking-[0.1em] text-ink-4">
                          <th className="w-10 px-4 py-2 font-medium">Search</th>
                          <th className="px-2 py-2 font-medium">Parameter</th>
                          <th className="px-2 py-2 font-medium">Basis</th>
                          <th className="w-24 px-2 py-2 font-medium">Lower</th>
                          <th className="w-24 px-2 py-2 font-medium">Nominal</th>
                          <th className="w-24 px-2 py-2 font-medium">Upper</th>
                          <th className="px-2 py-2 font-medium">Unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ps.map((p) => {
                          const v = params[p.name];
                          if (!v) return null;
                          const set = (k: "lower" | "nominal" | "upper") => (e: React.ChangeEvent<HTMLInputElement>) => setParams({ ...params, [p.name]: { ...v, [k]: e.target.value === "" ? NaN : Number(e.target.value) } });
                          return (
                            <tr key={p.name} className={cn("border-t border-line/50", !v.active && "opacity-50")}>
                              <td className="px-4 py-1.5"><Switch checked={v.active} label={`Include ${p.label} in search`} onChange={(a) => setParams({ ...params, [p.name]: { ...v, active: a } })} /></td>
                              <td className="px-2 py-1.5">
                                <Tip text={`${p.description} ${p.validity}`.trim()}><span className="cursor-help text-ink-2 underline decoration-line-2 decoration-dotted underline-offset-4">{p.label}</span></Tip>
                              </td>
                              <td className="px-2 py-1.5">
                                <Badge tone={p.status === "literature" ? "holds" : p.status === "engineering" ? "signal" : "caution"}>{p.status}</Badge>
                                {p.sources.length > 0 && <span className="ml-1.5 font-mono text-[11.5px] text-ink-4">{p.sources.join(", ")}</span>}
                              </td>
                              {(["lower", "nominal", "upper"] as const).map((k) => (
                                <td key={k} className="px-2 py-1.5">
                                  <Input type="number" step="any" value={Number.isNaN(v[k]) ? "" : v[k]} onChange={set(k)} aria-label={`${p.label} ${k}`} className={cn("h-7 px-2 font-mono text-[13px]", paramErrors[p.name] && "border-fail/60")} />
                                </td>
                              ))}
                              <td className="px-2 py-1.5 font-mono text-[12.5px] text-ink-3">{p.unit}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
                <div className="border-t border-line px-4 py-2.5 text-[13px] text-ink-4">
                  <Badge tone="caution">assumption</Badge> parameters are uncalibrated; results depending on them are exploratory. Disable a switch to hold a parameter fixed at nominal during the search.
                </div>
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel ticks className="overflow-hidden">
            <PanelHeader code="D" title="Geographical context" />
            <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-[#ff5b2e]/30 bg-[#ff5b2e]/10 px-4 py-3 text-[13.5px] text-white/85">
              <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ff5b2e] opacity-60" /><span className="relative inline-flex h-3 w-3 rounded-full bg-[#ff5b2e]" /></span>
              Click anywhere on the 3D Earth behind this page to place the site.
            </div>
            <div className="space-y-3 p-4 pt-2.5">
              <div className="flex flex-wrap gap-1.5">
                {SITES.map((s) => (
                  <button key={s.name} onClick={() => setSite({ name: s.name, country: s.country, lat: String(s.lat), lon: String(s.lon) })} className={cn("rounded-[3px] border px-2 py-0.5 text-[13px] transition-colors", site.name === s.name ? "border-signal/50 text-signal" : "border-line-2 text-ink-3 hover:text-ink-2")}>{s.name}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div><Label htmlFor="sname">Site name</Label><Input id="sname" value={site.name} onChange={(e) => setSite({ ...site, name: e.target.value })} /></div>
                <div><Label htmlFor="country">Country</Label><Input id="country" value={site.country} onChange={(e) => setSite({ ...site, country: e.target.value })} /></div>
                <div><Label htmlFor="lat">Latitude</Label><Input id="lat" type="number" step="any" className="font-mono" value={site.lat} onChange={(e) => setSite({ ...site, lat: e.target.value })} /></div>
                <div><Label htmlFor="lon">Longitude</Label><Input id="lon" type="number" step="any" className="font-mono" value={site.lon} onChange={(e) => setSite({ ...site, lon: e.target.value })} /></div>
              </div>
              <p className="text-[13px] leading-relaxed text-ink-4">Click the map to place the site. The Evidence Research Agent requests NASA POWER monthly climatology for these coordinates; if unavailable, a clearly-labelled synthetic climate is used. FAO-56 radiation equations are valid to ±66° latitude.</p>
            </div>
          </Panel>

          <Panel>
            <PanelHeader code="E" title="Investigation settings" />
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="budget">Evaluation budget / method</Label>
                  <Input id="budget" type="number" min={200} max={20000} step={100} className="font-mono" value={settings.budget} onChange={(e) => setSettings({ ...settings, budget: Number(e.target.value) })} />
                </div>
                <div>
                  <Label htmlFor="lambda">λ (design-change weight)</Label>
                  <Input id="lambda" type="number" min={0.01} max={100} step={0.5} className="font-mono" value={settings.lambda} onChange={(e) => setSettings({ ...settings, lambda: Number(e.target.value) })} />
                </div>
                <div>
                  <Label htmlFor="seed">Random seed</Label>
                  <Input id="seed" type="number" min={0} className="font-mono" value={settings.seed} onChange={(e) => setSettings({ ...settings, seed: Number(e.target.value) })} />
                </div>
                <div>
                  <Label htmlFor="horizon">Horizon (years)</Label>
                  <Input id="horizon" type="number" min={1} max={50} className="font-mono" value={settings.horizon_years} onChange={(e) => setSettings({ ...settings, horizon_years: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <Label htmlFor="cr">Cooling response (structural hypothesis)</Label>
                <Select id="cr" value={settings.cooling_response} onChange={(e) => setSettings({ ...settings, cooling_response: e.target.value })}>
                  <option value="saturating">Saturating exponential (default)</option>
                  <option value="threshold">Logistic threshold near 40 % cover (after Ziter et al. 2019)</option>
                </Select>
              </div>
              <div>
                <Label>Search methods</Label>
                <div className="space-y-1.5">
                  {METHODS.map((m) => {
                    const on = settings.methods.includes(m.key);
                    return (
                      <label key={m.key} className="flex cursor-pointer items-center gap-2.5 text-[14px]">
                        <input type="checkbox" className="accent-[#22d3ee]" checked={on} onChange={() => setSettings({ ...settings, methods: on ? settings.methods.filter((x) => x !== m.key) : [...settings.methods, m.key] })} />
                        <span className="text-ink-2">{m.label}</span>
                        <span className="text-[13px] text-ink-4">{m.note}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                <span className="text-[13.5px] text-ink-2">Search over intervention parameters (θ) too</span>
                <Switch checked={settings.include_intervention_params} onChange={(v) => setSettings({ ...settings, include_intervention_params: v })} label="Include intervention parameters" />
              </div>
            </div>
          </Panel>

        </div>
      </div>
      )}
    </div>
  );
}

function StepTitle({ n, title, sub }: { n: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-[15px] font-bold text-black">{n}</span>
      <div>
        <div className="text-[20px] font-semibold tracking-[-0.02em] text-white">{title}</div>
        <div className="mt-0.5 text-[14px] text-white/55">{sub}</div>
      </div>
    </div>
  );
}
