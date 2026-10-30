# BACKFIRE AI: explained so anyone gets it

Use this page to explain the project to a mentor, a judge or a friend. Each part goes one step deeper, so stop wherever your listener is happy.

---

## 1. The one-liner

> **BACKFIRE crash-tests climate promises before cities spend money on them.**

Car makers crash-test cars before people drive them. BACKFIRE does the same for green projects. It simulates the future thousands of times and finds the **smallest realistic change**, such as a slightly hotter summer or a little less water, that makes the promise fail.

## 2. The 30-second version

1. A city promises: *"Plant 250 trees per hectare and the streets will be 0.5 °C cooler, with at least half the trees still alive after 10 years."*
2. BACKFIRE reads the promise and turns it into exact targets: **cooling ≥ 0.5 °C** and **survival ≥ 50 %**.
3. It downloads the place's **real weather** (NASA) and builds a **mini-world** that lives through 10 years: sun, rain, watering, thirsty trees and dying trees.
4. Then it plays **"what if?"** thousands of times and looks for the smallest change that breaks the promise.
5. A separate checker repeats every result. BACKFIRE then suggests **safer designs** and writes a signed **certificate**.

## 3. The analogy that always works

> Imagine the plan stands on a hill. **Green ground** means the promise holds, and the **red sea** means it fails. The question is not whether the plan works today. The question is **how close it already stands to the edge of the red sea.**

BACKFIRE measures that distance and calls it **d\***. A small d\* means one bad summer could break the plan. A large d\* means the plan is robust.

---

## 4. What happens inside, step by step

| # | Step | In simple words | What really runs |
| --- | --- | --- | --- |
| 1 | **Read the promise** | The AI writes the promise down as exact numbers. | Claim Extraction agent. A language model (Ollama, Claude or GPT) fills a strict JSON schema. Any quote that is not in the document is thrown away. If no AI key is set, a rule-based reader does the job. |
| 2 | **Gather the facts** | It looks up how hot and rainy the city really is, and what scientists found. | NASA POWER 30-year monthly climate, OpenAlex papers, Crossref DOI checks and a GBIF species check. |
| 3 | **Build the mini-world** | It builds a pretend city block and lets 10 years pass, one day at a time. | FAO-56 Penman-Monteith evaporation, a soil-water "bucket", tree stress, deaths each year, surviving shade and cooling. |
| 4 | **Find what matters** | Out of all the unknowns, it finds which ones change the result most. | Sobol sensitivity analysis (SALib) over thousands of random futures. |
| 5 | **Try to break it** | It hunts for the smallest realistic change that makes the promise fail. | MPFS, our method, races random search, differential evolution and NSGA-II with the same budget and seed. |
| 6 | **Double-check** | A separate checker repeats every breaking point from scratch. | Verification agent: a fresh model, a configuration hash check and a robustness probe. |
| 7 | **Fix it** | Keeping the same harsh future, it tries tougher trees and smarter watering. | Alternatives agent with Monte Carlo failure probabilities. |
| 8 | **Sign it** | It writes a report with a fingerprint, so nobody can quietly change it. | PDF and JSON with a SHA-256 hash, seeds and versions. |

A conductor (LangGraph) runs these 8 agents in order. It handles time limits and retries and streams live progress to your screen.

## 5. The real numbers to quote (demo: New Delhi)

| What | Value |
| --- | --- |
| The promise | cooling ≥ 0.5 °C and ≥ 50 % of trees alive after 10 years |
| Real climate (NASA POWER) | 751 mm of rain a year; hottest month May at 42.8 °C |
| Evidence | 33 sources, 28 peer-reviewed, 28 DOIs checked |
| Biggest unknowns (Sobol) | wind speed 0.36 · drought mortality sensitivity 0.22 · urban microclimate 0.14 |
| As planned | 62.6 % of trees alive and 0.85 °C cooling, so the promise holds |
| Smallest breaking change | d\* = 0.29: drought mortality sensitivity 0.15 → 0.19 and baseline mortality 0.040 → 0.045 |
| After that change | 49.8 % alive (just under 50 %), and the promise breaks in year 10 |
| Search effort | 6,020 full 10-year simulations across 4 methods |
| Checked | 8 of 8 breaking points independently re-computed |
| Across plausible futures | fails in about 60 % of them (Monte Carlo) |
| Safer design | very-low-water-use species: failure drops from 53 % to 0 % in the same harsh future |

> These come from the running demo investigation. If you re-run it, check the app for the latest values.

## 6. Where the AI is (and where it isn't)

| AI does | AI never does |
| --- | --- |
| Reads proposals and writes exact targets | Invent a number. Every number comes from the simulation |
| Builds a scenario from your plain-language idea ("Surprise me" invents one) | Decide the verdict. The physics model and the checker do |
| Answers your questions (Copilot), using only computed facts | Cite a paper that wasn't retrieved and DOI-checked |
| Writes the film's subtitles | Get past the number check. An answer with an unknown number is rejected |
| Searches thousands of futures (search and evolutionary algorithms) | |
| Coordinates 8 agents (LangGraph) | |

