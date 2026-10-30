#!/usr/bin/env node
/**
 * Builds videos/00-backfire-master-cut.mp4: one edited film that alternates animated chapter
 * cards (drawn here in the site's own style) with excerpts of the films
 * recorded from the site (videos/03, 07, 08 and the motion-graphics workflow film 10). Every segment is normalised to 1280×720 at 30 fps,
 * titled, and joined with cross-fades. Run after `npm run record:videos`:
 *
 *   node scripts/stitch-master.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const V = (f) => path.join(ROOT, "videos", f);
const TMP = path.join(ROOT, "videos", ".stitch");
const OUT = V("00-backfire-master-cut.mp4");
const XF = 0.6; // cross-fade seconds

const FONT_B = "C\\:/Windows/Fonts/seguisb.ttf";
const FONT_R = "C\\:/Windows/Fonts/segoeui.ttf";
const ffmpeg = process.env.FFMPEG || "ffmpeg";
const run = (args) => {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
};
const dur = (f) => {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-i", f], { encoding: "utf8" });
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(r.stderr || "");
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
};
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%");

/** Title overlay for a Flow interstitial: small orange kicker + big headline, with a soft dark band. */
const titles = (kicker, title, sub) => [
  "drawbox=x=0:y=ih*0.62:w=iw:h=ih*0.38:color=black@0.45:t=fill",
  `drawtext=fontfile='${FONT_B}':text='${esc(kicker)}':fontcolor=0xff7a4d:fontsize=22:x=80:y=h*0.68:alpha='min(1,max(0,(t-0.3)/0.5))'`,
  `drawtext=fontfile='${FONT_B}':text='${esc(title)}':fontcolor=white:fontsize=50:x=80:y=h*0.68+38:alpha='min(1,max(0,(t-0.5)/0.6))'`,
  sub ? `drawtext=fontfile='${FONT_R}':text='${esc(sub)}':fontcolor=white@0.7:fontsize=24:x=80:y=h*0.68+104:alpha='min(1,max(0,(t-0.8)/0.6))'` : null,
].filter(Boolean).join(",");


/** Animated chapter card in the site's style (no external footage). */
const card = (kicker, title, sub, len = 4.5) => ({ card: true, len, kicker, title, sub });
const cardFilter = (c) => [
  `geq=r='7+18*exp(-((X-W*(0.3+0.4*T/${c.len}))^2+(Y-H*0.35)^2)/90000)':g='9+10*exp(-((X-W*(0.3+0.4*T/${c.len}))^2+(Y-H*0.35)^2)/90000)':b='13+8*exp(-((X-W*(0.3+0.4*T/${c.len}))^2+(Y-H*0.35)^2)/90000)'`,
  `drawbox=x=120:y=300:w='min(1,max(0,(t-0.2)/0.6))*160':h=4:color=0xff5b2e:t=fill`,
  `drawtext=fontfile='${FONT_B}':text='${esc(c.kicker)}':fontcolor=0xff7a4d:fontsize=24:x=120:y=250:alpha='min(1,max(0,(t-0.3)/0.5))'`,
  `drawtext=fontfile='${FONT_B}':text='${esc(c.title)}':fontcolor=white:fontsize=60:x='120+20*(1-min(1,max(0,(t-0.5)/0.6)))':y=330:alpha='min(1,max(0,(t-0.5)/0.6))'`,
  c.sub ? `drawtext=fontfile='${FONT_R}':text='${esc(c.sub)}':fontcolor=white@0.65:fontsize=28:x=120:y=420:alpha='min(1,max(0,(t-0.9)/0.6))'` : null,
  `drawtext=fontfile='${FONT_B}':text='BACKFIRE AI':fontcolor=white@0.5:fontsize=18:x=120:y=80`,
].filter(Boolean).join(",");

const MOTION = V("10-full-workflow-motion.mp4");
const SEGMENTS = [
  card("BACKFIRE AI", "Every climate promise has a breaking point", "We find it before the climate does.", 5),
  card("Stages 1-3", "From a promise to a simulation", "The promise as numbers, real climate, ten years day by day."),
  { src: MOTION, from: 5, len: 30 },
  card("Stage 3 in 3D", "The same city, three futures", "As planned, the breaking change, and a safer design."),
  { src: V("03-simulation-film-new-delhi.mp4"), from: 8, len: 22 },
  { src: V("03-simulation-film-new-delhi.mp4"), from: 45, len: 22 },
  card("Eight AI agents", "One rule. No number without proof.", "Language models read and write; the engine computes."),
  { src: V("08-where-the-ai-is-used.mp4"), from: 4, len: 24 },
  card("Stages 4-6", "Hunting the breaking point", "Four methods, the same budget. Every result re-computed."),
  { src: V("07-benchmark-race.mp4"), from: 2, len: 22 },
  { src: MOTION, from: 42, len: 23 },
  card("Stages 7-8", "Safer by design, signed and verifiable", "Same harsh future, a better plan, a certificate anyone can re-check."),
  { src: V("03-simulation-film-new-delhi.mp4"), from: 78, len: 22 },
  { src: MOTION, from: 65, len: 13 },
];

fs.mkdirSync(TMP, { recursive: true });
const parts = [];
for (const [i, s] of SEGMENTS.entries()) {
  const out = path.join(TMP, `p${String(i).padStart(2, "0")}.mp4`);
  if (s.card) {
    run(["-f", "lavfi", "-i", `color=c=0x07090d:s=1280x720:r=30:d=${s.len}`, "-vf", `format=yuv420p,${cardFilter(s)},format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "18", out]);
    parts.push({ out, len: dur(out) });
    process.stdout.write(`segment ${i + 1}/${SEGMENTS.length} card ${s.len}s\n`);
    continue;
  }
  if (!fs.existsSync(s.src)) throw new Error(`missing ${s.src}`);
  const len = Math.min(s.len, Math.max(1, dur(s.src) - s.from - 0.05));
  const base = "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1";
  run(["-ss", String(s.from), "-t", len.toFixed(2), "-i", s.src, "-an", "-vf", s.vf ? `${base},${s.vf}` : base, "-c:v", "libx264", "-preset", "medium", "-crf", "18", out]);
  parts.push({ out, len: dur(out) });
  process.stdout.write(`segment ${i + 1}/${SEGMENTS.length} ${len.toFixed(1)}s\n`);
}

// cross-fade chain
const inputs = parts.flatMap((p) => ["-i", p.out]);
let chain = "", last = "[0:v]", t = parts[0].len;
for (let k = 1; k < parts.length; k++) {
  const label = k === parts.length - 1 ? "[x]" : `[v${k}]`;
  chain += `${last}[${k}:v]xfade=transition=fade:duration=${XF}:offset=${(t - XF).toFixed(3)}${label};`;
  last = label;
  t += parts[k].len - XF;
}
chain += `[x]fade=t=in:st=0:d=0.8,fade=t=out:st=${(t - 1.2).toFixed(2)}:d=1.2[out]`;
run([...inputs, "-filter_complex", chain, "-map", "[out]", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", OUT]);
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`Done: ${OUT} (${dur(OUT).toFixed(1)} s, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
