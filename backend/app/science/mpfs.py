"""Minimum Plausible Failure Search (MPFS).

EXPERIMENTAL METHOD. Its performance relative to established methods is NOT
assumed - it is measured by ``benchmarks.py`` on problems with known answers and
reported with the raw numbers. No superiority claim is made anywhere in code.

Goal: find  argmin_u  D(u)^2   s.t.  B(u) < 0,  g(u) <= 0,  u ∈ [-1, 1]^d

Phases (each can be disabled for ablation studies):

1. Expanding-shell screening - batches of weighted-sphere samples at increasing
   radius (plus one-at-a-time axis probes), so the *nearest* failures are found
   first and the budget is not spent far from the nominal scenario.
2. Ray bisection - for an angularly diverse subset of failing samples, bisect the
   segment between the (successful) nominal point and the failure, landing on the
   success/failure boundary along that direction. All rays are bisected in
   parallel (one batch per iteration).
3. Boundary refinement - SLSQP on min D(u)^2 subject to B(u) <= -eps and the
   plausibility dependencies, started from the best boundary points, with
   batched finite-difference gradients.
4. Failure-mode extraction - the reported counterexamples are the smallest
   valid failures in mutually distinct directions.

The final answer is always the smallest *evaluated* valid failure, so the result
is a genuine, re-evaluable model point and never an extrapolation.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, asdict, field

import numpy as np
from scipy.optimize import minimize
from scipy.stats import qmc

from .problem import FailureProblem

MPFS_VERSION = "1.0.0"


class BudgetExhausted(Exception):
    pass


@dataclass
class MPFSConfig:
    budget: int = 3000
    seed: int = 42
    eps: float = 1e-3
    n_shells: int = 8
    shell_batch: int = 64
    screen_fraction: float = 0.45
    n_rays: int = 8
    bisect_iters: int = 14
    refine_starts: int = 3
    fd_step: float = 2e-3
    diversity_cos: float = 0.85
    use_shells: bool = True
    use_bisection: bool = True
    use_refinement: bool = True
    use_descent: bool = True
    descent_starts: int = 3
    descent_iters: int = 25

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SearchResult:
    method: str
    version: str
    found: bool
    best_u: list[float] | None
    best_distance: float | None
    best_b: float | None
    evaluations: int
    first_failure_at: int | None
    runtime_s: float
    convergence: list[tuple[int, float]]
    candidates: list[dict] = field(default_factory=list)
    config: dict = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    nominal_failure: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


def summarise(problem: FailureProblem, method: str, version: str, t0: float, config: dict,
              eps: float, n_candidates: int = 5, diversity_cos: float = 0.85, notes: list[str] | None = None) -> SearchResult:
    """Common result extraction for every method: best valid failure among ALL evaluations."""
    U, B, CV, _ = problem.log.arrays()
    notes = notes or []
    if U.size == 0:
        return SearchResult(method, version, False, None, None, None, 0, None, time.perf_counter() - t0, [], [], config, notes)
    valid = (B < 0) & (CV <= 0)
    dist = problem.norm(U)
    # convergence: running min distance of valid failures vs evaluation count
    running = np.where(valid, dist, np.inf)
    running = np.minimum.accumulate(running)
    conv: list[tuple[int, float]] = []
    last = np.inf
    for i, r in enumerate(running):
        if r < last:
            conv.append((i + 1, float(r)))
            last = r
    conv.append((len(running), float(last) if np.isfinite(last) else -1.0))
    if not valid.any():
        return SearchResult(method, version, False, None, None, None, problem.log.count, None,
                            time.perf_counter() - t0, conv, [], config, notes)
    order = np.argsort(np.where(valid, dist, np.inf))
    cands: list[dict] = []
    chosen: list[np.ndarray] = []
    for i in order:
        if not valid[i]:
            break
        u = U[i]
        nu = np.linalg.norm(u)
        if nu > 0 and any(np.dot(u, c) / (nu * np.linalg.norm(c) + 1e-12) > diversity_cos for c in chosen):
            continue
        chosen.append(u)
        cands.append({"u": u.tolist(), "distance": float(dist[i]), "b": float(B[i]), "eval_index": int(i)})
        if len(cands) >= n_candidates:
            break
    best = order[0]
    return SearchResult(
        method, version, True, U[best].tolist(), float(dist[best]), float(B[best]), problem.log.count,
        problem.log.first_failure_at, time.perf_counter() - t0, conv, cands, config, notes,
    )


def _sphere_directions(rng: np.random.Generator, n: int, d: int, weights: np.ndarray) -> np.ndarray:
    z = rng.standard_normal((n, d))
    z /= np.sqrt(weights)[None, :]  # sample uniformly on the weighted-metric sphere
    norms = np.sqrt((weights[None, :] * z**2).sum(axis=1, keepdims=True))
    return z / norms


def mpfs(problem: FailureProblem, cfg: MPFSConfig | None = None) -> SearchResult:
    cfg = cfg or MPFSConfig()
    problem.reset_log()
    t0 = time.perf_counter()
    rng = np.random.default_rng(cfg.seed)
    d = problem.dim
    w = problem.weights
    notes: list[str] = []

    def ev(U: np.ndarray, phase: str):
        U = np.atleast_2d(U)
        remaining = cfg.budget - problem.log.count
        if remaining <= 0:
            raise BudgetExhausted
        if U.shape[0] > remaining:
            U = U[:remaining]
        return U, *problem.evaluate(U, phase)

    try:
        # ---------------------------------------------------------------- phase 0: nominal
        _, b0, cv0 = ev(np.zeros((1, d)), "nominal")
        if b0[0] < 0:
            notes.append("The claim already fails under nominal conditions (distance 0).")
            res = summarise(problem, "MPFS", MPFS_VERSION, t0, cfg.to_dict(), cfg.eps, notes=notes)
            res.nominal_failure = True
            return res

        # ---------------------------------------------------------------- phase 1: screening
        screen_budget = int(cfg.screen_fraction * cfg.budget)
        if cfg.use_shells:
            axes = np.vstack([np.eye(d), -np.eye(d)])  # one-at-a-time probes at plausible extremes
            ev(axes, "axis-probe")
            r_max = float(np.sqrt(w.sum()))
            for k in range(1, cfg.n_shells + 1):
                if problem.log.count >= screen_budget:
                    break
                r = r_max * k / cfg.n_shells
                dirs = _sphere_directions(rng, cfg.shell_batch, d, w)
                U = np.clip(dirs * r, -1, 1)
                _, B, CV = ev(U, f"shell-{k}")
                U_all, B_all, CV_all, _ = problem.log.arrays()
                n_fail = int(((B_all < 0) & (CV_all <= 0)).sum())
                # Once enough failures exist, one more shell is enough to bracket the boundary.
                if n_fail >= cfg.n_rays and k >= 2:
                    dirs = _sphere_directions(rng, cfg.shell_batch, d, w)
                    ev(np.clip(dirs * r_max * (k - 0.5) / cfg.n_shells, -1, 1), f"shell-{k}-half")
                    break
        else:
            sampler = qmc.LatinHypercube(d, seed=cfg.seed)
            ev(sampler.random(max(16, screen_budget)) * 2 - 1, "uniform-screen")

        U_all, B_all, CV_all, _ = problem.log.arrays()
        fail = (B_all < 0) & (CV_all <= 0)
        if not fail.any() and cfg.use_descent:
            # phase 1b: margin descent - follow -∇B from the lowest-margin screened points
            notes.append("No failures in screening; ran margin descent from the most marginal points.")
            starts = U_all[np.argsort(B_all + 1e3 * np.clip(CV_all, 0, None))[: cfg.descent_starts]]
            h = cfg.fd_step
            for s in starts:
                u = s.copy()
                step = 0.25
                for _ in range(cfg.descent_iters):
                    # one-sided differences pointing into the box (a forward step at u = +1 would be
                    # clipped away and read as zero slope)
                    hv = np.where(u + h > 1, -h, h)
                    P = np.vstack([u[None, :], u[None, :] + np.diag(hv)])
                    _, B, CV = ev(P, "margin-descent")
                    if len(B) < d + 1 or (B[0] < 0 and CV[0] <= 0):
                        break
                    g = (B[1:] - B[0]) / hv
                    gn = np.linalg.norm(g)
                    if gn < 1e-12:
                        break
                    # Newton-style step aimed at the predicted zero crossing B/|grad B|, tried at
                    # several multiples in one batch (overshoot is fine: any failure is accepted)
                    newton = max(B[0] / gn, 1e-3)
                    mults = np.array([0.6, 1.1, 1.6, 2.5]) * max(newton, step * 0.25)
                    trial = np.clip(u[None, :] - np.outer(mults, g / gn), -1, 1)
                    _, Bt, CVt = ev(trial, "margin-descent")
                    k = int(np.argmin(Bt + 1e3 * np.clip(CVt, 0, None)))
                    if Bt[k] < B[0]:
                        u = trial[k]
                        step = float(mults[k])
                    else:
                        step *= 0.5
                    if (Bt < 0).any() and (CVt[Bt < 0] <= 0).any():
                        break
            U_all, B_all, CV_all, _ = problem.log.arrays()
            fail = (B_all < 0) & (CV_all <= 0)
        if not fail.any():
            notes.append("No failures found during screening; spending remaining budget on uniform sampling.")
            sampler = qmc.LatinHypercube(d, seed=cfg.seed + 1)
            while problem.log.count < cfg.budget:
                ev(sampler.random(min(256, cfg.budget - problem.log.count)) * 2 - 1, "fallback-uniform")
                U_all, B_all, CV_all, _ = problem.log.arrays()
                fail = (B_all < 0) & (CV_all <= 0)
                if fail.any():
                    break

        # pick angularly diverse failing seeds, nearest first
        U_all, B_all, CV_all, _ = problem.log.arrays()
        fail = (B_all < 0) & (CV_all <= 0)
        dist = problem.norm(U_all)
        order = np.argsort(np.where(fail, dist, np.inf))
        seeds: list[np.ndarray] = []
        for i in order:
            if not fail[i]:
                break
            u = U_all[i]
            nu = np.linalg.norm(u) + 1e-12
            if any(np.dot(u, s) / (nu * np.linalg.norm(s) + 1e-12) > cfg.diversity_cos for s in seeds):
                continue
            seeds.append(u)
            if len(seeds) >= cfg.n_rays:
                break

        # ---------------------------------------------------------------- phase 2: ray bisection
        boundary = np.array(seeds) if seeds else np.zeros((0, d))
        if cfg.use_bisection and len(seeds):
            S = np.array(seeds)
            lo = np.zeros(len(S))  # success side (nominal)
            hi = np.ones(len(S))  # failure side
            for _ in range(cfg.bisect_iters):
                mid = (lo + hi) / 2
                _, B, CV = ev(S * mid[:, None], "bisection")
                k = len(B)
                f = (B < 0) & (CV <= 0)
                hi[:k] = np.where(f, mid[:k], hi[:k])
                lo[:k] = np.where(f, lo[:k], mid[:k])
            boundary = S * hi[:, None]

        # ---------------------------------------------------------------- phase 3: refinement
        if cfg.use_refinement and len(boundary):
            starts = boundary[np.argsort(problem.norm(boundary))][: cfg.refine_starts]
            cache: dict[bytes, tuple[float, float, np.ndarray, np.ndarray]] = {}

            def fd(u: np.ndarray):
                key = np.round(u, 10).tobytes()
                if key in cache:
                    return cache[key]
                h = cfg.fd_step
                P = np.vstack([u[None, :], u[None, :] + h * np.eye(d)])
                P = np.clip(P, -1, 1)
                Pu, B, CV = ev(P, "refine")
                if len(B) < d + 1:
                    raise BudgetExhausted
                steps = P[1:] - P[0]
                diag = np.where(np.abs(np.diag(steps)) > 0, np.diag(steps), h)
                gb = (B[1:] - B[0]) / diag
                gc = (CV[1:] - CV[0]) / diag
                cache[key] = (float(B[0]), float(CV[0]), gb, gc)
                return cache[key]

            for s in starts:
                if problem.log.count + d + 1 > cfg.budget:
                    break
                try:
                    minimize(
                        lambda u: float((w * u**2).sum()),
                        s,
                        jac=lambda u: 2 * w * u,
                        method="SLSQP",
                        bounds=[(-1, 1)] * d,
                        constraints=[
                            {"type": "ineq", "fun": lambda u: -fd(u)[0] - cfg.eps, "jac": lambda u: -fd(u)[2]},
                            {"type": "ineq", "fun": lambda u: -fd(u)[1], "jac": lambda u: -fd(u)[3]},
                        ],
                        options={"maxiter": 40, "ftol": 1e-7},
                    )
                except BudgetExhausted:
                    break
                except Exception as exc:  # numerical failure in SLSQP is non-fatal: keep evaluated points
                    notes.append(f"Refinement start skipped: {type(exc).__name__}")

            # final radial bisection of the refined best point (squeezes onto the boundary)
            U_all, B_all, CV_all, _ = problem.log.arrays()
            fail = (B_all < 0) & (CV_all <= 0)
            if fail.any():
                best = U_all[np.argmin(np.where(fail, problem.norm(U_all), np.inf))]
                lo_t, hi_t = 0.0, 1.0
                for _ in range(10):
                    mid = (lo_t + hi_t) / 2
                    _, B, CV = ev(best[None, :] * mid, "final-bisection")
                    if B[0] < 0 and CV[0] <= 0:
                        hi_t = mid
                    else:
                        lo_t = mid
    except BudgetExhausted:
        notes.append("Evaluation budget exhausted.")

    return summarise(problem, "MPFS", MPFS_VERSION, t0, cfg.to_dict(), cfg.eps, diversity_cos=cfg.diversity_cos, notes=notes)
