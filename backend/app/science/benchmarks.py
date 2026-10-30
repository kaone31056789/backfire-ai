"""Synthetic benchmark problems with KNOWN minimum failure distances.

Used to measure (not assume) how MPFS compares with random search, differential
evolution and NSGA-II, and to run ablations of MPFS phases. Every number shown in
the UI is produced by ``run_benchmark_suite`` at request time and stored.
"""
from __future__ import annotations

import time

import numpy as np
from scipy.optimize import minimize

from .baselines import run_method
from .problem import AnalyticProblem

BENCHMARK_VERSION = "1.0.0"


def _unit(rng, d):
    a = np.abs(rng.standard_normal(d)) + 0.2
    return a / np.linalg.norm(a)


def make_problems(dim: int, seed: int = 0) -> list[AnalyticProblem]:
    rng = np.random.default_rng(1000 + dim + seed)
    probs: list[AnalyticProblem] = []

    # 1. Half-space: fail when a·u > b.  d* = b / ||a||
    a = _unit(rng, dim)
    b = 0.45
    probs.append(AnalyticProblem(f"halfspace-d{dim}", dim, lambda U, a=a, b=b: b - U @ a, b, a * b))

    # 2. Offset ball: fail inside ball(c, r).  d* = ||c|| - r
    c = _unit(rng, dim) * 0.75
    r = 0.2
    probs.append(AnalyticProblem(f"offset-ball-d{dim}", dim,
                                 lambda U, c=c, r=r: np.linalg.norm(U - c, axis=1) - r,
                                 float(np.linalg.norm(c) - r), c * (1 - r / np.linalg.norm(c))))

    # 3. Deceptive two-ball: large far basin, small near basin.  d* = min over balls
    c1 = _unit(rng, dim) * 0.95; r1 = 0.30
    c2 = -_unit(rng, dim) * 0.62; r2 = 0.06
    def two(U, c1=c1, r1=r1, c2=c2, r2=r2):
        return np.minimum(np.linalg.norm(U - c1, axis=1) - r1, np.linalg.norm(U - c2, axis=1) - r2)
    d_two = min(np.linalg.norm(c1) - r1, np.linalg.norm(c2) - r2)
    probs.append(AnalyticProblem(f"deceptive-two-ball-d{dim}", dim, two, float(d_two)))

    # 4. Constrained half-space with anisotropic weights; d* by exact convex QP
    a4 = _unit(rng, dim)
    b4 = 0.4
    w4 = np.linspace(0.5, 2.0, dim)
    k = int(np.argmax(a4))
    cap = 0.5 * (a4[k] * b4 / (a4 @ a4))  # forbid the dominant direction from reaching its unconstrained optimum
    viol = lambda U, k=k, cap=cap: U[:, k] - cap
    qp = minimize(lambda u: float((w4 * u**2).sum()), np.full(dim, 0.5), jac=lambda u: 2 * w4 * u, method="SLSQP",
                  bounds=[(-1, 1)] * dim,
                  constraints=[{"type": "ineq", "fun": lambda u: u @ a4 - b4, "jac": lambda u: a4},
                               {"type": "ineq", "fun": lambda u: cap - u[k]}],
                  options={"ftol": 1e-14, "maxiter": 500})
    probs.append(AnalyticProblem(f"constrained-weighted-halfspace-d{dim}", dim, lambda U, a=a4, b=b4: b - U @ a,
                                 float(np.sqrt(qp.fun)), qp.x, weights=w4, violation=viol))
    return probs


def _evals_to_within(conv: list[tuple[int, float]], target: float, tol: float) -> int | None:
    for n, dist in conv:
        if 0 <= dist <= target * (1 + tol):
            return n
    return None


def run_benchmark_suite(dims=(4, 8), methods=("mpfs", "random", "de", "nsga2"), seeds=(0, 1, 2),
                        budget: int = 2000, tol: float = 0.05, ablations: bool = True) -> dict:
    variants: list[tuple[str, str, dict | None]] = [(m, m, None) for m in methods]
    if ablations:
        variants += [
            ("mpfs-no-shells", "mpfs", {"use_shells": False}),
            ("mpfs-no-bisection", "mpfs", {"use_bisection": False}),
            ("mpfs-no-refinement", "mpfs", {"use_refinement": False}),
            ("mpfs-no-descent", "mpfs", {"use_descent": False}),
        ]
    t0 = time.perf_counter()
    rows = []
    for dim in dims:
        for prob in make_problems(dim):
            for key, base, overrides in variants:
                for seed in seeds:
                    res = run_method(base, prob, budget, seed, overrides)
                    gap = None if not res.found else (res.best_distance - prob.true_distance) / max(prob.true_distance, 1e-9)
                    rows.append({
                        "problem": prob.name,
                        "dim": dim,
                        "variant": key,
                        "method": res.method,
                        "seed": seed,
                        "true_distance": prob.true_distance,
                        "found": res.found,
                        "best_distance": res.best_distance,
                        "relative_gap": gap,
                        "within_tol": bool(res.found and gap is not None and gap <= tol),
                        "evaluations": res.evaluations,
                        "first_failure_at": res.first_failure_at,
                        "evals_to_tol": _evals_to_within(res.convergence, prob.true_distance, tol),
                        "runtime_s": res.runtime_s,
                        "below_true_bound": bool(res.found and res.best_distance < prob.true_distance * (1 - 1e-6)),
                    })
    # aggregate per variant
    summary = []
    for key, _, _ in variants:
        rs = [r for r in rows if r["variant"] == key]
        gaps = [r["relative_gap"] for r in rs if r["relative_gap"] is not None]
        e2t = [r["evals_to_tol"] for r in rs if r["evals_to_tol"] is not None]
        summary.append({
            "variant": key,
            "method": rs[0]["method"] if rs else key,
            "runs": len(rs),
            "found_rate": float(np.mean([r["found"] for r in rs])) if rs else 0.0,
            "within_tol_rate": float(np.mean([r["within_tol"] for r in rs])) if rs else 0.0,
            "median_relative_gap": float(np.median(gaps)) if gaps else None,
            "mean_relative_gap": float(np.mean(gaps)) if gaps else None,
            "median_evals_to_tol": float(np.median(e2t)) if e2t else None,
            "mean_runtime_s": float(np.mean([r["runtime_s"] for r in rs])) if rs else 0.0,
            "constraint_or_bound_violations": int(sum(r["below_true_bound"] for r in rs)),
        })
    return {
        "version": BENCHMARK_VERSION,
        "config": {"dims": list(dims), "methods": list(methods), "seeds": list(seeds), "budget": budget, "tolerance": tol,
                   "ablations": ablations},
        "summary": summary,
        "rows": rows,
        "runtime_s": time.perf_counter() - t0,
        "interpretation_note": (
            "Results are specific to these synthetic problems and budgets. They do not establish general "
            "superiority of any method. 'below_true_bound' counts results that claim a distance smaller than the "
            "analytic optimum, which would indicate a constraint or evaluation error."
        ),
    }
