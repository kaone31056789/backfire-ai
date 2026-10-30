#!/usr/bin/env node
/**
 * Records real product walkthroughs: Google Chrome is driven through the live site (clicks, typing,
 * scrolling) with a visible cursor, click ripples and on-screen captions, then encoded to MP4.
 *
 *   cd frontend && npm run record:walkthroughs            # all
 *   cd frontend && npm run record:walkthroughs -- 11 12   # only some
 *
 * Needs the site (default http://localhost:3000, BASE_URL to override) and the API running.
 * Signs in with the "Demo login" button. Env: WALK_SIZE=720|1080 (default 1080), HEADED=1.
 * Note: walkthrough 12 presses "Run the simulation", which creates one new investigation per recording.
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
const SIZE = process.env.WALK_SIZE === "720" ? { width: 1280, height: 720 } : { width: 1920, height: 1080 };
const OUT = path.join(ROOT, "videos", "walkthroughs");
const TMP = path.join(OUT, ".raw");
const FRAMES = path.join(OUT, "frames");
const only = process.argv.slice(2);

/* ------------------------------------------------------------------ ffmpeg */
function findFfmpeg() {
  if (spawnSync("ffmpeg", ["-version"]).status === 0) return "ffmpeg";
  try { const p = require("ffmpeg-static"); if (p && fs.existsSync(p)) return p; } catch { /* not installed */ }
  console.error("ffmpeg was not found. Install it system-wide, or run:  cd frontend && npm i -D ffmpeg-static");
  process.exit(1);
}
const FFMPEG = findFfmpeg();
const ff = (args) => {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
};
const probe = (file) => {
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(spawnSync(FFMPEG, ["-hide_banner", "-i", file], { encoding: "utf8" }).stderr || "");
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
};

