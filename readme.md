# BACKFIRE AI
### Adversarial Climate Intervention Falsification Laboratory

> **Every climate promise has a breaking point. BACKFIRE finds it before the climate does.**

BACKFIRE doesn't ask whether an environmental intervention will work. It asks:

> *What is the smallest scientifically plausible change in conditions that makes this intervention fail?*

Eight AI agents read a proposal, turn its promises into measurable targets, gather real climate data and peer-reviewed evidence, and build a cause-and-effect model. They then search thousands of simulated futures for the **minimum plausible failure**. An independent agent re-computes every result before it is trusted. The output is a 3D film of what happens, safer designs, and a reproducible, hashed **falsification certificate**.

First case study: **urban tree planting under water stress.** Can a tree-planting programme deliver its promised cooling without the trees dying of thirst?

📖 **Explaining it to someone?** Start with [docs/EXPLAINER.md](docs/EXPLAINER.md), a one-page guide with the analogy, a 3-minute demo script and the real numbers to quote.
🎬 **Want to show it?** See [videos/](videos/): eight MP4 films recorded from the running app.

---

## ✨ Quick start

```bash
# 1. Backend (Python 3.12+)
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt        # Windows  (Linux/macOS: .venv/bin/pip)
.venv/Scripts/python -m uvicorn app.main:app --port 8000

# 2. Frontend (Node 20+)
cd frontend
npm install
npm run build && npm start                           # production server on :3000
```

Open **http://localhost:3000** and click **Demo login**.

> Run either `npm run dev` **or** `npm start` in `frontend/`, never both at once. They share the `.next` folder, and running both breaks the build ("Application error"). After a rebuild, stop the old `next start` first.

### Demo account

Demo mode is on by default in development. On first start, the app creates an **admin demo account** and computes a real investigation (Green Canopy Programme, New Delhi) in the background.

- **Easiest:** click **Demo login** on the landing or sign-in page. It signs you in automatically, with no typing.
- **Manually:** use `DEMO_EMAIL` / `DEMO_PASSWORD` from [`.env.example`](.env.example).

Demo mode is **off in production** unless you set `DEMO_MODE=true`.

---

## 🤖 AI with Ollama (or Claude / GPT)

Go to **Settings → AI provider**, choose **Ollama**, paste your Ollama API key, pick a model (default `gpt-oss:120b`) and press **Test**.

- The key is **encrypted (Fernet) in the database**, so it survives server restarts on localhost. It is never sent back to the browser.
- **Ollama Cloud** (`https://ollama.com`, API key) and a **local Ollama** server (`http://127.0.0.1:11434`, no key) are both supported. Anthropic Claude and OpenAI work too.
- If a key is stored but no provider is selected, the app uses the stored key automatically.
- Some hosted models ignore Ollama's `format` field. BACKFIRE therefore also puts the exact JSON schema in the prompt and allows one automatic repair round-trip. Malformed replies are fixed or fall back cleanly.
- **Rule:** language models only read and write text. Any AI answer containing a number the simulation didn't compute is rejected. Without a key, everything still works through rule-based fallbacks.

## 🗺️ What's in the app

