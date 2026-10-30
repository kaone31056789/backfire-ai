"""Password hashing (bcrypt), JWT access/refresh tokens and API-key encryption at rest (Fernet)."""
from __future__ import annotations

import base64
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    # bcrypt only uses the first 72 bytes; pre-hash to keep long passphrases meaningful
    digest = base64.b64encode(hashlib.sha256(password.encode()).digest())
    return bcrypt.hashpw(digest, bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    digest = base64.b64encode(hashlib.sha256(password.encode()).digest())
    try:
        return bcrypt.checkpw(digest, hashed.encode())
    except ValueError:
        return False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_token(subject: str, kind: str, extra: dict | None = None) -> str:
    s = get_settings()
    exp = _now() + (timedelta(minutes=s.access_token_minutes) if kind == "access" else
                    timedelta(days=s.refresh_token_days) if kind == "refresh" else timedelta(seconds=60))
    payload = {"sub": subject, "type": kind, "iat": _now(), "exp": exp, "jti": uuid.uuid4().hex, **(extra or {})}
    return jwt.encode(payload, s.secret_key, algorithm=ALGORITHM)


def decode_token(token: str, kind: str) -> dict:
    payload = jwt.decode(token, get_settings().secret_key, algorithms=[ALGORITHM])
    if payload.get("type") != kind:
        raise jwt.InvalidTokenError("wrong token type")
    return payload


def _fernet() -> Fernet:
    key = hashlib.sha256(("api-key-encryption:" + get_settings().secret_key).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt_secret(token: str) -> str | None:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return None


def random_token(n: int = 24) -> str:
    return secrets.token_urlsafe(n)