/* ------------------------------------------------------------------ on-screen cursor, ripples, captions */
const OVERLAY = `(() => {
  const boot = () => {
    if (document.getElementById("bf-cursor")) return;
    const st = document.createElement("style");
    st.textContent = \`
      #bf-cursor{position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:transform .7s cubic-bezier(.22,1,.36,1);filter:drop-shadow(0 2px 6px rgba(0,0,0,.6))}
      .bf-ripple{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #ff5b2e;z-index:2147483646;pointer-events:none;animation:bfr .6s ease-out forwards}
      @keyframes bfr{to{transform:scale(4);opacity:0}}
      #bf-cap{position:fixed;left:50%;bottom:44px;transform:translate(-50%,20px);opacity:0;transition:all .45s ease;z-index:2147483645;pointer-events:none;max-width:72vw;
        background:rgba(8,10,16,.88);color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:18px;padding:14px 22px;font:500 22px/1.4 system-ui,sans-serif;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)}
      #bf-cap b{color:#ff8a5b}
      #bf-title{position:fixed;inset:0;display:grid;place-items:center;background:radial-gradient(ellipse at center,#141a28,#05070c 75%);z-index:2147483644;opacity:0;transition:opacity .6s;pointer-events:none;color:#fff;text-align:center;font-family:system-ui,sans-serif}
      #bf-title .k{font:600 16px system-ui;letter-spacing:.3em;text-transform:uppercase;color:#ff7a4d}
      #bf-title .t{font:700 64px/1.1 system-ui;letter-spacing:-.03em;margin-top:14px}
      #bf-title .s{font:400 24px system-ui;color:rgba(255,255,255,.7);margin-top:12px}\`;
    document.head.appendChild(st);
    const c = document.createElement("div");
    c.id = "bf-cursor";
    c.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M4 2l16 9-7 2-3 7z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const cap = document.createElement("div"); cap.id = "bf-cap"; document.body.appendChild(cap);
    const t = document.createElement("div"); t.id = "bf-title"; document.body.appendChild(t);
  };
  window.__bfMove = (x, y) => { boot(); document.getElementById("bf-cursor").style.transform = "translate(" + (x - 4) + "px," + (y - 2) + "px)"; };
  window.__bfRipple = (x, y) => { boot(); const r = document.createElement("div"); r.className = "bf-ripple"; r.style.left = x + "px"; r.style.top = y + "px"; document.body.appendChild(r); setTimeout(() => r.remove(), 700); };
  window.__bfCaption = (html) => { boot(); const c = document.getElementById("bf-cap"); if (!html) { c.style.opacity = 0; c.style.transform = "translate(-50%,20px)"; return; } c.innerHTML = html; c.style.opacity = 1; c.style.transform = "translate(-50%,0)"; };
  window.__bfTitle = (k, t, s) => { boot(); const el = document.getElementById("bf-title"); if (!t) { el.style.opacity = 0; return; } el.innerHTML = '<div><div class="k">' + k + '</div><div class="t">' + t + '</div><div class="s">' + (s || "") + "</div></div>"; el.style.opacity = 1; };
  if (document.readyState !== "loading") boot(); else document.addEventListener("DOMContentLoaded", boot);
})();`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Helpers bound to one page. */
function director(page) {
  let cx = SIZE.width / 2, cy = SIZE.height / 2;
  const move = async (x, y, ms = 750) => { cx = x; cy = y; await page.evaluate(([a, b]) => window.__bfMove(a, b), [x, y]); await page.mouse.move(x, y, { steps: 8 }); await wait(ms); };
  return {
    caption: async (html, ms = 0) => { await page.evaluate((h) => window.__bfCaption(h), html); if (ms) await wait(ms); },
    title: async (k, t, s, ms = 2800) => { await page.evaluate(([a, b, c]) => window.__bfTitle(a, b, c), [k, t, s]); await wait(ms); await page.evaluate(() => window.__bfTitle("", "")); await wait(500); },
    move,
    click: async (locator, ms = 900) => {
      const el = locator.first();
      await el.scrollIntoViewIfNeeded().catch(() => undefined);
      const b = await el.boundingBox();
      if (!b) throw new Error("element not visible");
      const x = b.x + b.width / 2, y = b.y + b.height / 2;
      await move(x, y, 700);
      await page.evaluate(([a, c]) => window.__bfRipple(a, c), [x, y]);
      await el.click();
      await wait(ms);
    },
    type: async (locator, text, delay = 32) => { await locator.first().pressSequentially(text, { delay }); },
    scroll: async (px, steps = 12, ms = 70) => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, px / steps); await wait(ms); } },
    hold: wait,
    get cursor() { return [cx, cy]; },
  };
}

/* ------------------------------------------------------------------ the walkthroughs */
const DEMO_INV = async (page) => {
  // the demo investigation (New Delhi) is the featured one on the public showcase
  const r = await page.request.get(`${BASE}/api/investigations`);
  const list = await r.json();
  const items = Array.isArray(list) ? list : list.items || [];
  const delhi = items.find((x) => /Green Canopy/i.test(x.title || "")) || items.find((x) => /New Delhi/i.test(x.location_name || "")) || items[0];
  return delhi?.id;
};

