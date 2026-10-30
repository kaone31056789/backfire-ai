# BACKFIRE AI — How It Works

## In one sentence

**BACKFIRE AI is a crash test for green promises.** It simulates ten years of a climate project in the real local climate. Then it searches thousands of possible futures for the **smallest realistic change that would make the promise fail**, so the plan can be fixed before the money is spent.

## The problem

Cities and climate funds spend large sums on projects such as urban tree planting. Their promises sound like *"the streets will be 0.5 °C cooler and half the trees will survive."*

Nobody systematically checks how *fragile* those promises are. A slightly hotter summer, a water shortage or weaker saplings can quietly break them, and by the time anyone notices, the trees are already dead.

## The idea

Most tools ask: *"Will this plan work on average?"*
BACKFIRE asks the opposite: *"What is the smallest plausible change that makes it fail?"*

This is the scientific idea of **falsification**: you trust a claim more once you have tried hard to break it and couldn't.

---

## How it works, in 5 steps

| # | Step | In plain words | What actually runs |
|---|---|---|---|
| 1 | **Read the promise** | Write down exactly what was promised. | Claim Extraction Agent: a language model (Ollama / Claude / GPT) or a rule-based reader turns the text into measurable targets, e.g. `cooling ≥ 0.5 °C`, `survival ≥ 50 %`. |
| 2 | **Gather the facts** | Look up the city's real climate and what scientists know. | Evidence Research Agent: NASA POWER monthly climate for the coordinates, OpenAlex papers, DOIs verified on Crossref. |
| 3 | **Build a mini-world** | Let ten years pass on the computer. | A daily water-balance model (FAO-56 Penman-Monteith) covering evaporation, soil moisture, drought stress, tree deaths and the cooling that survives. |
| 4 | **Try to break it** | Play "what if?" thousands of times. | Optimisation Agent: **MPFS** (our method) races three classic methods to find the minimum plausible failure. Sobol sensitivity and Monte Carlo quantify uncertainty. |
| 5 | **Double-check and fix** | A second checker repeats the result, then better plans are tried. | Independent Verification Agent re-computes every result from scratch. The Alternatives Agent re-tests safer designs under the *same harsh future*, and a signed, reproducible certificate is produced. |

## What the user sees (simple on the surface, complex underneath)

1. **Landing page** (`/`): a cinematic flight from space down to the city, a 30-second animated explainer, and a 3D simulation film of the demo city.
2. **Demo login:** one click, no password.
3. **Mission control** (`/dashboard`): a 3D satellite globe. Each investigation is a glowing column; the taller it is, the easier the promise breaks. Click it to fly into the city in 3D.
4. **New investigation** (`/lab`) takes three steps:
   - pick a ready-made situation, or click **Demo idea** (or type your own) and let the AI build the scenario;
   - check the promise;
   - press **Run the simulation**.
5. **Investigation pages:**
   - **Overview:** the plain-language verdict.
   - **▶ Simulation film:** a 3D movie of three futures.
   - **Failure boundary:** a 3D landscape where the claim fails in the red sea.
   - Also: alternatives, evidence, causal graph and the certificate.
6. **Ask AI** (button on every investigation): the Copilot answers questions using only computed numbers.
7. **Benchmarks:** a 3D race of the four search methods on courses with known answers.
8. **How it works** (`/how-it-works`): the public guide with judge Q&A.

---

## Where the AI is used

| Job | Type of AI | Guard-rail |
|---|---|---|
| Reading proposals into targets | Language model (Ollama, Claude or GPT), or rules | Any claim not found in the source text is discarded. |
| Building a scenario from a plain-language idea | Language model | Coordinates and targets are validated; falls back to rules. |
| Answering questions (Copilot) | Language model, or the grounded engine | Every number in the answer must exist in the computed facts, or the answer is rejected. |
| Narrating the simulation film | Language model, or the grounded narrator | Same number check. |
| Finding the breaking point | Search and evolutionary algorithms (MPFS, DE, NSGA-II) | Same budget and seed for all; every evaluation is logged. |
| Coordinating everything | Multi-agent system (LangGraph, 8 agents and an orchestrator) | Retries, time limits, loop guard, independent verifier. |

**Golden rule: AI reads and writes language; it never produces a result.** Every number comes from the simulation, and an independent agent re-computes it.

