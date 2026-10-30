"""Parameter registry for the Urban Afforestation Under Water Stress case study.

Every parameter carries units, plausible bounds, a nominal value, the source of
its range and an explicit status describing how well-supported it is:

* ``literature``  - range taken from (or directly bracketed by) the cited source.
* ``engineering`` - typical design/engineering values; must be checked locally.
* ``assumption``  - modelling assumption with no direct empirical calibration.
                    These MUST be calibrated before results are used for decisions.

References are listed in ``REFERENCES``. DOIs are resolved at runtime against
Crossref by the Evidence Research Agent; unresolved DOIs are flagged in reports.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Literal

ParamKind = Literal["environment", "intervention"]
SourceStatus = Literal["literature", "engineering", "assumption"]


@dataclass(frozen=True)
class Reference:
    key: str
    citation: str
    doi: str | None = None
    url: str | None = None
    source_type: Literal["peer_reviewed", "government_report", "technical_guide", "assessment_report"] = "peer_reviewed"


REFERENCES: dict[str, Reference] = {
    r.key: r
    for r in [
        Reference(
            "allen1998",
            "Allen, R.G., Pereira, L.S., Raes, D., Smith, M. (1998). Crop evapotranspiration - Guidelines for "
            "computing crop water requirements. FAO Irrigation and Drainage Paper 56. FAO, Rome.",
            url="https://www.fao.org/4/x0490e/x0490e00.htm",
            source_type="technical_guide",
        ),
        Reference(
            "hargreaves1985",
            "Hargreaves, G.H., Samani, Z.A. (1985). Reference crop evapotranspiration from temperature. "
            "Applied Engineering in Agriculture 1(2), 96-99.",
            doi="10.13031/2013.26773",
        ),
        Reference(
            "costello2014",
            "Costello, L.R., Jones, K.S. (2014). WUCOLS IV: Water Use Classification of Landscape Species. "
            "University of California Cooperative Extension / California Department of Water Resources.",
            url="https://ucanr.edu/sites/WUCOLS/",
            source_type="government_report",
        ),
        Reference(
            "roman2011",
            "Roman, L.A., Scatena, F.N. (2011). Street tree survival rates: Meta-analysis of previous studies and "
            "application to a field survey in Philadelphia, PA, USA. Urban Forestry & Urban Greening 10(4), 269-274.",
            doi="10.1016/j.ufug.2011.05.008",
        ),
        Reference(
            "bowler2010",
            "Bowler, D.E., Buyung-Ali, L., Knight, T.M., Pullin, A.S. (2010). Urban greening to cool towns and "
            "cities: A systematic review of the empirical evidence. Landscape and Urban Planning 97(3), 147-155.",
            doi="10.1016/j.landurbplan.2010.05.006",
        ),
        Reference(
            "ziter2019",
            "Ziter, C.D., Pedersen, E.J., Kucharik, C.J., Turner, M.G. (2019). Scale-dependent interactions between "
            "tree canopy cover and impervious surfaces reduce daytime urban heat during summer. PNAS 116(15), 7575-7580.",
            doi="10.1073/pnas.1817561116",
        ),
        Reference(
            "pataki2011",
            "Pataki, D.E., McCarthy, H.R., Litvak, E., Pincetl, S. (2011). Transpiration of urban forests in the "
            "Los Angeles metropolitan area. Ecological Applications 21(3), 661-677.",
            doi="10.1890/09-1717.1",
        ),
        Reference(
            "ipcc2021",
            "IPCC (2021). Climate Change 2021: The Physical Science Basis. Contribution of Working Group I to the "
            "Sixth Assessment Report. Cambridge University Press.",
            doi="10.1017/9781009157896",
            source_type="assessment_report",
        ),
        Reference(
            "nasapower",
            "NASA Prediction Of Worldwide Energy Resources (POWER) project, climatology API (MERRA-2 / CERES derived).",
            url="https://power.larc.nasa.gov/",
            source_type="government_report",
        ),
    ]
}


@dataclass(frozen=True)
class ParameterSpec:
    name: str
    label: str
    kind: ParamKind
    unit: str
    nominal: float
    lower: float
    upper: float
    status: SourceStatus
    sources: tuple[str, ...] = ()
    description: str = ""
    validity: str = ""
    # Relative plausibility weight in the MPFS distance metric. Larger = moving this
    # parameter is considered "less plausible" per unit of normalised range.
    weight: float = 1.0
    log_scale: bool = False

    def to_dict(self) -> dict:
        d = asdict(self)
        d["sources"] = list(self.sources)
        return d


PARAMETERS: list[ParameterSpec] = [
    # ------------------------------------------------------------------ environment (x)
    ParameterSpec(
        "warming_c", "Air temperature change", "environment", "°C", 1.0, 0.0, 4.5, "literature", ("ipcc2021",),
        "Uniform shift applied to monthly Tmax/Tmin relative to the baseline climatology.",
        "Range brackets AR6 regional projections for mid/late century; urban amplification not included.",
    ),
    ParameterSpec(
        "precip_change", "Rainfall change", "environment", "fraction", 0.0, -0.40, 0.20, "literature", ("ipcc2021",),
        "Multiplicative change in monthly precipitation (−0.2 = 20 % less rain).",
        "Sign and magnitude of regional precipitation change is highly uncertain; check regional atlas.",
    ),
    ParameterSpec(
        "rh_change", "Relative humidity change", "environment", "% points", 0.0, -15.0, 10.0, "assumption", ("ipcc2021",),
        "Additive shift in monthly mean relative humidity.",
        "Coupled to rainfall via a plausibility dependency (see constraints).",
    ),
    ParameterSpec(
        "wind_speed", "Wind speed at 2 m", "environment", "m/s", 2.0, 0.5, 4.0, "literature", ("allen1998",),
        "Used in FAO-56 Penman-Monteith. 2 m/s is the FAO-56 default when data are missing.",
        "Urban canyon wind speeds are frequently below open-site values.",
    ),
    ParameterSpec(
        "supply_reliability", "Irrigation supply reliability", "environment", "fraction", 1.0, 0.4, 1.0, "assumption",
        (), "Fraction of planned irrigation allocation actually delivered (drought restrictions, outages).",
        "Must be derived from local utility drought-restriction history.",
    ),
    ParameterSpec(
        "soil_taw_mm", "Root-zone total available water", "environment", "mm", 120.0, 50.0, 200.0, "literature",
        ("allen1998",), "TAW = 1000·(θFC − θWP)·Zr. FAO-56 Table 19 soil water characteristics, Zr ≈ 1 m.",
        "Compacted urban soils and restricted tree pits are often at the low end.",
    ),
    ParameterSpec(
        "microclimate_factor", "Urban microclimate factor", "environment", "–", 1.1, 0.9, 1.4, "literature",
        ("costello2014",), "WUCOLS Kmc: >1 for hot, paved, reflective sites; <1 for shaded, sheltered sites.",
        "Categorical in WUCOLS; treated as continuous here.",
    ),
    ParameterSpec(
        "base_mortality", "Baseline annual mortality", "environment", "1/yr", 0.04, 0.02, 0.08, "literature",
        ("roman2011",), "Annual mortality without drought stress. Roman & Scatena report ~3.5-5.1 %/yr for street trees.",
        "Street-tree meta-analysis; plantation-scale programmes may differ.",
    ),
    ParameterSpec(
        "drought_mortality_coeff", "Drought mortality sensitivity", "environment", "1/yr per WSI", 0.15, 0.05, 0.40,
        "assumption", (), "Additional annual mortality per unit of water-stress index.",
        "No direct calibration available. Requires local survival monitoring data.", weight=0.7,
    ),
    ParameterSpec(
        "cooling_max_c", "Max canopy cooling", "environment", "°C", 2.0, 1.0, 3.5, "literature",
        ("bowler2010", "ziter2019"),
        "Daytime pedestrian-level air-temperature reduction at full canopy cover and unstressed transpiration.",
        "Air temperature, NOT land-surface temperature. Order of magnitude bracketed by the cited studies; "
        "needs local calibration.",
    ),
    ParameterSpec(
        "evap_fraction", "Transpiration share of cooling", "environment", "fraction", 0.5, 0.3, 0.7, "assumption",
        ("pataki2011",), "Share of cooling attributed to evapotranspiration (remainder: shading).",
        "Partitioning varies with species, time of day and humidity; assumption.", weight=0.7,
    ),
    # ------------------------------------------------------------------ intervention (θ)
    ParameterSpec(
        "canopy_target", "Target canopy cover", "intervention", "fraction", 0.35, 0.05, 0.60, "engineering", (),
        "Added canopy cover over the programme area at maturity (if all trees survive).",
    ),
    ParameterSpec(
        "tree_density", "Planting density", "intervention", "trees/ha", 250.0, 50.0, 600.0, "engineering",
        ("costello2014",), "Mapped to the WUCOLS density factor Kd ∈ [0.5, 1.3].",
    ),
    ParameterSpec(
        "species_factor", "Species water-use factor", "intervention", "–", 0.5, 0.1, 0.9, "literature",
        ("costello2014",), "WUCOLS Ks: very low 0.1, low 0.2-0.3, moderate 0.4-0.6, high 0.7-0.9.",
    ),
    ParameterSpec(
        "irrigation_efficiency", "Irrigation efficiency", "intervention", "fraction", 0.75, 0.5, 0.95, "engineering",
        ("allen1998",), "Net water reaching root zone / gross water applied. Drip ≈ 0.85-0.95, spray ≈ 0.6-0.75.",
    ),
    ParameterSpec(
        "water_allocation_mm", "Planned irrigation allocation", "intervention", "mm/yr", 600.0, 0.0, 1500.0,
        "engineering", (), "Gross annual irrigation allocation per unit of planted (canopy) area.",
    ),
    ParameterSpec(
        "deficit_fraction", "Irrigation target fraction", "intervention", "fraction", 1.0, 0.4, 1.0, "engineering",
        ("allen1998",), "Fraction of the net irrigation requirement targeted (1.0 = full; <1 = deficit irrigation).",
    ),
    ParameterSpec(
        "maintenance_usd", "Maintenance budget", "intervention", "USD/tree/yr", 60.0, 10.0, 120.0, "assumption", (),
        "Establishment and maintenance spend; reduces baseline mortality (assumed saturating effect).",
        "Effect of maintenance on mortality is an uncalibrated assumption.",
    ),
]

PARAM_INDEX: dict[str, int] = {p.name: i for i, p in enumerate(PARAMETERS)}
PARAM_NAMES: list[str] = [p.name for p in PARAMETERS]
ENV_NAMES: list[str] = [p.name for p in PARAMETERS if p.kind == "environment"]
INT_NAMES: list[str] = [p.name for p in PARAMETERS if p.kind == "intervention"]


@dataclass
class LinearConstraint:
    """Plausibility dependency  sum_i coeffs[i] * value_i <= bound  (physical units)."""

    name: str
    coeffs: dict[str, float]
    bound: float
    rationale: str
    status: SourceStatus = "assumption"

    def to_dict(self) -> dict:
        return asdict(self)


DEFAULT_CONSTRAINTS: list[LinearConstraint] = [
    LinearConstraint(
        "drying_limits_humidity",
        # rh_change - 30*precip_change <= 5   ->  with 20 % less rain RH may rise at most −1 pp
        {"rh_change": 1.0, "precip_change": -30.0},
        5.0,
        "Large humidity increases are implausible in scenarios with strongly reduced rainfall.",
    ),
    LinearConstraint(
        "warming_limits_humidity_rise",
        # rh_change + 2*warming_c <= 12
        {"rh_change": 1.0, "warming_c": 2.0},
        12.0,
        "Relative humidity tends to fall over land under strong warming; large simultaneous rises excluded.",
    ),
]


@dataclass
class Criterion:
    """Success criterion: metric (op) threshold. ``scale`` normalises the margin."""

    metric: str
    op: Literal[">=", "<="]
    threshold: float
    scale: float | None = None
    label: str = ""

    def margin(self, value):
        s = self.scale if self.scale else max(abs(self.threshold), 1e-6)
        return (value - self.threshold) / s if self.op == ">=" else (self.threshold - value) / s

    def to_dict(self) -> dict:
        return asdict(self)


DEFAULT_CRITERIA: list[Criterion] = [
    Criterion("cooling_c", ">=", 0.5, None, "Summer daytime air cooling of at least 0.5 °C"),
    Criterion("survival_rate", ">=", 0.50, None, "At least 50 % of planted trees alive after the horizon"),
    Criterion("water_stress_index", "<=", 0.25, 0.25, "Mean water-stress index no greater than 0.25"),
]

METRICS: dict[str, dict] = {
    "cooling_c": {"label": "Summer daytime air cooling", "unit": "°C"},
    "survival_rate": {"label": "Survival at horizon", "unit": "fraction"},
    "water_stress_index": {"label": "Water-stress index", "unit": "0-1"},
    "irrigation_m3_ha": {"label": "Gross irrigation", "unit": "m³/ha/yr"},
    "annual_cost_usd_ha": {"label": "Annual cost", "unit": "USD/ha/yr"},
    "et0_mm": {"label": "Reference ET₀", "unit": "mm/yr"},
    "etc_mm": {"label": "Landscape water demand ETL", "unit": "mm/yr"},
    "transpiration_ratio": {"label": "Summer transpiration ratio", "unit": "ETa/ETc"},
    "effective_canopy": {"label": "Effective canopy at horizon", "unit": "fraction"},
}


def registry_dict() -> dict:
    return {
        "parameters": [p.to_dict() for p in PARAMETERS],
        "constraints": [c.to_dict() for c in DEFAULT_CONSTRAINTS],
        "criteria": [c.to_dict() for c in DEFAULT_CRITERIA],
        "metrics": METRICS,
        "references": {k: asdict(v) for k, v in REFERENCES.items()},
    }
