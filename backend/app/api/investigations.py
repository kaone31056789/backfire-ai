from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.config import BASE_DIR, get_settings
from ..core.security import create_token
from ..db import get_db
from ..models import (AgentEvent, AgentExecution, AnalysisResult, Assumption, CausalEdge, CausalGraph, CausalNode, Claim,
                      Counterexample, EvidencePassage, EvidenceSource, Intervention, Investigation, InvestigationReport,
                      OptimisationEvaluation, OptimisationRun, ScenarioComparison, User, VerificationResult)
from ..science import analysis as A
from ..science import model as M
from ..science.parameters import ENV_NAMES, METRICS, PARAM_INDEX, PARAM_NAMES, PARAMETERS
from ..science.verification import verify_counterexample
from ..services import context as C
from ..services import evidence as E
from ..services import worker
from ..services.embedding import cosine, embed
from ..services.report import build_report, render_pdf, store_report
from .deps import audit, current_user, get_investigation, rate_limit_heavy, require_role

router = APIRouter(prefix="/api", tags=["investigations"])

MetricName = Literal["cooling_c", "survival_rate", "water_stress_index", "irrigation_m3_ha", "annual_cost_usd_ha"]


# --------------------------------------------------------------------------- schemas
class ObjectiveIn(BaseModel):
    metric: MetricName
    operator: Literal[">=", "<="]
    threshold: float
    label: str = Field(default="", max_length=300)
    unit: str | None = Field(default=None, max_length=40)
    horizon_years: int | None = Field(default=None, ge=1, le=100)


class ParamIn(BaseModel):
    nominal: float | None = None
    lower: float | None = None
    upper: float | None = None
    active: bool | None = None
    weight: float | None = Field(default=None, ge=0.01, le=100)


class SettingsIn(BaseModel):
    budget: int | None = Field(default=None, ge=200, le=20000)
    lambda_: float | None = Field(default=None, alias="lambda", ge=0.01, le=100)
    methods: list[Literal["mpfs", "random", "de", "nsga2"]] | None = None
    include_intervention_params: bool | None = None
    mc_samples: int | None = Field(default=None, ge=200, le=20000)
    sobol_base: int | None = Field(default=None, ge=32, le=1024)
    horizon_years: int | None = Field(default=None, ge=1, le=50)
    cooling_response: Literal["saturating", "threshold"] | None = None
    water_price_usd_m3: float | None = Field(default=None, ge=0, le=50)

    model_config = {"populate_by_name": True}

    def clean(self) -> dict:
        d = self.model_dump(by_alias=True, exclude_none=True)
        if "methods" in d and not d["methods"]:
            d.pop("methods")
        return d


class InvestigationIn(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    description: str = Field(min_length=20, max_length=50000)
    location_name: str = Field(default="", max_length=200)
    country: str = Field(default="", max_length=100)
    latitude: float = Field(ge=-66, le=66)
    longitude: float = Field(ge=-180, le=180)
    objectives: list[ObjectiveIn] = Field(default_factory=list, max_length=10)
    parameters: dict[str, ParamIn] = Field(default_factory=dict)
    settings: SettingsIn = Field(default_factory=SettingsIn)
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    upload_id: str | None = None

    @field_validator("parameters")
    @classmethod
    def known(cls, v):
        bad = [k for k in v if k not in PARAM_INDEX]
        if bad:
            raise ValueError(f"Unknown parameters: {bad}")
        return v


class InvestigationPatch(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=300)
    settings: SettingsIn | None = None
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)


class ClaimIn(BaseModel):
    text: str = Field(min_length=3, max_length=2000)
    metric: MetricName | None = None
    operator: Literal[">=", "<="] | None = None
    threshold: float | None = None
    unit: str | None = Field(default=None, max_length=40)
    horizon_years: int | None = Field(default=None, ge=1, le=100)
    measurable: bool = True
    is_success_criterion: bool = False


class ClaimPatch(BaseModel):
    text: str | None = Field(default=None, min_length=3, max_length=2000)
    metric: MetricName | None = None
    operator: Literal[">=", "<="] | None = None
    threshold: float | None = None
    measurable: bool | None = None
    is_success_criterion: bool | None = None


class SimulateIn(BaseModel):
    parameters: dict[str, float] = Field(default_factory=dict)
    series: bool = True


class BoundaryIn(BaseModel):
    x: str
    y: str
    parameters: dict[str, float] = Field(default_factory=dict)
    counterexample_id: uuid.UUID | None = None
    resolution: int = Field(default=40, ge=10, le=80)
    metric: str = "net_benefit"


class UncertaintyIn(BaseModel):
    parameters: dict[str, float] = Field(default_factory=dict)
    n: int = Field(default=1500, ge=100, le=10000)


