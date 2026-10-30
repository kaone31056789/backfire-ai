"use client";
/**
 * "The full workflow" — a professional motion-graphics film of one investigation going through
 * all eight stages, from the written promise to the signed certificate. Everything is drawn on a
 * fixed 1280×720 stage (scaled to fit) and driven by one clock, so it seeks, loops and records
 * deterministically. Every number comes from the demo investigation (/public/showcase, /public/film);
 * only the search paths on the failure map are illustrative (their end point is computed).
 */
import { Expand, Pause, Play, RotateCcw } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import type { Film } from "@/components/film-player";
import type { Landscape } from "@/components/three/failure-landscape";
import { api } from "@/lib/api";
import { cn } from "@/lib/format";

/* ------------------------------------------------------------------ data */
interface Agents {
  claims: { text: string; metric: string | null; op: string | null; threshold: number | null; measurable: boolean }[];
  climate: { source: string; annual_rain_mm: number; hottest_month: string; hottest_tmax_c: number };
  evidence: { sources: number; peer_reviewed: number; doi_verified: number; example: string | null };
  causal: { nodes: number; edges: number; acyclic: boolean };
  sensitivity: { parameter: string; index: number }[];
  optimisation: { evaluations: number; methods: number };
  verification: { checked: number; verified: number };
  alternatives: null | { design: string; failure_probability: number; proposal_failure_probability: number | null; tested: number };
  report: null | { version: number; sha256: string };
}
interface Featured {
  title: string; location: string; country: string;
  criteria: { metric: string; op: string; threshold: number; label: string }[];
  best: null | { distance: number; deltas: Record<string, { from: number; to: number; label: string; unit: string; normalised: number }> };
  failure_probability: number | null;
  agents?: Agents;
  landscape: Landscape | null;
}
export interface MotionFacts { f: Featured; film: Film | null }

