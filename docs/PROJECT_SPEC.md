# MASTER BUILD PROMPT — BACKFIRE AI

You are the principal AI architect, senior full-stack engineer, machine learning researcher, scientific computing engineer, and world-class product designer responsible for building BACKFIRE AI.

Your job is to develop a sophisticated, competition-grade, research-oriented web application.

Do not build a generic AI chatbot, climate dashboard, or ordinary SaaS application.

Build an actual scientific computing platform with advanced AI agents, custom optimisation algorithms, evidence-grounded reasoning, reproducible experiments, and an exceptional interactive user experience.

# 1. PRODUCT VISION

Product name: BACKFIRE AI

Full name: Adversarial Climate Intervention Falsification Laboratory.

Category: AI for Energy, Environment and Climate Action.

Core concept:

BACKFIRE evaluates environmental interventions by attempting to mathematically falsify their claimed environmental benefits.

Instead of simply asking whether a climate intervention will work, BACKFIRE asks:

"What is the smallest scientifically plausible combination of changed conditions and assumptions that could make this intervention fail?"

The system must:

1. Accept environmental intervention proposals.
2. Extract measurable claims and assumptions.
3. Retrieve relevant scientific evidence.
4. Construct evidence-grounded causal hypotheses.
5. Create parameterised environmental models.
6. Search for plausible failure conditions.
7. Quantify uncertainty and sensitivity.
8. Independently verify discovered counterexamples.
9. Suggest alternative interventions.
10. Generate reproducible scientific investigation reports.

IMPORTANT:

Do not claim that this concept, algorithm, or product is the first of its kind.

Existing research already covers causal inference, climate-policy stress testing, adversarial optimisation, robust decision-making, and multi-agent climate simulations.

Our objective is to investigate and implement a potentially distinctive contribution called Minimum Plausible Failure Search (MPFS), benchmark it against established methods, and establish whether it offers a measurable technical improvement.

# 2. CORE TECHNICAL CONTRIBUTION — MPFS

Develop a custom scientific optimisation engine named:

Minimum Plausible Failure Search (MPFS).

Its purpose is to identify the smallest plausible perturbation to environmental conditions or model assumptions that causes a claimed environmental benefit to fall below a defined success threshold.

Define:

B(x, θ) = Net environmental benefit.

Where:
- x represents environmental conditions.
- θ represents intervention parameters.
- B represents modelled net benefit.

The success condition is:

B(x, θ) >= B_min

The optimisation problem is:

Minimise:

||Δx||²_W + λ||Δθ||²_W

Subject to:

B(x + Δx, θ + Δθ) < B_min

And scientifically justified bounds, dependencies, and constraints.

Requirements:

- Implement parameter normalisation.
- Support different parameter units.
- Implement plausible parameter bounds.
- Support parameter dependencies.
- Implement objective functions.
- Implement constraint handling.
- Implement random initialisation with reproducible seeds.
- Implement differential evolution as an optimisation baseline.
- Implement NSGA-II as a multi-objective baseline.
- Implement MPFS as a separate experimental method.
- Implement sensitivity analysis using SALib.
- Support uncertainty analysis using Monte Carlo sampling.
- Record all optimisation evaluations.
- Save reproducible experiment configurations.
- Visualise failure boundaries.
- Compare MPFS against baseline methods.

Never invent performance improvements.

Produce experimental results before claiming that MPFS is faster, more accurate, or more innovative than existing methods.

# 3. FIRST SCIENTIFIC CASE STUDY

Initially support one complete case study:

Urban Afforestation Under Water Stress.

Research question:

Can an urban afforestation programme achieve its promised cooling benefits without causing unacceptable water stress under future climate conditions?

Build a parameterised model containing:

- Air temperature.
- Rainfall.
- Relative humidity.
- Soil moisture.
- Vegetation characteristics.
- Canopy coverage.
- Tree survival rate.
- Irrigation requirements.
- Evapotranspiration.
- Cooling effectiveness.
- Maintenance costs.
- Water availability.

