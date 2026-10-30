"""LangGraph multi-agent investigation workflow.

Graph:   orchestrator ──► <agent node> ──► orchestrator ──► ... ──► END

* The orchestrator holds the plan and routes to the next pending agent; it stops
  on a failed required step, on completion, or when ``max_iterations`` is hit
  (loop guard).
* Each agent node runs inside ``_run_agent`` which provides: an AgentExecution
  record, retry policy, execution timeout, structured events and logging.
* Deterministic computation (science/*) is strictly separated from language
  tasks (providers.py). LLM output never becomes a numerical result.
"""
from __future__ import annotations

import concurrent.futures as cf
import logging
import time
import traceback
import uuid
from typing import Any, Callable, TypedDict

import numpy as np
from langgraph.graph import END, StateGraph
from sqlalchemy import delete, select

from ..core.config import get_settings
from ..core.security import decrypt_secret
from ..db import session_scope, utcnow
from ..models import (AgentExecution, AnalysisResult, ApiKey, Assumption, CausalEdge, CausalGraph, CausalNode, Claim,
                      Counterexample, EvidencePassage, EvidenceSource, Investigation, LlmUsage, OptimisationEvaluation,
                      OptimisationRun, ScenarioComparison, User, VerificationResult)
from ..science import analysis as A
from ..science import model as M
from ..science.baselines import run_method
from ..science.mpfs import MPFS_VERSION
from ..science.parameters import ENV_NAMES, PARAM_INDEX, PARAM_NAMES, PARAMETERS, REFERENCES
from ..science.verification import VERIFIER_VERSION, verify_counterexample
from ..services import context as C
from ..services import evidence as E
from ..services.embedding import embed
from ..services.events import bus
from . import causal as CA
from . import claims as CL
from .providers import ProviderError, build_provider

log = logging.getLogger("backfire.agents")

ANALYSE_PLAN = ["claim_extraction", "evidence_research", "causal_analysis"]
BACKFIRE_PLAN = ["adversarial_research", "optimisation", "verification", "alternatives", "report_compilation"]

AGENT_LABELS = {
    "orchestrator": "Orchestrator",
    "claim_extraction": "Claim Extraction Agent",
    "evidence_research": "Evidence Research Agent",
    "causal_analysis": "Causal Analysis Agent",
    "adversarial_research": "Adversarial Research Agent",
    "optimisation": "Optimisation Agent",
    "verification": "Independent Verification Agent",
    "alternatives": "Optimisation Agent · Alternatives",
    "report_compilation": "Report Compilation Agent",
}
RETRIES = {"evidence_research": 2, "claim_extraction": 1}
REQUIRED = {"claim_extraction", "causal_analysis", "adversarial_research", "optimisation", "verification", "report_compilation"}


class InvestigationState(TypedDict, total=False):
    investigation_id: str
    user_id: str
    plan: list[str]
    completed: list[str]
    failed: list[str]
    iteration: int
    max_iterations: int
    next: str
    summaries: dict[str, str]
    aborted: bool


# --------------------------------------------------------------------------- helpers
def _emit(inv_id: str, agent: str, type_: str, msg: str, data: dict | None = None, exec_id=None):
    return bus.emit(inv_id, agent, type_, msg, data, exec_id)


def _set_stage(inv_id: str, stage: str, status: str | None = None, error: str | None = None):
    with session_scope() as db:
        inv = db.get(Investigation, uuid.UUID(inv_id))
        inv.stage = stage
        if status:
            inv.status = status
        inv.error = error


def _run_agent(name: str, fn: Callable[[str, str, Any], str], state: InvestigationState) -> InvestigationState:
    inv_id = state["investigation_id"]
    timeout = get_settings().agent_timeout_s
    retries = RETRIES.get(name, 0)
    with session_scope() as db:
        ex = AgentExecution(investigation_id=uuid.UUID(inv_id), agent=name, status="running")
        db.add(ex)
        db.flush()
        exec_id = ex.id
    _set_stage(inv_id, name)
    _emit(inv_id, name, "started", f"{AGENT_LABELS[name]} started.", exec_id=exec_id)
    attempt, err = 0, None
    summary = ""
    while attempt <= retries:
        attempt += 1
        pool = cf.ThreadPoolExecutor(max_workers=1)
        try:
            fut = pool.submit(fn, inv_id, state.get("user_id", ""), exec_id)
            summary = fut.result(timeout=timeout)
            err = None
            break
        except cf.TimeoutError:
            err = f"Timed out after {timeout:.0f}s"
        except Exception as exc:  # noqa: BLE001 - recorded and surfaced
            err = f"{type(exc).__name__}: {exc}"
            log.error("agent %s failed: %s", name, traceback.format_exc())
        finally:
            pool.shutdown(wait=False)
        if attempt <= retries:
            _emit(inv_id, name, "warning", f"Attempt {attempt} failed ({err}); retrying.", exec_id=exec_id)
            time.sleep(min(2 * attempt, 5))
    with session_scope() as db:
        ex = db.get(AgentExecution, exec_id)
        ex.attempts = attempt
        ex.finished_at = utcnow()
        ex.status = "failed" if err else "succeeded"
        ex.error = err
        ex.summary = summary or (err or "")
    st = dict(state)
    st["summaries"] = {**state.get("summaries", {}), name: summary or err or ""}
    if err:
        st["failed"] = state.get("failed", []) + [name]
        _emit(inv_id, name, "error", f"{AGENT_LABELS[name]} failed: {err}", exec_id=exec_id)
    else:
        st["completed"] = state.get("completed", []) + [name]
        _emit(inv_id, name, "completed", summary, exec_id=exec_id)
    return st  # type: ignore[return-value]