/* ------------------------------------------------------------------ timeline */
const SCENES = [
  { key: "intro", len: 5 },
  { key: "claims", len: 8 },
  { key: "evidence", len: 8 },
  { key: "model", len: 14 },
  { key: "sensitivity", len: 7 },
  { key: "search", len: 9 },
  { key: "verify", len: 7 },
  { key: "alternatives", len: 7 },
  { key: "certificate", len: 7 },
  { key: "outro", len: 6 },
] as const;
const STARTS = SCENES.reduce<number[]>((a, s, i) => [...a, i === 0 ? 0 : a[i - 1] + SCENES[i - 1].len], []);
const TOTAL = STARTS[STARTS.length - 1] + SCENES[SCENES.length - 1].len;
const RAIL = ["Claims", "Evidence", "Model", "Sensitivity", "Search", "Verify", "Alternatives", "Certificate"];
const W = 1280, H = 720;
const sceneAt = (t: number) => { let i = 0; STARTS.forEach((s, k) => { if (t >= s) i = k; }); return i; };

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const fade = (p: number, a: number, len = 0.08) => ease(seg(p, a, a + len)); // fade-in starting at a
const out = (p: number, end = 0.94) => 1 - seg(p, end, 1); // fade-out at the end of a scene
const pct = (x: number | null | undefined, d = 0) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(d)} %`);
const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");

const C = { bg: "#07090d", panel: "#0d1219", line: "#1c2532", text: "#f4f6f8", mute: "rgba(244,246,248,.55)", dim: "rgba(244,246,248,.32)", accent: "#ff5b2e", green: "#3ee6a8", blue: "#5aa9ff", amber: "#f5b84a" };

/* ------------------------------------------------------------------ building blocks */
function Label({ step, title, sub, p }: { step: string; title: string; sub: string; p: number }) {
  const a = fade(p, 0) * out(p);
  return (
    <div style={{ position: "absolute", left: 80, top: 92, opacity: a, transform: `translateY(${(1 - fade(p, 0)) * 12}px)` }}>
      <div style={{ fontSize: 12.5, letterSpacing: ".22em", textTransform: "uppercase", color: C.accent, fontWeight: 600 }}>{step}</div>
      <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-.025em", color: C.text, marginTop: 6 }}>{title}</div>
      <div style={{ fontSize: 16, color: C.mute, marginTop: 6, maxWidth: 760 }}>{sub}</div>
    </div>
  );
}

function Panel({ x, y, w, h, p, delay = 0, children, style }: { x: number; y: number; w: number; h: number; p: number; delay?: number; children: React.ReactNode; style?: React.CSSProperties }) {
  const a = fade(p, delay, 0.1) * out(p);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, opacity: a, transform: `translateY(${(1 - fade(p, delay, 0.1)) * 18}px)`, overflow: "hidden", ...style }}>
      {children}
    </div>
  );
}

function Stat({ label, value, color = C.text }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: C.mute, letterSpacing: ".04em" }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-.03em", color, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

const Mono = ({ children, color = C.mute, size = 12.5 }: { children: React.ReactNode; color?: string; size?: number }) => (
  <span style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace", fontSize: size, color }}>{children}</span>
);

/* ------------------------------------------------------------------ scenes */
function Intro({ p, f }: { p: number; f: Featured }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", opacity: out(p, 0.9) }}>
      <div>
        <div style={{ fontSize: 13, letterSpacing: ".32em", textTransform: "uppercase", color: C.mute, opacity: fade(p, 0.02) }}>BACKFIRE AI · the workflow</div>
        <div style={{ fontSize: 60, fontWeight: 600, letterSpacing: "-.035em", color: C.text, marginTop: 18, opacity: fade(p, 0.1, 0.15), transform: `translateY(${(1 - fade(p, 0.1, 0.15)) * 20}px)` }}>
          From a promise to a <span style={{ color: C.accent }}>verified</span> verdict
        </div>
        <div style={{ fontSize: 19, color: C.mute, marginTop: 14, opacity: fade(p, 0.3, 0.15) }}>Eight stages. One real investigation. Every number computed.</div>
        <div style={{ display: "inline-flex", gap: 10, alignItems: "center", marginTop: 34, padding: "10px 18px", border: `1px solid ${C.line}`, borderRadius: 999, background: C.panel, opacity: fade(p, 0.5, 0.15) }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: C.accent }} />
          <span style={{ fontSize: 15, color: C.text }}>Case study: {f.title}</span>
        </div>
      </div>
    </div>
  );
}

function Claims({ p, f }: { p: number; f: Featured }) {
  const claims = f.agents?.claims ?? [];
  const sentence = claims[0]?.text ?? "The programme will reduce summer daytime air temperatures by 0.5 °C within 10 years, with at least 50% of planted trees surviving.";
  const sweep = seg(p, 0.15, 0.45);
  const extracted = claims.filter((c) => c.measurable).slice(0, 3);
  const other = claims.find((c) => !c.measurable);
  const unit = (m: string | null, v: number | null) => (v === null ? "" : m === "survival_rate" ? `${Math.round(v * 100)} %` : m === "cooling_c" ? `${v} °C` : String(v));
  return (
    <>
      <Label p={p} step="Stage 1 · Claim extraction" title="Read the promise, write it as numbers" sub="A language model fills a strict schema. Any quote it cannot find word-for-word in the proposal is discarded." />
      <Panel x={80} y={230} w={520} h={330} p={p} delay={0.05}>
        <div style={{ padding: 26 }}>
          <div style={{ fontSize: 12, color: C.mute, letterSpacing: ".08em", textTransform: "uppercase" }}>Proposal · {f.location}</div>
          {[0.9, 0.75, 0.82].map((w, i) => <div key={i} style={{ height: 9, width: `${w * 100}%`, background: C.line, borderRadius: 6, marginTop: i ? 12 : 22 }} />)}
          <div style={{ position: "relative", marginTop: 20, fontSize: 17, lineHeight: 1.6, color: C.text }}>
            <span style={{ backgroundImage: `linear-gradient(90deg, rgba(255,91,46,.28) ${sweep * 100}%, transparent ${sweep * 100}%)` }}>“{sentence}”</span>
          </div>
          {[0.7, 0.86].map((w, i) => <div key={i} style={{ height: 9, width: `${w * 100}%`, background: C.line, borderRadius: 6, marginTop: 16 }} />)}
        </div>
      </Panel>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <path d="M 610 395 C 650 395, 650 395, 690 395" stroke={C.accent} strokeWidth={2} fill="none" strokeDasharray="4 6" opacity={fade(p, 0.42) * out(p)} />
      </svg>
      <div style={{ position: "absolute", left: 700, top: 230, width: 500 }}>
        {extracted.map((c, i) => {
          const a = fade(p, 0.45 + i * 0.08, 0.08) * out(p);
          return (
            <div key={i} style={{ opacity: a, transform: `translateX(${(1 - a) * 24}px)`, marginBottom: 14, padding: "16px 20px", border: "1px solid rgba(62,230,168,.35)", background: "rgba(62,230,168,.06)", borderRadius: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Mono color={C.mute} size={13}>{`{ metric: "${c.metric}", op: "${c.op}" }`}</Mono>
              <span style={{ fontSize: 22, fontWeight: 600, color: C.green }}>{c.op} {unit(c.metric, c.threshold)}</span>
            </div>
          );
        })}
        {other && (
          <div style={{ opacity: fade(p, 0.7) * out(p), padding: "14px 20px", border: `1px dashed ${C.line}`, borderRadius: 14, color: C.mute, fontSize: 14.5 }}>
            “{other.text.slice(0, 70)}…” <span style={{ color: C.dim }}>→ not measurable, kept as context</span>
          </div>
        )}
        <div style={{ marginTop: 16, opacity: fade(p, 0.8) * out(p), display: "flex", gap: 8, alignItems: "center", color: C.green, fontSize: 14 }}>✓ schema-valid · quotes traced to the source</div>
      </div>
    </>
  );
}

function Evidence({ p, f, film }: { p: number; f: Featured; film: Film | null }) {
  const m = film?.scenes[0]?.monthly;
  const rain = m?.rain_mm ?? Array(12).fill(0);
  const tmax = m?.tmax_c ?? Array(12).fill(0);
  const cl = f.agents?.climate, ev = f.agents?.evidence;
  const maxR = Math.max(1, ...rain), lo = Math.min(...tmax) - 4, hi = Math.max(...tmax) + 2;
  const cw = 560, ch = 230, bx = 40;
  const grow = seg(p, 0.12, 0.5);
  const linePts = tmax.map((t, i) => `${bx + i * ((cw - 60) / 11) + 12},${ch - ((t - lo) / (hi - lo)) * ch}`).join(" ");
  const k = ease(seg(p, 0.45, 0.75));
  return (
    <>
      <Label p={p} step="Stage 2 · Evidence" title="Fetch the real climate and the science" sub="NASA POWER gives 30-year monthly weather for the exact coordinates; OpenAlex finds studies, Crossref confirms every DOI exists." />
      <Panel x={80} y={230} w={660} h={330} p={p} delay={0.04}>
        <div style={{ padding: "20px 24px 0", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 14, color: C.text }}>{f.location} · monthly climate</span>
          <span style={{ fontSize: 12.5 }}><span style={{ color: C.blue }}>■ rain</span>&nbsp;&nbsp;<span style={{ color: C.amber }}>— max temperature</span></span>
        </div>
        <svg width={620} height={280} style={{ position: "absolute", left: 20, top: 52 }}>
          {rain.map((r, i) => {
            const g = ease(clamp(grow * 12 - i * 0.7));
            const h = (r / maxR) * ch * g;
            return <rect key={i} x={bx + i * ((cw - 60) / 11)} y={ch - h} width={24} height={h} rx={4} fill={C.blue} opacity={0.85} />;
          })}
          <polyline points={linePts} fill="none" stroke={C.amber} strokeWidth={2.5} pathLength={1} strokeDasharray="1" strokeDashoffset={1 - seg(p, 0.3, 0.6)} />
          {["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"].map((mm, i) => <text key={i} x={bx + i * ((cw - 60) / 11) + 12} y={ch + 22} fill={C.dim} fontSize={12} textAnchor="middle">{mm}</text>)}
        </svg>
      </Panel>
      <div style={{ position: "absolute", left: 780, top: 230, width: 420, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, opacity: fade(p, 0.4) * out(p) }}>
        <Stat label="Rain per year" value={cl ? `${n0(cl.annual_rain_mm * k)} mm` : "—"} color={C.blue} />
        <Stat label={`Hottest month (${cl?.hottest_month ?? "—"})`} value={cl ? `${(cl.hottest_tmax_c * k).toFixed(1)} °C` : "—"} color={C.amber} />
        <Stat label="Sources retrieved" value={ev ? n0(ev.sources * k) : "—"} />
        <Stat label="DOIs verified" value={ev ? n0(ev.doi_verified * k) : "—"} color={C.green} />
      </div>
      {ev?.example && (
        <div style={{ position: "absolute", left: 780, top: 470, width: 420, opacity: fade(p, 0.65) * out(p), padding: "14px 16px", border: `1px solid ${C.line}`, borderRadius: 14, background: C.panel }}>
          <div style={{ fontSize: 11.5, color: C.dim, letterSpacing: ".08em", textTransform: "uppercase" }}>Example peer-reviewed source</div>
          <div style={{ fontSize: 14, color: C.text, marginTop: 4, lineHeight: 1.4 }}>{ev.example}</div>
        </div>
      )}
    </>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lerpHex = (a: string, b: string, k: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * clamp(k))).join(",")})`;
};