Do not pretend that a simple mathematical formula is a validated environmental model.

Use peer-reviewed research to identify scientifically defensible equations and parameter ranges.

Document:
- Source of each parameter.
- Units.
- Model assumptions.
- Validity conditions.
- Uncertainty.
- Calibration requirements.

Use synthetic data only when clearly labelled as synthetic.

Do not present satellite land-surface temperature as equivalent to pedestrian-level air temperature.

Do not infer actual tree water consumption directly from vegetation indices.

Where empirical validation is unavailable, clearly label the results as exploratory simulations.

# 4. MULTI-AGENT AI ARCHITECTURE

Use LangGraph to implement a coordinated multi-agent workflow.

Build these specialised agents:

A. ORCHESTRATOR AGENT
- Controls investigations.
- Assigns tasks.
- Tracks execution state.
- Handles failures.
- Coordinates agents.
- Maintains structured investigation context.

B. CLAIM EXTRACTION AGENT
- Reads intervention proposals.
- Extracts measurable claims.
- Identifies success criteria.
- Extracts assumptions.
- Converts claims into structured JSON.

C. EVIDENCE RESEARCH AGENT
- Searches scientific publications.
- Retrieves research metadata.
- Extracts relevant evidence.
- Stores source references.
- Identifies conflicting findings.
- Tracks evidence provenance.

D. CAUSAL ANALYSIS AGENT
- Proposes causal relationships.
- Identifies confounding variables.
- Builds causal hypotheses.
- Assigns evidence references to edges.
- Clearly separates correlation from causation.

E. ADVERSARIAL RESEARCH AGENT
- Searches for possible failure mechanisms.
- Challenges intervention assumptions.
- Identifies environmental vulnerabilities.
- Proposes parameter combinations for testing.

F. OPTIMISATION AGENT
- Invokes MPFS.
- Runs numerical experiments.
- Compares optimisation baselines.
- Records discovered failure boundaries.

G. INDEPENDENT VERIFICATION AGENT
- Independently reproduces discovered counterexamples.
- Checks constraints.
- Verifies numerical calculations.
- Flags unsupported conclusions.
- Never approves its own generated results.

H. REPORT COMPILATION AGENT
- Generates scientific investigation reports.
- Includes evidence references.
- Includes parameter assumptions.
- Explains discovered vulnerabilities.
- Includes reproducibility information.

Important architecture rules:

- Use typed agent states.
- Use Pydantic structured outputs.
- Add retry policies.
- Add execution timeouts.
- Add maximum iteration limits.
- Add logging and tracing.
- Prevent infinite agent loops.
- Avoid unnecessary agent calls.
- Keep deterministic computation separate from LLM reasoning.

LLMs must never fabricate scientific numerical results.

All quantitative calculations must come from the scientific computation engine.

# 5. EVIDENCE INTELLIGENCE

Create a scientific evidence retrieval system.

Integrate:

- OpenAlex API.
- Crossref API.
- NASA POWER API.
- Copernicus Climate Data Store where accessible.
- Google Earth Engine datasets where appropriate.
- GBIF API where relevant.

Requirements:

- Search research by topic.
- Retrieve publication metadata.
- Store DOI and source URLs.
- Store publication year.
- Store relevant extracted passages.
- Track evidence quality and limitations.
- Identify contradictory evidence.
- Support citations in investigation reports.

Use PostgreSQL with pgvector for semantic retrieval.

Do not scrape websites illegally or bypass access controls.

Do not pretend that a search result proves a scientific claim.

Distinguish peer-reviewed research, government reports, preprints, and other sources.

# 6. WEB APPLICATION TECHNOLOGY STACK

Frontend:

