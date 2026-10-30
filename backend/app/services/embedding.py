"""Deterministic hashed n-gram embeddings (256-d, L2-normalised).

A transparent, dependency-free lexical-semantic embedding used for evidence
retrieval. On PostgreSQL the vectors are stored in pgvector and searched with the
cosine-distance operator; on SQLite they are ranked in Python. Swap in a neural
embedding model by replacing ``embed`` - the storage dimension is configured in db.py.
"""
from __future__ import annotations

import hashlib
import re

import numpy as np

from ..db import EMBEDDING_DIM

STOP = set("the a an of and or in on for to with by at from is are was were be been this that these those as it its "
           "we our their which than into using use used can may also between during over under".split())


def _tokens(text: str) -> list[str]:
    words = [w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOP and len(w) > 1]
    stems = [w[:-1] if w.endswith("s") and len(w) > 3 else w for w in words]
    return stems + [f"{a}_{b}" for a, b in zip(stems, stems[1:])]


def embed(text: str) -> list[float]:
    v = np.zeros(EMBEDDING_DIM)
    for tok in _tokens(text):
        h = int.from_bytes(hashlib.blake2b(tok.encode(), digest_size=8).digest(), "little")
        v[h % EMBEDDING_DIM] += 1.0 if (h >> 63) & 1 else -1.0
    n = np.linalg.norm(v)
    return (v / n).round(6).tolist() if n > 0 else v.tolist()


def cosine(a: list[float], b: list[float]) -> float:
    a_, b_ = np.asarray(a), np.asarray(b)
    d = np.linalg.norm(a_) * np.linalg.norm(b_)
    return float(a_ @ b_ / d) if d > 0 else 0.0