# --------------------------------------------------------------------------- agents
def agent_claim_extraction(inv_id: str, user_id: str, exec_id) -> str:
    with session_scope() as db:
        inv = db.get(Investigation, uuid.UUID(inv_id))
        iv = inv.intervention
        text = (iv.description or "") + ("\n" + iv.source_text if iv.source_text else "")
        objectives = list(iv.objectives or [])
        prefs = {}
        key = None
        if user_id:
            u = db.get(User, uuid.UUID(user_id))
            prefs = (u.preferences or {}) if u else {}
            provider_name = prefs.get("llm_provider") or get_settings().default_llm_provider
            stored = list(db.scalars(select(ApiKey).where(ApiKey.user_id == uuid.UUID(user_id))))
            if provider_name == "deterministic" and stored:
                provider_name = "ollama" if any(s.provider == "ollama" for s in stored) else stored[0].provider
                prefs = {**prefs, "llm_provider": provider_name}
            k = next((s for s in stored if s.provider == provider_name), None)
            key = decrypt_secret(k.encrypted_key) if k else None
        db.execute(delete(Claim).where(Claim.investigation_id == inv.id, Claim.edited.is_(False)))
        db.execute(delete(Assumption).where(Assumption.investigation_id == inv.id, Assumption.source != "user"))

    rule = CL.extract_rule_based(text)
    provider = build_provider(prefs.get("llm_provider", "deterministic"), key, prefs.get("llm_model"), prefs.get("ollama_host"))
    llm_used, flagged = False, 0
    result = rule
    if provider.name != "deterministic":
        try:
            _emit(inv_id, "claim_extraction", "info", f"Reading proposal with {provider.name}:{provider.model}.", exec_id=exec_id)
            out, usage = provider.structured(CL.SYSTEM_PROMPT, text[:60000], CL.ClaimExtractionOutput)
            with session_scope() as db:
                db.add(LlmUsage(user_id=uuid.UUID(user_id), investigation_id=uuid.UUID(inv_id), provider=usage.provider,
                                model=usage.model, agent="claim_extraction", input_tokens=usage.input_tokens,
                                output_tokens=usage.output_tokens))
            kept = []
            for c in out.claims:
                if CL.traceable(c.text, text):
                    kept.append(c)
                else:
                    flagged += 1
            have = {(c.metric, c.threshold) for c in kept}
            kept += [c for c in rule.claims if (c.metric, c.threshold) not in have]
            result = CL.ClaimExtractionOutput(claims=kept, assumptions=out.assumptions + rule.assumptions,
                                              parameter_hints=rule.parameter_hints)
            llm_used = True
        except ProviderError as exc:
            _emit(inv_id, "claim_extraction", "warning", f"LLM extraction unavailable ({exc}); using rule-based extractor.",
                  exec_id=exec_id)

    with session_scope() as db:
        inv = db.get(Investigation, uuid.UUID(inv_id))
        edited_metrics = {c.metric for c in db.scalars(select(Claim).where(Claim.investigation_id == inv.id))}
        # user-defined objectives are authoritative success criteria
        obj_metrics = set()
        for o in objectives:
            if o.get("metric") in edited_metrics:
                continue
            obj_metrics.add(o.get("metric"))
            db.add(Claim(investigation_id=inv.id, text=o.get("label") or f"{o['metric']} {o['operator']} {o['threshold']}",
                         metric=o["metric"], operator=o["operator"], threshold=float(o["threshold"]), unit=o.get("unit"),
                         horizon_years=o.get("horizon_years"), measurable=True, is_success_criterion=True, source="user"))
        for c in result.claims:
            is_crit = bool(c.measurable and c.metric and c.metric not in obj_metrics and c.metric not in edited_metrics)
            if is_crit:
                obj_metrics.add(c.metric)
            db.add(Claim(investigation_id=inv.id, text=c.text, metric=c.metric, operator=c.operator, threshold=c.threshold,
                         unit=c.unit, horizon_years=c.horizon_years, measurable=c.measurable, is_success_criterion=is_crit,
                         support_status="untested" if c.measurable else "unsupported",
                         source="llm" if llm_used else "extracted"))
        for a in result.assumptions:
            db.add(Assumption(investigation_id=inv.id, text=a.text, parameter_name=a.parameter_name, source="extracted"))
        for a in CL.model_assumptions():
            db.add(Assumption(investigation_id=inv.id, text=a.text, parameter_name=a.parameter_name, source="model"))
        # apply design hints extracted from the text to the intervention parameter nominal values
        for row in C.get_params(db, inv.id):
            if row.name in result.parameter_hints and row.kind == "intervention":
                row.nominal = float(np.clip(result.parameter_hints[row.name], row.lower, row.upper))
        n_claims = len(result.claims) + len(objectives)
        n_vague = sum(1 for c in result.claims if not c.measurable)
    if flagged:
        _emit(inv_id, "claim_extraction", "warning", f"{flagged} LLM-reported claim(s) could not be traced to the source text "
                                                      "and were discarded.", exec_id=exec_id)
    if result.parameter_hints:
        _emit(inv_id, "claim_extraction", "finding", "Design values read from the proposal: " +
              ", ".join(f"{k}={v:g}" for k, v in result.parameter_hints.items()), {"hints": result.parameter_hints}, exec_id)
    return (f"Extracted {n_claims} claim(s) ({n_vague} not measurable) and {len(result.assumptions)} stated assumption(s); "
            f"added {len(CL.model_assumptions())} model assumptions.")