- Next.js with App Router.
- TypeScript.
- Tailwind CSS.
- shadcn/ui.
- Framer Motion.
- Lucide icons.
- React Flow for causal graphs.
- Plotly or ECharts for scientific visualisations.
- MapLibre for geospatial visualisations.

Backend:

- Python.
- FastAPI.
- Pydantic.
- LangGraph.
- SQLAlchemy.
- WebSockets for live investigation updates.

Scientific computing:

- NumPy.
- SciPy.
- pandas.
- Scikit-learn.
- PyTorch where justified.
- NetworkX.
- DoWhy.
- EconML.
- pymoo.
- SALib.

Infrastructure:

- PostgreSQL.
- PostGIS.
- pgvector.
- Redis.
- Celery or an appropriate background task system.
- Docker.
- Docker Compose.

Deployment target:

A self-hosted Ubuntu server running Docker and Coolify.

Keep deployment compatible with a GitHub-to-Coolify workflow.

# 7. DESIGN SYSTEM — EXTREMELY IMPORTANT

The interface must feel like a combination of:

- Advanced scientific research laboratory.
- Cybersecurity intelligence platform.
- Futuristic command centre.
- High-end research software.

Visual direction:

- Premium dark theme.
- Near-black backgrounds.
- Deep navy surfaces.
- Subtle emerald and cyan accents.
- Sophisticated typography.
- Fine grid patterns.
- Subtle atmospheric backgrounds.
- Beautiful data visualisations.
- Smooth transitions.
- Carefully controlled animations.

Avoid:

- Generic AI landing pages.
- Excessive gradients.
- Excessive glowing effects.
- Random floating cards.
- Oversized headings everywhere.
- Unnecessary glassmorphism.
- Generic dashboard templates.
- Fake metrics.
- Fake live activity.

The UI must look like a serious scientific product.

Create a consistent design system with:
- Design tokens.
- Typography scale.
- Spacing scale.
- Reusable components.
- Navigation patterns.
- Responsive layouts.
- Loading states.
- Empty states.
- Error states.

# 8. APPLICATION PAGES

Build the following complete pages.

PAGE 1 — GLOBAL INTELLIGENCE

- Interactive world map.
- Environmental investigation locations.
- Investigated intervention categories.
- Evidence coverage.
- Investigation history.
- Global research statistics, calculated from actual stored data.

PAGE 2 — INTERVENTION LAB

- Create investigation.
- Enter intervention description.
- Upload PDF research reports.
- Define environmental objectives.
- Define success thresholds.
- Configure parameters.
- Select geographical context.
- Start investigation.

PAGE 3 — CLAIM ANALYSIS

- Extracted claims.
- Assumptions.
- Success criteria.
- Unsupported claims.
- Evidence references.
- Editable claim structure.

PAGE 4 — CAUSAL INTELLIGENCE

- Interactive causal graph.
- Nodes representing environmental variables.
- Directed causal relationships.
- Evidence-backed graph edges.
- Confidence and uncertainty.
- Relationship details on click.
- Alternative causal hypotheses.

PAGE 5 — ADVERSARIAL ENGINE

- Live agent activity.
- Investigation progress.
- Hypothesis generation.
- Optimisation execution.
- Search evaluation counter.
- Failure discovery events.
- Agent reasoning summaries.
- Execution logs.

Do not expose hidden chain-of-thought or private internal model reasoning. Show concise evidence-based explanations and execution events.

PAGE 6 — FAILURE BOUNDARY EXPLORER

- Interactive parameter space.
- Success/failure regions.
- Sensitivity charts.
- Parameter sliders.
- Scenario comparison.
- Counterexample exploration.
- Uncertainty intervals.
- Re-run simulations after parameter changes.

PAGE 7 — ALTERNATIVE INTERVENTIONS

- Suggest alternative species.
- Suggest different plantation density.
- Suggest alternative irrigation strategies.
- Recalculate scenarios.
- Compare environmental trade-offs.

