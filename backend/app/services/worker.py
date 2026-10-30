"""Background execution of investigation workflows.

A bounded thread pool keeps long scientific runs off the request path. One
workflow per investigation at a time. (For multi-node deployments swap this for
Celery/RQ on Redis - the workflow entry point ``run_investigation`` is pure.)
"""
from __future__ import annotations

import concurrent.futures as cf
import threading

_pool = cf.ThreadPoolExecutor(max_workers=2, thread_name_prefix="backfire-worker")
_running: set[str] = set()
_lock = threading.Lock()


def is_running(inv_id: str) -> bool:
    with _lock:
        return inv_id in _running


def submit(inv_id: str, user_id: str, mode: str) -> bool:
    from ..agents.workflow import run_investigation

    with _lock:
        if inv_id in _running:
            return False
        _running.add(inv_id)

    def job():
        try:
            run_investigation(inv_id, user_id, mode)
        finally:
            with _lock:
                _running.discard(inv_id)

    _pool.submit(job)
    return True


def run_sync(inv_id: str, user_id: str, mode: str) -> None:
    """Used by tests: run the workflow in the calling thread."""
    from ..agents.workflow import run_investigation

    run_investigation(inv_id, user_id, mode)