def agent_evidence_research(inv_id: str, user_id: str, exec_id) -> str:
    with session_scope() as db:
        inv = db.get(Investigation, uuid.UUID(inv_id))
        lat, lon, name = inv.latitude, inv.longitude, inv.location_name
        db.execute(delete(EvidencePassage).where(EvidencePassage.investigation_id == inv.id))
        db.execute(delete(EvidenceSource).where(EvidenceSource.investigation_id == inv.id))

    # 1. climate context
    try:
        clim = E.nasa_power_climatology(lat, lon, name)
        _emit(inv_id, "evidence_research", "finding",
              f"Retrieved NASA POWER climatology for {lat:.2f}, {lon:.2f} (annual rain {sum(clim.precip_mm):.0f} mm, "
              f"warmest-month Tmax {max(clim.tmax):.1f} °C).", {"provider": "nasa_power"}, exec_id)
    except Exception as exc:  # noqa: BLE001
        clim = M.synthetic_climatology(lat, name=name)
        _emit(inv_id, "evidence_research", "warning",
              f"NASA POWER unavailable ({type(exc).__name__}). Using a clearly-labelled SYNTHETIC climatology; results "
              "are exploratory only.", exec_id=exec_id)
    with session_scope() as db:
        inv = db.get(Investigation, uuid.UUID(inv_id))
        cfg = C.build_config(db, inv)
        cfg.climatology = clim
        C.store_model_config(db, inv, cfg)
        if not clim.synthetic:
            db.add(EvidenceSource(investigation_id=inv.id, provider="nasa_power", title=f"NASA POWER climatology at "
                                  f"{lat:.3f}, {lon:.3f}", source_type="government_report", url="https://power.larc.nasa.gov/",
                                  quality={"score": 0.75, "basis": "reanalysis-derived gridded product"},
                                  limitations=["~0.5° grid reanalysis; does not resolve urban heat island or street-level microclimate.",
                                               "2 m air temperature, not land-surface temperature."], doi_verified=False))

    # 2. literature search (OpenAlex) per topic
    works: list[E.Work] = []
    errors = 0
    for topic in E.TOPICS:
        try:
            ws = E.search_openalex(topic, per_page=5)
            works += ws
            _emit(inv_id, "evidence_research", "progress", f"OpenAlex '{E.TOPICS[topic]['query']}': {len(ws)} works.",
                  {"topic": topic, "count": len(ws)}, exec_id)
        except Exception as exc:  # noqa: BLE001
            errors += 1
            _emit(inv_id, "evidence_research", "warning", f"OpenAlex query for '{topic}' failed: {type(exc).__name__}.",
                  exec_id=exec_id)
    # 3. resolve registry references via Crossref (parameter provenance)
    registry_rows = []
    for ref in REFERENCES.values():
        meta = E.crossref_lookup(ref.doi) if ref.doi else None
        registry_rows.append((ref, meta))
    if errors == len(E.TOPICS) and not any(m for _, m in registry_rows):
        raise RuntimeError("All evidence providers unreachable")

    seen_doi: set[str] = set()
    n_pass = n_contra = 0
    with session_scope() as db:
        for ref, meta in registry_rows:
            src = EvidenceSource(
                investigation_id=uuid.UUID(inv_id), provider="registry" if not meta else "crossref", doi=ref.doi,
                title=(meta or {}).get("title") or ref.citation, authors=(meta or {}).get("authors", []),
                year=(meta or {}).get("year"), venue=(meta or {}).get("venue"), source_type=ref.source_type,
                url=(f"https://doi.org/{ref.doi}" if ref.doi else ref.url), cited_by=(meta or {}).get("cited_by"),
                abstract=None, quality={"score": 0.8 if ref.source_type == "peer_reviewed" else 0.7,
                                        "basis": "parameter-registry reference", "registry_key": ref.key},
                limitations=([] if meta or not ref.doi else ["DOI could not be resolved via Crossref at retrieval time."]),
                doi_verified=bool(meta), query="parameter registry")
            db.add(src)
            if ref.doi:
                seen_doi.add(ref.doi.lower())
        for w in works:
            if w.doi and w.doi.lower() in seen_doi:
                continue
            if w.doi:
                seen_doi.add(w.doi.lower())
            src = EvidenceSource(investigation_id=uuid.UUID(inv_id), provider="openalex", doi=w.doi, title=w.title,
                                 authors=w.authors, year=w.year, venue=w.venue, source_type=w.source_type, url=w.url,
                                 cited_by=w.cited_by, abstract=w.abstract, quality=w.quality, limitations=w.limitations,
                                 doi_verified=bool(w.doi), query=w.query)
            db.add(src)
            db.flush()
            for p in w.passages:
                db.add(EvidencePassage(source_id=src.id, investigation_id=uuid.UUID(inv_id), text=p.text, topic=p.topic,
                                       stance=p.stance, relevance=p.relevance, embedding=embed(p.text)))
                n_pass += 1
                n_contra += p.stance == "contradicts"
    if n_contra:
        _emit(inv_id, "evidence_research", "finding", f"{n_contra} passage(s) heuristically flagged as contradicting the "
                                                      "intervention's expected benefits.", exec_id=exec_id)
    verified = sum(1 for _, m in registry_rows if m)
    return (f"Stored {len(works)} OpenAlex works ({n_pass} passages, {n_contra} contradicting) and "
            f"{len(registry_rows)} registry references ({verified} DOIs resolved via Crossref). Climate: "
            f"{'NASA POWER' if not clim.synthetic else 'SYNTHETIC'}.")