### Using Ollama
1. Open **Settings**.
2. Set the provider to **Ollama**.
3. Choose **Cloud** (paste your Ollama API key on the right) or **Local** (`ollama serve` on `127.0.0.1:11434`, no key).
4. Type a model name (e.g. `gpt-oss:120b`) and press **Save & test connection**.

Keys are stored **encrypted in the database** (`backend/backfire.db`), so they survive server restarts. Keep `SECRET_KEY` unchanged once set, or stored keys can no longer be decrypted.

---

## What is working (verified)

| Area | Status |
|---|---|
| Register / login / demo login, JWT cookies, roles, CSRF guard, rate limits, audit log | ✅ |
| Investigation workflow: 8 agents end to end (LangGraph) | ✅ |
| Real data: NASA POWER climate, OpenAlex papers, Crossref DOIs (all 9 registry citations resolve) | ✅ |
| Scientific model (FAO-56 water balance) with documented parameters | ✅ |
| MPFS plus random search, differential evolution and NSGA-II; Sobol; Monte Carlo | ✅ |
| Independent verification; reproducible signed certificate (PDF + JSON) | ✅ |
| 3D globe mission control, 3D failure landscape, 3D simulation film, 3D benchmark race | ✅ |
| AI Copilot, AI scenario builder, AI film narration (Ollama / Claude / OpenAI or grounded) | ✅ |
| Encrypted API keys persisted in the database | ✅ |
| Ollama structured output hardened (schema in the prompt plus one automatic repair); stored key used automatically | ✅ |
| AI scenario builder with "Surprise me" (empty box: the AI invents a plan and types it in) | ✅ |
| Live Lab preview film (plan plus a labelled hotter-and-drier what-if) before anything is saved | ✅ |
| Climate-specific film assets: desert, dry, Mediterranean, monsoon and humid, chosen from NASA climate | ✅ |
| Causal graph "Simple story" view with playable cause-and-effect stories | ✅ |
| Full-workflow films, 3D architecture map with guided tour, AI-uses reel | ✅ |
| Recording mode (`/films/*?record=1`) and `npm run record:videos` exporting MP4s to `videos/` | ✅ |
| Backend automated tests | ✅ 57 passing |

### Measured benchmark result
These numbers come from synthetic problems with known answers, 24 runs per method.

| Method | Hit the true weakest point (within 5 %) |
|---|---|
| **MPFS** | **~88 %** |
| Differential evolution | ~38 % |
| NSGA-II | ~33 % |
| Random search | 0 % |

### Honest limitations
- The coupled model is an **exploratory simulation**; parameters marked "assumption" (e.g. how drought raises tree mortality) are not yet calibrated with field data.
- A simulated failure means *the model does not deliver the promised benefit under those conditions*. It does not prove the project is harmful.
- Evidence "supports / contradicts" labels are keyword heuristics, not a systematic review.
- The city block in the film is illustrative staging; the trees' fate, thirst, rain and watering come from the model.

---

## 3-minute demo script

1. **Landing page (30 s):** scroll from orbit to street level, then point at the explainer reel.
   > "This is a crash test for green promises."
2. **Demo login → Mission control (20 s):** spin the globe and click the New Delhi column; the camera flies in.
   > "Taller column = easier to break."
3. **Overview (30 s):** read the verdict aloud.
   > "A change of just 0.29 of the plausible range breaks the survival promise, and it fails in about 60 % of futures."
4. **▶ Simulation film (40 s):** show *As planned → Breaking change → Better design*.
5. **Ask AI (20 s):** ask *"What should we change?"* and show that the answer cites real numbers.
6. **Benchmarks (20 s):** play the 3D race.
   > "We don't just claim our method is better; we race it on problems with known answers."
7. **New investigation (20 s):** click **Demo idea** and watch the AI type and build a scenario.

## How to run

```bash
# backend
cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8000
# frontend
cd frontend && npm run build && npm start      # http://localhost:3000
```

## More ways to explain it

- [EXPLAINER.md](EXPLAINER.md): a one-page guide with the analogy, the real numbers and a 3-minute click-through.
- `/architecture` in the app: a 3D map of the backend with a guided "follow one investigation" tour.
- [`../videos/`](../videos): eight MP4 films recorded from the running app.