| Where | What you see |
| --- | --- |
| **Landing `/`** | A scroll-driven dive from orbit to street level over a real satellite globe. Then a "What is BACKFIRE?" explainer, the **full-workflow film** (a motion-graphics walk from a written promise to the signed certificate), the simulation film, the 3D failure landscape, and the **agent walkthrough** with each agent's live result on the demo data. |
| **How it works `/how-it-works`** | A plain-language guide, the workflow film, **Where the AI is used** (an auto-playing reel plus six interactive demos showing *input → AI → output → safety check*) and judge Q&A. |
| **Architecture `/architecture`** | An interactive **3D map of the backend**. Click any block for a simple and a technical explanation with file paths. **Follow one investigation** is a 12-step guided tour with a gliding camera. Also: a request-journey sequence diagram, what the database stores, the security guards and the stack. |
| **Mission control `/dashboard`** | A full-screen 3D globe. Each investigation is a glowing column; click one for the verdict. |
| **New investigation `/lab`** | Pick a ready-made situation, or describe an idea and press **Let AI build it**. Leave the box empty and press **Surprise me (AI)**: the AI invents a plan for a hot city and types it in. A **"Watch it first" preview film** then plays the plan in that city's real climate, followed by a hotter-and-drier what-if. |
| **Investigation tabs** | Overview · **▶ Simulation film** · Claims · **Causal graph** · Adversarial engine · Failure boundary (3D/2D) · Alternatives · Evidence · Certificate · Ask-AI Copilot. |
| **Causal graph** | A **Simple story** view by default: five columns (nature → the city's choices → water → trees → results) with friendly names. Tap a card to light up what it changes. **Play a story** (🔥 a hotter summer, 🚰 the water doesn't arrive, …) to watch a chain unfold step by step. **Expert graph** keeps the full React Flow view with evidence on every edge. |
| **Benchmarks `/benchmarks`** | A plain-language leaderboard and a **3D race**: each explorer replays its algorithm's real search trace on three practice courses. Each course is a floating island with its own sky, a glowing failure canyon, trees and rocks, landing puffs, "found a closer one!" pop-ups and a sparkle burst at the answer. |
| **Films `/films/*`** | Every film full-screen: `engine`, `architecture`, `simulation`, `preview?city=…`, `race`, `ai`. Add `?record=1` for the clean recording view. |

### Climate-specific film assets

The simulation film styles each site from its **real climate** (annual rain, seasonality and hottest month from NASA POWER):

| Biome | When | Look |
| --- | --- | --- |
| 🏜️ Desert | < 250 mm rain a year | sand, dunes, flat-roofed adobe, palms and acacias |
| 🌵 Dry city | semi-arid | dusty ground, umbrella-shaped trees |
| 🫒 Mediterranean | dry summers, wet winters | terracotta roofs, olive trees and cypresses |
| 🌧️ Monsoon | ≥ 55 % of rain in 3 months | lush broadleaf trees with some palms, hazy sky |
| 🌴 Humid | ≥ 900 mm, spread through the year | deep-green trees, palms, green hills |

The model's output drives everything that moves: trees die along the survival curve, leaves brown with monthly drought stress, rain follows monthly precipitation, sprinklers follow irrigation, and sun and haze follow temperature. The city, tree species and hills are illustration only and never feed into the model.

---

## 🤖 The eight agents

Coordinated by a **LangGraph** orchestrator with typed state, retries, timeouts and a loop guard:

1. **Claim Extraction:** proposal → structured claims (language model or rule-based). Untraceable quotes are discarded.
2. **Evidence Research:** NASA POWER climatology, OpenAlex search, Crossref DOI verification, GBIF species check.
3. **Causal Analysis:** a causal DAG and confounders (NetworkX), with evidence linked to each edge.
4. **Adversarial Research:** Sobol sensitivity (SALib), turned into failure hypotheses.
5. **Optimisation:** MPFS against random search, differential evolution and NSGA-II, plus Monte Carlo.
6. **Independent Verification:** re-runs every counterexample from scratch and never approves its own results.
7. **Alternatives:** redesigns the intervention and re-tests it in the same harsh future.
8. **Report Compilation:** a PDF and JSON certificate with a SHA-256 hash.

## 🔬 The science

**Model** (`backend/app/science/model.py`): a daily root-zone water balance.
FAO-56 Penman-Monteith ET₀ → WUCOLS landscape demand → USDA-SCS effective rain → allocation-capped irrigation → FAO-56 stress coefficient → mortality → surviving canopy → daytime air cooling. Each parameter in `parameters.py` has units, bounds, sources and a status (`literature` / `engineering` / `assumption`).

**MPFS (Minimum Plausible Failure Search)**, in `mpfs.py`:

```
minimise   ||Δx||²_W + λ||Δθ||²_W
subject to B(x+Δx, θ+Δθ) < 0,  plausible bounds,  linear dependencies
```

MPFS runs in five phases: shell screening → margin descent (Newton step, one-sided finite differences inside the box) → ray bisection onto the boundary → SLSQP refinement → diverse failure modes.