def agent_causal_analysis(inv_id: str, user_id: str, exec_id) -> str:
    with session_scope() as db:
        iid = uuid.UUID(inv_id)
        for g in db.scalars(select(CausalGraph).where(CausalGraph.investigation_id == iid)):
            db.execute(delete(CausalEdge).where(CausalEdge.graph_id == g.id))
            db.execute(delete(CausalNode).where(CausalNode.graph_id == g.id))
            db.delete(g)
        passages = [{"id": str(p.id), "topic": p.topic, "stance": p.stance}
                    for p in db.scalars(select(EvidencePassage).where(EvidencePassage.investigation_id == iid))]
    results = []
    for alt in (False, True):
        built = CA.build(passages, alternative=alt)
        with session_scope() as db:
            g = CausalGraph(investigation_id=uuid.UUID(inv_id), is_alternative=alt,
                            name="Alternative hypotheses (not in model)" if alt else "Implemented model structure",
                            description=("Primary graph plus hypothesised mechanisms absent from the computational model."
                                         if alt else "Every edge corresponds to an implemented model equation or assumption."),
                            analysis=built.analysis)
            db.add(g)
            db.flush()
            for n in built.nodes:
                db.add(CausalNode(graph_id=g.id, **n))
            for e in built.edges:
                db.add(CausalEdge(graph_id=g.id, **e))
        results.append(built)
    # update claim support status from evidence stance on the relevant topic
    topic_of = {"cooling_c": "cooling", "survival_rate": "mortality", "water_stress_index": "drought_stress",
                "irrigation_m3_ha": "water_use"}
    with session_scope() as db:
        for c in db.scalars(select(Claim).where(Claim.investigation_id == uuid.UUID(inv_id), Claim.measurable.is_(True))):
            t = topic_of.get(c.metric or "")
            ps = [p for p in passages if p["topic"] == t]
            sup = [p["id"] for p in ps if p["stance"] == "supports"]
            con = [p["id"] for p in ps if p["stance"] == "contradicts"]
            c.evidence_ids = (sup + con)[:10]
            c.support_status = "contested" if sup and con else "supported" if sup else "contested" if con else "untested"
    a = results[0].analysis
    _emit(inv_id, "causal_analysis", "finding",
          f"Model graph: {a['n_nodes']} variables, {a['n_edges']} directed relations, acyclic={a['acyclic']}. "
          f"Alternative graph adds {len(CA.ALT_EDGES)} hypothesised mechanisms.", exec_id=exec_id)
    conf = [c for c in results[1].analysis["confounding"] if c["common_causes"]]
    if conf:
        _emit(inv_id, "causal_analysis", "finding", "Potential confounding: " + "; ".join(
            f"{c['treatment']}→{c['outcome']} shares causes {', '.join(c['common_causes'])}" for c in conf[:3]), exec_id=exec_id)
    return f"Built model-structure graph and alternative-hypothesis graph; {len(conf)} treatment/outcome pair(s) with structural confounders."


