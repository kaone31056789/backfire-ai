from __future__ import annotations

import threading
import time
import uuid
from collections import defaultdict, deque

import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.security import decode_token
from ..db import get_db
from ..models import AuditLog, Investigation, User

ROLE_RANK = {"viewer": 0, "researcher": 1, "admin": 2}


# --------------------------------------------------------------------------- rate limiting
class RateLimiter:
    """Sliding-window limiter; uses Redis when REDIS_URL is configured, else in-process memory."""

    def __init__(self):
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()
        self._redis = None
        url = get_settings().redis_url
        if url:
            try:
                import redis

                self._redis = redis.Redis.from_url(url, socket_timeout=0.5)
                self._redis.ping()
            except Exception:  # Redis unavailable: degrade to memory, never block requests
                self._redis = None

    def allow(self, key: str, limit: int, window: int = 60) -> bool:
        if self._redis is not None:
            try:
                bucket = f"rl:{key}:{int(time.time() // window)}"
                n = self._redis.incr(bucket)
                if n == 1:
                    self._redis.expire(bucket, window + 1)
                return n <= limit
            except Exception:
                pass
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown"))[:64]


def rate_limit_auth(request: Request):
    if not limiter.allow(f"auth:{client_ip(request)}", get_settings().auth_rate_limit_per_minute):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many authentication attempts. Try again in a minute.")


def rate_limit_heavy(request: Request):
    if not limiter.allow(f"heavy:{client_ip(request)}", 20):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many compute requests. Try again shortly.")


# --------------------------------------------------------------------------- auth
def _token_from_request(request: Request) -> tuple[str | None, bool]:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip(), False
    return request.cookies.get("bf_access"), True


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token, via_cookie = _token_from_request(request)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    # CSRF defence for cookie auth: state-changing requests must carry a custom header,
    # which cross-site forms cannot set (cookies are also SameSite=Lax).
    if via_cookie and request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-requested-with") != "backfire":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing CSRF header")
    try:
        payload = decode_token(token, "access")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    user = db.get(User, uuid.UUID(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User inactive")
    if not limiter.allow(f"user:{user.id}", get_settings().rate_limit_per_minute):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Rate limit exceeded")
    return user


def require_role(min_role: str):
    def dep(user: User = Depends(current_user)) -> User:
        if ROLE_RANK.get(user.role, 0) < ROLE_RANK[min_role]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires role '{min_role}'")
        return user

    return dep


def get_investigation(inv_id: uuid.UUID, db: Session, user: User, write: bool = False) -> Investigation:
    inv = db.get(Investigation, inv_id)
    if not inv:
        raise HTTPException(404, "Investigation not found")
    same_org = inv.organisation_id is not None and inv.organisation_id == user.organisation_id
    if inv.owner_id != user.id and not same_org and user.role != "admin":
        raise HTTPException(404, "Investigation not found")
    if write and ROLE_RANK.get(user.role, 0) < ROLE_RANK["researcher"]:
        raise HTTPException(403, "Viewers cannot modify investigations")
    return inv


def audit(db: Session, request: Request | None, user: User | None, action: str, resource_type: str | None = None,
          resource_id: str | None = None, detail: dict | None = None) -> None:
    db.add(AuditLog(user_id=user.id if user else None, action=action, resource_type=resource_type,
                    resource_id=str(resource_id) if resource_id else None,
                    ip=client_ip(request) if request else None, detail=detail or {}))
