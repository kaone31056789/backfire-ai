"""AI Copilot: natural-language answers about an investigation, grounded in its computed facts.

* With an LLM key configured (Settings), Claude / OpenAI writes the answer from a JSON
  fact sheet. Any number in the answer that does not appear in the fact sheet causes the
  answer to be rejected and replaced by the grounded engine (anti-fabrication).
* Without a key, a deterministic grounded engine composes the answer from the same facts.
"""
from __future__ import annotations

import json
import random
import re
import uuid

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..agents.providers import ProviderError, build_provider
from ..core.config import get_settings
from ..core.security import decrypt_secret
from ..db import get_db
from ..models import AnalysisResult, ApiKey, Counterexample, EvidenceSource, LlmUsage, ScenarioComparison, User
from ..science import model as M
from ..science.parameters import METRICS, PARAM_INDEX, PARAMETERS, Criterion
from ..services import context as C
from .deps import audit, current_user, get_investigation, rate_limit_heavy

router = APIRouter(prefix="/api", tags=["assistant"])


def provider_for(db: Session, user: User):
    """The user's language model: the selected provider, or any provider whose key is stored in Settings."""
    prefs = user.preferences or {}
    pname = prefs.get("llm_provider") or get_settings().default_llm_provider
    keys = {k.provider: k for k in db.scalars(select(ApiKey).where(ApiKey.user_id == user.id))}
    if pname == "deterministic" and keys:
        pname = "ollama" if "ollama" in keys else next(iter(keys))
    row = keys.get(pname)
    return build_provider(pname, decrypt_secret(row.encrypted_key) if row else None, prefs.get("llm_model"), prefs.get("ollama_host"))


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=600)


class LlmAnswer(BaseModel):
    answer: str
    used_facts: list[str] = Field(default_factory=list)


def _latest(db: Session, inv_id, kind: str):
    return db.scalars(select(AnalysisResult).where(AnalysisResult.investigation_id == inv_id, AnalysisResult.kind == kind)
                      .order_by(AnalysisResult.created_at.desc())).first()


def build_facts(db: Session, inv) -> dict:
    cfg = C.build_config(db, inv)
    v0, _, _ = C.param_arrays(C.get_params(db, inv.id))
    nominal = M.single(v0, cfg)
    best = db.scalars(select(Counterexample).where(Counterexample.investigation_id == inv.id, Counterexample.method == "MPFS")
                      .order_by(Counterexample.distance)).first()
    mc = _latest(db, inv.id, "monte_carlo")
    sob = _latest(db, inv.id, "sobol")
    alts = db.scalars(select(ScenarioComparison).where(ScenarioComparison.investigation_id == inv.id, ScenarioComparison.kind == "alternatives")
                      .order_by(ScenarioComparison.created_at.desc())).first()
    srcs = db.scalars(select(EvidenceSource).where(EvidenceSource.investigation_id == inv.id)).all()
    facts: dict = {
        "intervention": inv.title, "location": f"{inv.location_name}, {inv.country}".strip(", "),
        "climate_source": cfg.climatology.source, "synthetic_climate": cfg.climatology.synthetic,
        "criteria": [{"metric": METRICS.get(c.metric, {}).get("label", c.metric), "op": c.op, "threshold": c.threshold} for c in cfg.criteria],
        "nominal": {"net_benefit_B": round(nominal["net_benefit"], 3), "claim_holds": nominal["success"],
                    "binding_criterion": METRICS.get(nominal["binding_criterion"], {}).get("label", nominal["binding_criterion"]),
                    "cooling_c": round(nominal["cooling_c"], 2), "survival_rate": round(nominal["survival_rate"], 3),
                    "water_stress_index": round(nominal["water_stress_index"], 3)},
        "evidence": {"sources": len(srcs), "peer_reviewed": sum(s.source_type == "peer_reviewed" for s in srcs)},
    }
    if best:
        top = sorted(best.deltas.values(), key=lambda d: -abs(d["normalised"]))[:4]
        facts["smallest_breaking_change"] = {
            "distance_d_star": round(best.distance, 3), "status": best.status,
            "violated": METRICS.get(best.binding_criterion, {}).get("label", best.binding_criterion),
            "changes": [{"parameter": d["label"], "from": round(d["from"], 4), "to": round(d["to"], 4), "unit": d["unit"],
                         "share_of_plausible_range": round(abs(d["normalised"]), 2)} for d in top],
            "metrics_at_failure": {k: round(v, 3) for k, v in best.metrics.items() if k in ("cooling_c", "survival_rate", "water_stress_index")},
        }
    if mc:
        facts["uncertainty"] = {"failure_probability": round(mc.result["failure_probability"], 3),
                                "ci95": [round(x, 3) for x in mc.result["failure_ci95"]], "samples": mc.result["n_valid"]}
    if sob:
        st = sob.result["results"]["net_benefit"]["ST"]
        ranked = sorted(zip(sob.result["labels"], st), key=lambda t: -t[1])[:4]
        facts["most_influential_conditions"] = [{"parameter": n, "total_sobol_index": round(v, 2)} for n, v in ranked]
    if alts:
        rows = alts.result["rows"]
        prop = next((r for r in rows if r["key"] == "proposal"), None)
        better = sorted([r for r in rows if r["key"] != "proposal"], key=lambda r: r["failure_probability"])[:3]
        facts["alternatives"] = {"proposal_failure_probability": round(prop["failure_probability"], 3) if prop else None,
                                 "best": [{"design": r["label"], "failure_probability": round(r["failure_probability"], 3),
                                           "median_cooling_c": round(r["cooling_p50"], 2)} for r in better]}
    facts["limitations"] = ["Exploratory simulation; uncalibrated assumption parameters.",
                            "A simulated failure shows conditions where the claimed benefit is not delivered by the model; it does not prove harm."]
    return facts


