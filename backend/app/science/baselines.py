"""Baseline failure-search methods. All share the FailureProblem interface, the
same evaluation budget and the same result rule (smallest valid evaluated failure),
so comparisons with MPFS are like-for-like.
"""
from __future__ import annotations

import time

import numpy as np
from scipy.optimize import differential_evolution

from .mpfs import SearchResult, summarise
from .problem import FailureProblem

BASELINE_VERSION = "1.0.0"


def random_search(problem: FailureProblem, budget: int = 3000, seed: int = 42, batch: int = 256) -> SearchResult:
    problem.reset_log()
    t0 = time.perf_counter()
    rng = np.random.default_rng(seed)
    problem.evaluate(np.zeros((1, problem.dim)), "nominal")
    while problem.log.count < budget:
        n = min(batch, budget - problem.log.count)
        problem.evaluate(rng.uniform(-1, 1, (n, problem.dim)), "random")
    return summarise(problem, "Random search", BASELINE_VERSION, t0, {"budget": budget, "seed": seed}, 0.0)


def differential_evolution_search(problem: FailureProblem, budget: int = 3000, seed: int = 42,
                                  popsize: int = 10, eps: float = 1e-3) -> SearchResult:
    """SciPy DE on a penalised objective: D(u)^2 for valid failures, a dominated
    penalty proportional to the remaining benefit margin otherwise."""
    problem.reset_log()
    t0 = time.perf_counter()
    d = problem.dim
    big = float(problem.weights.sum()) + 1.0
    pop_n = popsize * d

    def f(UT: np.ndarray) -> np.ndarray:
        U = np.atleast_2d(UT.T)
        remaining = budget - problem.log.count
        if remaining <= 0:
            return np.full(U.shape[0], big * 10)
        B, CV = problem.evaluate(U[:remaining], "de")
        out = np.full(U.shape[0], big * 10)
        k = len(B)
        dist2 = (problem.weights[None, :] * U[:k] ** 2).sum(axis=1)
        valid = (B < -eps) & (CV <= 0)
        pen = big + 10 * np.clip(B + eps, 0, None) + 10 * np.clip(CV, 0, None)
        out[:k] = np.where(valid, dist2, pen)
        return out

    maxiter = max(1, budget // pop_n - 1)
    try:
        differential_evolution(
            f, bounds=[(-1, 1)] * d, seed=seed, popsize=popsize, maxiter=maxiter, tol=0, polish=False,
            vectorized=True, updating="deferred", init="sobol",
        )
    except Exception:  # pragma: no cover - SciPy edge cases at tiny budgets
        pass
    return summarise(problem, "Differential evolution", BASELINE_VERSION, t0,
                     {"budget": budget, "seed": seed, "popsize": popsize, "library": "scipy"}, eps)


def nsga2_search(problem: FailureProblem, budget: int = 3000, seed: int = 42, pop_size: int = 40) -> SearchResult:
    """pymoo NSGA-II: objectives (D(u)^2, B(u)), inequality constraint g(u) <= 0."""
    from pymoo.algorithms.moo.nsga2 import NSGA2
    from pymoo.core.problem import Problem
    from pymoo.optimize import minimize as pymoo_minimize

    problem.reset_log()
    t0 = time.perf_counter()
    d = problem.dim
    fp = problem

    class _P(Problem):
        def __init__(self):
            super().__init__(n_var=d, n_obj=2, n_ieq_constr=1, xl=-np.ones(d), xu=np.ones(d))

        def _evaluate(self, X, out, *args, **kwargs):
            B, CV = fp.evaluate(X, "nsga2")
            out["F"] = np.column_stack([(fp.weights[None, :] * X**2).sum(axis=1), B])
            out["G"] = CV[:, None]

    n_gen = max(1, budget // pop_size)
    try:
        pymoo_minimize(_P(), NSGA2(pop_size=pop_size), ("n_eval", budget), seed=seed, verbose=False)
    except Exception as exc:  # pragma: no cover
        return summarise(problem, "NSGA-II", BASELINE_VERSION, t0, {"budget": budget, "error": str(exc)}, 0.0)
    return summarise(problem, "NSGA-II", BASELINE_VERSION, t0,
                     {"budget": budget, "seed": seed, "pop_size": pop_size, "n_gen": n_gen, "library": "pymoo"}, 0.0)


METHODS = {
    "mpfs": None,  # resolved lazily to avoid a circular import in callers
    "random": random_search,
    "de": differential_evolution_search,
    "nsga2": nsga2_search,
}


def run_method(name: str, problem: FailureProblem, budget: int, seed: int, mpfs_overrides: dict | None = None) -> SearchResult:
    if name == "mpfs" or name.startswith("mpfs"):
        from .mpfs import MPFSConfig, mpfs

        cfg = MPFSConfig(budget=budget, seed=seed, **(mpfs_overrides or {}))
        res = mpfs(problem, cfg)
        if mpfs_overrides:
            res.method = "MPFS (" + ", ".join(k.replace("use_", "no-") for k, v in mpfs_overrides.items() if v is False) + ")"
        return res
    fn = METHODS[name]
    return fn(problem, budget=budget, seed=seed)
