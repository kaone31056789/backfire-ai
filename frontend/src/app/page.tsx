"use client";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowDown, ArrowRight, Loader2, Play } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Logo } from "@/components/auth-form";
import { FilmPlayer, type Film } from "@/components/film-player";
import { AgentConstellation, type AgentStory } from "@/components/landing/agent-constellation";
import { ExplainerReel } from "@/components/landing/explainer-reel";
import { WorkflowMotionSection } from "@/components/workflow-motion";
import type { CameraKey } from "@/components/landing/cinematic-earth";
import { Counter, KineticTitle, Marquee, Reveal } from "@/components/landing/motion";
import type { Landscape } from "@/components/three/failure-landscape";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";

const CinematicEarth = dynamic(() => import("@/components/landing/cinematic-earth").then((m) => m.CinematicEarth), { ssr: false });
const FailureLandscape = dynamic(() => import("@/components/three/failure-landscape").then((m) => m.FailureLandscape), { ssr: false });

interface Showcase {
  sites: { id: string; title: string; lat: number; lon: number; status: string; d_star: number | null }[];
  featured: null | {
    title: string; location: string; country: string; lat: number; lon: number; description: string;
    climate_source: string; synthetic_climate: boolean;
    criteria: { metric: string; op: string; threshold: number; label: string }[];
    nominal: { cooling_c: number; survival_rate: number; water_stress_index: number; net_benefit: number; success: boolean };
    best: null | { distance: number; status: string; binding_criterion: string; metrics: Record<string, number>; deltas: Record<string, { from: number; to: number; label: string; unit: string; normalised: number }> };
    failure_probability: number | null; failure_ci95: [number, number] | null;
    evaluations: number; methods: { method: string; found: boolean; distance: number | null }[];
    evidence_sources: number;
    agents?: AgentStory;
    landscape: (Landscape & { failure_fraction: number }) | null;
  };
}

const METRIC_LABEL: Record<string, string> = { cooling_c: "summer cooling", survival_rate: "tree survival", water_stress_index: "water stress", irrigation_m3_ha: "irrigation", annual_cost_usd_ha: "cost" };

