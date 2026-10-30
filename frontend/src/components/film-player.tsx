"use client";
/** Cinematic player for the 3D simulation film (used in investigations and on the landing page). */
import { AnimatePresence, motion } from "framer-motion";
import { CloudRain, Download, Droplets, Expand, Loader2, Pause, Play, RotateCcw, Sparkles, Sun, Thermometer, TreeDeciduous } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Biome, FilmScene, Playhead } from "@/components/three/city-film";
import { cn } from "@/lib/format";
import { canRecordFilm, downloadBlob, type FilmRecording, slug, startFilmRecording } from "@/lib/record-film";

const CityFilm = dynamic(() => import("@/components/three/city-film").then((m) => m.CityFilm), { ssr: false });

export interface Film {
  title: string;
  location: string;
  horizon_years: number;
  criteria: { metric: string; label: string; op: string; threshold: number }[];
  climate_source: string;
  synthetic_climate: boolean;
  biome?: Biome;
  scenes: FilmScene[];
  narration_mode: "llm" | "grounded";
  narration_model: string;
}

const BIOME_EMOJI: Record<string, string> = { desert: "🏜️", semi_arid: "🌵", mediterranean: "🫒", monsoon: "🌧️", humid: "🌴" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const INTRO = 4;
const TITLE = 4;
const END = 5;
const PER_MONTH = 0.2; // seconds of film per simulated month

export function FilmPlayer({ film, autoPlay = true, compact = false, record = false }: { film: Film; autoPlay?: boolean; compact?: boolean; record?: boolean }) {
  const H = film.horizon_years;
  const playLen = H * 12 * PER_MONTH;
  const sceneLen = TITLE + playLen + END;
  const total = INTRO + film.scenes.length * sceneLen;

  const t = useRef(0);
  const play = useRef<Playhead>({ scene: 0, phase: "intro", p: 0, years: 0 });
  const [playing, setPlaying] = useState(autoPlay);
  const [speed, setSpeed] = useState(1);
  const [hud, setHud] = useState<Playhead & { t: number }>({ scene: 0, phase: "intro", p: 0, years: 0, t: 0 });
  const box = useRef<HTMLDivElement>(null);
  const recording = useRef<FilmRecording | null>(null);
  const [recState, setRecState] = useState<"idle" | "recording" | "saving" | "error">("idle");

  /** Plays the film from the start while recording the film box, then downloads it. */
  async function downloadVideo() {
    if (!box.current || recState === "recording") return;
    try {
      const r = await startFilmRecording(box.current);
      recording.current = r;
      setRecState("recording");
      setSpeed(1);
      t.current = 0;
      setPlaying(true);
      const { blob, ext } = await r.done;
      setRecState("saving");
      downloadBlob(blob, `backfire-${slug(film.title)}.${ext}`);
      setRecState("idle");
    } catch {
      setRecState("error"); // viewer cancelled the share prompt, or the browser can't record
      setTimeout(() => setRecState("idle"), 4000);
    } finally {
      recording.current = null;
    }
  }

  const locate = useCallback(
    (time: number): Playhead => {
      if (time < INTRO) return { scene: 0, phase: "intro", p: time / INTRO, years: 0 };
      const k = Math.min(film.scenes.length - 1, Math.floor((time - INTRO) / sceneLen));
      const local = time - INTRO - k * sceneLen;
      if (local < TITLE) return { scene: k, phase: "title", p: local / TITLE, years: 0 };
      if (local < TITLE + playLen) {
        const p = (local - TITLE) / playLen;
        return { scene: k, phase: "play", p, years: p * H };
      }
      return { scene: k, phase: "end", p: Math.min(1, (local - TITLE - playLen) / END), years: H };
    },
    [film.scenes.length, sceneLen, playLen, H],
  );

  // master clock
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
    const tick = (now: number) => {
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); // rAF time can precede performance.now()
      last = now;
      if (playing) t.current = Math.min(total, t.current + dt * speed);
      if (t.current >= total) {
        setPlaying(false);
        if (recording.current) setTimeout(() => recording.current?.stop(), 800); // keep the last frame briefly
        (window as unknown as { __filmDone?: boolean }).__filmDone = true; // recording hook
      }
      play.current = locate(t.current);
      if (now - lastHud > 80) {
        lastHud = now;
        setHud({ ...play.current, t: t.current });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, total, locate]);

  useEffect(() => {
    (window as unknown as { __filmStarted?: number }).__filmStarted = performance.now();
  }, []);

  const seek = (time: number) => {
    t.current = Math.max(0, Math.min(total - 0.01, time));
    setPlaying(true);
  };

  const sc = film.scenes[hud.scene];
  const month = Math.min(11, Math.floor((hud.years % 1) * 12));
  const yi = Math.min(H, Math.floor(hud.years));
  const survival = hud.phase === "play" ? sc.survival_by_year[yi] + (sc.survival_by_year[Math.min(H, yi + 1)] - sc.survival_by_year[yi]) * (hud.years - yi) : hud.phase === "end" ? sc.survival_by_year[H] : 1;
  const survT = film.criteria.find((c) => c.metric === "survival_rate")?.threshold;
  const broken = sc.break_year !== null && hud.phase !== "title" && hud.phase !== "intro" && hud.years >= sc.break_year;
  const flash = sc.break_year !== null && hud.phase === "play" && Math.abs(hud.years - sc.break_year) < 0.35;
  const stress = sc.monthly.stress[month] ?? 0;
  const tmax = sc.monthly.tmax_c[month] ?? 0;
  const rain = sc.monthly.rain_mm[month] ?? 0;
  const irr = sc.monthly.irrigation_mm[month] ?? 0;
  const chapters = useMemo(() => [{ label: "Intro", at: 0 }, ...film.scenes.map((s, i) => ({ label: s.title, at: INTRO + i * sceneLen }))], [film.scenes, sceneLen]);
  const tone = sc.key === "break" ? "#ff5b2e" : sc.key === "better" ? "#3ee6a8" : "#7cc8ff";

  return (
    <div className="space-y-4">
      <div ref={box} className={record ? "fixed inset-0 overflow-hidden bg-black" : "relative aspect-video w-full overflow-hidden rounded-3xl border border-white/10 bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"}>
        <CityFilm scene={sc} play={play} biome={film.biome?.key} />

        {/* cinema letterbox */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[6%] bg-black" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[6%] bg-black" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.55)_100%)]" />
        {flash && <motion.div className="pointer-events-none absolute inset-0 bg-[#ff2a00]" initial={{ opacity: 0 }} animate={{ opacity: [0, 0.35, 0] }} transition={{ duration: 0.9 }} />}

        {/* intro card */}
        <AnimatePresence>
          {hud.phase === "intro" && (
            <motion.div key="intro" className="absolute inset-0 grid place-items-center bg-black/55 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.8 } }}>
              <div>
                <motion.div initial={{ opacity: 0, letterSpacing: "0.5em" }} animate={{ opacity: 1, letterSpacing: "0.3em" }} transition={{ duration: 1.6 }} className="text-[12px] uppercase text-white/60">A BACKFIRE simulation</motion.div>
                <motion.h2 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 1 }} className="mt-4 px-6 text-[clamp(26px,4vw,52px)] font-semibold tracking-[-0.03em] text-white">{film.title}</motion.h2>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="mt-3 font-serif text-[clamp(16px,1.8vw,24px)] italic text-white/70">{film.horizon_years} years · {film.scenes.length === 1 ? "one future" : `${["", "one", "two", "three"][film.scenes.length] || film.scenes.length} futures`} · one city block</motion.p>
                {film.biome && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.8 }} className="mx-auto mt-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/40 px-4 py-1.5 text-[13px] text-white/80">{BIOME_EMOJI[film.biome.key]} {film.biome.label} · {film.biome.annual_rain_mm} mm rain a year</motion.div>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* scene title card */}
        <AnimatePresence>
          {hud.phase === "title" && (
            <motion.div key={`title-${hud.scene}`} className="absolute inset-0 grid place-items-center bg-gradient-to-b from-black/60 via-black/30 to-black/60 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.6 } }}>
              <div className="max-w-2xl px-6">
                <div className="text-[12px] uppercase tracking-[0.3em]" style={{ color: tone }}>Scene {hud.scene + 1} of {film.scenes.length}</div>
                <motion.h3 initial={{ opacity: 0, y: 20, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.9 }} className="mt-3 text-[clamp(30px,4.5vw,60px)] font-semibold tracking-[-0.035em] text-white">{sc.title}</motion.h3>
                <p className="mt-2 text-[clamp(14px,1.4vw,18px)] text-white/70">{sc.subtitle}</p>
                {sc.changes.length > 0 && (
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {sc.changes.slice(0, 3).map((c, i) => (
                      <motion.span key={c.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 + i * 0.15 }} className="rounded-full border border-white/20 bg-black/50 px-3.5 py-1.5 text-[13px] text-white">
                        {c.label}: <span className="font-mono">{fmt3(c.from)}</span> → <span className="font-mono" style={{ color: tone }}>{fmt3(c.to)}</span>
                      </motion.span>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* HUD during the simulation */}
        {(hud.phase === "play" || hud.phase === "end") && (
          <>
            <div className="pointer-events-none absolute left-[2.5%] top-[9%] max-w-[46%]">
              <div className="text-[11px] uppercase tracking-[0.25em]" style={{ color: tone }}>Scene {hud.scene + 1} · {sc.title}</div>
              <div className="mt-1 text-[clamp(13px,1.2vw,16px)] text-white/80">{film.location}</div>
            </div>
            <div className="pointer-events-none absolute right-[2.5%] top-[9%] text-right">
              <div className="font-mono text-[clamp(22px,2.6vw,36px)] font-semibold text-white tabular-nums">Year {Math.min(H, Math.floor(hud.years)) }</div>
              <div className="flex items-center justify-end gap-1.5 text-[13px] text-white/70">{rain > 60 ? <CloudRain className="h-4 w-4" /> : <Sun className="h-4 w-4" />}{MONTHS[month]}</div>
            </div>
            <div className="pointer-events-none absolute bottom-[9%] left-[2.5%] w-[min(300px,38%)] space-y-2.5 rounded-2xl bg-black/55 p-3.5">
              <Gauge icon={TreeDeciduous} label="Trees alive" value={`${(survival * 100).toFixed(1)}%`} frac={survival} target={survT} bad={survT !== undefined && survival < survT} />
              <Gauge icon={Sun} label="Drought stress (this month)" value={`${Math.round(stress * 100)}%`} frac={stress} bad={stress > 0.5} />
              <Gauge icon={Thermometer} label="Max temperature" value={`${tmax.toFixed(1)} °C`} frac={Math.min(1, Math.max(0, (tmax - 10) / 40))} bad={tmax > 40} />
              <div className="flex justify-between text-[12px] text-white/65"><span className="flex items-center gap-1"><CloudRain className="h-3.5 w-3.5" /> Rain {Math.round(rain)} mm</span><span className="flex items-center gap-1"><Droplets className="h-3.5 w-3.5" /> Irrigation {Math.round(irr)} mm</span></div>
            </div>
          </>
        )}

        {/* breaking moment stamp */}
        <AnimatePresence>
          {broken && sc.key === "break" && hud.phase === "play" && (
            <motion.div key="stamp" className="pointer-events-none absolute right-[3%] top-[22%] rotate-[-6deg] rounded-xl border-[3px] border-[#ff5b2e] px-5 py-2 text-[clamp(16px,2vw,26px)] font-black uppercase tracking-[0.08em] text-[#ff5b2e]" initial={{ scale: 2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 18 }}>
              Promise broken · year {sc.break_year}
            </motion.div>
          )}
        </AnimatePresence>

        {/* end-of-scene result */}
        <AnimatePresence>
          {hud.phase === "end" && (
            <motion.div key={`end-${hud.scene}`} className="absolute right-[2.5%] top-1/2 w-[min(340px,40%)] -translate-y-1/2 rounded-2xl border p-5" style={{ borderColor: sc.success ? "#3ee6a866" : "#ff5b2e66", background: "rgba(0,0,0,0.7)" }} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div className="text-[clamp(18px,2vw,26px)] font-semibold" style={{ color: sc.success ? "#3ee6a8" : "#ff7a4d" }}>{sc.success ? "Promise kept" : "Promise broken"}</div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-white">
                <div><div className="text-[11.5px] text-white/50">Trees alive</div><div className="text-[22px] font-semibold">{(sc.metrics.survival_rate * 100).toFixed(1)}%</div></div>
                <div><div className="text-[11.5px] text-white/50">Street cooling</div><div className="text-[22px] font-semibold">{sc.metrics.cooling_c.toFixed(2)} °C</div></div>
              </div>
              {!sc.success && <div className="mt-2 text-[12.5px] text-white/60">Missed: {sc.binding.toLowerCase()}</div>}
            </motion.div>
          )}
        </AnimatePresence>

        {/* subtitles */}
        <AnimatePresence mode="wait">
          {(hud.phase === "play" || hud.phase === "end") && (
            <motion.div key={`sub-${hud.scene}`} className="pointer-events-none absolute bottom-[8%] left-[min(34%,340px)] right-[4%] text-center" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: 0.6 }}>
              <span className="box-decoration-clone rounded-md bg-black/70 px-2 py-1 text-[clamp(13px,1.25vw,17px)] leading-[1.8] text-white">{sc.narration}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* transport controls */}
      {!record && <div className="hud flex flex-wrap items-center gap-3 rounded-2xl p-3">
        <button onClick={() => setPlaying((p) => !p)} className="grid h-10 w-10 place-items-center rounded-xl bg-white text-black transition-transform hover:scale-105" aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-black" />}</button>
        <button onClick={() => seek(0)} className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-white transition-colors hover:bg-white/20" aria-label="Restart"><RotateCcw className="h-4 w-4" /></button>
        <div className="relative min-w-[200px] flex-1">
          <div className="relative h-2 cursor-pointer rounded-full bg-white/10" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * total); }}>
            <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#7cc8ff] via-[#ff5b2e] to-[#3ee6a8]" style={{ width: `${(hud.t / total) * 100}%` }} />
            {chapters.map((c) => <span key={c.label} className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-white/50" style={{ left: `${(c.at / total) * 100}%` }} />)}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chapters.map((c, i) => (
              <button key={c.label} onClick={() => seek(c.at + 0.01)} className={cn("rounded-lg px-2.5 py-1 text-[12.5px] transition-colors", (i === 0 ? hud.phase === "intro" : hud.scene === i - 1 && hud.phase !== "intro") ? "bg-white/15 text-white" : "text-white/55 hover:text-white")}>{c.label}</button>
            ))}
          </div>
        </div>
        <button onClick={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 0.5 : 1))} disabled={recState === "recording"} className="h-10 rounded-xl bg-white/10 px-3 font-mono text-[13px] text-white hover:bg-white/20 disabled:opacity-40">{speed}×</button>
        {canRecordFilm() && (
          <button onClick={() => (recState === "recording" ? recording.current?.stop() : downloadVideo())} title="Plays the film from the start and saves it as a video file" className={cn("inline-flex h-10 items-center gap-2 rounded-xl px-3.5 text-[13.5px] font-medium", recState === "recording" ? "bg-[#ff5b2e] text-white" : "bg-white/10 text-white hover:bg-white/20")}>
            {recState === "recording" ? <><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" /> Recording… stop</> : recState === "saving" ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving</> : recState === "error" ? "Recording cancelled" : <><Download className="h-4 w-4" /> Download video</>}
          </button>
        )}
        <button onClick={() => box.current?.requestFullscreen?.()} className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-white hover:bg-white/20" aria-label="Full screen"><Expand className="h-4 w-4" /></button>
      </div>}
      {!compact && !record && <p className="flex flex-wrap items-center gap-2 px-1 text-[12.5px] text-white/50">
        <Sparkles className="h-3.5 w-3.5 text-[#ff7a4d]" /> Narration: {film.narration_mode === "llm" ? `written by ${film.narration_model}, checked against computed numbers` : "grounded narrator (configure Ollama in Settings for AI narration)"}.
        Tree deaths follow the model&apos;s survival curve; leaf colour, rain, sprinklers and sun follow the monthly simulation. The city block itself is an illustration{film.biome ? `, styled as a ${film.biome.label.toLowerCase()} from the site's climate` : ""}. {film.synthetic_climate && "Synthetic climate — exploratory."}
      </p>}
    </div>
  );
}

function Gauge({ icon: Icon, label, value, frac, target, bad }: { icon: React.ElementType; label: string; value: string; frac: number; target?: number; bad?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[12px]"><span className="flex items-center gap-1.5 text-white/70"><Icon className="h-3.5 w-3.5" />{label}</span><span className={cn("font-mono font-semibold", bad ? "text-[#ff7a4d]" : "text-white")}>{value}</span></div>
      <div className="relative mt-1 h-1.5 rounded-full bg-white/10">
        <div className={cn("h-full rounded-full transition-[width] duration-200", bad ? "bg-[#ff5b2e]" : "bg-[#3ee6a8]")} style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} />
        {target !== undefined && <span className="absolute -top-1 h-3.5 w-0.5 bg-white" style={{ left: `${target * 100}%` }} title="target" />}
      </div>
    </div>
  );
}

const fmt3 = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toPrecision(3));