def _pct(x: float) -> str:
    return f"{x * 100:.0f}%"


def grounded_answer(q: str, f: dict) -> tuple[str, list[str]]:
    ql = q.lower()
    n = f["nominal"]
    sb = f.get("smallest_breaking_change")
    unc = f.get("uncertainty")
    used: list[str] = []

    def why() -> str:
        used.extend(["nominal", "smallest_breaking_change"])
        if not n["claim_holds"]:
            return f"The claim already fails under the proposal's own nominal conditions: the binding criterion is {n['binding_criterion'].lower()} (B = {n['net_benefit_B']})."
        if not sb:
            return "No counterexample has been found yet — run BACKFIRE to search for the smallest plausible failure."
        ch = "; ".join(f"{c['parameter'].lower()} moves from {c['from']} to {c['to']} {c['unit'] if c['unit'] != '–' else ''}".strip() for c in sb["changes"][:3])
        return (f"Under nominal conditions the claim holds (B = {n['net_benefit_B']}), but the search found that if {ch}, "
                f"{sb['violated'].lower()} misses its target. That combined change is only {sb['distance_d_star']} of the documented plausible range, "
                f"and it was {sb['status'].replace('_', ' ')} by the independent agent.")

    def sens() -> str:
        used.append("most_influential_conditions")
        mi = f.get("most_influential_conditions")
        if not mi:
            return "Sensitivity analysis has not run yet."
        lst = ", ".join(f"{m['parameter']} ({m['total_sobol_index']})" for m in mi)
        return f"The conditions that most control whether the claim holds (total Sobol index) are: {lst}. Several of these are uncalibrated assumptions, so local data on them would most reduce uncertainty."

    def fix() -> str:
        used.append("alternatives")
        a = f.get("alternatives")
        if not a or not a["best"]:
            return "Alternatives have not been evaluated yet."
        b = a["best"][0]
        others = ", ".join(x["design"] for x in a["best"][1:])
        return (f"The most robust option tested is “{b['design']}”: failure probability {_pct(b['failure_probability'])} versus {_pct(a['proposal_failure_probability'])} "
                f"for the original proposal, with median cooling of {b['median_cooling_c']} °C." + (f" Next best: {others}." if others else ""))

    def trust() -> str:
        used.extend(["uncertainty", "limitations", "climate_source"])
        s = ""
        if unc:
            s += f"Across {unc['samples']} uncertain futures the claim fails {_pct(unc['failure_probability'])} of the time (95% CI {_pct(unc['ci95'][0])}–{_pct(unc['ci95'][1])}). "
        s += ("Climate comes from " + ("a synthetic profile, so treat results as exploratory. " if f["synthetic_climate"] else "NASA POWER reanalysis. "))
        s += f["limitations"][0] + " " + f["limitations"][1]
        return s

    def evidence() -> str:
        used.append("evidence")
        e = f["evidence"]
        return f"The Evidence agent stored {e['sources']} sources ({e['peer_reviewed']} peer-reviewed). Open the Evidence tab to read passages, contradictions and DOIs."

    if re.search(r"why|fail|break|wrong|weak", ql):
        parts = [why()]
    elif re.search(r"assum|sensitiv|matter|important|driver|influen", ql):
        parts = [sens()]
    elif re.search(r"chang|improv|alternativ|recommend|fix|better|instead|should", ql):
        parts = [fix()]
    elif re.search(r"reliab|trust|confiden|certain|sure|accura|valid", ql):
        parts = [trust()]
    elif re.search(r"evidence|paper|source|study|literature", ql):
        parts = [evidence()]
    else:
        parts = [why(), fix() if f.get("alternatives") else ""]
    return " ".join(p for p in parts if p), sorted(set(used))