/** Two simulated years of the daily water balance, driven by the model's monthly output. */
function WaterBalance({ p, plan }: { p: number; plan: Film["scenes"][number] | undefined }) {
  const m = plan?.monthly;
  const q = seg(p, 0.06, 0.62) * 24; // 24 months play in the first part of the scene
  const mi = Math.min(23, Math.floor(q)), month = mi % 12, frac = q - Math.floor(q);
  const nxt = (mi + 1) % 12;
  const val = (arr: number[] | undefined, d = 0) => (arr ? arr[month] + (arr[nxt] - arr[month]) * frac : d);
  const stress = clamp(val(m?.stress, 0.3)), rain = val(m?.rain_mm, 30), irr = val(m?.irrigation_mm, 10), tmax = val(m?.tmax_c, 32);
  const heat = clamp((tmax - 20) / 24);
  const t = p * 14; // seconds into the scene, for looping motion
  const W2 = 560, sky = 150, soilTop = 168, soilH = 150;
  const level = soilTop + soilH * (0.08 + stress * 0.84); // y of the water surface
  const wave = Array.from({ length: 29 }, (_, i) => `${i * 20},${level + Math.sin(t * 3 + i * 0.7) * 2.5}`).join(" ");
  const drops = Math.round(clamp(rain / 160) * 26), sprays = irr > 4 ? 10 : 0, wisps = Math.round(heat * 9);
  const leaf = lerpHex("#3fae5a", "#b8862f", stress * 1.3);
  return (
    <svg width={W2} height={335} style={{ position: "absolute", left: 0, top: 0 }}>
      <defs>
        <linearGradient id="wb-sky" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={lerpHex("#16324f", "#5a2e1a", heat)} /><stop offset="1" stopColor="#0d1219" /></linearGradient>
        <linearGradient id="wb-water" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#5aa9ff" /><stop offset="1" stopColor="#1d4f99" /></linearGradient>
        <pattern id="wb-soil" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="#3a2a1c" /><circle cx="4" cy="5" r="1.4" fill="#4a3624" /><circle cx="11" cy="11" r="1.1" fill="#2e2116" /></pattern>
      </defs>
      <rect width={W2} height={sky + 18} fill="url(#wb-sky)" />
      {/* sun: bigger and redder in hot months */}
      <circle cx={470} cy={52} r={18 + heat * 14} fill={lerpHex("#ffe7a3", "#ff8a3d", heat)} opacity={0.95} />
      <circle cx={470} cy={52} r={34 + heat * 22} fill={lerpHex("#ffe7a3", "#ff8a3d", heat)} opacity={0.12} />
      {/* rain, in proportion to the month's rainfall */}
      {Array.from({ length: drops }, (_, i) => {
        const x = 30 + ((i * 53) % 330), y = (t * 160 + i * 37) % 150;
        return <line key={`r${i}`} x1={x} y1={y} x2={x - 3} y2={y + 10} stroke="#9fd0ff" strokeWidth={1.6} opacity={0.8} />;
      })}
      {/* evaporation pulled out by heat (ET0) */}
      {Array.from({ length: wisps }, (_, i) => {
        const x = 330 + (i % 5) * 34, y = 150 - ((t * 26 + i * 23) % 120);
        return <path key={`e${i}`} d={`M ${x} ${y} q 6 -8 0 -16 q -6 -8 0 -16`} stroke="#ffb27a" strokeWidth={1.6} fill="none" opacity={0.25 + 0.5 * (y / 150)} />;
      })}
      {/* ground and trees; crowns brown and shrink with stress, roots reach the water */}
      <rect x={0} y={sky} width={W2} height={18} fill="#2c3b25" />
      {[90, 200, 300].map((x, i) => {
        const h = 54 - stress * 12;
        return (
          <g key={x}>
            <path d={`M ${x} ${sky + 16} q ${-10 - i * 2} 30 -4 ${level - sky - 20}`} stroke="#8a6a48" strokeWidth={2} fill="none" opacity={0.7} />
            <path d={`M ${x} ${sky + 16} q 12 34 6 ${level - sky - 24}`} stroke="#8a6a48" strokeWidth={2} fill="none" opacity={0.7} />
            <rect x={x - 4} y={sky - 34} width={8} height={36} rx={2} fill="#6b4a2f" />
            <circle cx={x} cy={sky - 34 - h * 0.35} r={h * 0.55} fill={leaf} />
            <circle cx={x + 14} cy={sky - 28 - h * 0.25} r={h * 0.38} fill={leaf} opacity={0.9} />
          </g>
        );
      })}
      {/* sprinkler arcs when irrigation is delivered */}
      {Array.from({ length: sprays }, (_, i) => {
        const k = (t * 1.2 + i / sprays) % 1;
        return <circle key={`s${i}`} cx={150 + Math.cos(i) * 60 * k} cy={sky - Math.sin(k * Math.PI) * 30} r={2} fill="#7cc8ff" opacity={1 - k} />;
      })}
      {/* soil reservoir with a moving water table */}
      <rect x={0} y={soilTop} width={W2} height={soilH} fill="url(#wb-soil)" />
      <polygon points={`0,${soilTop + soilH} ${wave} ${W2},${soilTop + soilH}`} fill="url(#wb-water)" opacity={0.78} />
      <text x={W2 - 14} y={soilTop + 22} textAnchor="end" fill={C.mute} fontSize={12}>root-zone soil water</text>
      <text x={W2 - 14} y={Math.min(soilTop + soilH - 10, level + 20)} textAnchor="end" fill="#cfe6ff" fontSize={12.5} fontWeight={600}>{Math.round((1 - stress) * 100)} % available</text>
      {/* month ticker */}
      <rect x={14} y={14} width={160} height={52} rx={10} fill="rgba(0,0,0,.45)" />
      <text x={26} y={36} fill={C.text} fontSize={14} fontWeight={600}>Year {Math.floor(mi / 12) + 1} · {MONTHS[month]}</text>
      <text x={26} y={56} fill={C.mute} fontSize={12}>{Math.round(rain)} mm rain · {tmax.toFixed(0)} °C</text>
    </svg>
  );
}

