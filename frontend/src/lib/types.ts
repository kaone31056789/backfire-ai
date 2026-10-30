export type Role = "admin" | "researcher" | "viewer";

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  organisation: { id: string; name: string } | null;
  preferences: Record<string, unknown>;
}

export type InvStatus = "draft" | "analysing" | "analysed" | "running" | "completed" | "failed";

export interface InvestigationSummary {
  id: string;
  title: string;
  category: string;
  status: InvStatus;
  stage: string;
  location_name: string;
  country: string;
  latitude: number;
  longitude: number;
  seed: number;
  created_at: string;
  updated_at: string | null;
  owner: string | null;
  error: string | null;
  counts: { counterexamples: number; verified: number; evidence_sources: number };
  mpfs_min_distance: number | null;
  running: boolean;
}

export interface Climatology {
  tmax: number[];
  tmin: number[];
  rh: number[];
  precip_mm: number[];
  latitude: number;
  elevation_m: number;
  source: string;
  synthetic: boolean;
}

export interface Investigation extends InvestigationSummary {
  description: string;
  objectives: Objective[];
  source_document_name: string | null;
  source_text_chars: number;
  settings: InvSettings;
  algorithm_versions: Record<string, string>;
  climatology: Climatology | null;
  model_config_hash: string | null;
}

export interface InvSettings {
  budget: number;
  lambda: number;
  methods: MethodKey[];
  include_intervention_params: boolean;
  mc_samples: number;
  sobol_base: number;
  horizon_years: number;
  cooling_response: "saturating" | "threshold";
  water_price_usd_m3: number;
}

export type MethodKey = "mpfs" | "random" | "de" | "nsga2";
export type MetricKey = "cooling_c" | "survival_rate" | "water_stress_index" | "irrigation_m3_ha" | "annual_cost_usd_ha";

export interface Objective {
  metric: MetricKey;
  operator: ">=" | "<=";
  threshold: number;
  label?: string;
}

export interface Parameter {
  name: string;
  label: string;
  kind: "environment" | "intervention";
  unit: string;
  nominal: number;
  lower: number;
  upper: number;
  status: "literature" | "engineering" | "assumption";
  sources: string[];
  active: boolean;
  weight: number;
  description: string;
  validity: string;
  registry_lower: number;
  registry_upper: number;
  registry_nominal: number;
}

export interface RegistryParam {
  name: string;
  label: string;
  kind: "environment" | "intervention";
  unit: string;
  nominal: number;
  lower: number;
  upper: number;
  status: "literature" | "engineering" | "assumption";
  sources: string[];
  description: string;
  validity: string;
  weight: number;
}

export interface Registry {
  parameters: RegistryParam[];
  criteria: { metric: MetricKey; op: ">=" | "<="; threshold: number; label: string }[];
  metrics: Record<string, { label: string; unit: string }>;
  references: Record<string, { key: string; citation: string; doi: string | null; url: string | null; source_type: string }>;
  constraints: { name: string; coeffs: Record<string, number>; bound: number; rationale: string }[];
}

export interface Claim {
  id: string;
  text: string;
  metric: MetricKey | null;
  operator: ">=" | "<=" | null;
  threshold: number | null;
  unit: string | null;
  horizon_years: number | null;
  measurable: boolean;
  is_success_criterion: boolean;
  support_status: "supported" | "contested" | "unsupported" | "untested";
  evidence_ids: string[];
  source: "extracted" | "user" | "llm";
  edited: boolean;
  evidence?: { id: string; text: string; stance: Stance; source_title: string; doi: string | null; year: number | null }[];
}

export interface Assumption {
  id: string;
  text: string;
  parameter_name: string | null;
  status: string;
  source: "extracted" | "model" | "user";
}

export type Stance = "supports" | "contradicts" | "neutral";

export interface EvidenceSource {
  id: string;
  provider: string;
  doi: string | null;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  source_type: "peer_reviewed" | "preprint" | "government_report" | "technical_guide" | "assessment_report" | "other";
  url: string | null;
  cited_by: number | null;
  abstract: string | null;
  quality: { score?: number; basis?: string };
  limitations: string[];
  doi_verified: boolean;
  query: string | null;
  retrieved_at: string;
  passages: { id: string; text: string; topic: string; stance: Stance; relevance: number }[];
}

