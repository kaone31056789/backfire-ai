from __future__ import annotations

import uuid

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.security import create_token, decode_token, hash_password, verify_password
from ..db import get_db
from ..models import Organisation, User
from .deps import audit, current_user, rate_limit_auth

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=256)
    full_name: str = Field(default="", max_length=200)
    organisation: str = Field(default="", max_length=200)

    @field_validator("password")
    @classmethod
    def strong(cls, v: str) -> str:
        classes = sum([any(c.islower() for c in v), any(c.isupper() for c in v), any(c.isdigit() for c in v),
                       any(not c.isalnum() for c in v)])
        if classes < 3:
            raise ValueError("Password must mix at least three of: lowercase, uppercase, digits, symbols")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=256)


class RefreshIn(BaseModel):
    refresh_token: str | None = None


def user_out(u: User) -> dict:
    return {"id": str(u.id), "email": u.email, "full_name": u.full_name, "role": u.role,
            "organisation": {"id": str(u.organisation.id), "name": u.organisation.name} if u.organisation else None,
            "preferences": u.preferences or {}, "created_at": u.created_at.isoformat()}


def _issue(response: Response, user: User) -> dict:
    s = get_settings()
    access = create_token(str(user.id), "access", {"role": user.role})
    refresh = create_token(str(user.id), "refresh")
    common = dict(httponly=True, secure=s.cookie_secure, samesite="lax", path="/")
    response.set_cookie("bf_access", access, max_age=s.access_token_minutes * 60, **common)
    response.set_cookie("bf_refresh", refresh, max_age=s.refresh_token_days * 86400, **{**common, "path": "/api/auth"})
    return {"access_token": access, "refresh_token": refresh, "token_type": "bearer",
            "expires_in": s.access_token_minutes * 60, "user": user_out(user)}


@router.post("/register", status_code=201, dependencies=[Depends(rate_limit_auth)])
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)):
    email = body.email.lower()
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise HTTPException(409, "An account with this email already exists")
    org = Organisation(name=body.organisation.strip() or f"{body.full_name or email.split('@')[0]}'s lab")
    db.add(org)
    db.flush()
    first = (db.scalar(select(func.count(User.id))) or 0) == 0
    user = User(email=email, password_hash=hash_password(body.password), full_name=body.full_name.strip(),
                role="admin" if first else "researcher", organisation_id=org.id,
                preferences={"llm_provider": "deterministic", "llm_model": "rules-v1"})
    db.add(user)
    db.flush()
    audit(db, request, user, "auth.register", "user", user.id)
    db.commit()
    db.refresh(user)
    return _issue(response, user)


@router.post("/login", dependencies=[Depends(rate_limit_auth)])
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if not user or not verify_password(body.password, user.password_hash) or not user.is_active:
        audit(db, request, None, "auth.login_failed", "user", None, {"email": body.email.lower()})
        db.commit()
        raise HTTPException(401, "Invalid email or password")
    audit(db, request, user, "auth.login", "user", user.id)
    db.commit()
    return _issue(response, user)


@router.post("/refresh", dependencies=[Depends(rate_limit_auth)])
def refresh(request: Request, response: Response, body: RefreshIn | None = None, db: Session = Depends(get_db)):
    token = (body.refresh_token if body else None) or request.cookies.get("bf_refresh")
    if not token:
        raise HTTPException(401, "No refresh token")
    try:
        payload = decode_token(token, "refresh")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid refresh token")
    user = db.get(User, uuid.UUID(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(401, "User inactive")
    return _issue(response, user)


@router.get("/demo")
def demo_info():
    """Tells the sign-in page whether one-click demo access is available (no secrets returned)."""
    s = get_settings()
    return {"enabled": s.demo_mode, "email": s.demo_email if s.demo_mode else None}


@router.post("/demo-login", dependencies=[Depends(rate_limit_auth)])
def demo_login(request: Request, response: Response, db: Session = Depends(get_db)):
    s = get_settings()
    if not s.demo_mode:
        raise HTTPException(404, "Demo mode is disabled")
    user = db.scalar(select(User).where(func.lower(User.email) == s.demo_email.lower()))
    if not user:
        raise HTTPException(404, "Demo account not provisioned")
    audit(db, request, user, "auth.demo_login", "user", user.id)
    db.commit()
    return _issue(response, user)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("bf_access", path="/")
    response.delete_cookie("bf_refresh", path="/api/auth")
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)