Every alternative must use the actual scientific computation engine.

PAGE 8 — EVIDENCE EXPLORER

- Research publications.
- DOI links.
- Source metadata.
- Evidence passages.
- Contradictory findings.
- Confidence and limitations.

PAGE 9 — FALSIFICATION CERTIFICATE

Generate a detailed report containing:

- Investigation ID.
- Intervention description.
- Original claims.
- Success criteria.
- Evidence sources.
- Causal assumptions.
- Mathematical model.
- Parameter ranges.
- Optimisation algorithm and version.
- Discovered counterexamples.
- Uncertainty analysis.
- Verification results.
- Reproducibility configuration.
- Known limitations.

Export as PDF and JSON.

PAGE 10 — SETTINGS

- API key management.
- AI provider configuration.
- Model selection.
- Investigation settings.
- Usage monitoring.
- User preferences.

# 9. DATABASE DESIGN

Create appropriate relational database models.

At minimum:

- users
- organisations
- investigations
- interventions
- claims
- assumptions
- evidence_sources
- evidence_passages
- causal_graphs
- causal_nodes
- causal_edges
- environmental_parameters
- model_configurations
- agent_executions
- agent_events
- optimisation_runs
- optimisation_evaluations
- counterexamples
- verification_results
- scenario_comparisons
- investigation_reports
- audit_logs

Use UUID primary keys.

Use foreign-key relationships.

Add appropriate indexes.

Store timestamps in UTC.

Store investigation configuration and algorithm versions to enable reproducibility.

Implement database migrations with Alembic.

# 10. API DESIGN

Create REST endpoints for:

Authentication:
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/refresh

Investigations:
- POST /api/investigations
- GET /api/investigations
- GET /api/investigations/{id}
- DELETE /api/investigations/{id}

Analysis:
- POST /api/investigations/{id}/analyse
- GET /api/investigations/{id}/claims
- GET /api/investigations/{id}/evidence
- GET /api/investigations/{id}/causal-graph

Optimisation:
- POST /api/investigations/{id}/run-backfire
- GET /api/investigations/{id}/optimisation
- GET /api/investigations/{id}/counterexamples

Verification:
- POST /api/counterexamples/{id}/verify
- GET /api/investigations/{id}/verification

Reports:
- GET /api/investigations/{id}/report
- GET /api/investigations/{id}/report/pdf
- GET /api/investigations/{id}/report/json

Use WebSockets for live execution events.

Implement authentication, authorisation, validation, rate limiting and audit logging.

# 11. SECURITY

Security is a priority.

Implement:

- Secure password hashing.
- JWT or secure session-based authentication.
- Role-based access control.
- API key encryption at rest.
- Environment-based secrets.
- File upload validation.
- File size limits.
- PDF processing sandboxing.
- Rate limiting.
- Input sanitisation.
- SQL injection protection.
- SSRF protection for evidence retrieval.
- CORS restrictions.
- Secure HTTP headers.
- Audit logs.

Never expose API keys in frontend code.

Never commit secrets to GitHub.

Never execute arbitrary code extracted from uploaded documents.

# 12. TESTING AND VALIDATION

Build a comprehensive testing strategy.

Backend:
- Unit tests.
- API integration tests.
- Scientific calculation tests.
- Optimisation constraint tests.
- Agent workflow tests.
- Database tests.

Frontend:
- Component tests.
- Interaction tests.
- Loading and failure states.
- Responsive design tests.
- End-to-end tests with Playwright.

Scientific validation:

Create synthetic benchmark problems with known failure boundaries.

Test:

1. Whether MPFS discovers known counterexamples.
2. How many evaluations it requires.
3. How close it gets to the true failure boundary.
4. Whether it respects physical constraints.
5. Whether results are reproducible.
6. How it compares with random search.
7. How it compares with differential evolution.
8. How it compares with NSGA-II.

Create ablation experiments to identify which components contribute to performance.

