"""Sensitivity (SALib Sobol), Monte Carlo uncertainty, failure-boundary maps and
alternative-intervention evaluation. All quantities come from ``model.evaluate``.
"""
from __future__ import annotations

import math

import numpy as np

from . import model as M
from .parameters import PARAMETERS, PARAM_INDEX, ENV_NAMES, METRICS


def wilson_interval(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    denom = 1 + z**2 / n
    centre = (p + z**2 / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


# --------------------------------------------------------------------------- Sobol sensitivity
def sobol_sensitivity(cfg: M.ModelConfig, base: np.ndarray, lo: np.ndarray, hi: np.ndarray, names: list[str],
                      n_base: int = 256, seed: int = 42, outputs=("net_benefit", "cooling_c", "survival_rate",
                                                                    "water_stress_index")) -> dict:
    from SALib.analyze import sobol as sobol_analyze
    from SALib.sample import sobol as sobol_sample

    idx = [PARAM_INDEX[n] for n in names]
    problem = {"num_vars": len(names), "names": names, "bounds": [[float(lo[i]), float(hi[i])] for i in idx]}
    S = sobol_sample.sample(problem, n_base, calc_second_order=False, seed=seed)
    X = np.tile(base, (S.shape[0], 1))
    X[:, idx] = S
    out = M.evaluate(X, cfg)
    out["net_benefit"] = M.net_benefit(out, cfg.criteria)
    results = {}
    for o in outputs:
        Y = np.asarray(out[o], dtype=float)
        if np.allclose(Y.std(), 0):
            results[o] = {"S1": [0.0] * len(names), "ST": [0.0] * len(names), "S1_conf": [0.0] * len(names),
                          "ST_conf": [0.0] * len(names), "note": "Output constant over the sampled space."}
            continue
        Si = sobol_analyze.analyze(problem, Y, calc_second_order=False, seed=seed)
        results[o] = {k: np.nan_to_num(np.asarray(Si[k]), nan=0.0).round(5).tolist() for k in ("S1", "ST", "S1_conf", "ST_conf")}
    return {
        "method": "Sobol (Saltelli/Jansen estimators, SALib)",
        "names": names,
        "labels": [PARAMETERS[i].label for i in idx],
        "n_base": n_base,
        "n_evaluations": int(S.shape[0]),
        "seed": seed,
        "results": results,
        "note": "Indices are conditional on the uniform plausible ranges and on the model structure.",
    }


# --------------------------------------------------------------------------- Monte Carlo
def monte_carlo(cfg: M.ModelConfig, base: np.ndarray, lo: np.ndarray, hi: np.ndarray, names: list[str] | None = None,
                n: int = 2000, seed: int = 42) -> dict:
    """Triangular(lower, nominal, upper) uncertainty on the selected (default: environmental) parameters."""
    rng = np.random.default_rng(seed)
    names = names or ENV_NAMES
    X = np.tile(base, (n, 1))
    for name in names:
        i = PARAM_INDEX[name]
        a, c, b = lo[i], base[i], hi[i]
        if b - a <= 0:
            continue
        c = min(max(c, a), b)
        X[:, i] = rng.triangular(a, c, b, n) if (c > a or c < b) else np.full(n, c)
    valid = M.constraint_violation(X, cfg.constraints) <= 0
    X = X[valid]
    out = M.evaluate(X, cfg)
    mg = M.margins(out, cfg.criteria)
    B = mg.min(axis=1)
    k = int((B < 0).sum())
    m = len(B)
    p_fail = k / m if m else 0.0
    ci = wilson_interval(k, m)
    per_criterion = []
    for j, c in enumerate(cfg.criteria):
        kj = int((mg[:, j] < 0).sum())
        per_criterion.append({"metric": c.metric, "label": c.label, "failure_probability": kj / m if m else 0.0,
                              "ci95": wilson_interval(kj, m)})
    metric_stats = {}
    for key in METRICS:
        v = out[key]
        hist, edges = np.histogram(v, bins=30)
        metric_stats[key] = {
            "mean": float(v.mean()), "std": float(v.std()),
            "p05": float(np.percentile(v, 5)), "p50": float(np.percentile(v, 50)), "p95": float(np.percentile(v, 95)),
            "histogram": {"counts": hist.tolist(), "edges": np.round(edges, 5).tolist()},
        }
    # running estimate of the failure probability (convergence diagnostic)
    running = np.cumsum(B < 0) / np.arange(1, m + 1) if m else np.zeros(0)
    stride = max(1, m // 100)
    return {
        "method": "Monte Carlo, triangular(lower, nominal, upper) priors, implausible samples rejected",
        "n_requested": n,
        "n_valid": m,
        "rejected_by_constraints": int(n - m),
        "seed": seed,
        "uncertain_parameters": names,
        "failure_probability": p_fail,
        "failure_ci95": ci,
        "per_criterion": per_criterion,
        "metrics": metric_stats,
        "convergence": [[int(i + 1), float(running[i])] for i in range(0, m, stride)],
        "note": "Priors are not calibrated probability distributions; the failure probability is conditional on them.",
    }


# --------------------------------------------------------------------------- boundary maps
def boundary_map(cfg: M.ModelConfig, base: np.ndarray, px: str, py: str, lo: np.ndarray, hi: np.ndarray,
                 resolution: int = 40, metric: str = "net_benefit") -> dict:
    ix, iy = PARAM_INDEX[px], PARAM_INDEX[py]
    xs = np.linspace(lo[ix], hi[ix], resolution)
    ys = np.linspace(lo[iy], hi[iy], resolution)
    GX, GY = np.meshgrid(xs, ys)
    X = np.tile(base, (resolution * resolution, 1))
    X[:, ix] = GX.ravel()
    X[:, iy] = GY.ravel()
    out = M.evaluate(X, cfg)
    mg = M.margins(out, cfg.criteria)
    B = mg.min(axis=1)
    binding = mg.argmin(axis=1)
    cv = M.constraint_violation(X, cfg.constraints)
    Z = (B if metric == "net_benefit" else out[metric]).reshape(resolution, resolution)
    return {
        "x": {"name": px, "label": PARAMETERS[ix].label, "unit": PARAMETERS[ix].unit, "values": xs.round(5).tolist()},
        "y": {"name": py, "label": PARAMETERS[iy].label, "unit": PARAMETERS[iy].unit, "values": ys.round(5).tolist()},
        "metric": metric,
        "z": np.round(Z, 5).tolist(),
        "net_benefit": np.round(B.reshape(resolution, resolution), 5).tolist(),
        "binding": binding.reshape(resolution, resolution).tolist(),
        "implausible": (cv > 0).reshape(resolution, resolution).tolist(),
        "criteria": [c.metric for c in cfg.criteria],
        "failure_fraction": float((B < 0).mean()),
        "evaluations": int(resolution * resolution),
    }


def local_sensitivity(cfg: M.ModelConfig, x: np.ndarray, lo: np.ndarray, hi: np.ndarray, names: list[str]) -> list[dict]:
    """One-at-a-time swing of B between the parameter's plausible bounds (tornado chart data)."""
    rows = []
    X = []
    for n in names:
        i = PARAM_INDEX[n]
        a, b = x.copy(), x.copy()
        a[i], b[i] = lo[i], hi[i]
        X += [a, b]
    out = M.evaluate(np.array(X), cfg)
    B = M.net_benefit(out, cfg.criteria)
    for j, n in enumerate(names):
        rows.append({"name": n, "label": PARAMETERS[PARAM_INDEX[n]].label, "low": float(B[2 * j]), "high": float(B[2 * j + 1]),
                     "swing": float(abs(B[2 * j + 1] - B[2 * j]))})
    return sorted(rows, key=lambda r: -r["swing"])


# --------------------------------------------------------------------------- alternatives
WUCOLS_CLASSES = [
    ("very_low", "Very-low water-use species class (WUCOLS VL)", 0.10),
    ("low", "Low water-use species class (WUCOLS L)", 0.25),
    ("moderate", "Moderate water-use species class (WUCOLS M)", 0.50),
    ("high", "High water-use species class (WUCOLS H)", 0.80),
]

IRRIGATION_STRATEGIES = [
    ("spray_full", "Spray irrigation, full demand", {"irrigation_efficiency": 0.70, "deficit_fraction": 1.0}),
    ("drip_full", "Drip irrigation, full demand", {"irrigation_efficiency": 0.90, "deficit_fraction": 1.0}),
    ("drip_deficit", "Drip irrigation, 70 % regulated deficit", {"irrigation_efficiency": 0.90, "deficit_fraction": 0.7}),
    ("spray_deficit", "Spray irrigation, 60 % deficit", {"irrigation_efficiency": 0.70, "deficit_fraction": 0.6}),
]


def generate_alternatives(base: np.ndarray, stress: np.ndarray | None) -> list[dict]:
    """Candidate interventions: species class x density x irrigation strategy subsets."""
    alts = []
    dens_nom = base[PARAM_INDEX["tree_density"]]
    for skey, slabel, ks in WUCOLS_CLASSES:
        alts.append({"key": f"species-{skey}", "category": "species", "label": slabel,
                     "changes": {"species_factor": ks}})
    for f in (0.6, 0.8, 1.25):
        alts.append({"key": f"density-{int(f * 100)}", "category": "density",
                     "label": f"Planting density {f:.0%} of proposal ({dens_nom * f:.0f} trees/ha)",
                     "changes": {"tree_density": float(np.clip(dens_nom * f, 50, 600))}})
    for ikey, ilabel, ch in IRRIGATION_STRATEGIES:
        alts.append({"key": f"irrigation-{ikey}", "category": "irrigation", "label": ilabel, "changes": ch})
    alts.append({"key": "combined-low-drip", "category": "combined",
                 "label": "Low water-use class + drip + 80 % density",
                 "changes": {"species_factor": 0.25, "irrigation_efficiency": 0.9, "deficit_fraction": 1.0,
                             "tree_density": float(np.clip(dens_nom * 0.8, 50, 600))}})
    return alts


def evaluate_alternatives(cfg: M.ModelConfig, base: np.ndarray, lo: np.ndarray, hi: np.ndarray,
                          stress_points: list[np.ndarray], alternatives: list[dict], mc_n: int = 600, seed: int = 7) -> list[dict]:
    """Every alternative is evaluated by the model under (a) nominal conditions, (b) each discovered
    counterexample's environmental conditions and (c) Monte Carlo uncertainty."""
    from .parameters import INT_NAMES

    rows = []
    env_idx = [PARAM_INDEX[n] for n in ENV_NAMES]
    options = [{"key": "proposal", "category": "baseline", "label": "Original proposal", "changes": {}}] + alternatives
    for alt in options:
        v = base.copy()
        for k, val in alt["changes"].items():
            v[PARAM_INDEX[k]] = val
        nominal = M.single(v, cfg)
        stress_results = []
        for sp in stress_points:
            vs = v.copy()
            vs[env_idx] = sp[env_idx]  # apply adverse environmental conditions, keep the alternative's design
            r = M.single(vs, cfg)
            stress_results.append({"net_benefit": r["net_benefit"], "success": r["success"], "cooling_c": r["cooling_c"],
                                   "survival_rate": r["survival_rate"], "water_stress_index": r["water_stress_index"]})
        mc = monte_carlo(cfg, v, lo, hi, ENV_NAMES, n=mc_n, seed=seed)
        rows.append({
            **alt,
            "nominal": {k: nominal[k] for k in ("cooling_c", "survival_rate", "water_stress_index", "irrigation_m3_ha",
                                                "annual_cost_usd_ha", "net_benefit", "success", "binding_criterion")},
            "under_counterexamples": stress_results,
            "survives_counterexamples": int(sum(s["success"] for s in stress_results)),
            "failure_probability": mc["failure_probability"],
            "failure_ci95": mc["failure_ci95"],
            "cooling_p05": mc["metrics"]["cooling_c"]["p05"],
            "cooling_p50": mc["metrics"]["cooling_c"]["p50"],
            "water_p50": mc["metrics"]["irrigation_m3_ha"]["p50"],
        })
    return rows