class AlternativeIn(BaseModel):
    label: str = Field(min_length=2, max_length=200)
    changes: dict[str, float]


class AlternativesIn(BaseModel):
    custom: list[AlternativeIn] | None = Field(default=None, max_length=12)


# --------------------------------------------------------------------------- serializers
def inv_out(inv: Investigation, db: Session, detail: bool = False) -> dict:
    n_cex = db.scalar(select(func.count(Counterexample.id)).where(Counterexample.investigation_id == inv.id)) or 0
    n_ver = db.scalar(select(func.count(Counterexample.id)).where(Counterexample.investigation_id == inv.id,
                                                               Counterexample.status.in_(["verified", "verified_with_warnings"]))) or 0
    n_src = db.scalar(select(func.count(EvidenceSource.id)).where(EvidenceSource.investigation_id == inv.id)) or 0
    best = db.scalar(select(func.min(Counterexample.distance)).where(Counterexample.investigation_id == inv.id,
                                                                    Counterexample.method == "MPFS"))
    out = {
        "id": str(inv.id), "title": inv.title, "category": inv.category, "status": inv.status, "stage": inv.stage,
        "location_name": inv.location_name, "country": inv.country, "latitude": inv.latitude, "longitude": inv.longitude,
        "seed": inv.seed, "created_at": inv.created_at.isoformat(), "updated_at": inv.updated_at.isoformat() if inv.updated_at else None,
        "owner": inv.owner.full_name or inv.owner.email if inv.owner else None, "error": inv.error,
        "counts": {"counterexamples": n_cex, "verified": n_ver, "evidence_sources": n_src},
        "mpfs_min_distance": best, "running": worker.is_running(str(inv.id)),
    }
    if detail:
        iv = inv.intervention
        mc = C.latest_model_config(db, inv.id)
        out.update({
            "description": iv.description if iv else "", "objectives": iv.objectives if iv else [],
            "source_document_name": iv.source_document_name if iv else None,
            "source_text_chars": len(iv.source_text or "") if iv else 0,
            "settings": C.merged_settings(inv), "algorithm_versions": inv.algorithm_versions,
            "climatology": mc.config["climatology"] if mc else None,
            "model_config_hash": mc.config_hash if mc else None,
        })
    return out


def param_out(r) -> dict:
    spec = PARAMETERS[PARAM_INDEX[r.name]]
    return {"name": r.name, "label": r.label, "kind": r.kind, "unit": r.unit, "nominal": r.nominal, "lower": r.lower,
            "upper": r.upper, "status": r.status, "sources": r.sources, "active": r.active, "weight": r.weight,
            "description": spec.description, "validity": spec.validity, "registry_lower": spec.lower,
            "registry_upper": spec.upper, "registry_nominal": spec.nominal}


def claim_out(c: Claim) -> dict:
    return {"id": str(c.id), "text": c.text, "metric": c.metric, "operator": c.operator, "threshold": c.threshold,
            "unit": c.unit, "horizon_years": c.horizon_years, "measurable": c.measurable,
            "is_success_criterion": c.is_success_criterion, "support_status": c.support_status,
            "evidence_ids": c.evidence_ids, "source": c.source, "edited": c.edited}


def cex_out(c: Counterexample, v: VerificationResult | None = None) -> dict:
    return {"id": str(c.id), "run_id": str(c.run_id), "rank": c.rank, "method": c.method, "distance": c.distance,
            "net_benefit": c.net_benefit, "binding_criterion": c.binding_criterion, "parameters": c.parameters,
            "deltas": c.deltas, "metrics": c.metrics, "normalised": c.normalised, "status": c.status, "producer": c.producer,
            "verification": None if not v else {"status": v.status, "robustness": v.robustness, "recomputed_b": v.recomputed_b,
                                                "checks": v.checks, "flags": v.flags, "verifier": v.verifier,
                                                "created_at": v.created_at.isoformat()}}


