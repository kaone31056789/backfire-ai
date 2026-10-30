from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(BASE_DIR / ".env", BASE_DIR.parent / ".env"), extra="ignore")

    app_name: str = "BACKFIRE AI"
    environment: str = Field("development", description="development | production | test")
    # Must be overridden in production; the app refuses to start in production with the default.
    secret_key: str = "dev-only-insecure-secret-change-me-0123456789abcdef"
    database_url: str = f"sqlite:///{(BASE_DIR / 'backfire.db').as_posix()}"
    redis_url: str | None = None
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    access_token_minutes: int = 30
    refresh_token_days: int = 7
    cookie_secure: bool = False
    upload_dir: str = str(BASE_DIR / "uploads")
    max_upload_mb: int = 15
    contact_email: str = "backfire-research@example.org"  # sent to OpenAlex/Crossref polite pools
    evidence_timeout_s: float = 15.0
    default_llm_provider: str = "deterministic"
    agent_timeout_s: float = 600.0
    rate_limit_per_minute: int = 120
    auth_rate_limit_per_minute: int = 10
    run_migrations_on_start: bool = True
    # Demo mode seeds an admin demo account (+ one real investigation) and enables
    # one-click demo sign-in. Never enable on a public production deployment.
    # Local Ollama endpoint (admin-configured; the only non-public URL outbound calls may reach)
    ollama_local_url: str = "http://127.0.0.1:11434"
    demo_mode: bool = True
    demo_email: str = "admin@backfire.demo"
    demo_password: str = "Backfire-Demo-2026!"
    demo_seed_investigation: bool = True

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.environment == "test" or (s.is_production and "DEMO_MODE" not in os.environ):
        s.demo_mode = False  # production only gets demo mode when explicitly opted in
    if s.is_production and (s.secret_key.startswith("dev-only") or len(s.secret_key) < 32):
        raise RuntimeError("SECRET_KEY must be set to a strong value (>= 32 chars) in production.")
    return s
