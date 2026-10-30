#!/usr/bin/env node
/**
 * Records BACKFIRE's films to MP4.
 *
 *   cd frontend && npm run record:videos            # all videos
 *   cd frontend && npm run record:videos -- 01 04   # only some (by number prefix)
 *
 * Needs the site running (default http://localhost:3000, override with BASE_URL) with the backend up.
 * Signs in with the "Demo login" button (no password is typed), opens each film page with ?record=1,
 * captures every frame with Chrome's screencast until the page sets window.__filmDone, then encodes H.264 MP4 with ffmpeg
 * (system ffmpeg if present, otherwise the npm package ffmpeg-static).
 *
 * Env: BASE_URL, VIDEO_SIZE=720|1080 (default 720), HEADED=1 (show the browser), BROWSER_CHANNEL=chrome|msedge.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "frontend", "package.json"));
const { chromium } = require("playwright");

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const SIZE = process.env.VIDEO_SIZE === "1080" ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
const OUT = path.join(ROOT, "videos");
const TMP = path.join(OUT, ".raw");
const FRAMES = path.join(OUT, "frames");
const only = process.argv.slice(2);

const VIDEOS = [
  { n: "02", file: "02-backend-architecture-tour.mp4", url: "/films/architecture", expect: 82, what: "Guided 12-step tour of the backend on the 3D architecture map: browser → Next.js → FastAPI → job runner → LangGraph conductor → 8 agents → science engine, database, outside services → back to you." },
  { n: "03", file: "03-simulation-film-new-delhi.mp4", url: "/films/simulation", expect: 103, what: "The demo investigation's 3D simulation film for New Delhi: as planned → the smallest breaking change → a safer design, 10 simulated years per scene." },
  { n: "04", file: "04-desert-city-preview.mp4", url: "/films/preview?city=riyadh", expect: 70, biomes: ["desert"], cities: ["riyadh"], what: "Lab preview in desert staging (palms, dunes, flat roofs): the plan, then a labelled hotter-and-drier what-if." },
  { n: "05", file: "05-mediterranean-city-preview.mp4", url: "/films/preview?city=madrid", expect: 70, biomes: ["mediterranean"], cities: ["madrid"], what: "Lab preview in Mediterranean staging (terracotta roofs, olives and cypresses)." },
  { n: "06", file: "06-monsoon-or-humid-city-preview.mp4", url: "/films/preview?city=nairobi", expect: 70, biomes: ["monsoon", "humid"], cities: ["nairobi", "mumbai"], what: "Lab preview in monsoon / humid staging (lush broadleaf trees, heavy seasonal rain)." },
  { n: "10", file: "10-full-workflow-motion.mp4", url: "/films/motion", expect: 150, what: "Motion-graphics film of the whole workflow, from a written promise to the signed certificate." },
  { n: "08", file: "08-where-the-ai-is-used.mp4", url: "/films/ai", expect: 75, what: "The six places AI is used, each as a live demo: input → AI → output → safety check (reading proposals, building scenarios, Copilot answers, film narration, the breaking-point search, the multi-agent conductor)." },
  { n: "07", file: "07-benchmark-race.mp4", url: "/films/race", expect: 84, what: "The benchmark race on all three practice courses (Straight Cliff, Hidden Pit, The Decoy); each explorer replays its method's real search trace." },
];

/* ------------------------------------------------------------------ ffmpeg */
function findFfmpeg() {
  const sys = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (sys.status === 0) return "ffmpeg";
  try {
    const p = require("ffmpeg-static");
    if (p && fs.existsSync(p)) return p;
  } catch { /* not installed */ }
  console.error("ffmpeg was not found. Install it system-wide, or run:  cd frontend && npm i -D ffmpeg-static");
  process.exit(1);
}
const FFMPEG = findFfmpeg();
const ff = (args) => {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
};
function probeDuration(file) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", file], { encoding: "utf8" });
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(r.stderr || "");
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/* ------------------------------------------------------------------ browser */
const SEED_SCRIPT = `(() => {
  if (!location.search.includes("record=1")) return;
  let seed = 1234567;
  Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
})();`;