def agent_adversarial(inv_id: str, user_id: str, exec_id) -> str:
    with session_scope() as db:
        inv = db.get(Investigation, uuid.UUID(inv_id))
        cfg = C.build_config(db, inv)
        st = C.merged_settings(inv)
        rows = C.get_params(db, inv.id)
        v0, lo, hi = C.param_arrays(rows)
        active_env = [r.name for r in rows if r.active and r.kind == "environment" and r.upper > r.lower]
        all_active = [r.name for r in rows if r.active and r.upper > r.lower]
        db.execute(delete(AnalysisResult).where(AnalysisResult.investigation_id == inv.id))
    nominal = M.single(v0, cfg)
    _emit(inv_id, "adversarial_research", "info",
          f"Nominal scenario: B = {nominal['net_benefit']:.3f} ({'claim holds' if nominal['success'] else 'claim already fails'}); "
          f"binding criterion '{nominal['binding_criterion']}'.", {"nominal": {k: nominal[k] for k in
                                                                           ("cooling_c", "survival_rate", "water_stress_index")}}, exec_id)
    local = A.local_sensitivity(cfg, v0, lo, hi, all_active)
    sob = A.sobol_sensitivity(cfg, v0, lo, hi, active_env, n_base=int(st["sobol_base"]), seed=inv.seed)
    _emit(inv_id, "adversarial_research", "progress", f"Sobol sensitivity: {sob['n_evaluations']} model evaluations.",
          {"evaluations": sob["n_evaluations"]}, exec_id)
    with session_scope() as db:
        db.add(AnalysisResult(investigation_id=uuid.UUID(inv_id), kind="local_sensitivity", result={"rows": local, "base": "nominal"}))
        db.add(AnalysisResult(investigation_id=uuid.UUID(inv_id), kind="sobol", result=sob))
    st_idx = sob["results"]["net_benefit"]["ST"]
    ranked = sorted(zip(sob["names"], st_idx), key=lambda t: -t[1])
    hypotheses = []
    for name, sti in ranked[:5]:
        r = next((x for x in local if x["name"] == name), None)
        if not r:
            continue
        direction = "lower" if r["low"] < r["high"] else "upper"
        spec = PARAMETERS[PARAM_INDEX[name]]
        worst = min(r["low"], r["high"])
        hypotheses.append({"parameter": name, "label": spec.label, "direction": direction, "sobol_total": sti,
                           "one_at_a_time_B": worst, "single_factor_falsifies": worst < 0, "status": spec.status})
        _emit(inv_id, "adversarial_research", "finding",
              f"Hypothesis: moving '{spec.label}' toward its {direction} plausible bound erodes the margin "
              f"(total Sobol index {sti:.2f}; one-at-a-time B = {worst:.3f}{', falsifies alone' if worst < 0 else ''}).",
              {"hypothesis": hypotheses[-1]}, exec_id)
    with session_scope() as db:
        db.add(AnalysisResult(investigation_id=uuid.UUID(inv_id), kind="hypotheses", result={"hypotheses": hypotheses,
                              "nominal": nominal}))
    return f"Generated {len(hypotheses)} failure hypotheses from sensitivity analysis; {sum(h['single_factor_falsifies'] for h in hypotheses)} falsify the claim on their own."


