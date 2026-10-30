"""Builds the scientific configuration of an investigation from stored records."""
from __future__ import annotations

import uuid

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..science import model as M
from ..science.parameters import DEFAULT_CRITERIA, METRICS, PARAM_INDEX, PARAMETERS, Criterion
from ..science.problem import AfforestationProblem
from ..science.verification import config_hash
from ..models import Claim, EnvironmentalParameter, Investigation, ModelConfiguration

DEFAULT_SETTINGS = {
    "budget": 2000,
    "lambda": 4.0,
    "methods": ["mpfs", "random", "de", "nsga2"],
    "include_intervention_params": True,
    "mc_samples": 2000,
    "sobol_base": 128,
    "horizon_years": 10,
    "cooling_response": "saturating",
    "water_price_usd_m3": 1.5,
}

SCALES = {"water_stress_index": 0.25}


def merged_settings(inv: Investigation) -> dict:
    return {**DEFAULT_SETTINGS, **(inv.settings or {})}


def seed_parameters(db: Session, inv: Investigation, overrides: dict[str, dict] | None = None) -> None:
    """Create per-investigation parameter rows from the registry (+ user overrides)."""
    overrides = overrides or {}
    existing = {p.name for p in db.scalars(select(EnvironmentalParameter).where(EnvironmentalParameter.investigation_id == inv.id))}
    for p in PARAMETERS:
        if p.name in existing:
            continue
        o = overrides.get(p.name, {})
        lo, hi = float(o.get("lower", p.lower)), float(o.get("upper", p.upper))
        nom = float(np.clip(float(o.get("nominal", p.nominal)), lo, hi))
        db.add(EnvironmentalParameter(
            investigation_id=inv.id, name=p.name, label=p.label, kind=p.kind, unit=p.unit, nominal=nom, lower=lo,
            upper=hi, status=p.status, sources=list(p.sources), active=bool(o.get("active", True)),
            weight=float(o.get("weight", p.weight)),
        ))


def get_params(db: Session, inv_id: uuid.UUID) -> list[EnvironmentalParameter]:
    rows = list(db.scalars(select(EnvironmentalParameter).where(EnvironmentalParameter.investigation_id == inv_id)))
    order = {p.name: i for i, p in enumerate(PARAMETERS)}
    return sorted(rows, key=lambda r: order.get(r.name, 999))


def param_arrays(rows: list[EnvironmentalParameter]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    v0 = M.nominal_vector()
    lo, hi = M.bounds_arrays()
    for r in rows:
        i = PARAM_INDEX.get(r.name)
        if i is not None:
            v0[i], lo[i], hi[i] = r.nominal, r.lower, r.upper
    return v0, lo, hi


def criteria_from_claims(db: Session, inv_id: uuid.UUID) -> list[Criterion]:
    claims = db.scalars(select(Claim).where(Claim.investigation_id == inv_id, Claim.is_success_criterion.is_(True)))
    crit = []
    seen = set()
    for c in claims:
        if c.metric in METRICS and c.operator in (">=", "<=") and c.threshold is not None and c.metric not in seen:
            seen.add(c.metric)
            crit.append(Criterion(c.metric, c.operator, float(c.threshold), SCALES.get(c.metric), c.text[:200]))
    return crit or list(DEFAULT_CRITERIA)


def latest_model_config(db: Session, inv_id: uuid.UUID) -> ModelConfiguration | None:
    return db.scalars(select(ModelConfiguration).where(ModelConfiguration.investigation_id == inv_id)
                      .order_by(ModelConfiguration.created_at.desc())).first()


def build_config(db: Session, inv: Investigation) -> M.ModelConfig:
    st = merged_settings(inv)
    mc = latest_model_config(db, inv.id)
    clim = M.Climatology.from_dict(mc.config["climatology"]) if mc else M.synthetic_climatology(inv.latitude, name=inv.location_name)
    return M.ModelConfig(
        climatology=clim,
        criteria=criteria_from_claims(db, inv.id),
        horizon_years=int(st["horizon_years"]),
        cooling_response=st["cooling_response"],
        water_price_usd_m3=float(st["water_price_usd_m3"]),
    )


def store_model_config(db: Session, inv: Investigation, cfg: M.ModelConfig) -> ModelConfiguration:
    d = cfg.to_dict()
    row = ModelConfiguration(investigation_id=inv.id, model_name=M.MODEL_NAME, model_version=M.MODEL_VERSION, config=d,
                             config_hash=config_hash(d), climatology_source=cfg.climatology.source,
                             synthetic_climate=cfg.climatology.synthetic)
    db.add(row)
    return row


def build_problem(db: Session, inv: Investigation, cfg: M.ModelConfig) -> AfforestationProblem:
    st = merged_settings(inv)
    rows = get_params(db, inv.id)
    v0, lo, hi = param_arrays(rows)
    active = [r.name for r in rows if r.active and r.upper > r.lower and
              (r.kind == "environment" or st["include_intervention_params"])]
    weights = {r.name: r.weight for r in rows}
    return AfforestationProblem(cfg, v0, lo, hi, active, lam=float(st["lambda"]), weight_overrides=weights)