**Measured benchmark** (4-D and 8-D problems with known optima, 3 seeds, budget 1500), produced by `run_benchmark_suite`:

| Method | Found a failure | Within 5 % of true optimum | Median gap | Median evals to 5 % |
| --- | --- | --- | --- | --- |
| **MPFS** | 100 % | **88 %** | **0.08 %** | 555 |
| NSGA-II | 100 % | 33 % | 10.7 % | 744 |
| Differential evolution | 96 % | 38 % | 16.8 % | 924 |
| Random search | 67 % | 0 % | 55.4 % | never |

These results hold for these synthetic problems and budgets only; they are not a general superiority claim.

## 🧱 Architecture & stack

```
Browser ─► Next.js 15 website ─► FastAPI API (auth · CSRF · rate limit · audit)
                                     │
                                     ├─► job runner (thread pool) ──► WebSocket live events ─► browser
                                     │        │
                                     │        └─► LangGraph conductor ─► 8 agents
                                     │                 │            └─► Ollama / Claude / GPT (text only)
                                     │                 ├─► science engine (NumPy · SciPy · SALib · pymoo)
                                     │                 └─► NASA POWER · OpenAlex · Crossref · GBIF (allow-listed)
                                     └─► database (SQLite locally · PostgreSQL + PostGIS + pgvector in production)
```

- **Frontend:** Next.js 15 (App Router), React 19, TypeScript, Tailwind v4, Framer Motion, MapLibre GL 5, three.js / React Three Fiber / drei, React Flow, ECharts.
- **Backend:** FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, LangGraph, NumPy, SciPy, SALib, pymoo, NetworkX, ReportLab.
- **Data and maps:** PostgreSQL + PostGIS + pgvector (SQLite locally), Redis rate limiting, Sentinel-2 cloudless (EOX), AWS terrain, OpenFreeMap buildings.

The 3D version, with a guided tour, is at **`/architecture`**.

> **Map not showing?** Ad blockers such as Brave Shields can block tile hosts. Allow `tiles.maps.eox.at`, `tiles.openfreemap.org` and `s3.amazonaws.com`.

## 🎬 Videos

The [videos/](videos/) folder holds eight H.264 MP4s recorded from the running site. [videos/README.md](videos/README.md) lists each one with its length and the real numbers it shows.

| # | File | Shows |
| --- | --- | --- |
| 02 | `02-backend-architecture-tour.mp4` | the guided 3D backend tour |
| 03 | `03-simulation-film-new-delhi.mp4` | plan → breaking change → safer design |
| 04 | `04-desert-city-preview.mp4` | Lab preview, desert biome (Riyadh) |
| 05 | `05-mediterranean-city-preview.mp4` | Lab preview, Mediterranean biome (Madrid) |
| 06 | `06-monsoon-or-humid-city-preview.mp4` | Lab preview, monsoon/humid biome |
| 07 | `07-benchmark-race.mp4` | the race on all three courses |
| 08 | `08-where-the-ai-is-used.mp4` | the six AI uses as live demos |
| 10 | `10-full-workflow-motion.mp4` | the whole workflow as a motion-graphics film |

**Re-record** with the site and API running:

```bash
cd frontend
npm run record:videos              # all
npm run record:videos -- 03 07     # only some
VIDEO_SIZE=1080 npm run record:videos
```

[`scripts/record-videos.mjs`](scripts/record-videos.mjs) signs in with the **Demo login** button (no password typed) and opens each `/films/*?record=1` page. In record mode the page hides the site chrome, auto-plays from 0, seeds every random particle, and sets `window.__filmDone` at the end. The script captures every frame with Chrome's DevTools screencast and encodes 30 fps `yuv420p` H.264 with `+faststart` using the system ffmpeg; if no system ffmpeg is found it uses the `ffmpeg-static` npm package. It also writes `videos/README.md` and a still frame of each film into `videos/frames/`.

### Walkthroughs: the real site in Google Chrome