def agent_optimisation(inv_id: str, user_id: str, exec_id) -> str:
    with session_scope() as db:
        inv = db.get(Investigation, uuid.UUID(inv_id))
        cfg = C.build_config(db, inv)
        st = C.merged_settings(inv)
        prob = C.build_problem(db, inv, cfg)
        seed = inv.seed
        for r in db.scalars(select(OptimisationRun).where(OptimisationRun.investigation_id == inv.id)):
            db.execute(delete(OptimisationEvaluation).where(OptimisationEvaluation.run_id == r.id))
        cex_ids = [c.id for c in db.scalars(select(Counterexample).where(Counterexample.investigation_id == inv.id))]
        if cex_ids:
            db.execute(delete(VerificationResult).where(VerificationResult.counterexample_id.in_(cex_ids)))
        db.execute(delete(Counterexample).where(Counterexample.investigation_id == inv.id))
        db.execute(delete(OptimisationRun).where(OptimisationRun.investigation_id == inv.id))
        inv.algorithm_versions = {"mpfs": MPFS_VERSION, "model": M.MODEL_VERSION, "verifier": VERIFIER_VERSION,
                                  "baselines": "1.0.0"}
    budget = int(st["budget"])
    _emit(inv_id, "optimisation", "info", f"Search space: {prob.dim} active parameters, λ = {prob.lam}, budget {budget} "
                                          f"evaluations per method, seed {seed}.", {"problem": prob.describe()}, exec_id)
    # live evaluation counter: wrap the problem's evaluate()
    orig = prob.evaluate
    counter = {"n": 0, "last": 0, "method": ""}

    def counted(U, phase="search"):
        B, CV = orig(U, phase)
        counter["n"] += len(B)
        if counter["n"] - counter["last"] >= 200:
            counter["last"] = counter["n"]
            _emit(inv_id, "optimisation", "progress", f"{counter['method']}: {prob.log.count} evaluations",
                  {"method": counter["method"], "evaluations": prob.log.count, "total_evaluations": counter["n"]}, exec_id)
        return B, CV

    prob.evaluate = counted  # type: ignore[method-assign]
    summary = []
    best_overall = None
    for key in st["methods"]:
        counter["method"] = {"mpfs": "MPFS", "random": "Random search", "de": "Differential evolution", "nsga2": "NSGA-II"}.get(key, key)
        counter["last"] = counter["n"]
        res = run_method(key, prob, budget, seed)
        U, B, CV, phases = prob.log.arrays()
        dist = prob.norm(U) if len(U) else np.zeros(0)
        pending: list[tuple[str, str, dict]] = []
        with session_scope() as db:
            run = OptimisationRun(investigation_id=uuid.UUID(inv_id), method=res.method, method_key=key, version=res.version,
                                  budget=budget, seed=seed, evaluations=res.evaluations, found=res.found,
                                  best_distance=res.best_distance, best_b=res.best_b, first_failure_at=res.first_failure_at,
                                  runtime_s=res.runtime_s, config=res.config, problem=prob.describe(),
                                  convergence=res.convergence, notes=res.notes + (["Claim fails at nominal."] if res.nominal_failure else []))
            db.add(run)
            db.flush()
            db.bulk_insert_mappings(OptimisationEvaluation, [
                {"id": uuid.uuid4(), "run_id": run.id, "idx": i, "u": np.round(U[i], 5).tolist(), "b": float(B[i]),
                 "cv": float(CV[i]) if np.isfinite(CV[i]) else -1.0, "distance": float(dist[i]), "phase": phases[i]}
                for i in range(len(B))
            ])
            cands = res.candidates if key == "mpfs" else res.candidates[:1]
            for rank, cand in enumerate(cands, start=1):
                x = prob.to_physical(np.array(cand["u"]))[0]
                r = M.single(x, cfg)
                deltas = {}
                for j, name in enumerate(prob.active):
                    i = PARAM_INDEX[name]
                    if abs(x[i] - prob.v0[i]) > 1e-9 * max(1, abs(prob.v0[i])):
                        deltas[name] = {"from": float(prob.v0[i]), "to": float(x[i]), "delta": float(x[i] - prob.v0[i]),
                                        "normalised": float(cand["u"][j]), "unit": PARAMETERS[i].unit, "label": PARAMETERS[i].label}
                ce = Counterexample(investigation_id=uuid.UUID(inv_id), run_id=run.id, rank=rank, method=res.method,
                                    distance=cand["distance"], net_benefit=r["net_benefit"], binding_criterion=r["binding_criterion"],
                                    parameters={n: float(x[PARAM_INDEX[n]]) for n in PARAM_NAMES}, deltas=deltas,
                                    metrics={k: r[k] for k in ("cooling_c", "survival_rate", "water_stress_index", "irrigation_m3_ha",
                                                               "annual_cost_usd_ha", "transpiration_ratio", "effective_canopy")},
                                    normalised=cand["u"], producer="optimisation_agent")
                db.add(ce)
                if rank == 1:
                    top = sorted(deltas.items(), key=lambda kv: -abs(kv[1]["normalised"]))[:3]
                    changes = ", ".join(f"{v['label']} {v['from']:.3g}→{v['to']:.3g}" for _, v in top)
                    msg = (f"{res.method}: counterexample at distance {cand['distance']:.3f} — {changes}; "
                           f"violates '{r['binding_criterion']}'." if changes else
                           f"{res.method}: the claim already fails under nominal conditions ('{r['binding_criterion']}').")
                    # emitted after commit: SQLite allows a single writer at a time
                    pending.append(("failure_found", msg, {"method": res.method, "distance": cand["distance"],
                                                           "evaluation": cand["eval_index"] + 1}))
        for type_, msg, data in pending:
            _emit(inv_id, "optimisation", type_, msg, data, exec_id)
        summary.append(f"{res.method}: " + (f"d={res.best_distance:.3f} after {res.evaluations} evals" if res.found else "no failure found"))
        if res.found and (best_overall is None or res.best_distance < best_overall):
            best_overall = res.best_distance
    prob.evaluate = orig  # type: ignore[method-assign]
    # Monte Carlo uncertainty of the nominal design
    with session_scope() as db:
        inv = db.get(Investigation, uuid.UUID(inv_id))
        rows = C.get_params(db, inv.id)
        v0, lo, hi = C.param_arrays(rows)
    env = [n for n in ENV_NAMES if n in prob.active]
    mc = A.monte_carlo(cfg, v0, lo, hi, env, n=int(st["mc_samples"]), seed=seed)
    with session_scope() as db:
        db.add(AnalysisResult(investigation_id=uuid.UUID(inv_id), kind="monte_carlo", result=mc))
    _emit(inv_id, "optimisation", "finding", f"Monte Carlo ({mc['n_valid']} plausible samples): failure probability "
                                             f"{mc['failure_probability']:.1%} (95% CI {mc['failure_ci95'][0]:.1%}–{mc['failure_ci95'][1]:.1%}).",
          exec_id=exec_id)
    return "; ".join(summary)


