"""Demo workspace: an admin demo account and one real investigation.

The demo investigation is created from the case-study proposal and run through the
full agent workflow in the background - every number it shows is computed, exactly
as for any user-created investigation.
"""
from __future__ import annotations

import logging

from sqlalchemy import func, select

from ..core.config import get_settings
from ..core.security import hash_password
from ..db import session_scope
from ..models import Intervention, Investigation, Organisation, User
from . import context as C

log = logging.getLogger("backfire.demo")

DEMO_PROPOSAL = (
    "The Green Canopy Programme will plant 250 trees per hectare across 40 hectares of dense residential blocks, "
    "raising tree canopy cover to 35% at maturity. The programme will reduce summer daytime air temperatures by "
    "0.5 °C within 10 years, with at least 50% of planted trees surviving. Trees will be watered with drip irrigation "
    "from the municipal supply, and we assume sufficient water is available throughout the dry season. The programme "
    "will improve residents' wellbeing and neighbourhood resilience."
)


def ensure_demo() -> None:
    s = get_settings()
    if not s.demo_mode:
        return
    with session_scope() as db:
        user = db.scalar(select(User).where(func.lower(User.email) == s.demo_email.lower()))
        if not user:
            org = Organisation(name="BACKFIRE Demo Lab")
            db.add(org)
            db.flush()
            user = User(email=s.demo_email.lower(), password_hash=hash_password(s.demo_password), full_name="Demo Administrator",
                        role="admin", organisation_id=org.id,
                        preferences={"llm_provider": "deterministic", "llm_model": "rules-v1"})
            db.add(user)
            db.flush()
            log.info("Created demo admin account %s", s.demo_email)
        elif user.role != "admin":
            user.role = "admin"
        uid, org_id = str(user.id), user.organisation_id
        has_inv = db.scalar(select(func.count(Investigation.id)).where(Investigation.owner_id == user.id)) or 0
        inv_id = None
        if s.demo_seed_investigation and not has_inv:
            inv = Investigation(owner_id=user.id, organisation_id=org_id, title="Green Canopy Programme — New Delhi",
                                location_name="New Delhi", country="India", latitude=28.6139, longitude=77.209, seed=42,
                                settings={"budget": 1500}, status="draft")
            db.add(inv)
            db.flush()
            db.add(Intervention(investigation_id=inv.id, description=DEMO_PROPOSAL, objectives=[]))
            C.seed_parameters(db, inv)
            inv_id = str(inv.id)
    if inv_id:
        from . import worker

        worker.submit(inv_id, uid, "full")
        log.info("Seeded demo investigation %s; full workflow running in background", inv_id)