def _numbers(text: str) -> set[str]:
    """Numbers in a text, normalised so "0.50" and "0.5" compare equal (but "10" stays "10")."""
    out = set()
    for m in re.findall(r"\d+(?:\.\d+)?", text):
        out.add(f"{float(m):g}")
    return out


def stray_numbers(answer: str, facts_text: str, extra: set[str] = frozenset()) -> set[str]:
    """Numbers in an AI answer that cannot be traced to the facts.

    A number counts as grounded if it equals a fact after rounding to the precision written,
    either as-is or as a percentage of a fraction (0.848 → "84.8 %", "85%").
    """
    facts = [float(m) for m in re.findall(r"-?\d+(?:\.\d+)?(?:[eE]-?\d+)?", facts_text)]
    stray = set()
    for m in re.findall(r"\d+(?:\.\d+)?", answer):
        n = float(m)
        if f"{n:g}" in extra or (n.is_integer() and 0 <= n <= 10):
            continue
        dec = len(m.split(".")[1]) if "." in m else 0
        tol = 0.5 * 10 ** -dec + 1e-9
        if not any(abs(n - f) <= tol or abs(n - abs(f)) <= tol or abs(n - 100 * f) <= tol or abs(n - 100 * abs(f)) <= tol for f in facts):
            stray.add(m)
    return stray