const WALKS = [
  { n: "09", file: "09-walkthrough-home-page.mp4", what: "The home page in Chrome: the globe dive, “What is BACKFIRE?”, the engine film, the simulation film, the failure landscape and the eight agents with their live results.",
    run: async (page, d) => {
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await d.title("Walkthrough", "The BACKFIRE home page", "A crash test for green promises", 2600);
      await d.hold(2500);
      await d.caption("Scroll to dive from orbit down to the street — the <b>real satellite globe</b> of the demo city.");
      await d.scroll(2200, 30, 120);
      await d.caption("Each chapter uses the demo investigation’s <b>real results</b> for New Delhi.");
      await d.scroll(2200, 30, 120);
      await page.locator("#explainer").scrollIntoViewIfNeeded();
      await d.caption("<b>What is BACKFIRE?</b> The problem, what it does, where the AI is and what you get.", 4500);
      await page.locator("#engine").scrollIntoViewIfNeeded();
      await d.scroll(250, 4);
      await d.caption("<b>Under the hood:</b> a 3D film shows how the engine calculates — real formulas, real numbers.", 9000);
      await d.scroll(1100, 14, 90);
      await d.caption("The <b>simulation film</b>: ten years of the city block, computed by the model.", 6000);
      await page.locator("#agents").scrollIntoViewIfNeeded();
      await d.scroll(200, 4);
      await d.caption("<b>Eight AI agents</b> — each shows what it actually produced on the demo data.", 2500);
      const steps = page.locator("#agents ol li button");
      for (const k of [1, 4, 5]) await d.click(steps.nth(k), 3200);
      await d.caption("");
    } },
  { n: "10", file: "10-walkthrough-demo-login-mission-control.mp4", what: "One-click Demo login, the 3D Mission-control globe, selecting a tested city and opening its investigation.",
    run: async (page, d) => {
      await page.context().clearCookies();
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await d.title("Walkthrough", "Demo login & Mission control", "One click in, then the whole world of tested plans", 2600);
      await d.caption("No password to type — <b>Demo login</b> signs you in as the admin demo account.", 1500);
      await d.click(page.getByRole("button", { name: /demo/i }), 1500);
      await page.waitForURL(/dashboard/, { timeout: 30000 });
      await d.caption("<b>Mission control:</b> every glowing marker is a plan BACKFIRE has crash-tested.", 6000);
      await d.caption("Pick a city — the globe flies there and shows its verdict in plain words.", 800);
      await d.click(page.getByText(/Green Canopy Programme/).filter({ visible: true }), 4500);
      await d.caption("The panel shows: does it break, how often, and <b>what breaks it</b>.", 4000);
      const open = page.getByRole("link", { name: /open investigation/i });
      if (await open.count()) await d.click(open, 3500);
      await d.caption("");
    } },
  { n: "11", file: "11-walkthrough-investigation-tabs.mp4", what: "The New Delhi investigation tab by tab: overview, the simulation film, claims, the causal-graph story view, the 3D failure boundary, alternatives, evidence and the certificate.",
    run: async (page, d) => {
      const id = await DEMO_INV(page);
      await page.goto(`${BASE}/investigations/${id}/overview`, { waitUntil: "domcontentloaded" });
      await d.title("Walkthrough", "Inside one investigation", "Green Canopy Programme — New Delhi", 2600);
      await d.caption("<b>Overview:</b> the verdict in plain language and the smallest change that breaks the plan.", 5000);
      const tab = (name) => page.getByRole("link", { name });
      await d.click(tab(/simulation film/i), 600);
      await d.caption("<b>Simulation film:</b> as planned → the breaking change → a safer design.", 12000);
      await d.click(tab(/^claims$/i), 600);
      await d.caption("<b>Claims:</b> the AI turned the proposal into exact, testable targets.", 4500);
      await d.click(tab(/causal graph/i), 1500);
      await d.caption("<b>Causal graph:</b> how one thing leads to another. Let’s play a story…", 1500);
      await d.click(page.getByRole("button", { name: /hotter summer/i }), 300);
      await d.caption("More heat → more thirst → less soil water → more stress → <b>fewer trees alive</b>.", 10000);
      await d.click(page.locator("button").filter({ hasText: "Tree stress" }), 3500);
      await d.click(tab(/failure boundary/i), 1500);
      await d.caption("<b>Failure boundary:</b> green ground holds, the red sea fails. Drag to look around.", 1000);
      await d.move(SIZE.width * 0.55, SIZE.height * 0.55, 300);
      await page.mouse.down(); await d.move(SIZE.width * 0.7, SIZE.height * 0.5, 1200); await page.mouse.up();
      await d.hold(2500);
      await d.click(tab(/alternatives/i), 600);
      await d.caption("<b>Alternatives:</b> safer designs tested in the same harsh future.", 4500);
      await d.click(tab(/evidence/i), 600);
      await d.caption("<b>Evidence:</b> real papers with verified DOIs, plus NASA climate.", 4500);
      await d.click(tab(/certificate/i), 600);
      await d.caption("<b>Certificate:</b> a signed, reproducible report with a SHA-256 fingerprint.", 5000);
      await d.caption("");
    } },
  { n: "12", file: "12-walkthrough-ai-scenario-builder.mp4", what: "The Lab: “Surprise me (AI)” lets Ollama invent and type a scenario, the climate-styled preview film plays, then “Run the simulation” starts the eight agents live.",
    run: async (page, d) => {
      await page.goto(`${BASE}/lab`, { waitUntil: "domcontentloaded" });
      await d.title("Walkthrough", "Let the AI build a scenario", "From an empty box to a running investigation", 2600);
      await d.caption("Leave the idea box empty and press <b>Surprise me (AI)</b>…", 1800);
      await d.click(page.getByRole("button", { name: /surprise me/i }), 500);
      await d.caption("The language model (Ollama) <b>invents a realistic plan</b> for a hot city and types it in.");
      await page.waitForFunction(() => /Built by/.test(document.body.innerText), null, { timeout: 90000 });
      await d.hold(1500);
      await d.scroll(520, 10);
      await d.caption("It filled in the <b>place, coordinates and targets</b> — you can change any number.", 4000);
      await page.getByText(/watch it first/i).first().scrollIntoViewIfNeeded();
      await d.scroll(180, 4);
      await d.caption("<b>Watch it first:</b> the model plays the plan in this city’s real climate, then a hotter & drier what-if.", 16000);
      await d.click(page.getByRole("button", { name: /run the simulation/i }), 2500);
      await d.caption("<b>Eight AI agents</b> now work live: claims, evidence, cause & effect, sensitivity, the hunt, verification…", 25000);
      await d.caption("");
    } },
  { n: "13", file: "13-walkthrough-ask-ai-copilot.mp4", what: "The AI Copilot answers a question about the investigation using only the computed numbers.",
    run: async (page, d) => {
      const id = await DEMO_INV(page);
      await page.goto(`${BASE}/investigations/${id}/overview`, { waitUntil: "domcontentloaded" });
      await d.title("Walkthrough", "Ask the AI Copilot", "Answers built only from computed numbers", 2600);
      await d.hold(2000);
      await d.click(page.getByRole("button", { name: /ask ai/i }).filter({ visible: true }), 1200);
      await d.caption("Ask anything in plain words…", 800);
      const box = page.getByPlaceholder(/ask a question/i);
      await d.click(box, 300);
      await d.type(box, "Why does the plan fail, and what would make it safer?", 40);
      await page.keyboard.press("Enter");
      await d.caption("The AI may only use the <b>computed facts</b>. Any number it invents is rejected.");
      await page.waitForTimeout(25000);
      await d.caption("");
      await d.hold(3000);
    } },
  { n: "14", file: "14-walkthrough-benchmarks-architecture.mp4", what: "The Benchmarks page and its 3D race, then the 3D backend architecture map with the guided “follow one investigation” tour.",
    run: async (page, d) => {
      await page.goto(`${BASE}/benchmarks`, { waitUntil: "domcontentloaded" });
      await d.title("Walkthrough", "Benchmarks & architecture", "Measured, not claimed — and how it is built", 2600);
      await d.caption("<b>Benchmarks:</b> our search method races three classic methods on problems with known answers.", 4000);
      await page.getByText(/watch the race/i).first().scrollIntoViewIfNeeded();
      await d.caption("Each explorer replays its algorithm’s <b>real search</b>. Red footprints = failures found.", 14000);
      await page.goto(`${BASE}/architecture`, { waitUntil: "domcontentloaded" });
      await d.hold(1500);
      await page.evaluate(() => { const el = document.getElementById("map"); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 76, behavior: "smooth" }); });
      await d.hold(1200);
      await d.caption("<b>Architecture:</b> a 3D map of the backend. Tap any building…", 1500);
      await d.click(page.getByRole("button", { name: /follow one investigation/i }), 500);
      await d.caption("");
      await d.hold(32000);
    } },
];

