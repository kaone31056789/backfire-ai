"""Investigation event bus: every event is persisted (agent_events) and fanned out
to live WebSocket subscribers. Thread-safe: agents run in worker threads."""
from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from collections import defaultdict

from sqlalchemy import func, select

from ..db import session_scope
from ..models import AgentEvent

log = logging.getLogger("backfire.events")


class EventBus:
    def __init__(self) -> None:
        self._subs: dict[str, set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = defaultdict(set)
        self._lock = threading.Lock()
        self._seq: dict[str, int] = {}

    def subscribe(self, inv_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        with self._lock:
            self._subs[inv_id].add((asyncio.get_running_loop(), q))
        return q

    def unsubscribe(self, inv_id: str, q: asyncio.Queue) -> None:
        with self._lock:
            self._subs[inv_id] = {(l, qq) for l, qq in self._subs[inv_id] if qq is not q}

    def _next_seq(self, inv_id: str) -> int:
        with self._lock:
            if inv_id not in self._seq:
                with session_scope() as db:
                    self._seq[inv_id] = db.scalar(
                        select(func.coalesce(func.max(AgentEvent.seq), 0)).where(AgentEvent.investigation_id == uuid.UUID(inv_id))
                    ) or 0
            self._seq[inv_id] += 1
            return self._seq[inv_id]

    def emit(self, inv_id: str, agent: str, type_: str, message: str, data: dict | None = None,
             execution_id: uuid.UUID | None = None) -> dict:
        seq = self._next_seq(inv_id)
        with session_scope() as db:
            ev = AgentEvent(investigation_id=uuid.UUID(inv_id), execution_id=execution_id, seq=seq, agent=agent,
                            type=type_, message=message, data=data or {})
            db.add(ev)
            db.flush()
            payload = {"id": str(ev.id), "seq": seq, "agent": agent, "type": type_, "message": message,
                       "data": data or {}, "created_at": ev.created_at.isoformat()}
        log.info("[%s] %s/%s: %s", inv_id[:8], agent, type_, message)
        with self._lock:
            subs = list(self._subs.get(inv_id, ()))
        for loop, q in subs:
            try:
                loop.call_soon_threadsafe(q.put_nowait, payload)
            except Exception:  # queue full or loop closed: subscriber will resync from the backlog
                pass
        return payload

    def reset(self, inv_id: str) -> None:
        with self._lock:
            self._seq.pop(inv_id, None)


bus = EventBus()
