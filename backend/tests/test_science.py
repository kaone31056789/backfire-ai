import numpy as np
import pytest

from app.science import model as M
from app.science.analysis import boundary_map, monte_carlo, sobol_sensitivity, wilson_interval
from app.science.baselines import run_method
from app.science.benchmarks import make_problems, run_benchmark_suite
from app.science.mpfs import MPFSConfig, mpfs
from app.science.parameters import DEFAULT_CONSTRAINTS, PARAM_INDEX, PARAM_NAMES
from app.science.problem import AfforestationProblem
from app.science.verification import verify_counterexample


@pytest.fixture(scope="module")
def cfg():
    return M.ModelConfig(climatology=M.synthetic_climatology())


# ----------------------------------------------------------------- FAO-56 reference values
def test_saturation_vapour_pressure_matches_fao56_table():
    # FAO-56 Annex 2, Table 2.3: e°(25 °C) = 3.168 kPa, e°(10 °C) = 1.228 kPa
    assert M.sat_vapour_pressure(25.0) == pytest.approx(3.168, abs=2e-3)
    assert M.sat_vapour_pressure(10.0) == pytest.approx(1.228, abs=2e-3)


def test_extraterrestrial_radiation_fao56_example8():
    # FAO-56 Example 8: 20°S, 3 September (J = 246) -> Ra = 32.2 MJ m-2 day-1
    assert M.extraterrestrial_radiation(-20.0, np.array([246]))[0] == pytest.approx(32.2, abs=0.2)


def test_effective_rainfall_usda_scs():
    assert M.effective_rainfall_monthly(np.array([100.0]))[0] == pytest.approx(100 * (125 - 20) / 125)
    assert M.effective_rainfall_monthly(np.array([300.0]))[0] == pytest.approx(155.0)


def test_et0_increases_with_temperature_and_decreases_with_humidity(cfg):
    base = M.nominal_vector()
    X = np.tile(base, (3, 1))
    X[1, PARAM_INDEX["warming_c"]] += 3
    X[2, PARAM_INDEX["rh_change"]] = 10
    et0 = M.evaluate(X, cfg)["et0_mm"]
    assert et0[1] > et0[0] > et0[2]
    assert 800 < et0[0] < 2500  # plausible annual ET0 for a hot semi-arid climate


# ----------------------------------------------------------------- model properties
def test_batch_matches_single(cfg):
    rng = np.random.default_rng(0)
    lo, hi = M.bounds_arrays()
    X = lo + rng.random((20, len(lo))) * (hi - lo)
    batch = M.evaluate(X, cfg)
    for i in (0, 7, 19):
        s = M.single(X[i], cfg)
        assert s["cooling_c"] == pytest.approx(batch["cooling_c"][i], rel=1e-12)
        assert s["water_stress_index"] == pytest.approx(batch["water_stress_index"][i], rel=1e-12)


def test_physical_ranges(cfg):
    lo, hi = M.bounds_arrays()
    rng = np.random.default_rng(1)
    out = M.evaluate(lo + rng.random((500, len(lo))) * (hi - lo), cfg)
    assert np.all((out["water_stress_index"] >= 0) & (out["water_stress_index"] <= 1))
    assert np.all((out["survival_rate"] >= 0) & (out["survival_rate"] <= 1))
    assert np.all(out["cooling_c"] >= 0)
    assert np.all(out["irrigation_m3_ha"] >= 0)


def test_more_water_never_increases_stress(cfg):
    X = np.tile(M.nominal_vector(), (6, 1))
    X[:, PARAM_INDEX["water_allocation_mm"]] = np.linspace(0, 1500, 6)
    wsi = M.evaluate(X, cfg)["water_stress_index"]
    assert np.all(np.diff(wsi) <= 1e-12)


def test_irrigation_never_exceeds_allocation(cfg):
    X = np.tile(M.nominal_vector(), (4, 1))
    X[:, PARAM_INDEX["water_allocation_mm"]] = [100, 300, 600, 900]
    X[:, PARAM_INDEX["supply_reliability"]] = 0.5
    out = M.evaluate(X, cfg, return_series=True)
    gross = out["series"]["irrigation_mm"].sum(axis=1)
    assert np.all(gross <= X[:, PARAM_INDEX["water_allocation_mm"]] * 0.5 + 1e-6)


def test_nominal_default_case_succeeds(cfg):
    assert M.single(M.nominal_vector(), cfg)["success"]


def test_constraint_violation():
    v = M.nominal_vector()
    assert M.constraint_violation(v[None, :], DEFAULT_CONSTRAINTS)[0] <= 0
    v[PARAM_INDEX["precip_change"]] = -0.3
    v[PARAM_INDEX["rh_change"]] = 8
    assert M.constraint_violation(v[None, :], DEFAULT_CONSTRAINTS)[0] > 0


def test_config_roundtrip(cfg):
    again = M.ModelConfig.from_dict(cfg.to_dict())
    v = M.nominal_vector()
    assert M.single(v, again)["net_benefit"] == M.single(v, cfg)["net_benefit"]


# ----------------------------------------------------------------- MPFS + baselines
def test_mpfs_finds_known_halfspace_boundary():
    prob = make_problems(4)[0]
    res = mpfs(prob, MPFSConfig(budget=1500, seed=0))
    assert res.found
    assert res.best_distance == pytest.approx(prob.true_distance, rel=0.02)
    assert res.best_distance >= prob.true_distance * (1 - 1e-9)  # can never beat the analytic optimum


