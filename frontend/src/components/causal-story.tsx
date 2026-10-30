"use client";
/**
 * Plain-language view of the causal graph: five columns (nature → choices → water → trees →
 * results), friendly names, and arrows drawn only when they matter. Clicking a card lights up
 * everything it pushes and everything that pushes it; "stories" play a causal chain step by step.
 * Same nodes and edges as the expert graph - only the presentation is simplified.
 */
import { AnimatePresence, motion } from "framer-motion";
import { Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/format";

export interface StoryNode { key: string; label: string; kind: string; description: string }
export interface StoryEdge { id: string; source: string; target: string; sign: string; basis: string; mechanism: string; in_model: boolean }

const FRIENDLY: Record<string, [string, string, string]> = {
  warming: ["🌡️", "Heat", "How hot the air gets."],
  precip: ["🌧️", "Rain", "How much rain falls each month."],
  rh: ["💦", "Humidity", "How damp the air is."],
  wind: ["💨", "Wind", "Wind dries leaves and soil faster."],
  supply: ["🚰", "Water supply", "How often the promised water actually arrives."],
  taw: ["🧽", "Soil sponge", "How much water the soil around roots can hold."],
  kmc: ["🏙️", "City heat effect", "Paving and walls make streets hotter and drier."],
  canopy: ["🌳", "Planned shade", "How much of the ground the grown trees should cover."],
  density: ["🌱", "Trees planted", "How many trees per hectare."],
  species: ["🍃", "Thirsty or tough trees", "Some species need much more water than others."],
  alloc: ["🪣", "Water budget", "How much irrigation water the plan allows."],
  irr_eff: ["🔧", "Irrigation quality", "How much water reaches the roots instead of being wasted."],
  maint: ["🧑‍🌾", "Care", "Money spent looking after each tree."],
  et0: ["☀️", "Drying power of the air", "How strongly sun, heat and wind pull water out (FAO-56)."],
  etl: ["🥤", "Trees' thirst", "How much water the planted trees want."],
  peff: ["🌦️", "Rain that soaks in", "The part of the rain that actually reaches the roots."],
  irrigation: ["💧", "Water delivered", "Irrigation that really arrives."],
  soil: ["🟫", "Water in the soil", "What is left in the root zone each day."],
  stress: ["😰", "Tree stress", "How thirsty the trees are."],
  transp: ["🌬️", "Trees 'sweating'", "Water trees release through leaves - this cools the air."],
  mortality: ["🍂", "Trees dying", "Share of trees that die each year."],
  canopy_eff: ["🌲", "Real shade", "Shade from trees that are actually alive and healthy."],
  cooling: ["❄️", "Cooler streets", "Promised drop in daytime air temperature."],
  survival: ["✅", "Trees alive", "Share of trees still alive after 10 years."],
  water_use: ["🚿", "Water used", "Irrigation water used per hectare per year."],
  cost: ["💰", "Cost", "Water plus maintenance per year."],
  nocturnal: ["🌙", "Night heat trapped", "Thick canopy may hold heat in at night (not in the model)."],
  ventilation: ["🍃", "Street breeze", "Dense crowns may block wind (not in the model)."],
  local_humidity: ["😓", "Muggier air", "Watering may make the air more humid (not in the model)."],
  socioeconomic: ["🏘️", "Neighbourhood wealth", "Richer areas often have more trees AND more care (not in the model)."],
  impervious: ["🧱", "Concrete & asphalt", "Hard surfaces change how much trees cool (not in the model)."],
};

const COLUMNS: { title: string; emoji: string; keys: (n: StoryNode) => boolean }[] = [
  { title: "Nature & place", emoji: "🌍", keys: (n) => n.kind === "environment" },
  { title: "The city's choices", emoji: "🏙️", keys: (n) => n.kind === "intervention" },
  { title: "Water", emoji: "💧", keys: (n) => ["et0", "etl", "peff", "irrigation", "soil", "local_humidity"].includes(n.key) },
  { title: "Trees", emoji: "🌳", keys: (n) => ["stress", "transp", "mortality", "canopy_eff", "nocturnal", "ventilation"].includes(n.key) },
  { title: "Results promised", emoji: "🎯", keys: (n) => n.kind === "outcome" },
];

const STORIES = [
  { title: "🔥 A hotter summer", start: "more", path: ["warming", "et0", "etl", "soil", "stress", "mortality", "survival"] },
  { title: "🚰 The water doesn't arrive", start: "less", path: ["supply", "irrigation", "soil", "stress", "mortality", "survival", "canopy_eff", "cooling"] },
  { title: "🌳 Why trees cool streets", start: "more", path: ["canopy", "canopy_eff", "cooling"] },
  { title: "🍃 Picking tougher trees", start: "less", path: ["species", "etl", "soil", "stress", "mortality", "survival"] },
];

const name = (k: string, nodes: StoryNode[]) => FRIENDLY[k]?.[1] || nodes.find((n) => n.key === k)?.label || k;
const flip = (w: string) => (w === "more" ? "less" : "more");

export function CausalStory({ nodes, edges }: { nodes: StoryNode[]; edges: StoryEdge[] }) {
  const box = useRef<HTMLDivElement>(null);
  const cards = useRef<Record<string, HTMLButtonElement | null>>({});
  const [rects, setRects] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [story, setStory] = useState<number | null>(null);
  const [step, setStep] = useState(0);

  const measure = useCallback(() => {
    const el0 = box.current;
    const b = el0?.getBoundingClientRect();
    if (!el0 || !b) return;
    const r: typeof rects = {};
    Object.entries(cards.current).forEach(([k, el]) => {
      if (!el) return;
      const e = el.getBoundingClientRect();
      r[k] = { x: e.left - b.left + el0.scrollLeft, y: e.top - b.top + el0.scrollTop, w: e.width, h: e.height };
    });
    setRects(r);
  }, []);
  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [measure, nodes]);

  // story playback
  useEffect(() => {
    if (story === null) return;
    if (step >= STORIES[story].path.length - 1) return;
    const t = setTimeout(() => setStep((s) => s + 1), 1500);
    return () => clearTimeout(t);
  }, [story, step]);

  const focus = hover || sel;
  const { up, down } = useMemo(() => {
    const up = new Set<string>(), down = new Set<string>();
    if (!focus) return { up, down };
    const walk = (k: string, dir: "up" | "down", seen: Set<string>) => {
      edges.forEach((e) => {
        const [from, to] = dir === "down" ? [e.source, e.target] : [e.target, e.source];
        if (from === k && !seen.has(to)) {
          seen.add(to);
          walk(to, dir, seen);
        }
      });
    };
    walk(focus, "down", down);
    walk(focus, "up", up);
    return { up, down };
  }, [focus, edges]);

  const storyPath = story !== null ? STORIES[story].path.slice(0, step + 1) : null;
  const storyEdges = new Set<string>();
  if (storyPath) for (let i = 1; i < storyPath.length; i++) { const e = edges.find((x) => x.source === storyPath[i - 1] && x.target === storyPath[i]); if (e) storyEdges.add(e.id); }

  const lit = (k: string) => (storyPath ? storyPath.includes(k) : !focus || k === focus || up.has(k) || down.has(k));
  // downstream edges start at the focus (or below it); upstream edges end at the focus (or above it)
  const edgeOn = (e: StoryEdge) => {
    if (storyPath) return storyEdges.has(e.id);
    if (!focus) return false;
    const downstream = (e.source === focus || down.has(e.source)) && down.has(e.target);
    const upstream = (e.target === focus || up.has(e.target)) && up.has(e.source);
    return downstream || upstream;
  };

  // sentences for the story so far
  const sentences: string[] = [];
  if (story !== null && storyPath) {
    let w = STORIES[story].start;
    for (let i = 1; i < storyPath.length; i++) {
      const e = edges.find((x) => x.source === storyPath[i - 1] && x.target === storyPath[i]);
      const next = e?.sign === "-" ? flip(w) : w;
      sentences.push(`${w} ${name(storyPath[i - 1], nodes).toLowerCase()} → ${next} ${name(storyPath[i], nodes).toLowerCase()}`);
      w = next;
    }
  }

  const focusNode = focus ? nodes.find((n) => n.key === focus) : null;
  const pushes = focus ? edges.filter((e) => e.source === focus) : [];
  const pushedBy = focus ? edges.filter((e) => e.target === focus) : [];

  return (
    <div className="space-y-4">
      {/* stories */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-white/55">Play a story:</span>
        {STORIES.map((s, i) => (
          <button key={s.title} onClick={() => { setSel(null); setStory(i); setStep(0); }} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13.5px] transition-colors", story === i ? "border-[#ff5b2e] bg-[#ff5b2e]/15 text-white" : "border-white/12 bg-white/[0.04] text-white/75 hover:bg-white/[0.08]")}>
            <Play className="h-3 w-3" /> {s.title}
          </button>
        ))}
        {(story !== null || sel) && <button onClick={() => { setStory(null); setSel(null); }} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] text-white/55 hover:text-white"><RotateCcw className="h-3.5 w-3.5" /> Show everything</button>}
      </div>

      <div ref={box} className="relative overflow-x-auto rounded-2xl border border-white/10 bg-black/30 p-4">
        <style>{`@keyframes bf-flow { to { stroke-dashoffset: -24; } }`}</style>
        <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ minWidth: 980 }}>
          <defs>
            {["#3ee6a8", "#ff6b5b", "#ffffff"].map((c) => (
              <marker key={c} id={`ar-${c.slice(1)}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={c} /></marker>
            ))}
          </defs>
          {edges.map((e) => {
            const a = rects[e.source], b = rects[e.target];
            if (!a || !b) return null;
            const on = edgeOn(e);
            const quiet = !on && (focus || storyPath);
            const fwd = b.x > a.x + a.w / 2;
            const x1 = fwd ? a.x + a.w : a.x + a.w / 2, y1 = fwd ? a.y + a.h / 2 : a.y + a.h;
            const x2 = fwd ? b.x : b.x + b.w / 2, y2 = fwd ? b.y + b.h / 2 : b.y;
            const dx = Math.max(40, (x2 - x1) / 2);
            const d = fwd ? `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}` : `M${x1},${y1} C${x1},${y1 + 40} ${x2},${y2 - 40} ${x2},${y2}`;
            const color = on ? (e.sign === "-" ? "#ff6b5b" : "#3ee6a8") : "#ffffff";
            return (
              <path key={e.id} d={d} fill="none" stroke={color} strokeOpacity={on ? 0.95 : quiet ? 0.04 : 0.13} strokeWidth={on ? 2.4 : 1.2}
                strokeDasharray={on ? "8 4" : e.basis === "assumption" || e.basis === "hypothesis" ? "4 4" : undefined}
                style={on ? { animation: "bf-flow 0.8s linear infinite" } : undefined} markerEnd={on ? `url(#ar-${color.slice(1)})` : undefined} />
            );
          })}
        </svg>
        <div className="relative grid grid-cols-5 gap-5" style={{ minWidth: 950 }}>
          {COLUMNS.map((col) => (
            <div key={col.title} className="flex flex-col gap-2.5">
              <div className="mb-1 text-center text-[12.5px] font-semibold uppercase tracking-[0.12em] text-white/50">{col.emoji} {col.title}</div>
              <div className="flex flex-1 flex-col justify-center gap-2.5">
                {nodes.filter(col.keys).map((n) => {
                  const f = FRIENDLY[n.key];
                  const on = lit(n.key);
                  const isFocus = n.key === focus || (storyPath && storyPath[storyPath.length - 1] === n.key);
                  return (
                    <motion.button key={n.key} ref={(el) => { cards.current[n.key] = el; }} layout
                      onClick={() => { setStory(null); setSel(sel === n.key ? null : n.key); }}
                      onMouseEnter={() => !storyPath && setHover(n.key)} onMouseLeave={() => setHover(null)}
                      animate={{ opacity: on ? 1 : 0.22, scale: isFocus ? 1.04 : 1 }} transition={{ duration: 0.25 }}
                      className={cn("relative z-10 flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left", isFocus ? "border-[#ff5b2e] bg-[#1d1410]" : "border-white/10 bg-[#11151c] hover:border-white/30", n.kind === "outcome" && "border-[#3ee6a8]/40")}>
                      <span className="text-[20px] leading-none">{f?.[0] || "•"}</span>
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-medium leading-tight text-white">{f?.[1] || n.label}</span>
                        {n.key in FRIENDLY && ["nocturnal", "ventilation", "local_humidity", "socioeconomic", "impervious"].includes(n.key) && <span className="block text-[11px] text-[#f5b84a]">idea · not in model</span>}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* explanation */}
      <AnimatePresence mode="wait">
        {story !== null ? (
          <motion.div key={`s${story}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-[17px] font-semibold text-white">{STORIES[story].title}</div>
            <ol className="mt-3 space-y-1.5">
              {sentences.map((t, i) => (
                <motion.li key={t} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2.5 text-[15px] text-white/85">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-white/10 font-mono text-[11.5px]">{i + 1}</span>
                  <span className="first-letter:uppercase">{t}</span>
                </motion.li>
              ))}
            </ol>
            {step >= STORIES[story].path.length - 1 && <div className="mt-3 text-[13px] text-white/50">The simulator computes every one of these links each day for 10 years — that is how BACKFIRE finds where the promise breaks.</div>}
          </motion.div>
        ) : focusNode ? (
          <motion.div key={focusNode.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid grid-cols-1 gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:grid-cols-[1.1fr_1fr_1fr]">
            <div>
              <div className="text-[28px]">{FRIENDLY[focusNode.key]?.[0]}</div>
              <div className="mt-1 text-[19px] font-semibold text-white">{name(focusNode.key, nodes)}</div>
              <p className="mt-1 text-[14px] text-white/70">{FRIENDLY[focusNode.key]?.[2] || focusNode.description}</p>
              <p className="mt-2 font-mono text-[11.5px] text-white/35">{focusNode.label} · {focusNode.description}</p>
            </div>
            <Links title="It pushes" list={pushes.map((e) => ({ e, other: e.target }))} nodes={nodes} focus={focusNode.key} dir="out" />
            <Links title="It is pushed by" list={pushedBy.map((e) => ({ e, other: e.source }))} nodes={nodes} focus={focusNode.key} dir="in" />
          </motion.div>
        ) : (
          <motion.div key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-2xl border border-dashed border-white/15 p-4 text-center text-[14px] text-white/55">
            👆 Tap any card to see what it changes, or play a story. Read left to right: nature and the city&apos;s choices change the water, water changes the trees, trees change the results.
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-white/50">
        <span><span className="text-[#3ee6a8]">━</span> more → more</span>
        <span><span className="text-[#ff6b5b]">━</span> more → less</span>
        <span>┄ dashed = an assumption, not a law of physics</span>
      </div>
    </div>
  );
}

function Links({ title, list, nodes, focus, dir }: { title: string; list: { e: StoryEdge; other: string }[]; nodes: StoryNode[]; focus: string; dir: "in" | "out" }) {
  return (
    <div>
      <div className="mb-2 text-[12.5px] font-medium uppercase tracking-[0.12em] text-white/45">{title}</div>
      {list.length === 0 && <div className="text-[13.5px] text-white/40">Nothing — {dir === "in" ? "it is an input." : "it is a final result."}</div>}
      <ul className="space-y-1.5">
        {list.map(({ e, other }) => {
          const [a, b] = dir === "out" ? [focus, other] : [other, focus];
          return (
            <li key={e.id} className="text-[13.5px] leading-snug text-white/80">
              <span className={e.sign === "-" ? "text-[#ff8a7a]" : "text-[#3ee6a8]"}>●</span> More {name(a, nodes).toLowerCase()} → {e.sign === "-" ? "less" : "more"} {name(b, nodes).toLowerCase()}
              <span className="ml-1 text-[11.5px] text-white/35">({e.basis === "equation" ? "physics" : e.basis})</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
