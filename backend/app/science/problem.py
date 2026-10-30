"""Failure-search problem definition shared by MPFS and all baselines.

Normalised plausibility space
-----------------------------
Each active parameter i is mapped to u_i ∈ [-1, 1] *asymmetrically* around its
nominal value v0_i:

    v_i = v0_i + u_i * (hi_i - v0_i)   if u_i >= 0
    v_i = v0_i + u_i * (v0_i - lo_i)   if u_i <  0

so |u_i| = 1 always means "at the edge of the documented plausible range",
irrespective of units. The perturbation size is the weighted norm

    D(u)^2 = sum_env w_i u_i^2  +  λ * sum_int w_i u_i^2

which is the ||Δx||²_W + λ||Δθ||²_W objective of the specification. A point is a
counterexample when B(v(u)) < B_min (= 0) and all plausibility dependencies hold.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from . import model as M
from .parameters import PARAMETERS, PARAM_INDEX


@dataclass
class EvalLog:
    """Records every objective evaluation (u, B, constraint violation, wall time)."""

    u: list[np.ndarray] = field(default_factory=list)
    b: list[np.ndarray] = field(default_factory=list)
    cv: list[np.ndarray] = field(default_factory=list)
    phase: list[str] = field(default_factory=list)
    count: int = 0
    first_failure_at: int | None = None
    t0: float = field(default_factory=time.perf_counter)

    def add(self, U: np.ndarray, B: np.ndarray, CV: np.ndarray, phase: str, eps: float = 0.0) -> None:
        start = self.count
        self.u.append(U.copy())
        self.b.append(B.copy())
        self.cv.append(CV.copy())
        self.phase.extend([phase] * len(B))
        self.count += len(B)
        if self.first_failure_at is None:
            hits = np.nonzero((B < -eps) & (CV <= 0))[0]
            if hits.size:
                self.first_failure_at = start + int(hits[0]) + 1

    def arrays(self) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[str]]:
        if not self.u:
            return np.zeros((0, 0)), np.zeros(0), np.zeros(0), []
        return np.vstack(self.u), np.concatenate(self.b), np.concatenate(self.cv), self.phase


class FailureProblem:
    """Generic interface: batched B(u) and constraint violation in normalised space."""

    name: str = "problem"

    def __init__(self, dim: int, weights: np.ndarray, labels: list[str]):
        self.dim = dim
        self.weights = np.asarray(weights, dtype=float)
        self.labels = labels
        self.log = EvalLog()

    # subclasses implement
    def _benefit(self, U: np.ndarray) -> np.ndarray:  # pragma: no cover - interface
        raise NotImplementedError

    def _violation(self, U: np.ndarray) -> np.ndarray:
        return np.full(U.shape[0], -1.0)

    def evaluate(self, U: np.ndarray, phase: str = "search") -> tuple[np.ndarray, np.ndarray]:
        U = np.clip(np.atleast_2d(U), -1.0, 1.0)
        B = self._benefit(U)
        CV = self._violation(U)
        self.log.add(U, B, CV, phase)
        return B, CV

    def norm(self, U: np.ndarray) -> np.ndarray:
        U = np.atleast_2d(U)
        return np.sqrt((self.weights[None, :] * U**2).sum(axis=1))

    def reset_log(self) -> None:
        self.log = EvalLog()


class AfforestationProblem(FailureProblem):
    """MPFS problem over the afforestation model."""

    name = "urban-afforestation"

    def __init__(
        self,
        cfg: M.ModelConfig,
        nominal: np.ndarray,
        lo: np.ndarray,
        hi: np.ndarray,
        active: list[str],
        lam: float = 1.0,
        weight_overrides: dict[str, float] | None = None,
    ):
        self.cfg = cfg
        self.v0 = np.asarray(nominal, dtype=float)
        self.lo = np.minimum(np.asarray(lo, dtype=float), self.v0)
        self.hi = np.maximum(np.asarray(hi, dtype=float), self.v0)
        self.active = [a for a in active if a in PARAM_INDEX]
        self.idx = np.array([PARAM_INDEX[a] for a in self.active], dtype=int)
        self.lam = lam
        w = []
        for name in self.active:
            spec = PARAMETERS[PARAM_INDEX[name]]
            wi = (weight_overrides or {}).get(name, spec.weight)
            w.append(wi * (lam if spec.kind == "intervention" else 1.0))
        super().__init__(len(self.active), np.array(w), self.active)

    def to_physical(self, U: np.ndarray) -> np.ndarray:
        U = np.clip(np.atleast_2d(U), -1.0, 1.0)
        X = np.tile(self.v0, (U.shape[0], 1))
        up = self.hi[self.idx] - self.v0[self.idx]
        dn = self.v0[self.idx] - self.lo[self.idx]
        X[:, self.idx] = self.v0[self.idx] + np.where(U >= 0, U * up, U * dn)
        return X

    def to_normalised(self, X: np.ndarray) -> np.ndarray:
        X = np.atleast_2d(X)
        d = X[:, self.idx] - self.v0[self.idx]
        up = np.maximum(self.hi[self.idx] - self.v0[self.idx], 1e-12)
        dn = np.maximum(self.v0[self.idx] - self.lo[self.idx], 1e-12)
        return np.clip(np.where(d >= 0, d / up, d / dn), -1, 1)

    def _benefit(self, U: np.ndarray) -> np.ndarray:
        X = self.to_physical(U)
        out = M.evaluate(X, self.cfg)
        return M.net_benefit(out, self.cfg.criteria)

    def _violation(self, U: np.ndarray) -> np.ndarray:
        return M.constraint_violation(self.to_physical(U), self.cfg.constraints)

    def describe(self) -> dict:
        return {
            "active": self.active,
            "weights": self.weights.tolist(),
            "lambda": self.lam,
            "nominal": {n: float(self.v0[PARAM_INDEX[n]]) for n in self.active},
            "lower": {n: float(self.lo[PARAM_INDEX[n]]) for n in self.active},
            "upper": {n: float(self.hi[PARAM_INDEX[n]]) for n in self.active},
        }


class AnalyticProblem(FailureProblem):
    """Synthetic benchmark with a closed-form benefit and known minimum failure distance."""

    def __init__(self, name: str, dim: int, benefit: Callable[[np.ndarray], np.ndarray], true_distance: float,
                 true_point: np.ndarray | None = None, weights: np.ndarray | None = None,
                 violation: Callable[[np.ndarray], np.ndarray] | None = None):
        super().__init__(dim, weights if weights is not None else np.ones(dim), [f"u{i}" for i in range(dim)])
        self.name = name
        self._b = benefit
        self._v = violation
        self.true_distance = true_distance
        self.true_point = true_point

    def _benefit(self, U: np.ndarray) -> np.ndarray:
        return self._b(U)

    def _violation(self, U: np.ndarray) -> np.ndarray:
        return self._v(U) if self._v else np.full(U.shape[0], -1.0)