Never invent benchmark scores.

# 13. DEVELOPMENT WORKFLOW

Work in stages.

Do not attempt to build everything simultaneously.

STAGE 1 — REPOSITORY INSPECTION

First inspect the current working directory.

Identify:
- Existing files.
- Existing project configuration.
- Existing code.
- Installed dependencies.
- Git status.
- Existing infrastructure.

Do not delete or overwrite existing work without inspecting it.

STAGE 2 — ARCHITECTURE

Create:
- PROJECT_SPEC.md
- ARCHITECTURE.md
- SCIENTIFIC_METHODOLOGY.md
- DATABASE_SCHEMA.md
- API_SPEC.md
- DEVELOPMENT_ROADMAP.md

Identify unresolved research assumptions.

STAGE 3 — REPOSITORY FOUNDATION

Set up:
- Frontend.
- Backend.
- Database.
- Redis.
- Docker Compose.
- Environment templates.
- Development documentation.

Verify that the project runs.

STAGE 4 — SCIENTIFIC ENGINE

Implement the environmental model and MPFS first.

Create unit tests and synthetic benchmark functions.

Do not proceed to complex AI orchestration until the numerical engine works.

STAGE 5 — AI AGENTS

Implement the agent workflow.

Use mocked model providers during testing.

Implement provider abstraction so different AI models can be configured without rewriting the system.

STAGE 6 — FRONTEND

Build all application pages.

Connect the frontend to real backend endpoints.

Use real computation results.

STAGE 7 — INTEGRATION

Connect:
- Evidence retrieval.
- Agent execution.
- Optimisation.
- Verification.
- Reports.

STAGE 8 — VALIDATION

Run all tests.

Fix errors.

Test the complete investigation workflow.

STAGE 9 — DEPLOYMENT

Prepare:
- Production Dockerfiles.
- Docker Compose.
- Environment configuration.
- Health checks.
- Database migrations.
- Persistent storage.
- Coolify deployment instructions.

# 14. IMPORTANT ENGINEERING RULES

1. Never create fake functionality just to make the interface look complete.
2. Never use hardcoded fake results in production.
3. Never invent scientific citations.
4. Never treat LLM output as numerical scientific evidence.
5. Never claim an intervention is environmentally harmful solely because a simulated scenario fails.
6. Show uncertainty and limitations.
7. Use deterministic calculations where possible.
8. Keep AI provider integrations modular.
9. Make every major operation observable and reproducible.
10. Use clean, maintainable, documented code.
11. Build reusable components.
12. Never leave critical features as non-functional placeholders.
13. Run tests after meaningful changes.
14. Keep the project deployable throughout development.
15. Do not stop after creating a plan. Implement the project stage by stage.

# 15. DEFINITION OF DONE

The first competition-ready release is complete when a user can:

1. Register and log in.
2. Create an urban afforestation investigation.
3. Submit intervention claims and parameters.
4. Retrieve scientific evidence.
5. Review the extracted claims and causal graph.
6. Run the scientific environmental model.
7. Run MPFS and baseline optimisers.
8. Discover and inspect counterexamples.
9. Verify counterexamples.
10. Explore failure boundaries interactively.
11. Compare alternative interventions.
12. Generate and download a reproducible falsification certificate.

All of this must work through the web interface.

# YOUR FIRST TASK

Start by inspecting the current repository.

Do not immediately generate thousands of lines of code.

First:
1. Inspect the existing project.
2. Identify its current state.
3. Produce the proposed architecture.
4. Identify scientific and technical risks.
5. Create the project documentation.
6. Create a staged implementation checklist.
7. Begin implementing Stage 1.

After each stage:
- Run tests.
- Report what was implemented.
- Report what remains incomplete.
- Report any errors.
- Explain the next development step.

You are responsible for delivering a genuinely working scientific software product, not just a beautiful mockup.

Begin now.