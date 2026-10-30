"""Independent counterexample verification.

Deliberately separate from the search code path: it rebuilds the model
configuration from its serialised form, re-evaluates in a fresh process state,
re-checks bounds and plausibility dependencies, cross-checks the ET0 input with an
independent formula and probes robustness in a small neighbourhood.
"""
from __future__ import annotations

import hashlib
import json

import numpy as np

from . import model as M
from .parameters import PARAMETERS, PARAM_INDEX

VERIFIER_VERSION = "1.0.0"


def config_hash(cfg_dict: dict) -> str:
    return hashlib.sha256(json.dumps(cfg_dict, sort_keys=True, default=str).encode()).hexdigest()


def verify_counterexample(cfg_dict: dict, x_phys: list[float], reported_b: float, lo: list[float], hi: list[float],
                          producer: str, verifier: str = "independent_verification_agent", seed: int = 2024,
                          n_neighbours: int = 200, radius: float = 0.02, tol: float = 1e-6) -> dict:
    if producer == verifier:
        raise ValueError("A verifier may not approve results it produced itself.")
    cfg = M.ModelConfig.from_dict(json.loads(json.dumps(cfg_dict)))  # deep, serialisation-roundtripped copy
    x = np.asarray(x_phys, dtype=float)
    lo_a, hi_a = np.asarray(lo, dtype=float), np.asarray(hi, dtype=float)
    checks: list[dict] = []

    def check(name: str, passed: bool, detail: str, severity: str = "critical"):
        checks.append({"name": name, "passed": bool(passed), "detail": detail, "severity": severity})

    finite = bool(np.all(np.isfinite(x)))
    check("finite_inputs", finite, "All parameter values are finite numbers.")
    tol_b = 1e-9 * (np.abs(hi_a - lo_a) + 1)
    in_bounds = bool(np.all(x >= lo_a - tol_b) & np.all(x <= hi_a + tol_b))
    oob = [PARAMETERS[i].name for i in range(len(x)) if x[i] < lo_a[i] - tol_b[i] or x[i] > hi_a[i] + tol_b[i]]
    check("within_plausible_bounds", in_bounds, "All values within documented bounds." if in_bounds else f"Out of bounds: {oob}")

    cv = float(M.constraint_violation(x[None, :], cfg.constraints)[0]) if cfg.constraints else -1.0
    check("plausibility_dependencies", cv <= 1e-9, f"Max dependency violation {cv:.4g} (must be ≤ 0).")

    res = M.single(x, cfg)
    b = res["net_benefit"]
    reproduces = abs(b - reported_b) <= max(tol, 1e-6 * abs(reported_b))
    check("numerical_reproduction", reproduces, f"Recomputed B = {b:.8f}; reported B = {reported_b:.8f}.")
    check("claim_falsified", b < 0, f"B = {b:.6f} < B_min = 0 → criterion '{res['binding_criterion']}' violated." if b < 0
          else f"B = {b:.6f} ≥ 0: not a counterexample.")

    # independent ET0 cross-check (Hargreaves-Samani vs Penman-Monteith inputs)
    out = M.evaluate(x[None, :], cfg, return_series=True)
    ra = M.extraterrestrial_radiation(cfg.climatology.latitude, M.MID_MONTH_DOY)
    s = out["series"]
    et0_hs = float((M.et0_hargreaves(s["tmax"][0], s["tmin"][0], ra) * M.DAYS_IN_MONTH).sum())
    et0_pm = float(out["et0_mm"][0])
    ratio = et0_pm / et0_hs if et0_hs > 0 else float("inf")
    check("et0_cross_check", 0.6 <= ratio <= 1.5,
          f"Penman-Monteith ET0 {et0_pm:.0f} mm vs Hargreaves-Samani {et0_hs:.0f} mm (ratio {ratio:.2f}; accepted 0.6-1.5).",
          severity="warning")

    # robustness: fraction of nearby plausible points that also fail
    rng = np.random.default_rng(seed)
    span = hi_a - lo_a
    P = x[None, :] + rng.uniform(-radius, radius, (n_neighbours, len(x))) * span[None, :]
    P = np.clip(P, lo_a, hi_a)
    ok = M.constraint_violation(P, cfg.constraints) <= 0 if cfg.constraints else np.ones(len(P), bool)
    P = P[ok]
    Bn = M.net_benefit(M.evaluate(P, cfg), cfg.criteria) if len(P) else np.zeros(0)
    robust = float((Bn < 0).mean()) if len(Bn) else 0.0
    check("local_robustness", robust >= 0.25,
          f"{robust:.0%} of {len(Bn)} neighbours within ±{radius:.0%} of each range also fail.", severity="warning")

    # determinism: second evaluation must be bit-identical
    b2 = M.single(x, cfg)["net_benefit"]
    check("deterministic", b2 == b, "Repeated evaluation is bit-identical." if b2 == b else "Non-deterministic evaluation!")

    critical_ok = all(c["passed"] for c in checks if c["severity"] == "critical")
    warnings = [c["name"] for c in checks if not c["passed"] and c["severity"] == "warning"]
    status = "rejected" if not critical_ok else ("verified_with_warnings" if warnings else "verified")
    flags = []
    if robust < 0.25 and critical_ok:
        flags.append("Counterexample sits on a thin failure sliver; treat as a boundary case, not a robust failure mode.")
    if cfg.climatology.synthetic:
        flags.append("Baseline climate is SYNTHETIC; conclusions are exploratory only.")
    assumption_params = [p.name for p in PARAMETERS if p.status == "assumption"]
    flags.append("Result depends on uncalibrated assumptions: " + ", ".join(assumption_params) + ".")
    return {
        "status": status,
        "verifier": verifier,
        "producer": producer,
        "verifier_version": VERIFIER_VERSION,
        "config_hash": config_hash(cfg_dict),
        "recomputed_b": b,
        "reported_b": reported_b,
        "binding_criterion": res["binding_criterion"],
        "robustness": robust,
        "metrics": {k: res[k] for k in ("cooling_c", "survival_rate", "water_stress_index", "irrigation_m3_ha")},
        "checks": checks,
        "flags": flags,
    }