@router.post("/investigations/{inv_id}/assistant", dependencies=[Depends(rate_limit_heavy)])
def ask(inv_id: uuid.UUID, body: AskIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    facts = build_facts(db, inv)
    provider = provider_for(db, user)
    if hasattr(provider, "timeout"):
        provider.timeout = 45  # interactive: answer from the grounded engine rather than keep the user waiting
    mode, model, note = "grounded", "BACKFIRE grounded engine", None
    answer, used = grounded_answer(body.question, facts)
    if provider.name != "deterministic":
        system = ("You are BACKFIRE's research copilot. Answer the user's question about a climate-intervention investigation "
                  "using ONLY the FACTS JSON. Never invent numbers, studies or results; every number you state must appear in FACTS. "
                  "Be concise (max 120 words), plain-language, and honest about uncertainty. List the top-level FACTS keys you used.")
        try:
            out, usage = provider.structured(system, f"FACTS:\n{json.dumps(facts)}\n\nQUESTION: {body.question}", LlmAnswer)
            db.add(LlmUsage(user_id=user.id, investigation_id=inv.id, provider=usage.provider, model=usage.model, agent="copilot",
                            input_tokens=usage.input_tokens, output_tokens=usage.output_tokens))
            stray = stray_numbers(out.answer, json.dumps(facts), {"95"})
            if stray:
                note = f"The language model stated numbers not present in the computed facts ({', '.join(sorted(stray)[:4])}); its answer was discarded."
            else:
                answer, used, mode, model = out.answer, out.used_facts, "llm", f"{usage.provider}:{usage.model}"
        except ProviderError as exc:
            note = f"Language model unavailable ({str(exc)[:80]}); answered with the grounded engine."
    audit(db, request, user, "assistant.ask", "investigation", inv.id, {"mode": mode})
    db.commit()
    return {"answer": answer, "mode": mode, "model": model, "used_facts": used, "note": note,
            "facts": {k: facts[k] for k in used if k in facts}}


# =============================================================================== simulation film
class SceneNarration(BaseModel):
    key: str
    narration: str


class FilmNarration(BaseModel):
    scenes: list[SceneNarration]


def _scenario(cfg, v, label_changes: list[dict]) -> dict:
    r = M.single(v, cfg, series=True)
    m = r["annual_mortality"]
    survival = [round((1 - m) ** t, 4) for t in range(cfg.horizon_years + 1)]  # the model's own survival equation
    crit = {c.metric: c for c in cfg.criteria}
    break_year = None
    if "survival_rate" in crit:
        thr = crit["survival_rate"].threshold
        break_year = next((t for t, s in enumerate(survival) if s < thr), None)
    s = r["series"]
    return {
        "changes": label_changes,
        "survival_by_year": survival,
        "annual_mortality": round(m, 4),
        "monthly": {"stress": [round(1 - k, 3) for k in s["stress_coeff"]], "irrigation_mm": s["irrigation_mm"],
                    "rain_mm": s["precip_mm"], "tmax_c": s["tmax"]},
        "metrics": {"cooling_c": round(r["cooling_c"], 3), "survival_rate": round(r["survival_rate"], 3),
                    "water_stress_index": round(r["water_stress_index"], 3), "irrigation_m3_ha": round(r["irrigation_m3_ha"], 0),
                    "effective_canopy": round(r["effective_canopy"], 3)},
        "success": r["success"],
        "binding": METRICS.get(r["binding_criterion"], {}).get("label", r["binding_criterion"]),
        "binding_metric": r["binding_criterion"],
        "break_year": break_year,
        "tree_density": float(v[PARAM_INDEX["tree_density"]]),
        "species_factor": float(v[PARAM_INDEX["species_factor"]]),
    }


BIOMES = {
    "desert": ("Desert city", "Very little rain all year: sand, palms and flat-roofed houses."),
    "semi_arid": ("Dry city", "A long dry season: dusty ground, umbrella-shaped trees."),
    "mediterranean": ("Mediterranean city", "Hot dry summers, rainy winters: terracotta roofs and olive-green trees."),
    "monsoon": ("Monsoon city", "Most rain falls in a few wet months: lush in the monsoon, parched before it."),
    "humid": ("Green, rainy city", "Rain in most months: lush broadleaf trees and green hills."),
}


def biome_of(clim) -> dict:
    """Classify the site's monthly climate into a visual setting for the film (staging only, not a model input)."""
    rain = list(clim.precip_mm)
    annual = sum(rain) or 1e-6
    order = sorted(range(12), key=lambda m: -clim.tmax[m])
    wet3 = sum(sorted(rain, reverse=True)[:3]) / annual
    summer = sum(rain[m] for m in order[:3]) / annual
    winter = sum(rain[m] for m in order[-3:]) / annual
    if annual < 250:
        key = "desert"
    elif annual >= 550 and wet3 >= 0.55:
        key = "monsoon"
    elif summer < 0.12 and winter >= 0.3 and annual < 1000:  # dry summers, wet winters
        key = "mediterranean"
    elif annual >= 900:
        key = "humid"
    else:
        key = "semi_arid"
    label, why = BIOMES[key]
    return {"key": key, "label": label, "why": why, "annual_rain_mm": round(annual), "hottest_tmax_c": round(max(clim.tmax), 1)}


def _template_narration(sc: dict, key: str) -> str:
    mt = sc["metrics"]
    surv = f"{mt['survival_rate'] * 100:.1f}%"
    if key == "plan":
        return (f"Under the conditions the proposal assumes, {surv} of the trees are still standing at the horizon and the streets "
                f"cool by {mt['cooling_c']:.2f} °C. " + ("The promise holds." if sc["success"] else f"Even here, {sc['binding'].lower()} misses its target."))
    if key == "break":
        ch = "; ".join(f"{c['label'].lower()} {c['from']:.3g} → {c['to']:.3g}" for c in sc["changes"][:3])
        when = f" The promise breaks in year {sc['break_year']}." if sc["break_year"] is not None else ""
        return f"Now a small, plausible shift: {ch}. Survival falls to {surv} and {sc['binding'].lower()} misses its target.{when}"
    return (f"Same harsh future, better design ({', '.join(c['label'].lower() for c in sc['changes'][:2])}). "
            f"{surv} of the trees survive and cooling reaches {mt['cooling_c']:.2f} °C. " + ("The promise holds." if sc["success"] else "It still falls short."))


def film_payload(db: Session, inv) -> dict:
    """Scenes computed by the engine with grounded narration (no language model involved)."""
    cfg = C.build_config(db, inv)
    v0, _, _ = C.param_arrays(C.get_params(db, inv.id))
    best = db.scalars(select(Counterexample).where(Counterexample.investigation_id == inv.id, Counterexample.method == "MPFS",
                                                   Counterexample.status != "rejected").order_by(Counterexample.distance)).first()
    scenes = [{"key": "plan", "title": "As planned", "subtitle": "The future the proposal assumes", **_scenario(cfg, v0, [])}]
    v_break = None
    if best:
        v_break = v0.copy()
        for n, val in best.parameters.items():
            v_break[PARAM_INDEX[n]] = val
        ch = sorted(best.deltas.values(), key=lambda d: -abs(d["normalised"]))
        scenes.append({"key": "break", "title": "The breaking change", "subtitle": f"Smallest plausible failure · d* = {best.distance:.2f}",
                       **_scenario(cfg, v_break, [{"label": d["label"], "from": d["from"], "to": d["to"], "unit": d["unit"]} for d in ch[:4]])})
    alts = db.scalars(select(ScenarioComparison).where(ScenarioComparison.investigation_id == inv.id, ScenarioComparison.kind == "alternatives")
                      .order_by(ScenarioComparison.created_at.desc())).first()
    if alts and v_break is not None:
        cand = sorted([r for r in alts.result["rows"] if r["key"] != "proposal"], key=lambda r: r["failure_probability"])
        if cand:
            a = cand[0]
            v_alt = v_break.copy()  # keep the harsh environment, change only the design
            for k, val in a["changes"].items():
                v_alt[PARAM_INDEX[k]] = val
            scenes.append({"key": "better", "title": "A better design", "subtitle": a["label"],
                           **_scenario(cfg, v_alt, [{"label": PARAMETERS[PARAM_INDEX[k]].label, "from": float(v0[PARAM_INDEX[k]]), "to": val,
                                                    "unit": PARAMETERS[PARAM_INDEX[k]].unit} for k, val in a["changes"].items()])})
    criteria = [{"metric": c.metric, "label": METRICS.get(c.metric, {}).get("label", c.metric), "op": c.op, "threshold": c.threshold} for c in cfg.criteria]
    for sc in scenes:
        sc["narration"] = _template_narration(sc, sc["key"])
    return {"title": inv.title, "location": inv.location_name, "country": inv.country, "horizon_years": cfg.horizon_years,
            "criteria": criteria, "climate_source": cfg.climatology.source, "synthetic_climate": cfg.climatology.synthetic,
            "biome": biome_of(cfg.climatology), "scenes": scenes, "narration_mode": "grounded", "narration_model": "BACKFIRE grounded narrator"}


@router.get("/investigations/{inv_id}/film")
def film(inv_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    out_film = film_payload(db, inv)
    scenes, criteria = out_film["scenes"], out_film["criteria"]

    # optional: the configured language model (e.g. Ollama) rewrites the narration; numbers must come from the scenes
    mode, model = "grounded", "BACKFIRE grounded narrator"
    if True:
        provider = provider_for(db, user)
        if provider.name != "deterministic":
            facts = {"intervention": inv.title, "location": inv.location_name, "criteria": criteria,
                     "scenes": [{k: sc[k] for k in ("key", "title", "changes", "metrics", "success", "binding", "break_year")} for sc in scenes]}
            try:
                out, usage = provider.structured(
                    "You narrate a short documentary-style film about a city tree-planting programme for a general audience. "
                    "Write one vivid but factual narration (max 45 words) per scene key, using ONLY numbers present in FACTS.",
                    json.dumps(facts), FilmNarration)
                db.add(LlmUsage(user_id=user.id, investigation_id=inv.id, provider=usage.provider, model=usage.model, agent="film",
                                input_tokens=usage.input_tokens, output_tokens=usage.output_tokens))
                db.commit()
                by_key = {s.key: s.narration for s in out.scenes}
                if all(k in by_key and not stray_numbers(by_key[k], json.dumps(facts)) for k in (sc["key"] for sc in scenes)):
                    for sc in scenes:
                        sc["narration"] = by_key[sc["key"]]
                    mode, model = "llm", f"{usage.provider}:{usage.model}"
            except ProviderError:
                pass
    return {**out_film, "scenes": scenes, "narration_mode": mode, "narration_model": model}


# =============================================================================== AI scenario builder
GAZETTEER = {
    "new delhi": ("New Delhi", "India", 28.6139, 77.2090), "delhi": ("New Delhi", "India", 28.6139, 77.2090),
    "mumbai": ("Mumbai", "India", 19.0760, 72.8777), "bengaluru": ("Bengaluru", "India", 12.9716, 77.5946),
    "bangalore": ("Bengaluru", "India", 12.9716, 77.5946), "chennai": ("Chennai", "India", 13.0827, 80.2707),
    "kolkata": ("Kolkata", "India", 22.5726, 88.3639), "jaipur": ("Jaipur", "India", 26.9124, 75.7873),
    "ahmedabad": ("Ahmedabad", "India", 23.0225, 72.5714), "hyderabad": ("Hyderabad", "India", 17.3850, 78.4867),
    "pune": ("Pune", "India", 18.5204, 73.8567), "phoenix": ("Phoenix", "United States", 33.4484, -112.0740),
    "los angeles": ("Los Angeles", "United States", 34.0522, -118.2437), "madrid": ("Madrid", "Spain", 40.4168, -3.7038),
    "seville": ("Seville", "Spain", 37.3891, -5.9845), "athens": ("Athens", "Greece", 37.9838, 23.7275),
    "cairo": ("Cairo", "Egypt", 30.0444, 31.2357), "riyadh": ("Riyadh", "Saudi Arabia", 24.7136, 46.6753),
    "dubai": ("Dubai", "United Arab Emirates", 25.2048, 55.2708), "adelaide": ("Adelaide", "Australia", -34.9285, 138.6007),
    "melbourne": ("Melbourne", "Australia", -37.8136, 144.9631), "mexico city": ("Mexico City", "Mexico", 19.4326, -99.1332),
    "nairobi": ("Nairobi", "Kenya", -1.2921, 36.8219), "lagos": ("Lagos", "Nigeria", 6.5244, 3.3792),
    "karachi": ("Karachi", "Pakistan", 24.8607, 67.0011), "tehran": ("Tehran", "Iran", 35.6892, 51.3890),
    "beijing": ("Beijing", "China", 39.9042, 116.4074), "sao paulo": ("São Paulo", "Brazil", -23.5505, -46.6333),
    "paris": ("Paris", "France", 48.8566, 2.3522), "london": ("London", "United Kingdom", 51.5074, -0.1278),
}


class DraftIn(BaseModel):
    description: str = Field(default="", max_length=4000)


SURPRISE_CITIES = ["jaipur", "cairo", "riyadh", "phoenix", "madrid", "seville", "athens", "mumbai", "chennai", "dubai",
                   "adelaide", "mexico city", "nairobi", "lagos", "karachi", "ahmedabad", "los angeles", "tehran", "hyderabad"]


def _surprise_idea() -> str:
    """A fresh, clearly hypothetical idea (the user asked the AI to invent one)."""
    r = random.Random()
    city = GAZETTEER[r.choice(SURPRISE_CITIES)][0]
    density = r.choice([150, 200, 250, 300])
    canopy = r.choice([25, 30, 35, 40])
    cool = r.choice([0.5, 0.6, 0.8, 1.0])
    surv = r.choice([55, 60, 65, 70, 75])
    where = r.choice(["along busy bus routes", "in dense residential blocks", "around school yards", "in new pocket parks", "along market streets"])
    water = r.choice(["drip irrigation from the municipal supply", "drip irrigation from treated wastewater", "spray irrigation in the dry months"])
    return (f"Plant {density} trees per hectare {where} of {city} to reach {canopy}% canopy cover, cooling summer streets by "
            f"{cool} °C within 10 years while keeping {surv}% of the trees alive, using {water}.")


class DraftObjective(BaseModel):
    metric: str
    operator: str
    threshold: float


class ScenarioDraft(BaseModel):
    title: str = Field(max_length=200)
    location_name: str = Field("", description="City name only, e.g. 'Cairo'")
    country: str = ""
    latitude: float | None = None
    longitude: float | None = None
    description: str = ""
    objectives: list[DraftObjective] = Field(default_factory=list)


def _rule_draft(text: str) -> dict:
    from ..agents.claims import extract_rule_based

    low = text.lower()
    place = next((v for k, v in sorted(GAZETTEER.items(), key=lambda kv: -len(kv[0])) if re.search(rf"\b{re.escape(k)}\b", low)), None)
    ex = extract_rule_based(text)
    objs = [{"metric": c.metric, "operator": c.operator, "threshold": c.threshold} for c in ex.claims if c.measurable and c.metric]
    if not any(o["metric"] == "cooling_c" for o in objs):
        objs.append({"metric": "cooling_c", "operator": ">=", "threshold": 0.5})
    if not any(o["metric"] == "survival_rate" for o in objs):
        objs.append({"metric": "survival_rate", "operator": ">=", "threshold": 0.5})
    title = f"Urban tree programme — {place[0]}" if place else "Urban tree programme"
    return {"title": title, "location_name": place[0] if place else "", "country": place[1] if place else "",
            "latitude": place[2] if place else None, "longitude": place[3] if place else None,
            "description": text.strip(), "objectives": objs, "parameter_hints": ex.parameter_hints}


@router.post("/scenario/draft", dependencies=[Depends(rate_limit_heavy)])
def draft_scenario(body: DraftIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Turn a plain-language idea into an investigation draft (AI when configured, rules otherwise).

    An empty idea means "surprise me": a hypothetical proposal is invented for a random hot city.
    """
    idea = body.description.strip()
    invented = len(idea) < 10
    if invented:
        idea = _surprise_idea()
    base = _rule_draft(idea)
    mode, model, note = "rules", "BACKFIRE rule-based reader", None
    if True:
        provider = provider_for(db, user)
        if provider.name != "deterministic":
            try:
                out, usage = provider.structured(
                    "You turn a user's idea for an URBAN TREE-PLANTING intervention into a structured draft. "
                    "Write 'description' as a clear 3-5 sentence proposal in the user's terms (planting density, canopy, irrigation, targets). "
                    "objectives use metric in [cooling_c (°C), survival_rate (0-1 fraction), water_stress_index (0-1), irrigation_m3_ha, annual_cost_usd_ha] "
                    "and operator '>=' or '<='. Only include targets the user stated or clearly implied. Give the city's real latitude/longitude.",
                    idea, ScenarioDraft)
                db.add(LlmUsage(user_id=user.id, provider=usage.provider, model=usage.model, agent="scenario_builder",
                                input_tokens=usage.input_tokens, output_tokens=usage.output_tokens))
                d = out.model_dump()
                ok_metrics = {"cooling_c", "survival_rate", "water_stress_index", "irrigation_m3_ha", "annual_cost_usd_ha"}
                d["objectives"] = [o for o in d["objectives"] if o["metric"] in ok_metrics and o["operator"] in (">=", "<=")]
                for o in d["objectives"]:
                    if o["metric"] == "survival_rate" and o["threshold"] > 1:
                        o["threshold"] = o["threshold"] / 100
                if d["latitude"] is None or not (-66 <= d["latitude"] <= 66) or d["longitude"] is None or not (-180 <= d["longitude"] <= 180):
                    d["latitude"], d["longitude"] = base["latitude"], base["longitude"]
                d["objectives"] = d["objectives"] or base["objectives"]
                if base["location_name"]:  # a city we know: keep its name and coordinates exact
                    d.update({k: base[k] for k in ("location_name", "country", "latitude", "longitude")})
                d["parameter_hints"] = base["parameter_hints"]
                base, mode, model = d, "llm", f"{usage.provider}:{usage.model}"
            except ProviderError as exc:
                note = f"AI unavailable ({str(exc)[:80]}); used the rule-based reader."
    audit(db, request, user, "scenario.draft", "scenario", None, {"mode": mode, "invented": invented})
    db.commit()
    return {**base, "idea": idea, "invented": invented, "mode": mode, "model": model, "note": note}


# =============================================================================== live scenario preview (Lab)
_CLIM_CACHE: dict[tuple[float, float], M.Climatology] = {}


class PreviewObjective(BaseModel):
    metric: str
    operator: str
    threshold: float


class PreviewIn(BaseModel):
    title: str = Field(default="Your scenario", max_length=200)
    location_name: str = Field(default="", max_length=120)
    latitude: float = Field(ge=-66, le=66)
    longitude: float = Field(ge=-180, le=180)
    objectives: list[PreviewObjective] = Field(default_factory=list, max_length=5)
    parameter_hints: dict[str, float] = Field(default_factory=dict)


WHAT_IF = {"warming_c": 2.5, "precip_change": -0.2, "supply_reliability": 0.8}


def _preview_climate(lat: float, lon: float, name: str) -> M.Climatology:
    key = (round(lat, 1), round(lon, 1))
    if key not in _CLIM_CACHE:
        from ..services.evidence import nasa_power_climatology
        try:
            _CLIM_CACHE[key] = nasa_power_climatology(lat, lon, name)
        except Exception:  # offline / outside coverage: clearly-labelled synthetic profile
            return M.synthetic_climatology(lat, name=name)
    return _CLIM_CACHE[key]


@router.post("/scenario/preview", dependencies=[Depends(rate_limit_heavy)])
def preview_scenario(body: PreviewIn, user: User = Depends(current_user)):
    """Animated preview before anything is saved: the plan, then a labelled hotter-and-drier what-if."""
    clim = _preview_climate(body.latitude, body.longitude, body.location_name)
    crit = [Criterion(o.metric, o.operator, float(o.threshold), C.SCALES.get(o.metric), METRICS[o.metric]["label"])
            for o in body.objectives if o.metric in METRICS and o.operator in (">=", "<=")]
    cfg = M.ModelConfig(climatology=clim, criteria=crit or list(C.DEFAULT_CRITERIA))
    hints = {k: float(min(PARAMETERS[PARAM_INDEX[k]].upper, max(PARAMETERS[PARAM_INDEX[k]].lower, v)))
             for k, v in body.parameter_hints.items() if k in PARAM_INDEX}
    v0 = M.nominal_vector(hints)
    plan = {"key": "plan", "title": "As planned", "subtitle": "The future the proposal assumes", **_scenario(cfg, v0, [])}
    v1 = v0.copy()
    changes = []
    for k, val in WHAT_IF.items():
        i = PARAM_INDEX[k]
        changes.append({"label": PARAMETERS[i].label, "from": float(v0[i]), "to": val, "unit": PARAMETERS[i].unit})
        v1[i] = val
    what_if = {"key": "break", "title": "What if it gets hotter and drier?", "subtitle": "A quick stress test — not a prediction",
               **_scenario(cfg, v1, changes)}
    for sc in (plan, what_if):
        mt = sc["metrics"]
        verdict = "The promise holds." if sc["success"] else f"{sc['binding']} misses its target."
        if sc["key"] == "plan":
            sc["narration"] = f"As planned: {mt['survival_rate'] * 100:.1f}% of trees survive and streets cool by {mt['cooling_c']:.2f} °C. {verdict}"
        else:
            sc["narration"] = (f"Same plan, harsher world: 2.5 °C warmer, 20% less rain, water supply 80% reliable. "
                               f"{mt['survival_rate'] * 100:.1f}% of trees survive. {verdict} The full run searches for the smallest such change.")
    criteria = [{"metric": c.metric, "label": METRICS.get(c.metric, {}).get("label", c.metric), "op": c.op, "threshold": c.threshold} for c in cfg.criteria]
    return {"title": body.title, "location": body.location_name, "country": "", "horizon_years": cfg.horizon_years, "criteria": criteria,
            "climate_source": clim.source, "synthetic_climate": clim.synthetic, "biome": biome_of(clim), "scenes": [plan, what_if],
            "narration_mode": "grounded", "narration_model": "BACKFIRE grounded narrator"}