def _vector(db: Session, inv: Investigation, params: dict[str, float]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    v0, lo, hi = C.param_arrays(C.get_params(db, inv.id))
    v = v0.copy()
    for k, val in params.items():
        if k not in PARAM_INDEX:
            raise HTTPException(422, f"Unknown parameter {k}")
        i = PARAM_INDEX[k]
        if not np.isfinite(val):
            raise HTTPException(422, f"Non-finite value for {k}")
        v[i] = float(np.clip(val, lo[i], hi[i]))
    return v, lo, hi


# --------------------------------------------------------------------------- uploads
UPLOAD_DIR = Path(get_settings().upload_dir)


@router.post("/uploads", status_code=201)
async def upload_pdf(request: Request, file: UploadFile = File(...), user: User = Depends(require_role("researcher")),
                     db: Session = Depends(get_db)):
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    name = Path(file.filename or "document.pdf").name[:200]
    if not name.lower().endswith(".pdf"):
        raise HTTPException(415, "Only PDF files are accepted")
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(413, f"File exceeds {get_settings().max_upload_mb} MB")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(415, "File is not a valid PDF (bad signature)")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    uid = uuid.uuid4().hex
    path = UPLOAD_DIR / f"{uid}.pdf"
    path.write_bytes(data)
    try:
        proc = subprocess.run([sys.executable, "-I", str(BASE_DIR / "app" / "services" / "pdf_worker.py"), str(path)], capture_output=True,
                              timeout=30, cwd=str(BASE_DIR), text=True,
                              env={"SYSTEMROOT": os.environ.get("SYSTEMROOT", ""), "PATH": ""})
        result = json.loads(proc.stdout.strip().splitlines()[-1]) if proc.stdout.strip() else {"error": proc.stderr[-300:]}
    except subprocess.TimeoutExpired:
        result = {"error": "PDF processing timed out"}
    except Exception as exc:  # noqa: BLE001
        result = {"error": f"PDF processing failed: {type(exc).__name__}"}
    finally:
        path.unlink(missing_ok=True)  # the original binary is not retained
    if "error" in result:
        raise HTTPException(422, result["error"])
    meta = {"owner": str(user.id), "filename": name, "pages": result["pages"], "text": result["text"],
            "truncated": result["truncated"]}
    (UPLOAD_DIR / f"{uid}.json").write_text(json.dumps(meta), encoding="utf-8")
    audit(db, request, user, "upload.pdf", "upload", uid, {"filename": name, "bytes": len(data)})
    db.commit()
    return {"upload_id": uid, "filename": name, "pages": result["pages"], "characters": len(result["text"]),
            "truncated": result["truncated"], "preview": result["text"][:800]}


# --------------------------------------------------------------------------- CRUD
@router.post("/investigations", status_code=201)
def create_investigation(body: InvestigationIn, request: Request, user: User = Depends(require_role("researcher")),
                         db: Session = Depends(get_db)):
    src_name, src_text = None, None
    if body.upload_id:
        if not body.upload_id.isalnum():
            raise HTTPException(422, "Invalid upload id")
        p = UPLOAD_DIR / f"{body.upload_id}.json"
        if not p.exists():
            raise HTTPException(404, "Upload not found")
        meta = json.loads(p.read_text(encoding="utf-8"))
        if meta["owner"] != str(user.id):
            raise HTTPException(404, "Upload not found")
        src_name, src_text = meta["filename"], meta["text"]
    for k, p in body.parameters.items():
        lo = p.lower if p.lower is not None else PARAMETERS[PARAM_INDEX[k]].lower
        hi = p.upper if p.upper is not None else PARAMETERS[PARAM_INDEX[k]].upper
        if lo > hi:
            raise HTTPException(422, f"{k}: lower bound exceeds upper bound")
    inv = Investigation(owner_id=user.id, organisation_id=user.organisation_id, title=body.title.strip(),
                        location_name=body.location_name.strip(), country=body.country.strip(), latitude=body.latitude,
                        longitude=body.longitude, seed=body.seed, settings=body.settings.clean(), status="draft")
    db.add(inv)
    db.flush()
    db.add(Intervention(investigation_id=inv.id, description=body.description.strip(),
                        objectives=[o.model_dump() for o in body.objectives], source_document_name=src_name, source_text=src_text))
    C.seed_parameters(db, inv, {k: v.model_dump(exclude_none=True) for k, v in body.parameters.items()})
    audit(db, request, user, "investigation.create", "investigation", inv.id)
    db.commit()
    db.refresh(inv)
    return inv_out(inv, db, detail=True)


@router.get("/investigations")
def list_investigations(user: User = Depends(current_user), db: Session = Depends(get_db),
                        status: str | None = None, limit: int = Query(100, le=500)):
    q = select(Investigation)
    if user.role != "admin":
        q = q.where((Investigation.owner_id == user.id) | (Investigation.organisation_id == user.organisation_id))
    if status:
        q = q.where(Investigation.status == status)
    rows = db.scalars(q.order_by(Investigation.created_at.desc()).limit(limit)).all()
    return [inv_out(i, db) for i in rows]


@router.get("/investigations/{inv_id}")
def get_inv(inv_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return inv_out(get_investigation(inv_id, db, user), db, detail=True)


@router.patch("/investigations/{inv_id}")
def patch_inv(inv_id: uuid.UUID, body: InvestigationPatch, request: Request, user: User = Depends(current_user),
              db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user, write=True)
    if body.title:
        inv.title = body.title
    if body.settings:
        inv.settings = {**(inv.settings or {}), **body.settings.clean()}
    if body.seed is not None:
        inv.seed = body.seed
    audit(db, request, user, "investigation.update", "investigation", inv.id, body.model_dump(exclude_none=True, by_alias=True))
    db.commit()
    return inv_out(inv, db, detail=True)


@router.delete("/investigations/{inv_id}", status_code=204)
def delete_inv(inv_id: uuid.UUID, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user, write=True)
    if inv.owner_id != user.id and user.role != "admin":
        raise HTTPException(403, "Only the owner or an admin can delete an investigation")
    if worker.is_running(str(inv.id)):
        raise HTTPException(409, "Investigation is running")
    # explicit child cleanup keeps behaviour identical on databases without ON DELETE CASCADE
    for g in db.scalars(select(CausalGraph).where(CausalGraph.investigation_id == inv.id)):
        db.query(CausalEdge).filter(CausalEdge.graph_id == g.id).delete()
        db.query(CausalNode).filter(CausalNode.graph_id == g.id).delete()
    for r in db.scalars(select(OptimisationRun).where(OptimisationRun.investigation_id == inv.id)):
        db.query(OptimisationEvaluation).filter(OptimisationEvaluation.run_id == r.id).delete()
    for model in (VerificationResult, Counterexample, OptimisationRun, CausalGraph, EvidencePassage, EvidenceSource, Claim,
                  Assumption, AgentEvent, AgentExecution, AnalysisResult, ScenarioComparison, InvestigationReport):
        db.query(model).filter(model.investigation_id == inv.id).delete()
    db.delete(inv)
    audit(db, request, user, "investigation.delete", "investigation", inv_id)
    db.commit()
    return Response(status_code=204)


# --------------------------------------------------------------------------- parameters
@router.get("/investigations/{inv_id}/parameters")
def get_parameters(inv_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    return [param_out(r) for r in C.get_params(db, inv.id)]


@router.put("/investigations/{inv_id}/parameters")
def put_parameters(inv_id: uuid.UUID, body: dict[str, ParamIn], request: Request, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user, write=True)
    rows = {r.name: r for r in C.get_params(db, inv.id)}
    for k, p in body.items():
        if k not in rows:
            raise HTTPException(422, f"Unknown parameter {k}")
        r = rows[k]
        lo = p.lower if p.lower is not None else r.lower
        hi = p.upper if p.upper is not None else r.upper
        if lo > hi:
            raise HTTPException(422, f"{k}: lower bound exceeds upper bound")
        r.lower, r.upper = lo, hi
        r.nominal = float(np.clip(p.nominal if p.nominal is not None else r.nominal, lo, hi))
        if p.active is not None:
            r.active = p.active
        if p.weight is not None:
            r.weight = p.weight
    audit(db, request, user, "parameters.update", "investigation", inv.id, {"changed": list(body)})
    db.commit()
    return [param_out(r) for r in C.get_params(db, inv.id)]


# --------------------------------------------------------------------------- workflow
@router.post("/investigations/{inv_id}/analyse", status_code=202, dependencies=[Depends(rate_limit_heavy)])
def analyse(inv_id: uuid.UUID, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user, write=True)
    if not worker.submit(str(inv.id), str(user.id), "analyse"):
        raise HTTPException(409, "A workflow is already running for this investigation")
    audit(db, request, user, "investigation.analyse", "investigation", inv.id)
    db.commit()
    return {"accepted": True, "mode": "analyse"}


@router.post("/investigations/{inv_id}/run-backfire", status_code=202, dependencies=[Depends(rate_limit_heavy)])
def run_backfire(inv_id: uuid.UUID, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user, write=True)
    if not worker.submit(str(inv.id), str(user.id), "backfire"):
        raise HTTPException(409, "A workflow is already running for this investigation")
    audit(db, request, user, "investigation.run_backfire", "investigation", inv.id, {"settings": C.merged_settings(inv)})
    db.commit()
    return {"accepted": True, "mode": "backfire"}


@router.get("/investigations/{inv_id}/events")
def events(inv_id: uuid.UUID, after: int = 0, limit: int = Query(500, le=2000), user: User = Depends(current_user),
           db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    rows = db.scalars(select(AgentEvent).where(AgentEvent.investigation_id == inv.id, AgentEvent.seq > after)
                      .order_by(AgentEvent.seq).limit(limit)).all()
    return [{"id": str(e.id), "seq": e.seq, "agent": e.agent, "type": e.type, "message": e.message, "data": e.data,
             "created_at": e.created_at.isoformat()} for e in rows]


@router.get("/investigations/{inv_id}/executions")
def executions(inv_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    rows = db.scalars(select(AgentExecution).where(AgentExecution.investigation_id == inv.id).order_by(AgentExecution.started_at)).all()
    return [{"id": str(e.id), "agent": e.agent, "status": e.status, "attempts": e.attempts, "summary": e.summary,
             "error": e.error, "started_at": e.started_at.isoformat(),
             "finished_at": e.finished_at.isoformat() if e.finished_at else None} for e in rows]


@router.post("/ws-ticket")
def ws_ticket(body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(uuid.UUID(str(body.get("investigation_id"))), db, user)
    return {"ticket": create_token(str(user.id), "ws", {"inv": str(inv.id)})}


# --------------------------------------------------------------------------- claims
@router.get("/investigations/{inv_id}/claims")
def get_claims(inv_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    claims = db.scalars(select(Claim).where(Claim.investigation_id == inv.id).order_by(Claim.created_at)).all()
    assumptions = db.scalars(select(Assumption).where(Assumption.investigation_id == inv.id).order_by(Assumption.created_at)).all()
    ev_ids = {uuid.UUID(i) for c in claims for i in c.evidence_ids}
    passages = {str(p.id): p for p in db.scalars(select(EvidencePassage).where(EvidencePassage.id.in_(ev_ids)))} if ev_ids else {}
    srcs = {p.source_id for p in passages.values()}
    sources = {s.id: s for s in db.scalars(select(EvidenceSource).where(EvidenceSource.id.in_(srcs)))} if srcs else {}
    return {
        "claims": [{**claim_out(c), "evidence": [
            {"id": i, "text": passages[i].text, "stance": passages[i].stance, "source_title": sources[passages[i].source_id].title,
             "doi": sources[passages[i].source_id].doi, "year": sources[passages[i].source_id].year}
            for i in c.evidence_ids if i in passages]} for c in claims],
        "assumptions": [{"id": str(a.id), "text": a.text, "parameter_name": a.parameter_name, "status": a.status,
                         "source": a.source} for a in assumptions],
        "criteria": [c.to_dict() for c in C.criteria_from_claims(db, inv.id)],
        "metrics": METRICS,
    }


@router.post("/investigations/{inv_id}/claims", status_code=201)
def add_claim(inv_id: uuid.UUID, body: ClaimIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user, write=True)
    if body.is_success_criterion and not (body.metric and body.operator and body.threshold is not None):
        raise HTTPException(422, "A success criterion needs metric, operator and threshold")
    c = Claim(investigation_id=inv.id, source="user", edited=True, **body.model_dump())
    db.add(c)
    audit(db, request, user, "claim.create", "claim", None)
    db.commit()
    return claim_out(c)


@router.patch("/claims/{claim_id}")
def patch_claim(claim_id: uuid.UUID, body: ClaimPatch, request: Request, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    c = db.get(Claim, claim_id)
    if not c:
        raise HTTPException(404, "Claim not found")
    get_investigation(c.investigation_id, db, user, write=True)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    if c.is_success_criterion and not (c.metric and c.operator and c.threshold is not None):
        raise HTTPException(422, "A success criterion needs metric, operator and threshold")
    c.edited = True
    audit(db, request, user, "claim.update", "claim", c.id, body.model_dump(exclude_unset=True))
    db.commit()
    return claim_out(c)


@router.delete("/claims/{claim_id}", status_code=204)
def delete_claim(claim_id: uuid.UUID, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(Claim, claim_id)
    if not c:
        raise HTTPException(404, "Claim not found")
    get_investigation(c.investigation_id, db, user, write=True)
    db.delete(c)
    audit(db, request, user, "claim.delete", "claim", claim_id)
    db.commit()
    return Response(status_code=204)


# --------------------------------------------------------------------------- evidence
@router.get("/investigations/{inv_id}/evidence")
def get_evidence(inv_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    sources = db.scalars(select(EvidenceSource).where(EvidenceSource.investigation_id == inv.id)
                         .order_by(EvidenceSource.provider, EvidenceSource.year.desc())).all()
    passages = db.scalars(select(EvidencePassage).where(EvidencePassage.investigation_id == inv.id)).all()
    by_src: dict = {}
    for p in passages:
        by_src.setdefault(p.source_id, []).append({"id": str(p.id), "text": p.text, "topic": p.topic, "stance": p.stance,
                                                   "relevance": p.relevance})
    contradictions = []
    topics = {p.topic for p in passages}
    for t in topics:
        sup = [p for p in passages if p.topic == t and p.stance == "supports"]
        con = [p for p in passages if p.topic == t and p.stance == "contradicts"]
        if sup and con:
            contradictions.append({"topic": t, "supporting": [str(p.id) for p in sup[:5]], "contradicting": [str(p.id) for p in con[:5]]})
    return {
        "sources": [{"id": str(s.id), "provider": s.provider, "doi": s.doi, "title": s.title, "authors": s.authors, "year": s.year,
                     "venue": s.venue, "source_type": s.source_type, "url": s.url, "cited_by": s.cited_by,
                     "abstract": s.abstract, "quality": s.quality, "limitations": s.limitations, "doi_verified": s.doi_verified,
                     "query": s.query, "retrieved_at": s.retrieved_at.isoformat(), "passages": by_src.get(s.id, [])}
                    for s in sources],
        "contradictions": contradictions,
        "topics": {k: v["query"] for k, v in E.TOPICS.items()},
        "stance_method": "keyword heuristic (see services/evidence.py) - not a substitute for reading the source",
    }


@router.get("/investigations/{inv_id}/evidence/search")
def search_evidence(inv_id: uuid.UUID, q: str = Query(min_length=2, max_length=300), limit: int = Query(10, le=50),
                    user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    qv = embed(q)
    if db.bind.dialect.name == "postgresql":
        dist = EvidencePassage.embedding.cosine_distance(qv)  # pgvector operator <=>
        rows = db.execute(select(EvidencePassage, dist.label("d")).where(EvidencePassage.investigation_id == inv.id)
                          .order_by(dist).limit(limit)).all()
        scored = [(1 - float(d), p) for p, d in rows]
    else:
        ps = db.scalars(select(EvidencePassage).where(EvidencePassage.investigation_id == inv.id)).all()
        scored = sorted(((cosine(qv, p.embedding or []), p) for p in ps), key=lambda t: -t[0])[:limit]
    srcs = {s.id: s for s in db.scalars(select(EvidenceSource).where(EvidenceSource.id.in_({p.source_id for _, p in scored})))} if scored else {}
    return [{"score": round(s, 4), "id": str(p.id), "text": p.text, "topic": p.topic, "stance": p.stance,
             "source": {"title": srcs[p.source_id].title, "doi": srcs[p.source_id].doi, "year": srcs[p.source_id].year}}
            for s, p in scored if s > 0]


@router.get("/evidence/gbif")
def gbif(name: str = Query(min_length=3, max_length=120, pattern=r"^[A-Za-z][A-Za-z .\-]+$"), lat: float = Query(ge=-90, le=90),
         lon: float = Query(ge=-180, le=180), user: User = Depends(current_user)):
    try:
        return E.gbif_occurrences(name, lat, lon)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"GBIF unavailable: {type(exc).__name__}")


# --------------------------------------------------------------------------- causal graph
@router.get("/investigations/{inv_id}/causal-graph")
def causal_graph(inv_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    graphs = db.scalars(select(CausalGraph).where(CausalGraph.investigation_id == inv.id)).all()
    out = []
    for g in graphs:
        nodes = db.scalars(select(CausalNode).where(CausalNode.graph_id == g.id)).all()
        edges = db.scalars(select(CausalEdge).where(CausalEdge.graph_id == g.id)).all()
        out.append({"id": str(g.id), "name": g.name, "description": g.description, "is_alternative": g.is_alternative,
                    "analysis": g.analysis,
                    "nodes": [{"key": n.key, "label": n.label, "kind": n.kind, "parameter_name": n.parameter_name,
                               "description": n.description, "x": n.x, "y": n.y} for n in nodes],
                    "edges": [{"id": str(e.id), "source": e.source_key, "target": e.target_key, "sign": e.sign,
                               "mechanism": e.mechanism, "basis": e.basis, "in_model": e.in_model, "confidence": e.confidence,
                               "uncertainty": e.uncertainty, "references": e.references, "evidence_ids": e.evidence_ids,
                               "contradicting_ids": e.contradicting_ids} for e in edges]})
    ids = {uuid.UUID(i) for g in out for e in g["edges"] for i in e["evidence_ids"] + e["contradicting_ids"]}
    passages = {}
    if ids:
        ps = db.scalars(select(EvidencePassage).where(EvidencePassage.id.in_(ids))).all()
        srcs = {s.id: s for s in db.scalars(select(EvidenceSource).where(EvidenceSource.id.in_({p.source_id for p in ps})))}
        passages = {str(p.id): {"text": p.text, "stance": p.stance, "source_title": srcs[p.source_id].title,
                                "doi": srcs[p.source_id].doi, "year": srcs[p.source_id].year} for p in ps}
    from ..science.parameters import REFERENCES

    return {"graphs": sorted(out, key=lambda g: g["is_alternative"]), "passages": passages,
            "references": {k: {"citation": r.citation, "doi": r.doi, "url": r.url} for k, r in REFERENCES.items()}}


# --------------------------------------------------------------------------- optimisation
@router.get("/investigations/{inv_id}/optimisation")
def optimisation(inv_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    runs = db.scalars(select(OptimisationRun).where(OptimisationRun.investigation_id == inv.id).order_by(OptimisationRun.created_at)).all()
    return {"runs": [{"id": str(r.id), "method": r.method, "method_key": r.method_key, "version": r.version, "budget": r.budget,
                      "seed": r.seed, "evaluations": r.evaluations, "found": r.found, "best_distance": r.best_distance,
                      "best_b": r.best_b, "first_failure_at": r.first_failure_at, "runtime_s": r.runtime_s, "config": r.config,
                      "problem": r.problem, "convergence": r.convergence, "notes": r.notes,
                      "created_at": r.created_at.isoformat()} for r in runs],
            "settings": C.merged_settings(inv)}


@router.get("/optimisation/runs/{run_id}/evaluations")
def run_evaluations(run_id: uuid.UUID, limit: int = Query(3000, le=20000), user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    run = db.get(OptimisationRun, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    get_investigation(run.investigation_id, db, user)
    rows = db.execute(select(OptimisationEvaluation.idx, OptimisationEvaluation.b, OptimisationEvaluation.distance,
                             OptimisationEvaluation.cv, OptimisationEvaluation.phase, OptimisationEvaluation.u)
                      .where(OptimisationEvaluation.run_id == run_id).order_by(OptimisationEvaluation.idx).limit(limit)).all()
    return {"run_id": str(run_id), "active": run.problem.get("active", []), "total": run.evaluations,
            "evaluations": [{"i": r.idx, "b": r.b, "d": r.distance, "cv": r.cv, "phase": r.phase, "u": r.u} for r in rows]}


@router.get("/investigations/{inv_id}/counterexamples")
def counterexamples(inv_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    cexs = db.scalars(select(Counterexample).where(Counterexample.investigation_id == inv.id).order_by(Counterexample.distance)).all()
    vers = {v.counterexample_id: v for v in db.scalars(select(VerificationResult).where(VerificationResult.investigation_id == inv.id)
                                                      .order_by(VerificationResult.created_at))}
    return [cex_out(c, vers.get(c.id)) for c in cexs]


@router.post("/counterexamples/{cex_id}/verify")
def verify(cex_id: uuid.UUID, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(Counterexample, cex_id)
    if not c:
        raise HTTPException(404, "Counterexample not found")
    inv = get_investigation(c.investigation_id, db, user, write=True)
    cfg = C.build_config(db, inv)
    _, lo, hi = C.param_arrays(C.get_params(db, inv.id))
    vr = verify_counterexample(cfg.to_dict(), [c.parameters[n] for n in PARAM_NAMES], c.net_benefit, lo.tolist(), hi.tolist(),
                               producer=c.producer)
    db.query(VerificationResult).filter(VerificationResult.counterexample_id == c.id).delete()
    v = VerificationResult(counterexample_id=c.id, investigation_id=inv.id, status=vr["status"], verifier=vr["verifier"],
                           verifier_version=vr["verifier_version"], recomputed_b=vr["recomputed_b"], robustness=vr["robustness"],
                           config_hash=vr["config_hash"], checks=vr["checks"], flags=vr["flags"])
    db.add(v)
    c.status = vr["status"]
    audit(db, request, user, "counterexample.verify", "counterexample", c.id, {"status": vr["status"]})
    db.commit()
    return cex_out(c, v)


@router.get("/investigations/{inv_id}/verification")
def verification(inv_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    rows = db.scalars(select(VerificationResult).where(VerificationResult.investigation_id == inv.id)).all()
    return [{"counterexample_id": str(v.counterexample_id), "status": v.status, "verifier": v.verifier,
             "verifier_version": v.verifier_version, "recomputed_b": v.recomputed_b, "robustness": v.robustness,
             "config_hash": v.config_hash, "checks": v.checks, "flags": v.flags, "created_at": v.created_at.isoformat()} for v in rows]


# --------------------------------------------------------------------------- interactive science
@router.get("/investigations/{inv_id}/analysis")
def analysis_results(inv_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    out = {}
    for row in db.scalars(select(AnalysisResult).where(AnalysisResult.investigation_id == inv.id).order_by(AnalysisResult.created_at)):
        out[row.kind] = row.result
    return out


@router.post("/investigations/{inv_id}/simulate")
def simulate(inv_id: uuid.UUID, body: SimulateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    cfg = C.build_config(db, inv)
    v, lo, hi = _vector(db, inv, body.parameters)
    res = M.single(v, cfg, series=body.series)
    res["plausibility_violation"] = float(M.constraint_violation(v[None, :], cfg.constraints)[0])
    res["parameters"] = {n: float(v[PARAM_INDEX[n]]) for n in PARAM_NAMES}
    res["criteria"] = [c.to_dict() for c in cfg.criteria]
    res["climatology"] = {"source": cfg.climatology.source, "synthetic": cfg.climatology.synthetic}
    return res


@router.post("/investigations/{inv_id}/boundary", dependencies=[Depends(rate_limit_heavy)])
def boundary(inv_id: uuid.UUID, body: BoundaryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    if body.x not in PARAM_INDEX or body.y not in PARAM_INDEX or body.x == body.y:
        raise HTTPException(422, "x and y must be two different parameters")
    if body.metric != "net_benefit" and body.metric not in METRICS:
        raise HTTPException(422, "Unknown metric")
    cfg = C.build_config(db, inv)
    params = dict(body.parameters)
    if body.counterexample_id:
        cex = db.get(Counterexample, body.counterexample_id)
        if not cex or cex.investigation_id != inv.id:
            raise HTTPException(404, "Counterexample not found")
        params = {**cex.parameters, **params}
    v, lo, hi = _vector(db, inv, params)
    return A.boundary_map(cfg, v, body.x, body.y, lo, hi, body.resolution, body.metric)


@router.post("/investigations/{inv_id}/sensitivity")
def sensitivity(inv_id: uuid.UUID, body: SimulateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    cfg = C.build_config(db, inv)
    v, lo, hi = _vector(db, inv, body.parameters)
    names = [r.name for r in C.get_params(db, inv.id) if r.upper > r.lower]
    return {"rows": A.local_sensitivity(cfg, v, lo, hi, names), "base": M.single(v, cfg)["net_benefit"]}


@router.post("/investigations/{inv_id}/uncertainty", dependencies=[Depends(rate_limit_heavy)])
def uncertainty(inv_id: uuid.UUID, body: UncertaintyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    cfg = C.build_config(db, inv)
    v, lo, hi = _vector(db, inv, body.parameters)
    env = [r.name for r in C.get_params(db, inv.id) if r.kind == "environment" and r.active and r.upper > r.lower]
    return A.monte_carlo(cfg, v, lo, hi, env, n=body.n, seed=inv.seed)


@router.get("/investigations/{inv_id}/alternatives")
def get_alternatives(inv_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    rows = db.scalars(select(ScenarioComparison).where(ScenarioComparison.investigation_id == inv.id)
                      .order_by(ScenarioComparison.created_at.desc())).all()
    latest_alt = next((r for r in rows if r.kind == "alternatives"), None)
    latest_custom = next((r for r in rows if r.kind == "scenario"), None)
    fmt = lambda r: None if not r else {"id": str(r.id), "name": r.name, "inputs": r.inputs, "rows": r.result["rows"],
                                        "created_at": r.created_at.isoformat()}
    return {"alternatives": fmt(latest_alt), "custom": fmt(latest_custom)}


@router.post("/investigations/{inv_id}/alternatives", dependencies=[Depends(rate_limit_heavy)])
def post_alternatives(inv_id: uuid.UUID, body: AlternativesIn, request: Request, user: User = Depends(current_user),
                      db: Session = Depends(get_db)):
    from ..agents.workflow import compute_alternatives

    inv = get_investigation(inv_id, db, user, write=True)
    custom = None
    if body.custom is not None:
        custom = []
        for i, a in enumerate(body.custom):
            bad = [k for k in a.changes if k not in PARAM_INDEX or PARAMETERS[PARAM_INDEX[k]].kind != "intervention"]
            if bad:
                raise HTTPException(422, f"Alternatives may only change intervention parameters: {bad}")
            custom.append({"key": f"custom-{i}", "category": "custom", "label": a.label, "changes": a.changes})
    rows = compute_alternatives(str(inv.id), custom)
    audit(db, request, user, "alternatives.compute", "investigation", inv.id, {"custom": bool(custom)})
    db.commit()
    return {"rows": rows}


# --------------------------------------------------------------------------- reports
def _report_content(db: Session, inv: Investigation, regenerate: bool = False) -> dict:
    rep = db.scalars(select(InvestigationReport).where(InvestigationReport.investigation_id == inv.id)
                     .order_by(InvestigationReport.version.desc())).first()
    if regenerate or not rep:
        rep = store_report(db, inv.id)
        db.commit()
    return rep.content


@router.get("/investigations/{inv_id}/report")
def report(inv_id: uuid.UUID, regenerate: bool = False, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    return _report_content(db, inv, regenerate)


@router.get("/investigations/{inv_id}/report/json")
def report_json(inv_id: uuid.UUID, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    content = _report_content(db, inv)
    audit(db, request, user, "report.download_json", "investigation", inv.id)
    db.commit()
    return Response(json.dumps(content, indent=2, default=str), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="backfire-certificate-{str(inv.id)[:8]}.json"'})


@router.get("/investigations/{inv_id}/report/pdf")
def report_pdf(inv_id: uuid.UUID, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = get_investigation(inv_id, db, user)
    content = _report_content(db, inv)
    pdf = render_pdf(content)
    audit(db, request, user, "report.download_pdf", "investigation", inv.id)
    db.commit()
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="backfire-certificate-{str(inv.id)[:8]}.pdf"'})
