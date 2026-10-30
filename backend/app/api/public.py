"""Public showcase for the landing page (demo mode only).

Serves results of the demo organisation's investigations - all values are read
from stored runs or computed by the model; nothing is illustrative.
"""
from __future__ import annotations

import time

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..db import get_db
from ..models import AnalysisResult, Counterexample, EvidenceSource, Investigation, OptimisationRun, User
from ..science import analysis as A
from ..science import model as M
from ..science.parameters import PARAM_INDEX, PARAMETERS
from ..services import context as C

router = APIRouter(prefix="/api/public", tags=["public"])


def _agent_story(db: Session, inv, cfg, runs) -> dict:
    """What each agent actually produced on this investigation (for the agent walkthrough)."""
    from ..models import CausalEdge, CausalGraph, Claim, InvestigationReport, ScenarioComparison, VerificationResult

    claims = db.scalars(select(Claim).where(Claim.investigation_id == inv.id)).all()
    graph = db.scalars(select(CausalGraph).where(CausalGraph.investigation_id == inv.id, CausalGraph.is_alternative.is_(False))).first()
    n_edges = db.scalar(select(func.count(CausalEdge.id)).where(CausalEdge.graph_id == graph.id)) if graph else 0
    sob = db.scalars(select(AnalysisResult).where(AnalysisResult.investigation_id == inv.id, AnalysisResult.kind == "sobol")
                     .order_by(AnalysisResult.created_at.desc())).first()
    vers = db.scalars(select(VerificationResult).where(VerificationResult.investigation_id == inv.id)).all()
    alts = db.scalars(select(ScenarioComparison).where(ScenarioComparison.investigation_id == inv.id, ScenarioComparison.kind == "alternatives")
                      .order_by(ScenarioComparison.created_at.desc())).first()
    rep = db.scalars(select(InvestigationReport).where(InvestigationReport.investigation_id == inv.id)
                     .order_by(InvestigationReport.version.desc())).first()
    srcs = db.scalars(select(EvidenceSource).where(EvidenceSource.investigation_id == inv.id)).all()
    clim = cfg.climatology
    hot = max(range(12), key=lambda m: clim.tmax[m])
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    top = []
    if sob:
        top = sorted(zip(sob.result["labels"], sob.result["results"]["net_benefit"]["ST"]), key=lambda t: -t[1])[:3]
    best_alt, prop = None, None
    if alts:
        rows = alts.result["rows"]
        prop = next((r for r in rows if r["key"] == "proposal"), None)
        cand = sorted([r for r in rows if r["key"] != "proposal"], key=lambda r: r["failure_probability"])
        best_alt = cand[0] if cand else None
    return {
        "claims": [{"text": c.text[:140], "metric": c.metric, "op": c.operator, "threshold": c.threshold, "measurable": c.measurable} for c in claims][:5],
        "climate": {"source": "NASA POWER" if not clim.synthetic else "synthetic", "annual_rain_mm": round(sum(clim.precip_mm)),
                    "hottest_month": months[hot], "hottest_tmax_c": round(clim.tmax[hot], 1)},
        "evidence": {"sources": len(srcs), "peer_reviewed": sum(s.source_type == "peer_reviewed" for s in srcs),
                     "doi_verified": sum(bool(s.doi_verified) for s in srcs),
                     "example": next((s.title for s in srcs if s.provider == "openalex"), None)},
        "causal": {"nodes": len(graph.analysis and [1] or []) and graph.analysis.get("n_nodes", 0) if graph else 0, "edges": n_edges,
                   "acyclic": bool(graph and graph.analysis.get("acyclic"))},
        "sensitivity": [{"parameter": n, "index": round(v, 2)} for n, v in top],
        "optimisation": {"evaluations": int(sum(r.evaluations for r in runs)), "methods": len(runs)},
        "verification": {"checked": len(vers), "verified": sum(v.status != "rejected" for v in vers)},
        "alternatives": None if not best_alt else {"design": best_alt["label"], "failure_probability": best_alt["failure_probability"],
                                                   "proposal_failure_probability": prop["failure_probability"] if prop else None,
                                                   "tested": len(alts.result["rows"]) - 1},
        "report": None if not rep else {"version": rep.version, "sha256": rep.content_hash[:16]},
    }
_cache: dict = {"t": 0.0, "data": None}