export interface AgentEvent {
  id: string;
  seq: number;
  agent: string;
  type: "info" | "started" | "progress" | "finding" | "failure_found" | "warning" | "error" | "completed";
  message: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface Execution {
  id: string;
  agent: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  attempts: number;
  summary: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface OptRun {
  id: string;
  method: string;
  method_key: MethodKey;
  version: string;
  budget: number;
  seed: number;
  evaluations: number;
  found: boolean;
  best_distance: number | null;
  best_b: number | null;
  first_failure_at: number | null;
  runtime_s: number;
  config: Record<string, unknown>;
  problem: { active: string[]; weights: number[]; lambda: number };
  convergence: [number, number][];
  notes: string[];
}

export interface Delta {
  from: number;
  to: number;
  delta: number;
  normalised: number;
  unit: string;
  label: string;
}

export interface Check {
  name: string;
  passed: boolean;
  detail: string;
  severity: "critical" | "warning";
}

export interface Counterexample {
  id: string;
  run_id: string;
  rank: number;
  method: string;
  distance: number;
  net_benefit: number;
  binding_criterion: string;
  parameters: Record<string, number>;
  deltas: Record<string, Delta>;
  metrics: Record<string, number>;
  normalised: number[];
  status: "unverified" | "verified" | "verified_with_warnings" | "rejected";
  producer: string;
  verification: null | {
    status: string;
    robustness: number;
    recomputed_b: number;
    checks: Check[];
    flags: string[];
    verifier: string;
    created_at: string;
  };
}

export interface SimResult {
  cooling_c: number;
  survival_rate: number;
  water_stress_index: number;
  irrigation_m3_ha: number;
  annual_cost_usd_ha: number;
  et0_mm: number;
  etc_mm: number;
  transpiration_ratio: number;
  effective_canopy: number;
  annual_mortality: number;
  margins: Record<string, number>;
  net_benefit: number;
  success: boolean;
  binding_criterion: string;
  plausibility_violation: number;
  parameters: Record<string, number>;
  criteria: { metric: string; op: string; threshold: number; label: string }[];
  climatology: { source: string; synthetic: boolean };
  series?: Record<string, number[]>;
}

export interface BoundaryMap {
  x: { name: string; label: string; unit: string; values: number[] };
  y: { name: string; label: string; unit: string; values: number[] };
  metric: string;
  z: number[][];
  net_benefit: number[][];
  binding: number[][];
  implausible: boolean[][];
  criteria: string[];
  failure_fraction: number;
  evaluations: number;
}

export interface MonteCarlo {
  method: string;
  n_requested: number;
  n_valid: number;
  rejected_by_constraints: number;
  failure_probability: number;
  failure_ci95: [number, number];
  per_criterion: { metric: string; label: string; failure_probability: number; ci95: [number, number] }[];
  metrics: Record<string, { mean: number; std: number; p05: number; p50: number; p95: number; histogram: { counts: number[]; edges: number[] } }>;
  convergence: [number, number][];
  uncertain_parameters: string[];
  note: string;
}

export interface Sobol {
  method: string;
  names: string[];
  labels: string[];
  n_evaluations: number;
  results: Record<string, { S1: number[]; ST: number[]; S1_conf: number[]; ST_conf: number[] }>;
  note: string;
}

export interface AlternativeRow {
  key: string;
  category: string;
  label: string;
  changes: Record<string, number>;
  nominal: {
    cooling_c: number;
    survival_rate: number;
    water_stress_index: number;
    irrigation_m3_ha: number;
    annual_cost_usd_ha: number;
    net_benefit: number;
    success: boolean;
    binding_criterion: string;
  };
  under_counterexamples: { net_benefit: number; success: boolean; cooling_c: number; survival_rate: number; water_stress_index: number }[];
  survives_counterexamples: number;
  failure_probability: number;
  failure_ci95: [number, number];
  cooling_p05: number;
  cooling_p50: number;
  water_p50: number;
}