async function launch() {
  return chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chrome",
    headless: !process.env.HEADED,
    args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=d3d11", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
}

async function demoLogin(browser) {
  const ctx = await browser.newContext({ viewport: SIZE });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /demo/i }).first().click();
  await page.waitForURL(/\/(dashboard|lab|investigations)/, { timeout: 30000 });
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

/**
 * Records one film with Chrome's own screencast (DevTools protocol): every rendered frame arrives
 * as a JPEG with a timestamp, so no extra recorder download is needed and timing is exact.
 */
async function recordOne(browser, state, v, url) {
  const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, storageState: state });
  await ctx.addInitScript(SEED_SCRIPT);
  const page = await ctx.newPage();
  await page.goto(`${BASE}${url}${url.includes("?") ? "&" : "?"}record=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__filmStarted === "number", null, { timeout: 90000, polling: 50 });
  const biome = await page.evaluate(() => window.__biome || null);
  if (v.biomes && !v.biomes.includes(biome)) {
    await ctx.close();
    return { skipped: biome };
  }
  const dir = fs.mkdtempSync(path.join(TMP, `${v.n}-`));
  const frames = [];
  const cdp = await ctx.newCDPSession(page);
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const f = path.join(dir, `f${String(frames.length).padStart(6, "0")}.jpg`);
    fs.writeFileSync(f, Buffer.from(data, "base64"));
    frames.push({ f, t: metadata.timestamp });
    try { await cdp.send("Page.screencastFrameAck", { sessionId }); } catch { /* page closing */ }
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 });
  const t0 = Date.now();
  await page.waitForFunction(() => window.__filmDone === true, null, { timeout: (v.expect + 120) * 1000, polling: 500 });
  await page.waitForTimeout(1200);
  const played = (Date.now() - t0) / 1000;
  await cdp.send("Page.stopScreencast").catch(() => undefined);
  await ctx.close();
  return { dir, frames, played, biome };
}

/** Frames with wall-clock timestamps -> constant 30 fps H.264 MP4. */
function encode(frames, dir, out) {
  if (frames.length < 2) throw new Error("no frames captured");
  const list = path.join(dir, "list.txt");
  const rows = [];
  for (let i = 0; i < frames.length; i++) {
    const d = i + 1 < frames.length ? Math.max(0.001, frames[i + 1].t - frames[i].t) : 1 / 30;
    rows.push(`file '${frames[i].f.replace(/\\/g, "/")}'`, `duration ${d.toFixed(4)}`);
  }
  rows.push(`file '${frames[frames.length - 1].f.replace(/\\/g, "/")}'`);
  fs.writeFileSync(list, rows.join("\n"));
  ff(["-y", "-f", "concat", "-safe", "0", "-i", list,
    "-vf", `fps=30,scale=${SIZE.width}:${SIZE.height}:force_original_aspect_ratio=decrease,pad=${SIZE.width}:${SIZE.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-movflags", "+faststart", "-an", out]);
}

/* ------------------------------------------------------------------ facts for the README */
async function facts(browser, state) {
  const ctx = await browser.newContext({ storageState: state });
  const get = async (p) => (await ctx.request.get(`${BASE}/api${p}`)).json();
  const post = async (p, body) => (await ctx.request.post(`${BASE}/api${p}`, { data: body, headers: { "X-Requested-With": "backfire" } })).json();
  const out = { showcase: await get("/public/showcase"), film: await get("/public/film"), race: {}, previews: {} };
  for (const c of ["straight", "pit", "decoy"]) out.race[c] = await get(`/benchmarks/race?course=${c}`);
  const CITY = { riyadh: [24.7136, 46.6753, 0.7, 0.6, "Riyadh"], madrid: [40.4168, -3.7038, 0.6, 0.7, "Madrid"], nairobi: [-1.2921, 36.8219, 0.8, 0.65, "Nairobi"], mumbai: [19.076, 72.8777, 0.6, 0.75, "Mumbai"] };
  for (const [k, [lat, lon, cool, surv, name]] of Object.entries(CITY))
    out.previews[k] = await post("/scenario/preview", { title: name, location_name: name, latitude: lat, longitude: lon,
      objectives: [{ metric: "cooling_c", operator: ">=", threshold: cool }, { metric: "survival_rate", operator: ">=", threshold: surv }] });
  await ctx.close();
  return out;
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
function numbersFor(v, F, city) {
  const f = F.showcase.featured || {};
  const a = f.agents || {};
  if (v.n === "01") return [`claims: cooling ≥ ${f.criteria?.find((c) => c.metric === "cooling_c")?.threshold} °C, survival ≥ ${pct(f.criteria?.find((c) => c.metric === "survival_rate")?.threshold ?? 0)}`,
    `NASA POWER: ${a.climate?.annual_rain_mm} mm rain/yr, hottest ${a.climate?.hottest_month} ${a.climate?.hottest_tmax_c} °C; ${a.evidence?.sources} evidence sources`,
    `as planned: ${pct(F.film.scenes?.[0]?.metrics.survival_rate ?? 0)} trees alive, ${F.film.scenes?.[0]?.metrics.cooling_c.toFixed(2)} °C cooling`,
    `Sobol: ${(a.sensitivity || []).map((s) => `${s.parameter} ${s.index}`).join(", ")}`,
    `${a.optimisation?.evaluations} simulations, d* = ${f.best?.distance?.toFixed(2)}; verified ${a.verification?.verified}/${a.verification?.checked}; fails in ${pct(f.failure_probability ?? 0)} of plausible futures`];
  if (v.n === "08") return ["claim: cooling ≥ 0.5 °C, survival ≥ 50% (demo proposal)", "breaking change d* = 0.29: drought mortality sensitivity 0.15 → 0.19, baseline mortality 0.040 → 0.045", `breaking-change scene: ${pct(F.film.scenes?.[1]?.metrics.survival_rate ?? 0)} trees alive, ${F.film.scenes?.[1]?.metrics.cooling_c.toFixed(2)} °C`, `${a.optimisation?.evaluations} simulations, verified ${a.verification?.verified}/${a.verification?.checked}, fails in ${pct(f.failure_probability ?? 0)} of plausible futures`];
  if (v.n === "10") return ["see the film: workflow stages with the demo investigation's numbers"];
  if (v.n === "09") return ["see the film: workflow stages with the demo investigation's numbers"];
  if (v.n === "02") return ["no computed numbers — architecture tour (component names and file paths are real)"];
  if (v.n === "03") return F.film.scenes.map((s) => `${s.title}: ${pct(s.metrics.survival_rate)} trees alive, ${s.metrics.cooling_c.toFixed(2)} °C cooling, ${s.success ? "promise kept" : `promise broken${s.break_year !== null ? ` in year ${s.break_year}` : ""}`}`);
  if (["04", "05", "06"].includes(v.n)) {
    const p = F.previews[city];
    return [`site climate (${p.climate_source.split(" (")[0]}): ${p.biome.annual_rain_mm} mm rain/yr, hottest month ${p.biome.hottest_tmax_c} °C → ${p.biome.label}`,
      ...p.scenes.map((s) => `${s.title}: ${pct(s.metrics.survival_rate)} trees alive, ${s.metrics.cooling_c.toFixed(2)} °C cooling (${s.success ? "holds" : "fails"})`)];
  }
  if (v.n === "07") return Object.entries(F.race).map(([c, d]) => `${c}: budget ${d.budget} tries per method, true closest failure at distance ${d.true_distance.toFixed(3)}; ` +
    d.racers.map((r) => `${r.method} ${r.best_distance === null ? "no failure found" : `${(((r.best_distance - d.true_distance) / d.true_distance) * 100).toFixed(0)}% off`}`).join(", "));
  return [];
}

/* ------------------------------------------------------------------ main */
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(FRAMES, { recursive: true });
const browser = await launch();
console.log(`Recording at ${SIZE.width}x${SIZE.height} from ${BASE} (ffmpeg: ${FFMPEG === "ffmpeg" ? "system" : "ffmpeg-static"})`);
const state = await demoLogin(browser);
console.log("Signed in with the demo account.");
const F = await facts(browser, state);
const rows = [];
for (const v of VIDEOS) {
  if (only.length && !only.includes(v.n)) continue;
  let res = null, city = v.cities?.[0];
  for (const c of v.cities || [null]) {
    const url = c ? `/films/preview?city=${c}` : v.url;
    process.stdout.write(`● ${v.file} ← ${url} … `);
    try {
      res = await recordOne(browser, state, v, url);
    } catch (e) {
      console.log(`failed: ${String(e.message || e).split("\n")[0]}`);
      res = null;
      break;
    }
    if (!res.skipped) { city = c; break; }
    console.log(`biome was ${res.skipped}, trying the next city`);
  }
  if (!res) continue;
  if (res.skipped) { console.log("skipped (no city with the wanted biome)"); continue; }
  const out = path.join(OUT, v.file);
  encode(res.frames, res.dir, out);
  fs.rmSync(res.dir, { recursive: true, force: true });
  const dur = probeDuration(out);
  const frame = path.join(FRAMES, v.file.replace(".mp4", ".jpg"));
  ff(["-y", "-ss", (dur * 0.55).toFixed(2), "-i", out, "-frames:v", "1", "-q:v", "3", frame]);
  const mb = fs.statSync(out).size / 1e6;
  console.log(`${dur?.toFixed(1)} s, ${mb.toFixed(1)} MB${res.biome ? `, biome ${res.biome}` : ""}`);
  rows.push({ v, dur, mb, city, biome: res.biome, numbers: numbersFor(v, F, city) });
}
await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });

