from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..agents.providers import PROVIDERS
from ..core.security import encrypt_secret
from ..db import get_db
from ..models import ApiKey, AuditLog, Investigation, LlmUsage, OptimisationRun, User
from ..services.context import DEFAULT_SETTINGS
from .deps import audit, current_user, require_role

router = APIRouter(prefix="/api/settings", tags=["settings"])


class KeyIn(BaseModel):
    provider: Literal["anthropic", "openai", "ollama"]
    api_key: str = Field(min_length=10, max_length=400)
    label: str = Field(default="", max_length=100)


class PrefsIn(BaseModel):
    llm_provider: Literal["deterministic", "anthropic", "openai", "ollama"] | None = None
    llm_model: str | None = Field(default=None, max_length=100, pattern=r"^[A-Za-z0-9._:/\-]+$")
    ollama_host: Literal["cloud", "local"] | None = None
    default_budget: int | None = Field(default=None, ge=200, le=20000)
    default_lambda: float | None = Field(default=None, ge=0.01, le=100)
    default_methods: list[Literal["mpfs", "random", "de", "nsga2"]] | None = None
    reduced_motion: bool | None = None
    units: Literal["metric"] | None = None
    full_name: str | None = Field(default=None, max_length=200)


@router.get("")
def get_settings_(user: User = Depends(current_user), db: Session = Depends(get_db)):
    keys = db.scalars(select(ApiKey).where(ApiKey.user_id == user.id)).all()
    return {
        "preferences": user.preferences or {},
        "providers": PROVIDERS,
        "api_keys": [{"id": str(k.id), "provider": k.provider, "label": k.label, "masked": f"••••{k.last4}",
                      "created_at": k.created_at.isoformat()} for k in keys],
        "investigation_defaults": DEFAULT_SETTINGS,
        "user": {"email": user.email, "full_name": user.full_name, "role": user.role},
    }


@router.put("/preferences")
def put_prefs(body: PrefsIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    d = body.model_dump(exclude_none=True)
    if "full_name" in d:
        user.full_name = d.pop("full_name")
    if "llm_provider" in d and d["llm_provider"] != "deterministic":
        if "llm_model" in d and not PROVIDERS[d["llm_provider"]].get("free_model") and d["llm_model"] not in PROVIDERS[d["llm_provider"]]["models"]:
            raise HTTPException(422, "Unknown model for provider")
    user.preferences = {**(user.preferences or {}), **d}
    audit(db, request, user, "settings.preferences", "user", user.id, d)
    db.commit()
    return {"preferences": user.preferences}


@router.post("/api-keys", status_code=201)
def add_key(body: KeyIn, request: Request, user: User = Depends(require_role("researcher")), db: Session = Depends(get_db)):
    existing = db.scalars(select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.provider == body.provider)).first()
    if existing:
        db.delete(existing)
        db.flush()
    k = ApiKey(user_id=user.id, provider=body.provider, label=body.label, encrypted_key=encrypt_secret(body.api_key.strip()),
               last4=body.api_key.strip()[-4:])
    db.add(k)
    audit(db, request, user, "settings.api_key_add", "api_key", None, {"provider": body.provider})
    db.commit()
    return {"id": str(k.id), "provider": k.provider, "label": k.label, "masked": f"••••{k.last4}"}


@router.delete("/api-keys/{key_id}", status_code=204)
def delete_key(key_id: uuid.UUID, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    k = db.get(ApiKey, key_id)
    if not k or k.user_id != user.id:
        raise HTTPException(404, "Key not found")
    db.delete(k)
    audit(db, request, user, "settings.api_key_delete", "api_key", key_id, {"provider": k.provider})
    db.commit()
    return Response(status_code=204)


class PingOut(BaseModel):
    reply: str


@router.post("/test-llm")
def test_llm(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Round-trip a tiny structured request through the configured provider."""
    from ..agents.providers import ProviderError, build_provider
    from ..core.security import decrypt_secret

    prefs = user.preferences or {}
    name = prefs.get("llm_provider", "deterministic")
    k = db.scalars(select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.provider == name)).first()
    provider = build_provider(name, decrypt_secret(k.encrypted_key) if k else None, prefs.get("llm_model"), prefs.get("ollama_host"))
    if provider.name == "deterministic":
        return {"ok": False, "detail": "No language model configured (store a key, or choose local Ollama)."}
    try:
        out, usage = provider.structured("Reply with JSON only.", 'Return {"reply": "ok"}', PingOut)
        audit(db, request, user, "settings.test_llm", "user", user.id, {"provider": name, "ok": True})
        db.commit()
        return {"ok": True, "detail": f"{usage.provider}:{usage.model} answered '{out.reply[:40]}'"}
    except ProviderError as exc:
        return {"ok": False, "detail": str(exc)[:300]}


@router.get("/usage")
def usage(user: User = Depends(current_user), db: Session = Depends(get_db)):
    llm = db.execute(select(LlmUsage.provider, LlmUsage.model, func.count(LlmUsage.id), func.sum(LlmUsage.input_tokens),
                            func.sum(LlmUsage.output_tokens)).where(LlmUsage.user_id == user.id)
                     .group_by(LlmUsage.provider, LlmUsage.model)).all()
    inv_ids = select(Investigation.id).where(Investigation.owner_id == user.id)
    runs = db.execute(select(func.count(OptimisationRun.id), func.coalesce(func.sum(OptimisationRun.evaluations), 0),
                             func.coalesce(func.sum(OptimisationRun.runtime_s), 0.0))
                      .where(OptimisationRun.investigation_id.in_(inv_ids))).one()
    n_inv = db.scalar(select(func.count(Investigation.id)).where(Investigation.owner_id == user.id)) or 0
    recent = db.scalars(select(AuditLog).where(AuditLog.user_id == user.id).order_by(AuditLog.created_at.desc()).limit(25)).all()
    return {
        "llm": [{"provider": p, "model": m, "calls": c, "input_tokens": int(i or 0), "output_tokens": int(o or 0)} for p, m, c, i, o in llm],
        "compute": {"investigations": n_inv, "optimisation_runs": runs[0], "model_evaluations": int(runs[1]),
                    "optimisation_seconds": float(runs[2])},
        "audit": [{"action": a.action, "resource_type": a.resource_type, "resource_id": a.resource_id, "ip": a.ip,
                   "created_at": a.created_at.isoformat()} for a in recent],
    }