def test_mpfs_respects_constraints_and_bounds():
    prob = make_problems(4)[3]  # constrained weighted half-space
    res = mpfs(prob, MPFSConfig(budget=1500, seed=1))
    U, B, CV, _ = prob.log.arrays()
    assert np.all(np.abs(U) <= 1 + 1e-12)
    assert res.found
    u = np.array(res.best_u)
    assert prob._violation(u[None, :])[0] <= 0
    assert prob._benefit(u[None, :])[0] < 0
    assert res.best_distance >= prob.true_distance * (1 - 1e-6)


@pytest.mark.parametrize("method", ["mpfs", "random", "de", "nsga2"])
def test_methods_are_reproducible(method):
    a = run_method(method, make_problems(4)[1], 600, 7)
    b = run_method(method, make_problems(4)[1], 600, 7)
    assert a.best_distance == b.best_distance
    assert a.evaluations == b.evaluations


@pytest.mark.parametrize("method", ["mpfs", "random", "de", "nsga2"])
def test_budget_is_respected(method):
    res = run_method(method, make_problems(4)[0], 500, 3)
    assert res.evaluations <= 500 + 40  # NSGA-II may finish its last generation


def test_mpfs_reports_nominal_failure(cfg):
    v0 = M.nominal_vector({"water_allocation_mm": 0, "species_factor": 0.9})
    lo, hi = M.bounds_arrays()
    prob = AfforestationProblem(cfg, v0, lo, hi, PARAM_NAMES)
    res = mpfs(prob, MPFSConfig(budget=300))
    assert res.nominal_failure and res.best_distance == 0


def test_mpfs_on_afforestation_model_verified(cfg):
    v0 = M.nominal_vector()
    lo, hi = M.bounds_arrays()
    prob = AfforestationProblem(cfg, v0, lo, hi, PARAM_NAMES, lam=4.0)
    res = mpfs(prob, MPFSConfig(budget=1200, seed=42))
    assert res.found and res.best_distance > 0
    x = prob.to_physical(np.array(res.best_u))[0]
    vr = verify_counterexample(cfg.to_dict(), x.tolist(), res.best_b, lo.tolist(), hi.tolist(), producer="optimisation_agent")
    assert vr["status"] in ("verified", "verified_with_warnings")
    assert all(c["passed"] for c in vr["checks"] if c["severity"] == "critical")


def test_normalisation_roundtrip(cfg):
    v0 = M.nominal_vector()
    lo, hi = M.bounds_arrays()
    prob = AfforestationProblem(cfg, v0, lo, hi, PARAM_NAMES)
    U = np.random.default_rng(3).uniform(-1, 1, (10, prob.dim))
    # one-sided ranges (nominal at a bound) have no room on that side: u collapses to 0 there
    up_room = (prob.hi - prob.v0)[prob.idx] > 0
    dn_room = (prob.v0 - prob.lo)[prob.idx] > 0
    expected = np.where(U >= 0, U * up_room, U * dn_room)
    assert np.allclose(prob.to_normalised(prob.to_physical(U)), expected)
    X = prob.to_physical(np.ones((1, prob.dim)))[0]
    assert np.allclose(X, hi)


def test_benchmark_suite_structure():
    r = run_benchmark_suite(dims=(3,), seeds=(0,), budget=400, ablations=False)
    assert {s["variant"] for s in r["summary"]} == {"mpfs", "random", "de", "nsga2"}
    assert all(s["constraint_or_bound_violations"] == 0 for s in r["summary"])


# ----------------------------------------------------------------- verification
def test_verifier_rejects_non_counterexample(cfg):
    v = M.nominal_vector()
    lo, hi = M.bounds_arrays()
    b = M.single(v, cfg)["net_benefit"]
    vr = verify_counterexample(cfg.to_dict(), v.tolist(), b, lo.tolist(), hi.tolist(), producer="optimisation_agent")
    assert vr["status"] == "rejected"


def test_verifier_detects_tampered_value(cfg):
    v = M.nominal_vector({"water_allocation_mm": 0, "species_factor": 0.9})
    lo, hi = M.bounds_arrays()
    vr = verify_counterexample(cfg.to_dict(), v.tolist(), -5.0, lo.tolist(), hi.tolist(), producer="optimisation_agent")
    assert not next(c for c in vr["checks"] if c["name"] == "numerical_reproduction")["passed"]
    assert vr["status"] == "rejected"


def test_verifier_cannot_approve_own_results(cfg):
    v = M.nominal_vector()
    lo, hi = M.bounds_arrays()
    with pytest.raises(ValueError):
        verify_counterexample(cfg.to_dict(), v.tolist(), 0.0, lo.tolist(), hi.tolist(), producer="x", verifier="x")


# ----------------------------------------------------------------- analysis
def test_wilson_interval():
    lo, hi = wilson_interval(50, 100)
    assert lo < 0.5 < hi and hi - lo == pytest.approx(0.192, abs=0.005)


def test_monte_carlo_and_sobol(cfg):
    v0 = M.nominal_vector()
    lo, hi = M.bounds_arrays()
    mc = monte_carlo(cfg, v0, lo, hi, n=400, seed=1)
    assert 0 <= mc["failure_probability"] <= 1
    assert mc["failure_ci95"][0] <= mc["failure_probability"] <= mc["failure_ci95"][1]
    names = ["warming_c", "supply_reliability", "base_mortality", "drought_mortality_coeff"]
    s = sobol_sensitivity(cfg, v0, lo, hi, names, n_base=64)
    assert len(s["results"]["net_benefit"]["ST"]) == 4


def test_boundary_map_shape(cfg):
    v0 = M.nominal_vector()
    lo, hi = M.bounds_arrays()
    bm = boundary_map(cfg, v0, "base_mortality", "drought_mortality_coeff", lo, hi, resolution=12)
    assert len(bm["z"]) == 12 and len(bm["z"][0]) == 12
    assert 0 <= bm["failure_fraction"] <= 1