/* README: a manifest keeps rows of videos not re-recorded this time */
const readme = path.join(OUT, "README.md");
const manifestPath = path.join(OUT, "manifest.json");
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};
for (const r of rows) manifest[r.v.file] = { dur: r.dur, mb: r.mb, what: r.v.what, city: r.city || null, biome: r.biome || null, numbers: r.numbers };
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const all = Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)).map(([file, m]) => ({ ...m, v: { file, what: m.what } }));
const lines = [
  "# BACKFIRE videos",
  "",
  `Recorded from the running site with \`npm run record:videos\` (in \`frontend/\`) on ${new Date().toISOString().slice(0, 10)} at ${SIZE.width}×${SIZE.height}, H.264 MP4, 30 fps.`,
  "Every number shown in a video is computed by BACKFIRE (demo investigation or the live model); buildings, tree shapes and hills are illustration.",
  "The same films play on the site: home page (engine film), /how-it-works, /architecture, the investigation \"Simulation film\" tab, the Lab preview and /benchmarks.",
  "",
  "| File | Length | Size | What it shows |",
  "|---|---|---|---|",
  ...all.map((r) => `| [${r.v.file}](${r.v.file}) | ${Math.floor(r.dur / 60)}:${String(Math.round(r.dur % 60)).padStart(2, "0")} | ${r.mb.toFixed(1)} MB | ${r.v.what}${r.city ? ` City: ${r.city}${r.biome ? ` (${r.biome})` : ""}.` : ""} |`),
  "",
  "## Real numbers in each video",
  "",
  ...all.flatMap((r) => [`### ${r.v.file}`, "", ...r.numbers.map((x) => `- ${x}`), "", `Still frame: [frames/${r.v.file.replace(".mp4", ".jpg")}](frames/${r.v.file.replace(".mp4", ".jpg")})`, ""]),
  "## Re-recording",
  "",
  "```bash",
  "# site on http://localhost:3000 and API on :8000 must be running",
  "cd frontend",
  "npm run record:videos            # all seven",
  "npm run record:videos -- 03 07   # just some",
  "VIDEO_SIZE=1080 npm run record:videos   # 1920x1080",
  "```",
  "",
  "Each film page also works in a normal browser: `/films/engine`, `/films/architecture`, `/films/simulation`, `/films/preview?city=riyadh|madrid|nairobi|mumbai`, `/films/race`. Add `?record=1` for the clean full-screen recording view.",
  "",
];
fs.writeFileSync(readme, lines.join("\n"));
console.log(`Done. ${rows.length} video(s) in ${OUT}`);
