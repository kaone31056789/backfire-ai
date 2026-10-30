import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

export function fmt(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(2);
  if (a >= 1000) return v.toLocaleString("en-GB", { maximumFractionDigits: 0 });
  return v.toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export const pct = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`;

export function signed(v: number, d = 3) {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;
}

export function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.max(1, Math.round(s))}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export const shortId = (id: string) => id.slice(0, 8).toUpperCase();

export const METRIC_META: Record<string, { label: string; unit: string; digits: number; asPct?: boolean }> = {
  cooling_c: { label: "Daytime air cooling", unit: "°C", digits: 2 },
  survival_rate: { label: "Survival at horizon", unit: "", digits: 1, asPct: true },
  water_stress_index: { label: "Water-stress index", unit: "", digits: 3 },
  irrigation_m3_ha: { label: "Gross irrigation", unit: "m³/ha/yr", digits: 0 },
  annual_cost_usd_ha: { label: "Annual cost", unit: "USD/ha/yr", digits: 0 },
  et0_mm: { label: "Reference ET₀", unit: "mm/yr", digits: 0 },
  etc_mm: { label: "Landscape demand", unit: "mm/yr", digits: 0 },
  transpiration_ratio: { label: "Summer transpiration ratio", unit: "", digits: 3 },
  effective_canopy: { label: "Effective canopy", unit: "", digits: 1, asPct: true },
  net_benefit: { label: "Net benefit B", unit: "", digits: 3 },
};

export function metricValue(key: string, v: number | null | undefined): string {
  const m = METRIC_META[key];
  if (v === null || v === undefined) return "—";
  if (!m) return fmt(v);
  if (m.asPct) return pct(v, m.digits);
  return `${v.toFixed(m.digits)}${m.unit ? " " + m.unit : ""}`;
}

export const AGENT_META: Record<string, { label: string; code: string }> = {
  orchestrator: { label: "Orchestrator", code: "ORC" },
  claim_extraction: { label: "Claim Extraction", code: "CLM" },
  evidence_research: { label: "Evidence Research", code: "EVD" },
  causal_analysis: { label: "Causal Analysis", code: "CSL" },
  adversarial_research: { label: "Adversarial Research", code: "ADV" },
  optimisation: { label: "Optimisation", code: "OPT" },
  verification: { label: "Independent Verification", code: "VER" },
  alternatives: { label: "Alternatives", code: "ALT" },
  report_compilation: { label: "Report Compilation", code: "REP" },
};

export const PIPELINE = [
  "claim_extraction",
  "evidence_research",
  "causal_analysis",
  "adversarial_research",
  "optimisation",
  "verification",
  "alternatives",
  "report_compilation",
];

export const METHOD_COLORS: Record<string, string> = {
  MPFS: "#22d3ee",
  "Random search": "#6b7a94",
  "Differential evolution": "#a5b4fc",
  "NSGA-II": "#fbbf24",
};