export default function Landing() {
  const router = useRouter();
  const [data, setData] = useState<Showcase | null>(null);
  const [busy, setBusy] = useState(false);
  const story = useRef<HTMLElement>(null);
  const progress = useRef(0);
  const [chapter, setChapter] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const landRef = useRef<HTMLDivElement>(null);
  const [landActive, setLandActive] = useState(false);

  const [film, setFilm] = useState<Film | null>(null);
  const filmRef = useRef<HTMLDivElement>(null);
  const [filmOn, setFilmOn] = useState(false);
  useEffect(() => {
    api<Showcase>("/public/showcase").then(setData).catch(() => setData(null));
    api<Film>("/public/film").then(setFilm).catch(() => setFilm(null));
  }, []);
  useEffect(() => {
    const el = filmRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setFilmOn(true), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [film]);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 40);
      const s = story.current;
      if (s) {
        const r = s.getBoundingClientRect();
        const p = Math.max(0, Math.min(4, -r.top / window.innerHeight));
        progress.current = p;
        setChapter(Math.round(p));
      }
      const l = landRef.current;
      if (l) {
        const r = l.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.7 && r.bottom > 0) setLandActive(true);
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  async function demo() {
    setBusy(true);
    try {
      await api("/auth/demo-login", { body: {} });
      router.push("/dashboard");
    } catch {
      router.push("/login");
    }
  }

  const f = data?.featured;
  const site = { lon: f?.lon ?? 77.209, lat: f?.lat ?? 28.6139 };
  const keys: CameraKey[] = [
    { lon: site.lon - 55, lat: 12, zoom: 1.45, pitch: 0, bearing: 0 },
    { lon: site.lon, lat: site.lat - 3, zoom: 3.6, pitch: 20, bearing: -8 },
    { lon: site.lon, lat: site.lat, zoom: 10.6, pitch: 48, bearing: -24 },
    { lon: site.lon, lat: site.lat, zoom: 15.4, pitch: 70, bearing: 32 },
    { lon: site.lon + 0.004, lat: site.lat - 0.004, zoom: 14.3, pitch: 62, bearing: 140 },
  ];
  const deltas = f?.best ? Object.values(f.best.deltas).sort((a, b) => Math.abs(b.normalised) - Math.abs(a.normalised)).slice(0, 3) : [];

  return (
    <div className="bg-[#030407] text-white selection:bg-[#ff5b2e]/40">
      {/* ------------------------------------------------------------------ nav */}
      <header className={`fixed inset-x-0 top-0 z-50 transition-[background,backdrop-filter,border-color] duration-500 ${scrolled ? "border-b border-white/[0.06] bg-black/40 backdrop-blur-xl" : "border-b border-transparent"}`}>
        <div className="mx-auto flex h-[72px] max-w-[1400px] items-center gap-8 px-6 md:px-10">
          <Link href="/" className="flex items-center gap-2.5"><Logo size={30} /><span className="text-[16px] font-semibold tracking-[-0.01em]">BACKFIRE<span className="text-[#ff5b2e]"> AI</span></span></Link>
          <nav className="hidden flex-1 items-center gap-7 text-[14px] text-white/60 md:flex">
            <a href="#story" className="transition-colors hover:text-white">Story</a>
            <a href="#landscape" className="transition-colors hover:text-white">Failure landscape</a>
            <a href="#agents" className="transition-colors hover:text-white">AI agents</a>
            <a href="#science" className="transition-colors hover:text-white">Science</a>
            <Link href="/how-it-works" className="transition-colors hover:text-white">How it works</Link>
            <Link href="/architecture" className="transition-colors hover:text-white">Architecture</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="hidden h-10 items-center rounded-full px-4 text-[14px] text-white/80 transition-colors hover:text-white sm:inline-flex">Sign in</Link>
            <button onClick={demo} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-5 text-[14px] font-semibold text-black transition-transform hover:scale-[1.03] active:scale-100">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Demo login <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------------ cinematic story: the camera flies from orbit to street level */}
      <section ref={story} id="story" className="relative" style={{ height: "500vh" }}>
        <div className="sticky top-0 h-screen overflow-hidden">
          <CinematicEarth keys={keys} progressRef={progress} site={site} />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.75)_100%)]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#030407] to-transparent" />
          {/* chapter progress rail */}
          <div className="absolute right-6 top-1/2 z-10 hidden -translate-y-1/2 flex-col gap-3 md:flex">
            {["Orbit", "Place", "Promise", "Street", "Breaking point"].map((c, i) => (
              <div key={c} className="flex items-center justify-end gap-3">
                <span className={`text-[12px] transition-all duration-500 ${chapter === i ? "text-white opacity-100" : "text-white/0"}`}>{c}</span>
                <span className={`block h-[2px] rounded-full transition-all duration-500 ${chapter === i ? "w-8 bg-[#ff5b2e]" : "w-3 bg-white/30"}`} />
              </div>
            ))}
          </div>
        </div>

        <div className="absolute inset-0">
          {/* 0 — orbit */}
          <div className="flex h-screen items-end px-6 pb-[14vh] md:px-10">
            <div className="mx-auto w-full max-w-[1400px]">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3.5 py-1.5 text-[13px] text-white/80 backdrop-blur-md">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff5b2e]" /> Adversarial Climate Intervention Falsification Lab
              </motion.div>
              <KineticTitle text="Every climate promise has a breaking point." accent={["breaking", "point"]} className="max-w-5xl text-[52px] font-semibold leading-[0.98] tracking-[-0.045em] md:text-[96px]" />
              <Reveal delay={0.7}>
                <p className="mt-7 max-w-xl text-[18px] leading-relaxed text-white/70 md:text-[20px]">BACKFIRE AI finds it — the smallest plausible change in the real world that makes a green intervention fail — before the climate does.</p>
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <button onClick={demo} disabled={busy} className="inline-flex h-13 items-center gap-2.5 rounded-full bg-[#ff5b2e] px-7 text-[16px] font-semibold text-white shadow-[0_10px_40px_-8px_rgba(255,91,46,0.7)] transition-transform hover:scale-[1.03]">
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-4 w-4 fill-white" />} Enter the live demo
                  </button>
                  <a href="#explainer" className="inline-flex h-13 items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 text-[16px] font-medium text-white backdrop-blur-md transition-colors hover:bg-white/10"><Play className="h-4 w-4" /> Watch the 30-second explainer <ArrowDown className="h-4 w-4" /></a>
                </div>
              </Reveal>
            </div>
          </div>

          {/* 1 — place */}
          <Chapter id="chapter-1" n="01" kicker="It starts with a place">
            <h2 className="text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] md:text-[64px]">{f ? f.location : "New Delhi"}<span className="font-serif italic text-white/50">{f?.country ? `, ${f.country}` : ""}</span></h2>
            <p className="mt-5 text-[17px] leading-relaxed text-white/70">{site.lat.toFixed(4)}° N, {site.lon.toFixed(4)}° E. The climate here is not assumed — it is read from {f && !f.synthetic_climate ? "NASA POWER satellite-era reanalysis" : "the site's climatology"}: heat, humidity, rain, month by month.</p>
          </Chapter>

          {/* 2 — promise */}
          <Chapter n="02" kicker="And a promise">
            <blockquote className="font-serif text-[30px] italic leading-[1.2] text-white md:text-[38px]">“{f ? truncate(f.description, 180) : "Plant 250 trees per hectare, cool summer streets by 0.5 °C, keep half the trees alive for a decade."}”</blockquote>
            {f && (
              <div className="mt-6 flex flex-wrap gap-2">
                {f.criteria.map((c) => (
                  <span key={c.metric} className="rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-[14px] text-white/85 backdrop-blur">{METRIC_LABEL[c.metric] || c.metric} {c.op === ">=" ? "≥" : "≤"} {c.metric === "survival_rate" ? `${Math.round(c.threshold * 100)}%` : c.threshold}</span>
                ))}
              </div>
            )}
          </Chapter>

          {/* 3 — street */}
          <Chapter n="03" kicker="Down at street level">
            <h2 className="text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] md:text-[56px]">Physics, not optimism.</h2>
            <p className="mt-5 text-[17px] leading-relaxed text-white/70">Every tree is run through a daily FAO-56 water balance: evapotranspiration, soil moisture, drought stress, mortality and the cooling that survives it. Eighteen parameters, each with documented bounds and sources.</p>
            <div className="mt-7 grid grid-cols-3 gap-4">
              <Stat value={18} label="parameters" />
              <Stat value={f?.evidence_sources ?? 0} label="evidence sources" />
              <Stat value={365} label="days simulated / yr" />
            </div>
          </Chapter>

          {/* 4 — breaking point */}
          <Chapter n="04" kicker="Then we try to break it" accent>
            {f?.best ? (
              <>
                <h2 className="text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] md:text-[56px]">It breaks at <span className="text-[#ff7a4d]"><Counter value={f.best.distance} format={(v) => v.toFixed(2)} /></span></h2>
                <p className="mt-1 font-serif text-[22px] italic text-white/55">of the documented plausible range — a small, realistic shift.</p>
                <ul className="mt-6 space-y-2.5">
                  {deltas.map((d) => (
                    <li key={d.label} className="flex items-center justify-between gap-6 border-b border-white/10 pb-2.5 text-[16px]">
                      <span className="text-white/75">{d.label}</span>
                      <span className="font-mono text-white">{fmt(d.from)} → <span className="text-[#ff7a4d]">{fmt(d.to)}</span></span>
                    </li>
                  ))}
                </ul>
                <p className="mt-5 text-[16px] leading-relaxed text-white/70">
                  …and <b className="text-white">{METRIC_LABEL[f.best.binding_criterion]}</b> misses its target. Across uncertain futures the claim fails{" "}
                  <b className="text-[#ff7a4d]">{f.failure_probability !== null ? `${Math.round(f.failure_probability * 100)}%` : "—"}</b> of the time. Independently verified.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] md:text-[56px]">Minimum Plausible Failure Search.</h2>
                <p className="mt-5 text-[17px] leading-relaxed text-white/70">Thousands of simulated futures, searched for the nearest one where the promise breaks — then reproduced by an independent agent.</p>
              </>
            )}
          </Chapter>
        </div>
      </section>

      {/* ------------------------------------------------------------------ what is this? (for mentors) + animated explainer */}
      {/* ------------------------------------------------------------------ the full workflow film */}
      <section id="workflow" className="relative px-6 pt-28 md:px-10">
        <div className="mx-auto max-w-[1400px]">
          <Reveal><div className="text-[13px] font-medium uppercase tracking-[0.2em] text-[#ff7a4d]">The full workflow</div></Reveal>
          <KineticTitle text="From a promise to a verified verdict, in eight stages." accent={["verified", "verdict,"]} className="mt-4 max-w-4xl text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] md:text-[56px]" />
          <div className="mt-10"><WorkflowMotionSection /></div>
        </div>
      </section>

      <section id="explainer" className="relative px-6 py-28 md:px-10">
        <div className="mx-auto max-w-[1400px]">
          <Reveal><div className="text-[13px] font-medium uppercase tracking-[0.2em] text-[#ff7a4d]">What is BACKFIRE?</div></Reveal>
          <KineticTitle text="A crash test for green promises." accent={["green", "promises."]} className="mt-4 max-w-4xl text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] md:text-[68px]" />
          <div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div className="space-y-4">
              {[
                ["😟", "The problem", "Cities spend millions planting trees and building green projects on promises like “2 °C cooler streets”. Nobody checks how easily that promise breaks — a hotter summer, a water shortage — until the trees are already dying."],
                ["🔨", "What BACKFIRE does", "It crash-tests the promise before the money is spent. It simulates 10 years of the real local climate and searches thousands of possible futures for the smallest realistic change that makes the promise fail."],
                ["🤖", "Where the AI is", "Eight AI agents work together: one reads the proposal, one gathers scientific evidence, one builds cause-and-effect, one hunts for failures, one independently double-checks, one designs safer alternatives, one writes the report. You can also ask the AI Copilot questions in plain English."],
                ["🎁", "What you get", "A clear verdict, the exact conditions that break the plan, a 3D film of what happens, safer designs, and a signed, reproducible certificate."],
              ].map(([e, t, d], k) => (
                <Reveal key={t} delay={k * 0.08}>
                  <div className="flex gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/[0.06] text-[26px]">{e}</div>
                    <div><div className="text-[18px] font-semibold text-white">{t}</div><p className="mt-1 text-[15.5px] leading-relaxed text-white/65">{d}</p></div>
                  </div>
                </Reveal>
              ))}
              <Reveal delay={0.4}><Link href="/how-it-works" className="inline-flex items-center gap-2 text-[15px] font-semibold text-[#ff7a4d] hover:underline">Read the full guide &amp; judge Q&amp;A <ArrowRight className="h-4 w-4" /></Link></Reveal>
            </div>
            <Reveal delay={0.15}>
              <ExplainerReel facts={{
                place: f?.location || "New Delhi",
                cooling: f?.criteria.find((c) => c.metric === "cooling_c")?.threshold ?? 0.5,
                survival: f?.criteria.find((c) => c.metric === "survival_rate")?.threshold ?? 0.5,
                sources: f?.evidence_sources ?? 0,
                dStar: f?.best?.distance ?? null,
                pFail: f?.failure_probability ?? null,
                changes: deltas.map((d) => d.label.toLowerCase()),
                bestAlt: film?.scenes.find((x) => x.key === "better")?.subtitle ?? null,
              }} />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ the 3D simulation film */}
      {film && film.scenes.length >= 2 && (
        <section className="relative border-t border-white/[0.06] px-6 py-28 md:px-10">
          <div className="mx-auto max-w-[1400px]">
            <Reveal><div className="text-[13px] font-medium uppercase tracking-[0.2em] text-[#ff7a4d]">The simulation film</div></Reveal>
            <KineticTitle text="Watch ten years happen in one minute." accent={["one", "minute."]} className="mt-4 max-w-4xl text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] md:text-[60px]" />
            <Reveal delay={0.2}><p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-white/60">The same city block lives through three futures: the one the plan assumes, the smallest change that breaks it, and a safer design. Trees grow, get thirsty, and fall exactly as the simulation computed.</p></Reveal>
            <div ref={filmRef} className="mt-10">
              {filmOn ? <FilmPlayer film={film} compact /> : <div className="aspect-video w-full rounded-3xl border border-white/10 bg-black/40" />}
            </div>
          </div>
        </section>
      )}

      <Marquee items={["NASA POWER climatology", "OpenAlex", "Crossref", "FAO-56 Penman-Monteith", "WUCOLS", "SALib Sobol", "pymoo NSGA-II", "LangGraph agents", "Sentinel-2", "GBIF"]} />

      {/* ------------------------------------------------------------------ 3D failure landscape */}
      <section id="landscape" className="relative px-6 py-28 md:px-10">
        <div className="mx-auto max-w-[1400px]">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <Reveal><div className="text-[13px] font-medium uppercase tracking-[0.2em] text-[#ff7a4d]">The failure landscape</div></Reveal>
              <KineticTitle text="Hills where the promise holds. A red sea where it drowns." accent={["drowns."]} className="mt-4 text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] md:text-[60px]" />
              <Reveal delay={0.3}>
                <p className="mt-6 max-w-md text-[17px] leading-relaxed text-white/60">Each point is a full model run. Height is the net benefit of the intervention; everything below the surface fails a success criterion. Drag to orbit — this is the demo investigation&apos;s real computed boundary.</p>
                {f?.landscape && (
                  <div className="mt-8 flex gap-10">
                    <div><div className="text-[44px] font-semibold tracking-[-0.03em] text-[#ff7a4d]"><Counter value={f.landscape.failure_fraction * 100} format={(v) => `${v.toFixed(0)}%`} /></div><div className="text-[14px] text-white/50">of this slice is underwater</div></div>
                    <div><div className="text-[44px] font-semibold tracking-[-0.03em]"><Counter value={f.landscape.x.values.length * f.landscape.y.values.length} /></div><div className="text-[14px] text-white/50">model runs in this view</div></div>
                  </div>
                )}
              </Reveal>
            </div>
            <div ref={landRef} className="relative overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-b from-[#0b0f18] to-[#05070b]">
              {f?.landscape ? <FailureLandscape data={f.landscape} active={landActive} height={560} /> : <div className="grid h-[560px] place-items-center text-[14px] text-white/40">The landscape appears once the demo investigation has finished computing.</div>}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ agents */}
      <section id="agents" className="relative border-t border-white/[0.06] px-6 py-28 md:px-10">
        <div className="mx-auto max-w-[1400px]">
          <Reveal><div className="text-[13px] font-medium uppercase tracking-[0.2em] text-[#ff7a4d]">Where the AI works</div></Reveal>
          <KineticTitle text="Eight AI agents. One rule: no number without proof." className="mt-4 max-w-4xl text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] md:text-[64px]" />
          <div className="mt-16"><AgentConstellation story={f?.agents} subject={f ? `${f.title}` : undefined} /></div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ science / methods */}
      <section id="science" className="relative border-t border-white/[0.06] px-6 py-28 md:px-10">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-14 lg:grid-cols-2">
          <div>
            <Reveal><div className="text-[13px] font-medium uppercase tracking-[0.2em] text-[#ff7a4d]">Measured, not claimed</div></Reveal>
            <KineticTitle text="We race our own algorithm against the classics." className="mt-4 text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] md:text-[56px]" />
            <Reveal delay={0.2}><p className="mt-6 max-w-md text-[17px] leading-relaxed text-white/60">Same budget, same seed, same model. The smallest verified breaking change wins. Benchmarks on problems with known answers live inside the app — with every losing run kept.</p></Reveal>
          </div>
          <div className="space-y-3">
            {(f?.methods.length ? f.methods : [{ method: "MPFS", found: true, distance: null }, { method: "NSGA-II", found: true, distance: null }, { method: "Differential evolution", found: true, distance: null }, { method: "Random search", found: true, distance: null }]).map((m, i, arr) => {
              const max = Math.max(...arr.map((x) => x.distance ?? 0), 0.01);
              return (
                <Reveal key={m.method} delay={i * 0.08}>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[18px] font-medium">{m.method}</span>
                      <span className="font-mono text-[15px] text-white/70">{m.distance !== null ? `d* = ${m.distance.toFixed(3)}` : m.found ? "" : "no failure found"}</span>
                    </div>
                    {m.distance !== null && (
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                        <motion.div className={`h-full rounded-full ${m.method === "MPFS" ? "bg-[#ff5b2e]" : "bg-white/35"}`} initial={{ width: 0 }} whileInView={{ width: `${(m.distance / max) * 100}%` }} viewport={{ once: true }} transition={{ duration: 1.4, delay: 0.2 + i * 0.1, ease: [0.22, 1, 0.36, 1] }} />
                      </div>
                    )}
                  </div>
                </Reveal>
              );
            })}
            <p className="pt-2 text-[13px] text-white/40">Shorter bar = smaller change needed to break the claim = sharper search. Single demo instance, not a general benchmark.</p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ CTA */}
      <section className="relative overflow-hidden border-t border-white/[0.06] px-6 py-36 text-center md:px-10">
        <motion.div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ff5b2e]/20 blur-[120px]" animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }} />
        <div className="relative">
          <KineticTitle text="Break your promise here, not in the city." accent={["here,"]} className="mx-auto max-w-4xl text-[48px] font-semibold leading-[1] tracking-[-0.04em] md:text-[80px]" />
          <Reveal delay={0.4}>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <button onClick={demo} disabled={busy} className="inline-flex h-14 items-center gap-2.5 rounded-full bg-white px-8 text-[17px] font-semibold text-black transition-transform hover:scale-[1.03]">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null} Demo login <ArrowRight className="h-5 w-5" />
              </button>
              <Link href="/register" className="inline-flex h-14 items-center rounded-full border border-white/20 px-8 text-[17px] font-medium text-white transition-colors hover:bg-white/10">Create an account</Link>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] px-6 py-10 text-[13px] text-white/40 md:px-10">
        <div className="mx-auto flex max-w-[1400px] flex-col justify-between gap-4 md:flex-row">
          <span>BACKFIRE AI · Adversarial Climate Intervention Falsification Laboratory</span>
          <span>Imagery: Sentinel-2 cloudless by EOX (Copernicus data) · Terrain: Mapzen/AWS · Buildings: © OpenStreetMap via OpenFreeMap</span>
        </div>
      </footer>
    </div>
  );
}

function Chapter({ id, n, kicker, accent, children }: { id?: string; n: string; kicker: string; accent?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const opacity = useTransform(scrollYProgress, [0.15, 0.4, 0.6, 0.85], [0, 1, 1, 0]);
  const y = useTransform(scrollYProgress, [0.15, 0.4, 0.6, 0.85], [60, 0, 0, -60]);
  return (
    <div id={id} ref={ref} className="flex h-screen items-center px-6 md:px-10">
      <div className="mx-auto w-full max-w-[1400px]">
        <motion.div style={{ opacity, y }} className={`max-w-xl rounded-[28px] border p-8 backdrop-blur-2xl md:p-10 ${accent ? "border-[#ff5b2e]/30 bg-black/55" : "border-white/10 bg-black/45"}`}>
          <div className="mb-5 flex items-center gap-3 text-[13px] font-medium uppercase tracking-[0.2em] text-[#ff7a4d]"><span className="font-mono text-white/40">{n}</span>{kicker}</div>
          {children}
        </motion.div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-[34px] font-semibold tracking-[-0.03em]"><Counter value={value} /></div>
      <div className="text-[13px] text-white/50">{label}</div>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, s.lastIndexOf(" ", n)) + "…" : s;
}
