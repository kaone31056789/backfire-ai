# BACKFIRE videos

Recorded from the running site with `npm run record:videos` (in `frontend/`) on 2026-10-30 at 1280×720, H.264 MP4, 30 fps.
Every number shown in a video is computed by BACKFIRE (demo investigation or the live model); buildings, tree shapes and hills are illustration.
The same films play on the site: home page (engine film), /how-it-works, /architecture, the investigation "Simulation film" tab, the Lab preview and /benchmarks.

| File | Length | Size | What it shows |
|---|---|---|---|
| [01-how-the-engine-calculates.mp4](01-how-the-engine-calculates.mp4) | 0:56 | 8.9 MB | The 6-chapter engine film: the promise, the real weather, the day-by-day water bucket, Sobol sensitivity, the search for the breaking point on the real failure landscape, verification and verdict. |
| [02-backend-architecture-tour.mp4](02-backend-architecture-tour.mp4) | 1:24 | 15.8 MB | Guided 12-step tour of the backend on the 3D architecture map: browser → Next.js → FastAPI → job runner → LangGraph conductor → 8 agents → science engine, database, outside services → back to you. |
| [03-simulation-film-new-delhi.mp4](03-simulation-film-new-delhi.mp4) | 1:46 | 52.0 MB | The demo investigation's 3D simulation film for New Delhi: as planned → the smallest breaking change → a safer design, 10 simulated years per scene. |
| [04-desert-city-preview.mp4](04-desert-city-preview.mp4) | 1:13 | 50.1 MB | Lab preview in desert staging (palms, dunes, flat roofs): the plan, then a labelled hotter-and-drier what-if. City: riyadh (desert). |
| [05-mediterranean-city-preview.mp4](05-mediterranean-city-preview.mp4) | 1:12 | 41.8 MB | Lab preview in Mediterranean staging (terracotta roofs, olives and cypresses). City: madrid (mediterranean). |
| [06-monsoon-or-humid-city-preview.mp4](06-monsoon-or-humid-city-preview.mp4) | 1:12 | 41.1 MB | Lab preview in monsoon / humid staging (lush broadleaf trees, heavy seasonal rain). City: mumbai (monsoon). |
| [08-where-the-ai-is-used.mp4](08-where-the-ai-is-used.mp4) | 1:09 | 2.7 MB | The six places AI is used, each as a live demo: input → AI → output → safety check (reading proposals, building scenarios, Copilot answers, film narration, the breaking-point search, the multi-agent conductor). |
| [07-benchmark-race.mp4](07-benchmark-race.mp4) | 1:30 | 24.9 MB | The benchmark race on all three practice courses (Straight Cliff, Hidden Pit, The Decoy); each explorer replays its method's real search trace. |

## Real numbers in each video

### 01-how-the-engine-calculates.mp4

- claims: cooling ≥ 0.5 °C, survival ≥ 50.0%
- NASA POWER: 751 mm rain/yr, hottest May 42.8 °C; 33 evidence sources
- as planned: 62.6% trees alive, 0.85 °C cooling
- Sobol: Wind speed at 2 m 0.36, Drought mortality sensitivity 0.22, Urban microclimate factor 0.14
- 6020 simulations, d* = 0.29; verified 8/8; fails in 60.2% of plausible futures

Still frame: [frames/01-how-the-engine-calculates.jpg](frames/01-how-the-engine-calculates.jpg)

### 02-backend-architecture-tour.mp4

- no computed numbers — architecture tour (component names and file paths are real)

Still frame: [frames/02-backend-architecture-tour.jpg](frames/02-backend-architecture-tour.jpg)

### 03-simulation-film-new-delhi.mp4

- As planned: 62.6% trees alive, 0.85 °C cooling, promise kept
- The breaking change: 49.8% trees alive, 0.61 °C cooling, promise broken in year 10
- A better design: 68.6% trees alive, 1.09 °C cooling, promise kept

Still frame: [frames/03-simulation-film-new-delhi.jpg](frames/03-simulation-film-new-delhi.jpg)

### 04-desert-city-preview.mp4

- site climate (NASA POWER monthly climatology): 31 mm rain/yr, hottest month 44 °C → Desert city
- As planned: 26.7% trees alive, 0.21 °C cooling (fails)
- What if it gets hotter and drier?: 23.0% trees alive, 0.17 °C cooling (fails)

Still frame: [frames/04-desert-city-preview.jpg](frames/04-desert-city-preview.jpg)

### 05-mediterranean-city-preview.mp4

- site climate (NASA POWER monthly climatology): 447 mm rain/yr, hottest month 33.7 °C → Mediterranean city
- As planned: 72.2% trees alive, 1.09 °C cooling (holds)
- What if it gets hotter and drier?: 62.7% trees alive, 0.90 °C cooling (fails)

Still frame: [frames/05-mediterranean-city-preview.jpg](frames/05-mediterranean-city-preview.jpg)

### 06-monsoon-or-humid-city-preview.mp4

- site climate (NASA POWER monthly climatology): 2509 mm rain/yr, hottest month 38.4 °C → Monsoon city
- As planned: 52.7% trees alive, 0.54 °C cooling (fails)
- What if it gets hotter and drier?: 47.3% trees alive, 0.44 °C cooling (fails)

Still frame: [frames/06-monsoon-or-humid-city-preview.jpg](frames/06-monsoon-or-humid-city-preview.jpg)

### 08-where-the-ai-is-used.mp4

- claim: cooling ≥ 0.5 °C, survival ≥ 50% (demo proposal)
- breaking change d* = 0.29: drought mortality sensitivity 0.15 → 0.19, baseline mortality 0.040 → 0.045
- breaking-change scene: 49.8% trees alive, 0.61 °C
- 6020 simulations, verified 8/8, fails in 60.2% of plausible futures

Still frame: [frames/08-where-the-ai-is-used.jpg](frames/08-where-the-ai-is-used.jpg)

### 07-benchmark-race.mp4

- straight: budget 240 tries per method, true closest failure at distance 0.450; MPFS 0% off, NSGA-II 3% off, Differential evolution 9% off, Random search 8% off
- pit: budget 240 tries per method, true closest failure at distance 0.550; MPFS 0% off, NSGA-II 7% off, Differential evolution 8% off, Random search 7% off
- decoy: budget 240 tries per method, true closest failure at distance 0.560; MPFS 0% off, NSGA-II 10% off, Differential evolution 19% off, Random search 9% off

Still frame: [frames/07-benchmark-race.jpg](frames/07-benchmark-race.jpg)

## Re-recording

```bash
# site on http://localhost:3000 and API on :8000 must be running
cd frontend
npm run record:videos            # all seven
npm run record:videos -- 03 07   # just some
VIDEO_SIZE=1080 npm run record:videos   # 1920x1080
```

Each film page also works in a normal browser: `/films/engine`, `/films/architecture`, `/films/simulation`, `/films/preview?city=riyadh|madrid|nairobi|mumbai`, `/films/race`. Add `?record=1` for the clean full-screen recording view.
