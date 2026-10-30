from __future__ import annotations

import uuid
from collections import Counter

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ..core.security import decode_token
from ..db import SessionLocal, get_db
from ..models import (AgentEvent, BenchmarkRun, Counterexample, EvidenceSource, Investigation, OptimisationRun, User,
                      VerificationResult)
from ..science import model as M
from ..science.benchmarks import run_benchmark_suite
from ..science.mpfs import MPFS_VERSION
from ..science.parameters import registry_dict
from ..services.events import bus
from .deps import audit, current_user, get_investigation, rate_limit_heavy, require_role

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": db.bind.dialect.name, "model_version": M.MODEL_VERSION, "mpfs_version": MPFS_VERSION}


@router.get("/registry")
def registry():
    return registry_dict()


@router.get("/stats/global")
def global_stats(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """All values are computed from stored investigations visible to the user."""
    q = select(Investigation)
    if user.role != "admin":
        q = q.where((Investigation.owner_id == user.id) | (Investigation.organisation_id == user.organisation_id))
    invs = db.scalars(q.order_by(Investigation.created_at.desc())).all()
    ids = [i.id for i in invs]
    if not ids:
        return {"investigations": [], "totals": {"investigations": 0, "completed": 0, "counterexamples": 0, "verified": 0,
                                                 "evidence_sources": 0, "peer_reviewed": 0, "model_evaluations": 0, "countries": 0},
                "by_category": {}, "by_status": {}, "by_source_type": {}, "evidence_by_topic": {}, "timeline": []}
    n_cex = db.scalar(select(func.count(Counterexample.id)).where(Counterexample.investigation_id.in_(ids))) or 0
    n_ver = db.scalar(select(func.count(VerificationResult.id)).where(VerificationResult.investigation_id.in_(ids),
                                                                     VerificationResult.status != "rejected")) or 0
    src_types = dict(db.execute(select(EvidenceSource.source_type, func.count(EvidenceSource.id))
                                .where(EvidenceSource.investigation_id.in_(ids)).group_by(EvidenceSource.source_type)).all())
    evals = db.scalar(select(func.coalesce(func.sum(OptimisationRun.evaluations), 0)).where(OptimisationRun.investigation_id.in_(ids))) or 0
    per_inv_src = dict(db.execute(select(EvidenceSource.investigation_id, func.count(EvidenceSource.id))
                                  .where(EvidenceSource.investigation_id.in_(ids)).group_by(EvidenceSource.investigation_id)).all())
    per_inv_cex = dict(db.execute(select(Counterexample.investigation_id, func.min(Counterexample.distance))
                                  .where(Counterexample.investigation_id.in_(ids), Counterexample.method == "MPFS")
                                  .group_by(Counterexample.investigation_id)).all())
    from ..models import EvidencePassage

    topics = dict(db.execute(select(EvidencePassage.topic, func.count(EvidencePassage.id))
                             .where(EvidencePassage.investigation_id.in_(ids)).group_by(EvidencePassage.topic)).all())
    months = Counter(i.created_at.strftime("%Y-%m") for i in invs)
    return {
        "investigations": [{"id": str(i.id), "title": i.title, "category": i.category, "status": i.status,
                            "latitude": i.latitude, "longitude": i.longitude, "location_name": i.location_name,
                            "country": i.country, "created_at": i.created_at.isoformat(),
                            "evidence_sources": per_inv_src.get(i.id, 0), "mpfs_min_distance": per_inv_cex.get(i.id)} for i in invs],
        "totals": {"investigations": len(invs), "completed": sum(i.status == "completed" for i in invs), "counterexamples": n_cex,
                   "verified": n_ver, "evidence_sources": sum(src_types.values()), "peer_reviewed": src_types.get("peer_reviewed", 0),
                   "model_evaluations": int(evals), "countries": len({i.country for i in invs if i.country})},
        "by_category": dict(Counter(i.category for i in invs)),
        "by_status": dict(Counter(i.status for i in invs)),
        "by_source_type": src_types,
        "evidence_by_topic": topics,
        "timeline": [{"month": k, "count": v} for k, v in sorted(months.items())],
    }


class BenchmarkIn(BaseModel):
    dims: list[int] = Field(default=[4, 8], max_length=3)
    seeds: int = Field(default=3, ge=1, le=10)
    budget: int = Field(default=1500, ge=200, le=5000)
    ablations: bool = True


@router.post("/benchmarks", dependencies=[Depends(rate_limit_heavy)])
def run_benchmarks(body: BenchmarkIn, request: Request, user: User = Depends(require_role("researcher")), db: Session = Depends(get_db)):
    if any(d < 2 or d > 16 for d in body.dims):
        raise HTTPException(422, "dims must be between 2 and 16")
    result = run_benchmark_suite(dims=tuple(body.dims), seeds=tuple(range(body.seeds)), budget=body.budget, ablations=body.ablations)
    row = BenchmarkRun(user_id=user.id, config=result["config"], result=result)
    db.add(row)
    audit(db, request, user, "benchmarks.run", "benchmark", None, result["config"])
    db.commit()
    return {"id": str(row.id), "created_at": row.created_at.isoformat(), **result}


@router.get("/benchmarks/latest")
def latest_benchmark(user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.scalars(select(BenchmarkRun).order_by(BenchmarkRun.created_at.desc())).first()
    if not row:
        return None
    return {"id": str(row.id), "created_at": row.created_at.isoformat(), **row.result}


@router.websocket("/ws/investigations/{inv_id}")
async def ws_events(websocket: WebSocket, inv_id: uuid.UUID, ticket: str, after: int = 0):
    """Live agent events. Auth via a 60-second ticket from POST /api/ws-ticket."""
    try:
        payload = decode_token(ticket, "ws")
        if payload.get("inv") != str(inv_id):
            raise jwt.InvalidTokenError("ticket/investigation mismatch")
    except jwt.InvalidTokenError:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    q = bus.subscribe(str(inv_id))
    try:
        db = SessionLocal()
        try:
            backlog = db.scalars(select(AgentEvent).where(AgentEvent.investigation_id == inv_id, AgentEvent.seq > after)
                                 .order_by(AgentEvent.seq).limit(2000)).all()
            last = after
            for e in backlog:
                last = e.seq
                await websocket.send_json({"id": str(e.id), "seq": e.seq, "agent": e.agent, "type": e.type, "message": e.message,
                                           "data": e.data, "created_at": e.created_at.isoformat()})
        finally:
            db.close()
        while True:
            ev = await q.get()
            if ev["seq"] > last:
                last = ev["seq"]
                await websocket.send_json(ev)
    except WebSocketDisconnect:
        pass
    finally:
        bus.unsubscribe(str(inv_id), q)


@router.get("/benchmarks/race")
def benchmark_race(course: str = "decoy", budget: int = 240, user: User = Depends(current_user)):
    """Real search traces of every method on a 2-D practice course (for the animated race)."""
    import numpy as np

    from ..science.baselines import run_method
    from ..science.benchmarks import make_problems

    names = {"straight": 0, "pit": 1, "decoy": 2}
    if course not in names:
        raise HTTPException(422, "course must be straight, pit or decoy")
    budget = max(80, min(600, budget))
    prob = make_problems(2, seed=0)[names[course]]
    # terrain: net benefit over the plausible square
    n = 48
    g = np.linspace(-1, 1, n)
    GX, GY = np.meshgrid(g, g)
    Z = prob._benefit(np.column_stack([GX.ravel(), GY.ravel()])).reshape(n, n)
    # true closest failure point (dense search; the distance itself is analytic)
    m = 600
    h = np.linspace(-1, 1, m)
    HX, HY = np.meshgrid(h, h)
    P = np.column_stack([HX.ravel(), HY.ravel()])
    Bd = prob._benefit(P)
    d = np.where(Bd < 0, np.hypot(P[:, 0], P[:, 1]), np.inf)
    tp = P[int(np.argmin(d))]
    racers = []
    for key in ("mpfs", "nsga2", "de", "random"):
        res = run_method(key, prob, budget, 0)
        U, B, CV, _ = prob.log.arrays()
        racers.append({
            "key": key, "method": res.method,
            "tries": [[round(float(u[0]), 4), round(float(u[1]), 4), bool(b < 0)] for u, b in zip(U, B)],
            "best": res.best_u, "best_distance": res.best_distance, "first_failure_at": res.first_failure_at,
        })
    return {"course": course, "grid": {"n": n, "z": np.round(Z, 4).tolist()}, "true_point": tp.round(4).tolist(),
            "true_distance": prob.true_distance, "budget": budget, "racers": racers}