function Model({ p, f, film }: { p: number; f: Featured; film: Film | null }) {
  const plan = film?.scenes[0];
  const surv = plan?.survival_by_year ?? [];
  const target = f.criteria.find((c) => c.metric === "survival_rate")?.threshold ?? 0.5;
  const q = seg(p, 0.06, 0.62) * 24, month = Math.min(23, Math.floor(q)) % 12;
  const stressNow = clamp(plan?.monthly.stress[month] ?? 0);
  const steps = [
    ["ET₀", "FAO-56 Penman-Monteith (heat, humidity, wind, sun)"],
    ["Demand", "Ks · Kd · Kmc · ET₀ (WUCOLS)"],
    ["Soil", "soil += rain + irrigation − demand, every day"],
    ["Stress", "1 − Ks(soil) when the root zone runs low"],
    ["Survival", "(1 − m)¹⁰, mortality rises with stress"],
  ];
  const gx = 700, gy = 410, gw = 480, gh = 110;
  const pts = surv.map((s, i) => `${gx + (i / Math.max(1, surv.length - 1)) * gw},${gy + gh - ((s - 0.3) / 0.7) * gh}`).join(" ");
  const ty = gy + gh - ((target - 0.3) / 0.7) * gh;
  const second = fade(p, 0.62, 0.08);
  return (
    <>
      <Label p={p} step="Stage 3 · The model" title="Simulate ten years, one day at a time" sub="Rain and irrigation fill the soil, heat pulls water out, thirsty trees die faster, and only the surviving shade cools the street." />
      <Panel x={80} y={230} w={560} h={335} p={p} delay={0.03}>
        <WaterBalance p={p} plan={plan} />
      </Panel>
      <div style={{ position: "absolute", left: 700, top: 230, width: 500, opacity: (1 - second) * out(p) }}>
        {steps.map(([k, v], i) => {
          const a = fade(p, 0.08 + i * 0.07);
          const live = Math.floor(seg(p, 0.08, 0.6) * 5) === i;
          return (
            <div key={k} style={{ display: "flex", gap: 14, alignItems: "baseline", padding: "9px 14px", marginBottom: 6, borderRadius: 12, background: live ? "rgba(255,91,46,.10)" : "transparent", border: `1px solid ${live ? "rgba(255,91,46,.45)" : C.line}`, opacity: a, transform: `translateX(${(1 - a) * 20}px)` }}>
              <span style={{ width: 72, fontSize: 14, fontWeight: 600, color: live ? C.accent : C.text }}>{k}</span>
              <Mono color={C.mute} size={12.5}>{v}</Mono>
            </div>
          );
        })}
        <div style={{ marginTop: 14, fontSize: 14, color: C.mute }}>Water stress this month: <span style={{ color: stressNow > 0.5 ? C.accent : C.green, fontWeight: 600 }}>{Math.round(stressNow * 100)} %</span></div>
      </div>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, opacity: second * out(p), pointerEvents: "none" }}>
        <text x={gx} y={gy - 18} fill={C.mute} fontSize={13}>Trees alive as planned, year 0 → 10 (3,650 simulated days)</text>
        <line x1={gx} y1={ty} x2={gx + gw} y2={ty} stroke={C.accent} strokeDasharray="5 6" opacity={0.8} />
        <text x={gx + gw} y={ty - 6} fill={C.accent} fontSize={12} textAnchor="end">target {Math.round(target * 100)} %</text>
        <polyline points={pts} fill="none" stroke={C.green} strokeWidth={3} pathLength={1} strokeDasharray="1" strokeDashoffset={1 - seg(p, 0.66, 0.9)} />
      </svg>
      <div style={{ position: "absolute", left: 700, top: 270, display: "flex", gap: 40, opacity: second * out(p) }}>
        <Stat label="Trees alive after 10 years" value={pct(plan?.metrics.survival_rate, 1)} color={C.green} />
        <Stat label="Street cooling" value={plan ? `${plan.metrics.cooling_c.toFixed(2)} °C` : "—"} />
      </div>
    </>
  );
}