def agent_verification(inv_id: str, user_id: str, exec_id) -> str:
    with session_scope() as db:
        inv = db.get(Investigation, uuid.UUID(inv_id))
        cfg = C.build_config(db, inv)
        rows = C.get_params(db, inv.id)
        _, lo, hi = C.param_arrays(rows)
        cexs = list(db.scalars(select(Counterexample).where(Counterexample.investigation_id == inv.id)))
        items = [(c.id, c.parameters, c.net_benefit, c.producer, c.method, c.rank) for c in cexs]
    counts = {"verified": 0, "verified_with_warnings": 0, "rejected": 0}
    for cid, params, b, producer, method, rank in items:
        x = [params[n] for n in PARAM_NAMES]
        vr = verify_counterexample(cfg.to_dict(), x, b, lo.tolist(), hi.tolist(), producer=producer)
        counts[vr["status"]] += 1
        with session_scope() as db:
            db.execute(delete(VerificationResult).where(VerificationResult.counterexample_id == cid))
            db.add(VerificationResult(counterexample_id=cid, investigation_id=uuid.UUID(inv_id), status=vr["status"],
                                      verifier=vr["verifier"], verifier_version=vr["verifier_version"],
                                      recomputed_b=vr["recomputed_b"], robustness=vr["robustness"],
                                      config_hash=vr["config_hash"], checks=vr["checks"], flags=vr["flags"]))
            db.get(Counterexample, cid).status = vr["status"]
        if rank == 1:
            _emit(inv_id, "verification", "finding" if vr["status"] != "rejected" else "warning",
                  f"{method} counterexample → {vr['status'].replace('_', ' ')} (B recomputed {vr['recomputed_b']:.4f}, "
                  f"local robustness {vr['robustness']:.0%}).", {"counterexample_id": str(cid)}, exec_id)
    return (f"Independently re-evaluated {len(items)} counterexample(s): {counts['verified']} verified, "
            f"{counts['verified_with_warnings']} verified with warnings, {counts['rejected']} rejected.")


def agent_alternatives(inv_id: str, user_id: str, exec_id) -> str:
    rows_out = compute_alternatives(inv_id)
    better = [r for r in rows_out if r["key"] != "proposal" and r["failure_probability"] < rows_out[0]["failure_probability"]]
    _emit(inv_id, "alternatives", "finding", f"Evaluated {len(rows_out) - 1} alternatives with the model; "
                                             f"{len(better)} have lower failure probability than the proposal.", exec_id=exec_id)
    return f"{len(rows_out) - 1} alternative interventions evaluated under nominal, counterexample and Monte Carlo conditions."


def compute_alternatives(inv_id: str, custom: list[dict] | None = None) -> list[dict]:
    with session_scope() as db:
        inv = db.get(Investigation, uuid.UUID(inv_id))
        cfg = C.build_config(db, inv)
        v0, lo, hi = C.param_arrays(C.get_params(db, inv.id))
        cexs = db.scalars(select(Counterexample).where(Counterexample.investigation_id == inv.id,
                                                       Counterexample.status.in_(["verified", "verified_with_warnings"]))
                          .order_by(Counterexample.distance)).all()
        stress = [np.array([c.parameters[n] for n in PARAM_NAMES]) for c in cexs[:3]]
        seed = inv.seed
    alts = custom if custom is not None else A.generate_alternatives(v0, stress[0] if stress else None)
    rows_out = A.evaluate_alternatives(cfg, v0, lo, hi, stress, alts, mc_n=600, seed=seed)
    with session_scope() as db:
        db.add(ScenarioComparison(investigation_id=uuid.UUID(inv_id), name="Alternative interventions" if custom is None
                                  else "Custom scenarios", kind="alternatives" if custom is None else "scenario",
                                  inputs={"alternatives": alts, "n_stress_points": len(stress)}, result={"rows": rows_out}))
    return rows_out