@router.get("/showcase")
def showcase(db: Session = Depends(get_db)):
    s = get_settings()
    if not s.demo_mode:
        raise HTTPException(404, "Showcase is only available in demo mode")
    if _cache["data"] is not None and time.time() - _cache["t"] < 60:
        return _cache["data"]
    demo = db.scalar(select(User).where(func.lower(User.email) == s.demo_email.lower()))
    if not demo:
        raise HTTPException(404, "Demo workspace not provisioned")
    invs = db.scalars(select(Investigation).where(Investigation.organisation_id == demo.organisation_id)
                      .order_by(Investigation.created_at)).all()
    sites = []
    for i in invs:
        d = db.scalar(select(func.min(Counterexample.distance)).where(Counterexample.investigation_id == i.id,
                                                                     Counterexample.method == "MPFS"))
        sites.append({"id": str(i.id), "title": i.title, "location": i.location_name, "country": i.country,
                      "lat": i.latitude, "lon": i.longitude, "status": i.status, "d_star": d})
    featured = next((i for i in invs if i.status == "completed"), invs[0] if invs else None)
    out: dict = {"sites": sites, "featured": None}
    if featured:
        cfg = C.build_config(db, featured)
        v0, lo, hi = C.param_arrays(C.get_params(db, featured.id))
        nominal = M.single(v0, cfg)
        best = db.scalars(select(Counterexample).where(Counterexample.investigation_id == featured.id,
                                                       Counterexample.method == "MPFS").order_by(Counterexample.distance)).first()
        mc = db.scalars(select(AnalysisResult).where(AnalysisResult.investigation_id == featured.id,
                                                     AnalysisResult.kind == "monte_carlo")
                        .order_by(AnalysisResult.created_at.desc())).first()
        runs = db.scalars(select(OptimisationRun).where(OptimisationRun.investigation_id == featured.id)).all()
        n_src = db.scalar(select(func.count(EvidenceSource.id)).where(EvidenceSource.investigation_id == featured.id)) or 0
        landscape = None
        if best and best.deltas:
            env = [k for k, d in sorted(best.deltas.items(), key=lambda kv: -abs(kv[1]["normalised"]))
                   if PARAMETERS[PARAM_INDEX[k]].kind == "environment"]
            axes = (env + ["warming_c", "supply_reliability"])[:2] if len(env) < 2 else env[:2]
            if axes[0] == axes[1]:
                axes[1] = "supply_reliability" if axes[0] != "supply_reliability" else "warming_c"
            base = np.array([best.parameters[p.name] for p in PARAMETERS])
            bm = A.boundary_map(cfg, base, axes[0], axes[1], lo, hi, resolution=36)
            landscape = {"x": bm["x"], "y": bm["y"], "z": bm["net_benefit"], "failure_fraction": bm["failure_fraction"],
                         "point": [float(best.parameters[axes[0]]), float(best.parameters[axes[1]])],
                         "nominal": [float(v0[PARAM_INDEX[axes[0]]]), float(v0[PARAM_INDEX[axes[1]]])]}
        out["featured"] = {
            "id": str(featured.id), "title": featured.title, "location": featured.location_name, "country": featured.country,
            "lat": featured.latitude, "lon": featured.longitude, "description": featured.intervention.description if featured.intervention else "",
            "climate_source": cfg.climatology.source, "synthetic_climate": cfg.climatology.synthetic,
            "criteria": [c.to_dict() for c in cfg.criteria],
            "nominal": {k: nominal[k] for k in ("cooling_c", "survival_rate", "water_stress_index", "net_benefit", "success", "binding_criterion")},
            "best": None if not best else {"distance": best.distance, "status": best.status, "binding_criterion": best.binding_criterion,
                                            "metrics": best.metrics, "deltas": best.deltas},
            "failure_probability": mc.result["failure_probability"] if mc else None,
            "failure_ci95": mc.result["failure_ci95"] if mc else None,
            "evaluations": int(sum(r.evaluations for r in runs)),
            "methods": [{"method": r.method, "found": r.found, "distance": r.best_distance} for r in runs],
            "evidence_sources": n_src,
            "landscape": landscape,
            "agents": _agent_story(db, featured, cfg, runs),
        }
    _cache.update(t=time.time(), data=out)
    return out


@router.get("/film")
def public_film(db: Session = Depends(get_db)):
    """The demo investigation's simulation film (demo mode only; grounded narration)."""
    from .assistant import film_payload

    s = get_settings()
    if not s.demo_mode:
        raise HTTPException(404, "Only available in demo mode")
    demo = db.scalar(select(User).where(func.lower(User.email) == s.demo_email.lower()))
    inv = db.scalars(select(Investigation).where(Investigation.organisation_id == demo.organisation_id, Investigation.status == "completed")
                     .order_by(Investigation.created_at)).first() if demo else None
    if not inv:
        raise HTTPException(404, "Demo investigation not computed yet")
    return film_payload(db, inv)