function Sensitivity({ p, f }: { p: number; f: Featured }) {
  const rows = f.agents?.sensitivity ?? [];
  const max = Math.max(0.01, ...rows.map((r) => r.index));
  const dots = useMemo(() => {
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    return Array.from({ length: 260 }, () => [700 + r() * 500, 240 + r() * 300]);
  }, []);
  return (
    <>
      <Label p={p} step="Stage 4 · Sensitivity" title="Find what matters most" sub="Thousands of plausible futures are sampled; Sobol indices measure how much of the result's spread each uncertain input explains." />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        {dots.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2} fill={C.text} opacity={(i / dots.length < seg(p, 0.05, 0.5) ? 0.35 : 0) * out(p)} />)}
      </svg>
      <div style={{ position: "absolute", left: 80, top: 250, width: 560 }}>
        {rows.map((r, i) => (
          <div key={r.parameter} style={{ marginBottom: 28, opacity: fade(p, 0.25 + i * 0.1) * out(p) }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, color: C.text }}><span>{r.parameter}</span><Mono color={C.text} size={15}>{r.index.toFixed(2)}</Mono></div>
            <div style={{ height: 12, background: C.line, borderRadius: 8, marginTop: 8 }}>
              <div style={{ height: "100%", width: `${(r.index / max) * 100 * ease(seg(p, 0.3 + i * 0.1, 0.6 + i * 0.1))}%`, background: [C.accent, C.amber, C.blue][i], borderRadius: 8 }} />
            </div>
          </div>
        ))}
        <div style={{ fontSize: 13, color: C.dim, opacity: fade(p, 0.7) * out(p) }}>Sobol total-order index (SALib) · share of variance in the net benefit</div>
      </div>
      <div style={{ position: "absolute", left: 760, top: 545, fontSize: 13, color: C.dim, opacity: fade(p, 0.3) * out(p) }}>each dot = one simulated 10-year future</div>
    </>
  );
}

const Heatmap = memo(function Heatmap({ L, w, h }: { L: Landscape; w: number; h: number }) {
  const ny = L.z.length, nx = L.z[0].length, cw = w / nx, chh = h / ny;
  return (
    <g>
      {L.z.map((row, j) => row.map((b, i) => (
        <rect key={`${i}-${j}`} x={i * cw} y={h - (j + 1) * chh} width={cw + 0.5} height={chh + 0.5}
          fill={b >= 0 ? `rgba(62,230,168,${0.18 + Math.min(1, b * 2) * 0.55})` : `rgba(255,91,46,${0.3 + Math.min(1, -b * 3) * 0.55})`} />
      )))}
    </g>
  );
});

