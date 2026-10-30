"""Urban Afforestation Under Water Stress - parameterised, vectorised model.

EXPLORATORY SIMULATION MODEL. Not empirically validated as a whole. Component
equations come from established methods (FAO-56, WUCOLS); the coupling between
water stress, mortality and cooling contains explicit, uncalibrated assumptions
(see ``parameters.py`` - status ``assumption``).

Structure (per unit of planted canopy area, daily step, climatological year):

1. Reference evapotranspiration ET0  - FAO-56 Penman-Monteith (eq. 6) with solar
   radiation estimated from the temperature range (FAO-56 eq. 50, Hargreaves).
2. Landscape demand ETL = Ks * Kd * Kmc * ET0  - WUCOLS landscape coefficient method.
3. Effective rainfall - USDA-SCS method as used in FAO CROPWAT (monthly).
4. Irrigation - demand-driven, capped by allocation * reliability, scaled by efficiency.
5. Root-zone depletion bucket with FAO-56 water-stress coefficient (eq. 84), p = 0.5.
6. Water-stress index WSI = 1 - sum(ETa)/sum(ETL)   (annual, demand-weighted).
7. Annual mortality m = m_base * maintenance_effect + beta * WSI  ->  survival (1-m)^H.
8. Cooling = Cmax * f(effective canopy) * [(1-e) + e * TR_summer * humidity_factor]
   where TR_summer is the transpiration ratio over the three warmest months.

All functions accept a (n, P) array of parameter vectors and evaluate the batch
simultaneously, which keeps sampling-heavy methods (Sobol, Monte Carlo, MPFS
screening) fast without approximations.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict

import numpy as np

from .parameters import PARAM_INDEX, PARAMETERS, Criterion, DEFAULT_CRITERIA, LinearConstraint, DEFAULT_CONSTRAINTS

MODEL_NAME = "urban-afforestation-water-stress"
MODEL_VERSION = "1.0.0"

DAYS_IN_MONTH = np.array([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
MID_MONTH_DOY = np.array([15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349])


@dataclass
class Climatology:
    """Monthly baseline climate. ``source`` is shown wherever results are displayed."""

    tmax: list[float]
    tmin: list[float]
    rh: list[float]
    precip_mm: list[float]  # monthly totals
    latitude: float
    elevation_m: float = 100.0
    source: str = "synthetic"
    synthetic: bool = True
    location_name: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Climatology":
        return cls(**{k: d[k] for k in cls.__dataclass_fields__ if k in d})


def synthetic_climatology(latitude: float = 28.6, elevation_m: float = 216.0, name: str = "") -> Climatology:
    """Clearly-labelled SYNTHETIC hot semi-arid monsoon-type profile.

    Used only when no observed climatology is available. Never presented as observed data.
    """
    m = np.arange(12)
    hemi = 1.0 if latitude >= 0 else -1.0
    phase = (m - 5.0) if hemi > 0 else (m - 11.0)
    tmean = 25.0 + 9.0 * np.cos(2 * np.pi * phase / 12.0)
    trange = 12.0 - 3.0 * np.cos(2 * np.pi * (m - 7.0) / 12.0)
    rain = 15.0 + 190.0 * np.exp(-0.5 * ((m - 7.0) / 1.1) ** 2)
    rh = 40.0 + 30.0 * np.exp(-0.5 * ((m - 7.5) / 1.6) ** 2)
    return Climatology(
        tmax=list(np.round(tmean + trange / 2, 2)),
        tmin=list(np.round(tmean - trange / 2, 2)),
        rh=list(np.round(rh, 1)),
        precip_mm=list(np.round(rain, 1)),
        latitude=latitude,
        elevation_m=elevation_m,
        source="SYNTHETIC hot semi-arid monsoon profile (not observed data)",
        synthetic=True,
        location_name=name,
    )


@dataclass
class ModelConfig:
    climatology: Climatology
    criteria: list[Criterion] = field(default_factory=lambda: list(DEFAULT_CRITERIA))
    constraints: list[LinearConstraint] = field(default_factory=lambda: list(DEFAULT_CONSTRAINTS))
    horizon_years: int = 10
    depletion_fraction_p: float = 0.5  # FAO-56 Table 22 typical value
    coastal: bool = False  # kRs = 0.19 coastal, 0.16 interior (FAO-56 eq. 50)
    cooling_response: str = "saturating"  # "saturating" | "threshold" (structural alternative)
    water_price_usd_m3: float = 1.5  # ASSUMPTION - set from local tariff
    spinup_years: int = 1

    def to_dict(self) -> dict:
        return {
            "climatology": self.climatology.to_dict(),
            "criteria": [c.to_dict() for c in self.criteria],
            "constraints": [c.to_dict() for c in self.constraints],
            "horizon_years": self.horizon_years,
            "depletion_fraction_p": self.depletion_fraction_p,
            "coastal": self.coastal,
            "cooling_response": self.cooling_response,
            "water_price_usd_m3": self.water_price_usd_m3,
            "spinup_years": self.spinup_years,
            "model": MODEL_NAME,
            "model_version": MODEL_VERSION,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ModelConfig":
        return cls(
            climatology=Climatology.from_dict(d["climatology"]),
            criteria=[Criterion(**c) for c in d.get("criteria", [])] or list(DEFAULT_CRITERIA),
            constraints=[LinearConstraint(**c) for c in d.get("constraints", [])],
            horizon_years=int(d.get("horizon_years", 10)),
            depletion_fraction_p=float(d.get("depletion_fraction_p", 0.5)),
            coastal=bool(d.get("coastal", False)),
            cooling_response=d.get("cooling_response", "saturating"),
            water_price_usd_m3=float(d.get("water_price_usd_m3", 1.5)),
            spinup_years=int(d.get("spinup_years", 1)),
        )


# --------------------------------------------------------------------------- FAO-56 helpers
def sat_vapour_pressure(t):
    """e°(T) kPa - FAO-56 eq. 11 (Tetens form)."""
    return 0.6108 * np.exp(17.27 * t / (t + 237.3))


def extraterrestrial_radiation(lat_deg: float, doy: np.ndarray) -> np.ndarray:
    """Ra MJ m-2 day-1 - FAO-56 eqs. 21-25."""
    phi = math.radians(lat_deg)
    dr = 1 + 0.033 * np.cos(2 * np.pi * doy / 365.0)
    delta = 0.409 * np.sin(2 * np.pi * doy / 365.0 - 1.39)
    ws = np.arccos(np.clip(-np.tan(phi) * np.tan(delta), -1.0, 1.0))
    return (24 * 60 / np.pi) * 0.0820 * dr * (ws * np.sin(phi) * np.sin(delta) + np.cos(phi) * np.cos(delta) * np.sin(ws))


def et0_penman_monteith(tmax, tmin, rh, u2, ra, elevation_m: float, krs: float):
    """Daily ET0 mm/day - FAO-56 eq. 6 with Rs from eq. 50; G ≈ 0 for monthly means.

    Arrays broadcast: tmax/tmin/rh shape (n, 12), u2 shape (n, 1), ra shape (12,).
    """
    tmean = (tmax + tmin) / 2.0
    trange = np.clip(tmax - tmin, 0.1, None)
    rs = krs * np.sqrt(trange) * ra
    rso = (0.75 + 2e-5 * elevation_m) * ra
    es = (sat_vapour_pressure(tmax) + sat_vapour_pressure(tmin)) / 2.0
    ea = np.clip(rh, 1.0, 100.0) / 100.0 * es
    rns = 0.77 * rs
    sigma = 4.903e-9
    rnl = sigma * ((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2.0 * (0.34 - 0.14 * np.sqrt(ea)) * (
        1.35 * np.clip(rs / rso, 0.25, 1.0) - 0.35
    )
    rn = rns - rnl
    delta = 4098 * sat_vapour_pressure(tmean) / (tmean + 237.3) ** 2
    pressure = 101.3 * ((293 - 0.0065 * elevation_m) / 293) ** 5.26
    gamma = 0.665e-3 * pressure
    et0 = (0.408 * delta * rn + gamma * 900 / (tmean + 273) * u2 * (es - ea)) / (delta + gamma * (1 + 0.34 * u2))
    return np.clip(et0, 0.0, None)


def et0_hargreaves(tmax, tmin, ra):
    """Hargreaves-Samani (1985) daily ET0 mm/day - used ONLY as an independent cross-check."""
    tmean = (tmax + tmin) / 2.0
    return 0.0023 * (ra * 0.408) * (tmean + 17.8) * np.sqrt(np.clip(tmax - tmin, 0.0, None))


def effective_rainfall_monthly(p):
    """USDA-SCS effective rainfall (mm/month) as implemented in FAO CROPWAT."""
    return np.where(p <= 250.0, p * (125.0 - 0.2 * p) / 125.0, 125.0 + 0.1 * p)


# --------------------------------------------------------------------------- core model
def _col(X: np.ndarray, name: str) -> np.ndarray:
    return X[:, PARAM_INDEX[name]][:, None]


def evaluate(X: np.ndarray, cfg: ModelConfig, return_series: bool = False) -> dict[str, np.ndarray]:
    """Evaluate the model for a batch of parameter vectors ``X`` (n, P) in physical units."""
    X = np.atleast_2d(np.asarray(X, dtype=float))
    n = X.shape[0]
    clim = cfg.climatology

    warming = _col(X, "warming_c")
    tmax = np.asarray(clim.tmax)[None, :] + warming
    tmin = np.asarray(clim.tmin)[None, :] + warming
    rh = np.clip(np.asarray(clim.rh)[None, :] + _col(X, "rh_change"), 5.0, 100.0)
    precip = np.clip(np.asarray(clim.precip_mm)[None, :] * (1.0 + _col(X, "precip_change")), 0.0, None)
    u2 = _col(X, "wind_speed")

    ra = extraterrestrial_radiation(clim.latitude, MID_MONTH_DOY)
    krs = 0.19 if cfg.coastal else 0.16
    et0_daily = et0_penman_monteith(tmax, tmin, rh, u2, ra, clim.elevation_m, krs)  # (n,12)

    ks = _col(X, "species_factor")
    density = _col(X, "tree_density")
    kd = np.clip(0.5 + density / 500.0, 0.5, 1.3)  # ASSUMPTION: linear map onto WUCOLS Kd range
    kmc = _col(X, "microclimate_factor")
    etl_daily = ks * kd * kmc * et0_daily  # (n,12) mm/day

    peff_daily = effective_rainfall_monthly(precip) / DAYS_IN_MONTH[None, :]

    eff = _col(X, "irrigation_efficiency")[:, 0]
    alloc_gross = _col(X, "water_allocation_mm")[:, 0] * _col(X, "supply_reliability")[:, 0]
    target = _col(X, "deficit_fraction")[:, 0]
    taw = _col(X, "soil_taw_mm")[:, 0]
    p = cfg.depletion_fraction_p
    raw = p * taw

    dr = np.zeros(n)  # root-zone depletion, start at field capacity
    years = cfg.spinup_years + 1
    month_eta = np.zeros((n, 12))
    month_etl = np.zeros((n, 12))
    month_irr_gross = np.zeros((n, 12))
    month_ks = np.zeros((n, 12))
    for year in range(years):
        record = year == years - 1
        used = np.zeros(n)  # gross allocation used this year
        for m in range(12):
            days = DAYS_IN_MONTH[m]
            # cumulative cap: allocation released evenly by month, unused water carries forward
            budget_m = np.clip(alloc_gross * (m + 1) / 12.0 - used, 0.0, None)
            etl_d = etl_daily[:, m]
            pe_d = peff_daily[:, m]
            for _ in range(days):
                # irrigation event when depletion reaches half of RAW; replace `target` x depletion
                need_net = np.where(dr >= 0.5 * raw, target * dr, 0.0)
                gross = np.minimum(need_net / eff, budget_m)
                budget_m = budget_m - gross
                used = used + gross
                dr = np.clip(dr - gross * eff - pe_d, 0.0, None)
                kst = np.where(dr <= raw, 1.0, np.clip((taw - dr) / ((1.0 - p) * taw), 0.0, 1.0))
                eta = kst * etl_d
                dr = np.clip(dr + eta, 0.0, taw)
                if record:
                    month_eta[:, m] += eta
                    month_etl[:, m] += etl_d
                    month_irr_gross[:, m] += gross
                    month_ks[:, m] += kst / days

    sum_etl = month_etl.sum(axis=1)
    sum_eta = month_eta.sum(axis=1)
    wsi = 1.0 - np.divide(sum_eta, sum_etl, out=np.ones(n), where=sum_etl > 0)
    wsi = np.clip(wsi, 0.0, 1.0)

    # summer = three warmest months of the (perturbed) climatology
    warm_idx = np.argsort(np.asarray(clim.tmax))[-3:]
    tr_summer = month_eta[:, warm_idx].sum(axis=1) / np.clip(month_etl[:, warm_idx].sum(axis=1), 1e-9, None)
    rh_summer = rh[:, warm_idx].mean(axis=1)

    maint = _col(X, "maintenance_usd")[:, 0]
    maint_effect = 1.4 - 0.8 * np.clip(maint / 80.0, 0.0, 1.0)  # ASSUMPTION: 0.6-1.4x of baseline mortality
    mortality = np.clip(_col(X, "base_mortality")[:, 0] * maint_effect + _col(X, "drought_mortality_coeff")[:, 0] * wsi, 0.0, 0.95)
    survival = (1.0 - mortality) ** cfg.horizon_years

    canopy_target = _col(X, "canopy_target")[:, 0]
    vigour = 0.5 + 0.5 * (1.0 - wsi)  # ASSUMPTION: stressed trees reach smaller crowns
    canopy_eff = np.clip(canopy_target * survival * vigour, 0.0, 1.0)

    if cfg.cooling_response == "threshold":
        # Logistic response with steepest change near 40 % cover (structural alternative after Ziter et al. 2019)
        L = lambda c: 1.0 / (1.0 + np.exp(-(c - 0.4) / 0.08))
        f_c = (L(canopy_eff) - L(0.0)) / (L(1.0) - L(0.0))
    else:
        k = 2.5
        f_c = (1.0 - np.exp(-k * canopy_eff)) / (1.0 - math.exp(-k))
    humidity_factor = np.clip(1.0 - 0.012 * (rh_summer - 50.0), 0.4, 1.2)  # ASSUMPTION
    e = _col(X, "evap_fraction")[:, 0]
    cooling = _col(X, "cooling_max_c")[:, 0] * f_c * ((1.0 - e) + e * tr_summer * humidity_factor)

    gross_mm = month_irr_gross.sum(axis=1)
    irrigation_m3_ha = gross_mm * canopy_target * 10.0  # 1 mm over 1 ha = 10 m³
    trees_alive_mean = density[:, 0] * (1 + survival) / 2.0
    annual_cost = trees_alive_mean * maint + irrigation_m3_ha * cfg.water_price_usd_m3

    out = {
        "cooling_c": cooling,
        "survival_rate": survival,
        "water_stress_index": wsi,
        "irrigation_m3_ha": irrigation_m3_ha,
        "annual_cost_usd_ha": annual_cost,
        "et0_mm": (et0_daily * DAYS_IN_MONTH[None, :]).sum(axis=1),
        "etc_mm": sum_etl,
        "transpiration_ratio": tr_summer,
        "effective_canopy": canopy_eff,
        "annual_mortality": mortality,
    }
    if return_series:
        out["series"] = {
            "et0_mm": (et0_daily * DAYS_IN_MONTH[None, :]),
            "etl_mm": month_etl,
            "eta_mm": month_eta,
            "irrigation_mm": month_irr_gross,
            "effective_rain_mm": effective_rainfall_monthly(precip),
            "precip_mm": precip,
            "stress_coeff": month_ks,
            "tmax": tmax,
            "tmin": tmin,
        }
    return out


def margins(metrics: dict[str, np.ndarray], criteria: list[Criterion]) -> np.ndarray:
    """(n, K) normalised criterion margins. Positive = criterion satisfied."""
    return np.stack([c.margin(metrics[c.metric]) for c in criteria], axis=1)


def net_benefit(metrics: dict[str, np.ndarray], criteria: list[Criterion]) -> np.ndarray:
    """B(x, θ) := min_k margin_k. Success condition B >= B_min with B_min = 0."""
    return margins(metrics, criteria).min(axis=1)


def constraint_violation(X: np.ndarray, constraints: list[LinearConstraint]) -> np.ndarray:
    """Max violation of plausibility dependencies (<= 0 means all satisfied)."""
    X = np.atleast_2d(X)
    if not constraints:
        return np.full(X.shape[0], -np.inf)
    vals = []
    for c in constraints:
        s = np.zeros(X.shape[0])
        for name, coef in c.coeffs.items():
            s = s + coef * X[:, PARAM_INDEX[name]]
        vals.append(s - c.bound)
    return np.max(np.stack(vals, axis=1), axis=1)


def nominal_vector(overrides: dict[str, float] | None = None) -> np.ndarray:
    v = np.array([p.nominal for p in PARAMETERS], dtype=float)
    for k, val in (overrides or {}).items():
        if k in PARAM_INDEX:
            v[PARAM_INDEX[k]] = float(val)
    return v


def bounds_arrays(overrides: dict[str, tuple[float, float]] | None = None) -> tuple[np.ndarray, np.ndarray]:
    lo = np.array([p.lower for p in PARAMETERS], dtype=float)
    hi = np.array([p.upper for p in PARAMETERS], dtype=float)
    for k, (a, b) in (overrides or {}).items():
        if k in PARAM_INDEX:
            lo[PARAM_INDEX[k]], hi[PARAM_INDEX[k]] = float(a), float(b)
    return lo, hi


def single(x: np.ndarray, cfg: ModelConfig, series: bool = False) -> dict:
    """Evaluate one parameter vector and return plain Python values (for APIs/reports)."""
    out = evaluate(np.atleast_2d(x), cfg, return_series=series)
    res: dict = {}
    for k, v in out.items():
        if k == "series":
            res["series"] = {sk: np.round(sv[0], 4).tolist() for sk, sv in v.items()}
        else:
            res[k] = float(v[0])
    m = margins({k: v for k, v in out.items() if k != "series"}, cfg.criteria)[0]
    res["margins"] = {c.metric: float(mm) for c, mm in zip(cfg.criteria, m)}
    res["net_benefit"] = float(m.min())
    res["success"] = bool(m.min() >= 0)
    res["binding_criterion"] = cfg.criteria[int(np.argmin(m))].metric
    return res
