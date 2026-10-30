# BACKFIRE AI — Counter-Questions & Answers

Short, honest answers to the questions judges and mentors are most likely to ask. Lead with the one-line answer, then give the supporting detail if pressed.

---

## About the idea

**Q: What does your project do, in one line?**
It's a crash test for green promises: it finds the smallest realistic change that would make a climate project fail, before the money is spent.

**Q: Why does this matter?**
Urban greening is a major climate-adaptation investment, and tree-planting programmes often fail quietly when trees die of drought. Today nobody measures how *fragile* a promise is; we do.

**Q: Who would use it?**
- City planning departments, before approving greening projects.
- Climate funds and development banks, as due diligence before financing.
- NGOs, to design programmes that survive bad years.

**Q: What is actually new?**
Falsification instead of prediction. Most tools ask "does it work on average?"; we ask "what is the minimum plausible failure?". Our search method, **MPFS (Minimum Plausible Failure Search)**, is built for exactly that question.

---

## "Couldn't ChatGPT do this?"

**Q: Couldn't I just ask ChatGPT whether this plan will work?**
ChatGPT can give an *opinion*, but it can't run 10 years of New Delhi's real climate through a water-balance model thousands of times, and it will confidently invent numbers. BACKFIRE:
1. runs a physics-based simulation on real NASA climate data;
2. searches systematically for the weakest point (thousands of model runs);
3. has a second agent independently re-compute every result;
4. records seeds and a configuration hash, so anyone can reproduce it.

**Q: So where is the AI, then?**
In eight places:
- A language model (we support Ollama, Claude and OpenAI) reads the proposal, builds scenarios from plain language, answers questions in the Copilot and narrates the film.
- Search and evolutionary algorithms hunt for failures.
- A LangGraph multi-agent system coordinates eight specialised agents.

The rule is that AI handles language and search, and the simulation produces every number.

**Q: What if the AI hallucinates?**
It can't change the results:
- Extracted claims must be found in the source text or they are thrown away.
- Copilot and narration answers are checked number-by-number against the computed facts; any number the simulation didn't produce causes the AI answer to be rejected.
- Without any AI key, the system still works with rule-based readers.

---

## About the science

**Q: Is the simulation real or made up?**
The components are standard, published methods:
- **FAO-56 Penman-Monteith**, the UN FAO method for evapotranspiration;
- **WUCOLS**, landscape water-use coefficients;
- **NASA POWER** climate for the exact coordinates;
- a **peer-reviewed meta-analysis** of street-tree survival (Roman & Scatena 2011).

All 9 registry citations are DOI-verified on Crossref at runtime.

**Q: Isn't the model too simple?**
It's deliberately transparent and documented, not a black box. We label it an exploratory simulation that needs local calibration. Its job is to reveal *which assumptions a promise depends on* and how much margin there is, not to forecast exact temperatures.

**Q: Which parts are uncertain?**
Parameters without direct calibration (e.g. how drought raises mortality) are labelled "assumption" and shown in orange. Sobol sensitivity analysis then tells you which of them matter most, so you know what to measure next.

**Q: Does a failure mean the project is bad?**
No. It means "under these plausible conditions, the promised benefit isn't delivered by this model". That's useful information. The Alternatives step then shows designs that survive the *same* harsh future; for the demo, a very-low water-use species class drops the failure probability from ~53 % to ~0 %.

**Q: How do you handle uncertainty?**
Monte Carlo over thousands of futures, reported with confidence intervals, e.g. "fails in 60 % of futures (95 % CI 58–63 %)". We never give a single magic number.

---

## About the method and the results

**Q: How do you know MPFS is any good?**
We benchmark it on synthetic problems where the true answer is known, against three established methods. The Benchmarks page lets anyone re-run this race live.

| Method | Hit the true weakest point within 5 % |
|---|---|
| MPFS | ~88 % |
| Differential evolution | ~38 % |
| NSGA-II | ~33 % |
| Random search | 0 % |

**Q: Are you claiming MPFS is always better?**
No. It's better *on these test problems at this budget*. We say that explicitly in the app.

**Q: How do you know each part of MPFS matters?**
Ablation: we switch parts off one at a time.
- Without boundary refinement, accuracy drops to ~25 %.
- Without margin descent, it only finds a failure in ~67 % of runs.

**Q: Did you find any bugs in your own method?**
Yes, and the benchmarks caught them. For example, a gradient step at the edge of the search box read as zero slope, so MPFS missed a small failure region; we fixed it and re-verified that all benchmark numbers held. That's why we built the benchmarks.

**Q: How do you make results trustworthy?**
- An independent verification agent re-computes every counterexample and is forbidden from approving its own work.
- Every run stores its seed, algorithm versions and a SHA-256 hash of the full configuration.
- The certificate (PDF + JSON) contains everything needed to reproduce it.

---

## About the product and engineering

**Q: Is it a real app or a mock-up?**
It's a working full-stack app:
- **Backend:** FastAPI with LangGraph agents, SQLAlchemy and Alembic migrations, and 55 automated tests.
- **Frontend:** Next.js with real 3D (MapLibre globe, three.js).
- **Data:** every number on screen is computed or retrieved; nothing is hard-coded.

**Q: Is it secure?**
- bcrypt passwords, JWT httpOnly cookies, a CSRF guard and role-based access.
- API keys are encrypted in the database and never sent to the browser.
- Outbound requests use an allow-list (SSRF protection), and uploaded PDFs are parsed in an isolated process.
- Every action is rate-limited and audit-logged.

**Q: Does it scale to other interventions?**
The pipeline is general: claims → model → minimum-failure search → verification → alternatives → certificate. A new intervention (cool roofs, wetlands, irrigation schemes) needs its own model and parameter registry; the agents, search and reporting stay the same.

**Q: What would you do next?**
1. Calibrate the "assumption" parameters with real survival data from city tree inventories.
2. Add more intervention types.
3. Validate against historical programmes whose outcomes are known.

---

## If you get stuck

Return to the core message:
> "We don't predict whether a green project works. We find the smallest realistic change that breaks it, prove it with an independent check, and show a safer design — all reproducible."