/* ------------------------------------------------------------------ capture + encode */
async function capture(page, dir) {
  const frames = [];
  const cdp = await page.context().newCDPSession(page);
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const f = path.join(dir, `f${String(frames.length).padStart(6, "0")}.jpg`);
    fs.writeFileSync(f, Buffer.from(data, "base64"));
    frames.push({ f, t: metadata.timestamp });
    try { await cdp.send("Page.screencastFrameAck", { sessionId }); } catch { /* closing */ }
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 });
  return { frames, stop: () => cdp.send("Page.stopScreencast").catch(() => undefined) };
}

function encode(frames, dir, out) {
  const rows = [];
  for (let i = 0; i < frames.length; i++) {
    const dur = i + 1 < frames.length ? Math.max(0.001, frames[i + 1].t - frames[i].t) : 1 / 30;
    rows.push(`file '${frames[i].f.replace(/\\/g, "/")}'`, `duration ${dur.toFixed(4)}`);
  }
  rows.push(`file '${frames[frames.length - 1].f.replace(/\\/g, "/")}'`);
  const list = path.join(dir, "list.txt");
  fs.writeFileSync(list, rows.join("\n"));
  ff(["-y", "-f", "concat", "-safe", "0", "-i", list,
    "-vf", `fps=30,scale=${SIZE.width}:${SIZE.height}:force_original_aspect_ratio=decrease,pad=${SIZE.width}:${SIZE.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-movflags", "+faststart", "-an", out]);
}

fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(FRAMES, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: !process.env.HEADED,
  args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=d3d11", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});
console.log(`Walkthroughs at ${SIZE.width}x${SIZE.height} in Google Chrome from ${BASE}`);

// sign in once with the Demo login button and reuse the session
const loginCtx = await browser.newContext({ viewport: SIZE });
const lp = await loginCtx.newPage();
await lp.goto(`${BASE}/login`);
await lp.getByRole("button", { name: /demo/i }).first().click();
await lp.waitForURL(/dashboard/, { timeout: 30000 });
const state = await loginCtx.storageState();
await loginCtx.close();

const rows = [];
for (const w of WALKS) {
  if (only.length && !only.includes(w.n)) continue;
  process.stdout.write(`● ${w.file} … `);
  const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, storageState: state });
  await ctx.addInitScript(OVERLAY);
  const page = await ctx.newPage();
  await page.setContent('<body style="margin:0;background:#05070c"></body>'); // dark first frame instead of a white flash
  const dir = fs.mkdtempSync(path.join(TMP, `${w.n}-`));
  const cap = await capture(page, dir);
  try {
    await w.run(page, director(page));
  } catch (e) {
    console.log(`(step failed: ${String(e.message || e).split("\n")[0]}) `);
  }
  await wait(800);
  await cap.stop();
  await ctx.close();
  const out = path.join(OUT, w.file);
  encode(cap.frames, dir, out);
  fs.rmSync(dir, { recursive: true, force: true });
  const dur = probe(out);
  ff(["-y", "-ss", (dur * 0.5).toFixed(2), "-i", out, "-frames:v", "1", "-q:v", "3", path.join(FRAMES, w.file.replace(".mp4", ".jpg"))]);
  const mb = fs.statSync(out).size / 1e6;
  console.log(`${dur.toFixed(1)} s, ${mb.toFixed(1)} MB`);
  rows.push({ w, dur, mb });
}
await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });

const manifestPath = path.join(OUT, "manifest.json");
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};
for (const { w, dur, mb } of rows) manifest[w.file] = { dur, mb, what: w.what };
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const all = Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b));
const md = [
  "# BACKFIRE walkthrough videos",
  "",
  `Screen recordings of the real site in Google Chrome (driven by \`npm run record:walkthroughs\`), ${SIZE.width}×${SIZE.height}, H.264 MP4, 30 fps.`,
  "The white arrow, orange click ripples and captions are added during recording so viewers can follow along. Everything else is the live app.",
  "",
  "| File | Length | Size | What it shows |",
  "| --- | --- | --- | --- |",
  ...all.map(([file, { dur, mb, what }]) => `| [${file}](${file}) | ${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, "0")} | ${mb.toFixed(1)} MB | ${what} |`),
  "",
  "Still frames are in [frames/](frames/).",
  "",
];
fs.writeFileSync(path.join(OUT, "README.md"), md.join("\n"));
console.log(`Done. ${rows.length} walkthrough(s) in ${OUT}`);