def agent_report(inv_id: str, user_id: str, exec_id) -> str:
    from ..services.report import store_report

    with session_scope() as db:
        rep = store_report(db, uuid.UUID(inv_id))
        return f"Falsification certificate v{rep.version} compiled (SHA-256 {rep.content_hash[:12]}…)."


AGENTS: dict[str, Callable] = {
    "claim_extraction": agent_claim_extraction,
    "evidence_research": agent_evidence_research,
    "causal_analysis": agent_causal_analysis,
    "adversarial_research": agent_adversarial,
    "optimisation": agent_optimisation,
    "verification": agent_verification,
    "alternatives": agent_alternatives,
    "report_compilation": agent_report,
}


# --------------------------------------------------------------------------- graph
def orchestrator(state: InvestigationState) -> InvestigationState:
    st = dict(state)
    st["iteration"] = state.get("iteration", 0) + 1
    inv_id = state["investigation_id"]
    if st["iteration"] > state.get("max_iterations", 20):
        _emit(inv_id, "orchestrator", "error", "Maximum orchestration iterations reached; stopping (loop guard).")
        st["next"], st["aborted"] = END, True
        return st  # type: ignore[return-value]
    failed_required = [f for f in state.get("failed", []) if f in REQUIRED]
    if failed_required:
        _emit(inv_id, "orchestrator", "error", f"Required step '{failed_required[0]}' failed; investigation halted.")
        st["next"], st["aborted"] = END, True
        return st  # type: ignore[return-value]
    done = set(state.get("completed", [])) | set(state.get("failed", []))
    pending = [p for p in state["plan"] if p not in done]
    st["next"] = pending[0] if pending else END
    if pending:
        _emit(inv_id, "orchestrator", "info", f"Assigning task to {AGENT_LABELS[pending[0]]} "
                                              f"({len(done) + 1}/{len(state['plan'])}).", {"step": pending[0]})
    return st  # type: ignore[return-value]


def build_graph():
    g = StateGraph(InvestigationState)
    g.add_node("orchestrator", orchestrator)
    for name, fn in AGENTS.items():
        g.add_node(name, lambda s, _n=name, _f=fn: _run_agent(_n, _f, s))
        g.add_edge(name, "orchestrator")
    g.set_entry_point("orchestrator")
    g.add_conditional_edges("orchestrator", lambda s: s["next"], {**{n: n for n in AGENTS}, END: END})
    return g.compile()


GRAPH = build_graph()


def run_investigation(inv_id: str, user_id: str, mode: str) -> None:
    """Entry point used by the background worker."""
    with session_scope() as db:
        inv = db.get(Investigation, uuid.UUID(inv_id))
        analysed = inv.status in ("analysed", "completed") or inv.stage in BACKFIRE_PLAN
    plan = ANALYSE_PLAN if mode == "analyse" else (BACKFIRE_PLAN if analysed and mode == "backfire" else ANALYSE_PLAN + BACKFIRE_PLAN)
    _set_stage(inv_id, "queued", "analysing" if mode == "analyse" else "running")
    _emit(inv_id, "orchestrator", "started", f"Investigation workflow started ({mode}): " + " → ".join(AGENT_LABELS[p] for p in plan),
          {"plan": plan})
    t0 = time.perf_counter()
    try:
        final = GRAPH.invoke({"investigation_id": inv_id, "user_id": user_id, "plan": plan, "completed": [], "failed": [],
                              "iteration": 0, "max_iterations": len(plan) * 2 + 2, "summaries": {}},
                             {"recursion_limit": 100})
        ok = not final.get("aborted")
        status = ("analysed" if mode == "analyse" else "completed") if ok else "failed"
        _set_stage(inv_id, "done" if ok else "halted", status, None if ok else "; ".join(final.get("failed", [])))
        _emit(inv_id, "orchestrator", "completed" if ok else "error",
              f"Workflow {'finished' if ok else 'halted'} in {time.perf_counter() - t0:.1f}s.", {"status": status})
    except Exception as exc:  # noqa: BLE001
        log.exception("workflow crashed")
        _set_stage(inv_id, "halted", "failed", str(exc))
        _emit(inv_id, "orchestrator", "error", f"Workflow crashed: {exc}")