[videos/walkthroughs/](videos/walkthroughs/) holds screen recordings of someone **using** the app in Google Chrome at 1920×1080: real clicks, typing and scrolling, with a visible cursor, click ripples and captions explaining each step.

| # | File | Shows |
| --- | --- | --- |
| 09 | `09-walkthrough-home-page.mp4` | the home page: globe dive, explainer, films, agents with live results |
| 10 | `10-walkthrough-demo-login-mission-control.mp4` | one-click Demo login, the 3D Mission-control globe, opening a city |
| 11 | `11-walkthrough-investigation-tabs.mp4` | one investigation tab by tab, including the causal-graph story and 3D failure boundary |
| 12 | `12-walkthrough-ai-scenario-builder.mp4` | "Surprise me (AI)" → Ollama writes a scenario → preview film → Run → live agents |
| 13 | `13-walkthrough-ask-ai-copilot.mp4` | asking the AI Copilot why the plan fails |
| 14 | `14-walkthrough-benchmarks-architecture.mp4` | the benchmark race and the 3D architecture tour |

```bash
cd frontend
npm run record:walkthroughs            # all six (12 creates one new investigation)
npm run record:walkthroughs -- 10 13   # only some
WALK_SIZE=720 npm run record:walkthroughs
```

Both recorders keep a `manifest.json`, so re-recording only some videos still leaves a complete README.

## 🔐 Security

- **Passwords and sessions:** bcrypt passwords; JWT access and refresh tokens in httpOnly cookies, plus a required CSRF header (`X-Requested-With`).
- **Access control:** roles (admin / analyst / viewer).
- **Secrets:** API keys encrypted at rest with Fernet and never returned to the browser.
- **Network:** an SSRF allow-list for every outgoing call. Local Ollama is only allowed at the configured `/api/` path.
- **Uploads:** PDFs are parsed in an isolated subprocess.
- **Hardening:** rate limiting, strict CSP and security headers.
- **Accountability:** an audit log of every write.

## 🧪 Tests

```bash
cd backend && .venv/Scripts/python -m pytest -q      # 57 tests
cd frontend && npm run typecheck
```

The tests cover:

- FAO-56 reference values
- MPFS correctness and reproducibility
- the baselines
- verification tamper detection
- claim extraction and LLM traceability
- SSRF blocking
- auth, RBAC and CSRF
- uploads
- the full agent workflow
- the AI scenario builder ("surprise me")
- the live preview endpoint
- climate-biome classification

## 🚀 Deploy (Docker / Coolify)

```bash
cp .env.example .env       # set SECRET_KEY, POSTGRES_PASSWORD, ALLOWED_ORIGINS
docker compose up -d --build
```

Docker Compose starts four services:

| Service | What it runs |
| --- | --- |
| `db` | PostgreSQL 16 + PostGIS + pgvector |
| `redis` | Redis |
| `backend` | FastAPI, running Alembic migrations on start |
| `frontend` | Next.js standalone |

In Coolify, route the domain to `frontend:3000` and `/api/*` to `backend:8000`.

## 📚 Docs

| File | What it is |
| --- | --- |
| [docs/EXPLAINER.md](docs/EXPLAINER.md) | The one-page guide for explaining the project to anyone |
| [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) | How it works, what is verified, and the 3-minute demo |
| [docs/JUDGE_QA.md](docs/JUDGE_QA.md) | Tough questions and honest answers |
| [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) | The original build specification |

## ⚠️ Honest limitations

- **Exploratory simulation.** The coupled model is not validated end-to-end against field data, and the `assumption` parameters are uncalibrated.
- **What a failure means.** A simulated failure shows conditions under which this model says the claimed benefit isn't delivered. It does **not** prove the intervention is harmful.
- **What "cooling" means.** "Cooling" is daytime pedestrian-level *air* temperature, not satellite land-surface temperature.
- **Evidence stance.** Whether a source supports or contradicts a claim is judged by a keyword heuristic, not a systematic review.
- **Illustration vs. model.** Film scenery (buildings, tree species, hills) and the agent-walkthrough and AI-demo animations are illustrations. The numbers they display are computed.