function Search({ p, f }: { p: number; f: Featured }) {
  const L = f.landscape;
  const mx = 80, my = 230, mw = 560, mh = 330;
  const at = (pt?: [number, number] | null): [number, number] => {
    if (!L || !pt) return [mw * 0.3, mh * 0.6];
    const xs = L.x.values, ys = L.y.values;
    return [((pt[0] - xs[0]) / (xs[xs.length - 1] - xs[0])) * mw, mh - ((pt[1] - ys[0]) / (ys[ys.length - 1] - ys[0])) * mh];
  };
  const s = at(L?.nominal), g = at(L?.point);
  const colors = [C.accent, C.amber, "#a78bfa", "#9aa3b2"];
  const paths = colors.map((_, k) => {
    const end: [number, number] = k === 0 ? g : [g[0] + Math.cos(1 + k * 2) * (22 + k * 16), g[1] + Math.sin(1 + k * 2) * (22 + k * 16)];
    const m1 = [s[0] + (end[0] - s[0]) * 0.35 + Math.sin(k * 2.3) * 40, s[1] + (end[1] - s[1]) * 0.35 + Math.cos(k * 1.7) * 40];
    const m2 = [s[0] + (end[0] - s[0]) * 0.7 - Math.sin(k * 1.3) * 26, s[1] + (end[1] - s[1]) * 0.7 + Math.cos(k * 2.1) * 26];
    return `M ${s[0]} ${s[1]} C ${m1[0]} ${m1[1]}, ${m2[0]} ${m2[1]}, ${end[0]} ${end[1]}`;
  });
  const opt = f.agents?.optimisation;
  const deltas = f.best ? Object.values(f.best.deltas).sort((a, b) => Math.abs(b.normalised) - Math.abs(a.normalised)).slice(0, 2) : [];
  const k = ease(seg(p, 0.15, 0.7));
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toPrecision(2));
  return (
    <>
      <Label p={p} step="Stage 5 · Adversarial search" title="Hunt for the smallest change that breaks it" sub="Green holds the promise, red breaks it. Four methods get the same budget and seed; MPFS (ours) finds the closest edge." />
      <Panel x={mx - 1} y={my - 1} w={mw + 2} h={mh + 2} p={p} delay={0.03} style={{ background: "#0a0e14" }}>
        <svg width={mw} height={mh}>
          {L && <Heatmap L={L} w={mw} h={mh} />}
          {paths.map((d, i) => <path key={i} d={d} fill="none" stroke={colors[i]} strokeWidth={i === 0 ? 3 : 2} pathLength={1} strokeDasharray="1" strokeDashoffset={1 - ease(seg(p, 0.2, 0.7))} opacity={0.95} />)}
          <circle cx={s[0]} cy={s[1]} r={7} fill="#fff" />
          <text x={s[0] + 12} y={s[1] + 4} fill="#fff" fontSize={13} fontWeight={600}>the plan</text>
          <g opacity={fade(p, 0.68)}>
            <circle cx={g[0]} cy={g[1]} r={10 + Math.sin(p * 40) * 2} fill="none" stroke="#ffd23f" strokeWidth={2} />
            <circle cx={g[0]} cy={g[1]} r={5} fill="#ffd23f" />
            <line x1={s[0]} y1={s[1]} x2={g[0]} y2={g[1]} stroke="#ffd23f" strokeDasharray="5 5" strokeWidth={1.5} />
          </g>
        </svg>
      </Panel>
      {L && <div style={{ position: "absolute", left: mx, top: my + mh + 10, fontSize: 12, color: C.dim, opacity: fade(p, 0.1) * out(p) }}>x: {L.x.label} · y: {L.y.label} · paths illustrative, breaking point computed</div>}
      <div style={{ position: "absolute", left: 700, top: 230, width: 500, opacity: fade(p, 0.15) * out(p) }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
          <Stat label="Full 10-year simulations" value={opt ? n0(opt.evaluations * k) : "—"} />
          <Stat label="Smallest breaking change" value={f.best ? `d* = ${(f.best.distance * k).toFixed(2)}` : "—"} color="#ffd23f" />
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 22, fontSize: 13.5, color: C.mute }}>
          {["MPFS", "NSGA-II", "Evolution", "Random"].map((m, i) => <span key={m} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 3, background: colors[i], borderRadius: 2 }} />{m}</span>)}
        </div>
        <div style={{ marginTop: 26, opacity: fade(p, 0.7) }}>
          <div style={{ fontSize: 12, color: C.mute, letterSpacing: ".06em", textTransform: "uppercase" }}>What changes at the breaking point</div>
          {deltas.map((d) => (
            <div key={d.label} style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 16, color: C.text }}>
              <span>{d.label}</span><Mono color={C.text} size={15}>{fmt(d.from)} → <span style={{ color: C.accent }}>{fmt(d.to)}</span></Mono>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Verify({ p, f }: { p: number; f: Featured }) {
  const v = f.agents?.verification ?? { checked: 0, verified: 0 };
  const n = Math.min(8, v.checked);
  return (
    <>
      <Label p={p} step="Stage 6 · Independent verification" title="Re-compute every breaking point from scratch" sub="A separate agent rebuilds the model from the stored configuration (hash must match) and repeats each result. If it doesn't repeat, it is rejected." />
      <Panel x={80} y={230} w={640} h={330} p={p} delay={0.03}>
        <div style={{ padding: "18px 24px" }}>
          {Array.from({ length: n }, (_, i) => {
            const a = fade(p, 0.12 + i * 0.07, 0.05);
            const ok = i < v.verified;
            return (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${C.line}`, opacity: 0.25 + a * 0.75 }}>
                <Mono color={C.text} size={13.5}>counterexample #{i + 1}</Mono>
                <Mono size={12.5}>config hash ✓ · fresh model run</Mono>
                <span style={{ fontSize: 15, fontWeight: 600, color: a > 0.5 ? (ok ? C.green : C.accent) : C.dim }}>{a > 0.5 ? (ok ? "✓ verified" : "✗ rejected") : "…"}</span>
              </div>
            );
          })}
        </div>
      </Panel>
      <div style={{ position: "absolute", left: 780, top: 300, opacity: fade(p, 0.72) * out(p) }}>
        <div style={{ fontSize: 96, fontWeight: 600, letterSpacing: "-.04em", color: C.green, lineHeight: 1 }}>{v.verified}/{v.checked}</div>
        <div style={{ fontSize: 18, color: C.mute, marginTop: 10 }}>breaking points independently confirmed</div>
      </div>
    </>
  );
}

function Alternatives({ p, f }: { p: number; f: Featured }) {
  const a = f.agents?.alternatives;
  const rows = [
    { label: "As proposed", value: a?.proposal_failure_probability ?? null, color: C.accent },
    { label: a?.design ?? "Best alternative design", value: a?.failure_probability ?? null, color: C.green },
  ];
  return (
    <>
      <Label p={p} step="Stage 7 · Alternatives" title="Keep the harsh future, change the design" sub={`Only design choices change: tree species, density, irrigation. ${a ? `All ${a.tested} designs are` : "Every design is"} re-tested with Monte Carlo in the same conditions.`} />
      <div style={{ position: "absolute", left: 80, top: 250, width: 760 }}>
        <div style={{ fontSize: 13, color: C.mute, letterSpacing: ".06em", textTransform: "uppercase", opacity: fade(p, 0.05) * out(p) }}>Chance the promise fails in the harsh future</div>
        {rows.map((r, i) => {
          const g = ease(seg(p, 0.2 + i * 0.15, 0.6 + i * 0.15));
          return (
            <div key={r.label} style={{ marginTop: 28, opacity: fade(p, 0.15 + i * 0.15) * out(p) }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, color: C.text }}><span>{r.label}</span><span style={{ fontWeight: 600, color: r.color }}>{pct(r.value === null ? null : r.value * g)}</span></div>
              <div style={{ height: 18, background: C.line, borderRadius: 10, marginTop: 10 }}>
                <div style={{ height: "100%", width: `${Math.max(r.value ?? 0, 0.006) * 100 * g}%`, background: r.color, borderRadius: 10 }} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 900, top: 270, width: 300, opacity: fade(p, 0.65) * out(p) }}>
        <Stat label="As proposed, across all plausible futures" value={pct(f.failure_probability)} color={C.accent} />
        <div style={{ fontSize: 14, color: C.mute, marginTop: 14, lineHeight: 1.5 }}>Monte Carlo over the plausible range of every uncertain input.</div>
      </div>
    </>
  );
}

function Certificate({ p, f }: { p: number; f: Featured }) {
  const rep = f.agents?.report;
  const hash = rep ? `${rep.sha256}…` : "—";
  const typed = hash.slice(0, Math.floor(hash.length * seg(p, 0.35, 0.65)));
  const stamp = ease(seg(p, 0.7, 0.8));
  const fields: [string, string][] = [
    ["Intervention", f.title],
    ["Smallest breaking change", f.best ? `d* = ${f.best.distance.toFixed(2)}` : "—"],
    ["Fails across plausible futures", pct(f.failure_probability)],
    ["Verified breaking points", f.agents ? `${f.agents.verification.verified} of ${f.agents.verification.checked}` : "—"],
    ["Seeds, model & data versions", "recorded"],
  ];
  return (
    <>
      <Label p={p} step="Stage 8 · Certificate" title="Sign a result anyone can re-check" sub="PDF + JSON with seeds, versions and limitations, fingerprinted with SHA-256: change one character and the fingerprint changes." />
      <Panel x={300} y={225} w={680} h={340} p={p} delay={0.04} style={{ background: "#f4f1ea", border: "none" }}>
        <div style={{ padding: "26px 34px", color: "#14171c" }}>
          <div style={{ fontSize: 12, letterSpacing: ".24em", textTransform: "uppercase", color: "#8a5a3a" }}>BACKFIRE · falsification certificate{rep ? ` · v${rep.version}` : ""}</div>
          {fields.map(([k, v], i) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid rgba(20,23,28,.12)", fontSize: 15.5, opacity: 0.2 + fade(p, 0.1 + i * 0.05) * 0.8 }}>
              <span style={{ color: "rgba(20,23,28,.6)" }}>{k}</span><span style={{ fontWeight: 600 }}>{v}</span>
            </div>
          ))}
          <div style={{ marginTop: 16, fontSize: 12, color: "rgba(20,23,28,.55)" }}>SHA-256</div>
          <Mono color="#14171c" size={16}>{typed}</Mono>
        </div>
        <div style={{ position: "absolute", right: 30, bottom: 26, transform: `rotate(-8deg) scale(${2 - stamp})`, opacity: stamp, border: `3px solid ${C.green}`, color: "#0d8a62", borderRadius: 12, padding: "6px 14px", fontWeight: 800, letterSpacing: ".1em", fontSize: 20 }}>VERIFIED</div>
      </Panel>
    </>
  );
}

function Outro({ p }: { p: number }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
      <div style={{ opacity: fade(p, 0.05, 0.15), transform: `translateY(${(1 - fade(p, 0.05, 0.15)) * 16}px)` }}>
        <div style={{ fontSize: 54, fontWeight: 600, letterSpacing: "-.035em", color: C.text }}>Every number computed.<br /><span style={{ color: C.green }}>Every result re-checked.</span></div>
        <div style={{ fontSize: 18, color: C.mute, marginTop: 18, opacity: fade(p, 0.3) }}>BACKFIRE AI: find the breaking point before the climate does.</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ stage chrome */
function Rail({ t }: { t: number }) {
  const step = (k: number) => clamp((t - STARTS[k + 1]) / SCENES[k + 1].len);
  return (
    <div style={{ position: "absolute", left: 80, right: 80, bottom: 46 }}>
      <div style={{ position: "relative", height: 2, background: C.line, top: 9 }}>
        <div style={{ height: "100%", width: `${clamp((t - STARTS[1]) / (STARTS[9] - STARTS[1])) * 100}%`, background: C.accent }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", position: "relative" }}>
        {RAIL.map((r, k) => {
          const s = step(k), on = s > 0 && s < 1, done = s >= 1;
          return (
            <div key={r} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 100 }}>
              <span style={{ width: 18, height: 18, borderRadius: 99, border: `2px solid ${on || done ? C.accent : C.line}`, background: done ? C.accent : on ? "#2a130b" : C.bg, boxShadow: on ? "0 0 0 6px rgba(255,91,46,.15)" : "none" }} />
              <span style={{ marginTop: 9, fontSize: 12.5, color: on ? C.text : done ? C.mute : C.dim, fontWeight: on ? 600 : 400 }}>{k + 1}. {r}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stage({ facts, t }: { facts: MotionFacts; t: number }) {
  const i = sceneAt(t);
  const p = clamp((t - STARTS[i]) / SCENES[i].len);
  const { f, film } = facts;
  const key = SCENES[i].key;
  return (
    <div style={{ position: "relative", width: W, height: H, background: `radial-gradient(1200px 600px at 70% -10%, #121a26 0%, ${C.bg} 60%)`, overflow: "hidden", fontFamily: "var(--font-geist), system-ui, sans-serif" }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, opacity: 0.35 }}>
        {Array.from({ length: 33 }, (_, k) => <line key={`v${k}`} x1={k * 40} y1={0} x2={k * 40} y2={H} stroke="#0f151e" />)}
        {Array.from({ length: 19 }, (_, k) => <line key={`h${k}`} x1={0} y1={k * 40} x2={W} y2={k * 40} stroke="#0f151e" />)}
      </svg>
      <div style={{ position: "absolute", left: 80, top: 34, display: "flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 600, color: C.text }}>
        <svg width={22} height={22} viewBox="0 0 64 64"><path d="M12 46 L26 30 L34 38 L52 16" fill="none" stroke={C.accent} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" /><circle cx={52} cy={16} r={6} fill={C.green} /></svg>
        BACKFIRE <span style={{ color: C.accent }}>AI</span>
        <span style={{ color: C.dim, fontWeight: 400, marginLeft: 8 }}>The workflow</span>
      </div>
      <div style={{ position: "absolute", right: 80, top: 36, fontSize: 13, color: C.mute }}>{f.location}{f.country ? `, ${f.country}` : ""} · <Mono size={13}>{String(Math.floor(t / 60)).padStart(2, "0")}:{String(Math.floor(t % 60)).padStart(2, "0")}</Mono></div>
      {/* drifting glow: slow colour light that travels across the whole film */}
      <div style={{ position: "absolute", width: 900, height: 900, borderRadius: "50%", left: 200 + Math.sin(t * 0.13) * 380, top: -300 + Math.cos(t * 0.09) * 160, background: "radial-gradient(circle, rgba(255,91,46,.10), transparent 60%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", width: 800, height: 800, borderRadius: "50%", left: 500 + Math.cos(t * 0.11) * 420, top: 120 + Math.sin(t * 0.07) * 140, background: "radial-gradient(circle, rgba(62,230,168,.07), transparent 60%)", pointerEvents: "none" }} />
      {/* slow camera push on every scene */}
      <div style={{ position: "absolute", inset: 0, transform: `scale(${1 + ease(p) * 0.028}) translateY(${-ease(p) * 6}px)`, transformOrigin: "50% 45%" }}>
      {key === "intro" && <Intro p={p} f={f} />}
      {key === "claims" && <Claims p={p} f={f} />}
      {key === "evidence" && <Evidence p={p} f={f} film={film} />}
      {key === "model" && <Model p={p} f={f} film={film} />}
      {key === "sensitivity" && <Sensitivity p={p} f={f} />}
      {key === "search" && <Search p={p} f={f} />}
      {key === "verify" && <Verify p={p} f={f} />}
      {key === "alternatives" && <Alternatives p={p} f={f} />}
      {key === "certificate" && <Certificate p={p} f={f} />}
      {key === "outro" && <Outro p={p} />}
      </div>
      {/* light sweep at each scene change */}
      {i > 0 && p < 0.07 && <div style={{ position: "absolute", top: 0, bottom: 0, width: 260, left: -260 + (p / 0.07) * (W + 520), background: "linear-gradient(90deg, transparent, rgba(255,122,77,.16), transparent)", pointerEvents: "none" }} />}
      {key !== "intro" && <Rail t={t} />}
    </div>
  );
}

/* ------------------------------------------------------------------ player */
export function WorkflowMotion({ facts, record = false, autoPlay = true }: { facts: MotionFacts; record?: boolean; autoPlay?: boolean }) {
  const clock = useRef(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const [scale, setScale] = useState(1);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(record ? Math.min(window.innerWidth / W, window.innerHeight / H) : el.clientWidth / W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("resize", fit);
    return () => { ro.disconnect(); window.removeEventListener("resize", fit); };
  }, [record]);

  useEffect(() => {
    (window as unknown as { __filmStarted?: number }).__filmStarted = performance.now();
  }, []);

  useEffect(() => {
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
      last = now;
      if (playing) {
        clock.current = Math.min(TOTAL, clock.current + dt);
        if (clock.current >= TOTAL) {
          setPlaying(false);
          (window as unknown as { __filmDone?: boolean }).__filmDone = true; // recording hook
        }
      }
      setT(clock.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = (s: number) => { clock.current = s; setT(s); setPlaying(true); };
  const scene = sceneAt(t);

  return (
    <div className="space-y-3">
      <div ref={box} className={record ? "fixed inset-0 grid place-items-center bg-[#07090d]" : "relative aspect-video w-full overflow-hidden rounded-3xl border border-white/10 bg-[#07090d] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"}>
        <div style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: record ? "center" : "top left", position: record ? "relative" : "absolute", left: 0, top: 0, flexShrink: 0 }}>
          <Stage facts={facts} t={t} />
        </div>
      </div>
      {!record && (
        <div className="hud flex flex-wrap items-center gap-3 rounded-2xl p-3">
          <button onClick={() => (t >= TOTAL ? seek(0) : setPlaying((x) => !x))} className="grid h-10 w-10 place-items-center rounded-xl bg-white text-black" aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-black" />}</button>
          <button onClick={() => seek(0)} className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-white hover:bg-white/20" aria-label="Restart"><RotateCcw className="h-4 w-4" /></button>
          <div className="flex min-w-[220px] flex-1 flex-wrap gap-1">
            {RAIL.map((r, k) => (
              <button key={r} onClick={() => seek(STARTS[k + 1] + 0.01)} className={cn("rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors", scene === k + 1 ? "bg-white/15 text-white" : "text-white/55 hover:text-white")}>{k + 1}. {r}</button>
            ))}
          </div>
          <span className="font-mono text-[12.5px] text-white/50">{Math.floor(t)}s / {TOTAL}s</span>
          <button onClick={() => box.current?.requestFullscreen?.()} className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-white hover:bg-white/20" aria-label="Full screen"><Expand className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}

/** Loads the demo investigation and shows the workflow motion film. */
export function WorkflowMotionSection({ record = false }: { record?: boolean }) {
  const [facts, setFacts] = useState<MotionFacts | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    Promise.all([api<{ featured: Featured | null }>("/public/showcase"), api<Film>("/public/film").catch(() => null)])
      .then(([s, film]) => (s.featured ? setFacts({ f: s.featured, film }) : setFailed(true)))
      .catch(() => setFailed(true));
  }, []);
  if (facts) return <WorkflowMotion facts={facts} record={record} />;
  return (
    <div className="grid aspect-video w-full place-items-center rounded-3xl border border-white/10 bg-black/40 text-[14px] text-white/50">
      {failed ? "The workflow film appears once the demo investigation has finished computing." : "Loading the workflow film…"}
    </div>
  );
}