The AI runs on **Ollama** (cloud or local), Claude or GPT, chosen in Settings. Your key is stored **encrypted** in the database and is never sent to the browser. Even with no key, everything still works through the rule-based fallbacks.

## 7. The 3-minute live demo (what to click, what to say)

| Time | Click | Say |
| --- | --- | --- |
| 0:00 | **Home page.** Scroll the globe dive. | "Every climate promise has a breaking point. We find it before the climate does." |
| 0:20 | Home → the **full-workflow film** | "Here is the whole journey: from a written promise, through the eight agents and thousands of simulations, to a signed verdict." |
| 0:45 | **Demo login → Mission control** | "Each glowing column is a tested plan. Taller means easier to break." |
| 1:00 | Open **Green Canopy, New Delhi → Overview** | "The verdict: it holds as planned but breaks with a small change, d\* = 0.29." |
| 1:20 | **▶ Simulation film** tab | "Three futures: as planned, the breaking change, and a safer design. Trees die exactly as the model computes." |
| 1:45 | **Causal graph → Play a story: 🔥 A hotter summer** | "More heat, more thirst, less soil water, more stress, fewer trees alive." |
| 2:05 | **Failure boundary** (3D) | "Green ground holds, the red sea fails. The star is the closest edge." |
| 2:20 | **New investigation → Surprise me (AI)** | "The AI invents a plan for a new city, and the preview plays it in that city's climate: palms for deserts, terracotta for Mediterranean cities." |
| 2:45 | **Benchmarks** race | "We don't just claim our search is better. We race it against the classics on problems with known answers." |

## 8. Key ideas in one line each

- **Claim**: a promise written as a number with a direction, for example *cooling ≥ 0.5 °C*.
- **Net benefit B**: how far the plan is above its weakest target. Above 0 the promise holds; below 0 it fails.
- **Plausibility distance (d\*)**: how big a change is needed to break the promise. 0 means as planned, and 1 means the edge of what is plausible.
- **MPFS (Minimum Plausible Failure Search)**: our search method. It walks downhill on the success margin, lands exactly on the edge and polishes the result (SLSQP).
- **Sobol index**: the share of the result's ups and downs that one unknown explains.
- **Monte Carlo**: run thousands of random plausible futures and count how often the promise fails.
- **Verification**: an independent re-run. If a result doesn't repeat, it is thrown out.
- **Biome staging**: the film's look (desert, dry, Mediterranean, monsoon or humid) is chosen from the site's real climate. It is decoration, not a model input.

## 9. Tough questions, short answers

**"Couldn't ChatGPT do this?"**
No. A chatbot gives opinions and can invent numbers. BACKFIRE runs a physics-based simulation thousands of times, searches systematically, and re-checks every result. Any AI sentence containing a number the engine didn't compute is rejected.

**"Is the science real?"**
Yes. The model uses standard published methods: FAO-56 (the UN's evaporation method), WUCOLS landscape water coefficients, NASA climate data and peer-reviewed tree-survival rates. Where science gives no number, the parameter is marked as an *assumption* in orange, and the sensitivity analysis shows whether it matters.

**"What is new?"**
It asks the opposite question: not *"does it work on average?"* but *"what is the smallest realistic change that breaks it?"* We also measured our search method. On problems with known answers, it found the true weakest point (within 5 %) in about 88 % of runs, versus 33–38 % for established methods.

**"Does a failure mean the plan is bad?"**
No. It shows the conditions under which this model says the promised benefit isn't delivered. That tells the city what to protect: water supply, tougher species or maintenance.

More questions and answers are in [JUDGE_QA.md](JUDGE_QA.md). The full technical guide is [HOW_IT_WORKS.md](HOW_IT_WORKS.md).

## 10. Show, don't tell: the videos

All of these are in [`/videos`](../videos) and also play on the website:

| Video | Use it to explain |
| --- | --- |
| 02 Backend architecture tour | how a request travels through the system |
| 03 Simulation film, New Delhi | what "breaking" looks like over 10 years |
| 04–06 City previews | the same idea in a desert, a Mediterranean and a monsoon/humid city |
| 07 Benchmark race | why our search method is better, and that it was measured |
| 08 Where the AI is used | the six AI jobs and their safety checks |
| 10 Full workflow | the whole journey in one motion-graphics film |
| 09–14 Walkthroughs ([`videos/walkthroughs`](../videos/walkthroughs)) | the real site in Chrome: home page, Demo login, an investigation tab by tab, the AI building a scenario, the Copilot, benchmarks and architecture |

Pages to open live: `/how-it-works` (guide and AI demos), `/architecture` (3D backend map) and `/films/*` (every film full-screen).
