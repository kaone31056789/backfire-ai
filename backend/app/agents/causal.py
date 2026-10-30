"""Causal Analysis Agent logic.

The primary graph mirrors the *implemented* computational model exactly, so every
in-model edge corresponds to code in ``science/model.py``. Each edge records its
basis (equation / literature / engineering / assumption) and is linked to retrieved
evidence passages by topic. Alternative hypotheses (not implemented in the model)
are kept in a separate graph. Literature edges based on observational studies are
flagged as associations whose causal effect is not identified.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import networkx as nx

NODES: list[tuple[str, str, str, str | None, str]] = [
    # key, label, kind, parameter, description
    ("warming", "Air temperature", "environment", "warming_c", "Monthly Tmax/Tmin shifted by ΔT."),
    ("precip", "Rainfall", "environment", "precip_change", "Monthly precipitation."),
    ("rh", "Relative humidity", "environment", "rh_change", "Monthly mean RH."),
    ("wind", "Wind speed", "environment", "wind_speed", "2 m wind speed."),
    ("supply", "Supply reliability", "environment", "supply_reliability", "Fraction of allocation delivered."),
    ("taw", "Soil water capacity", "environment", "soil_taw_mm", "Root-zone total available water."),
    ("kmc", "Urban microclimate", "environment", "microclimate_factor", "WUCOLS microclimate factor."),
    ("canopy", "Target canopy cover", "intervention", "canopy_target", "Planned canopy at maturity."),
    ("density", "Planting density", "intervention", "tree_density", "Trees per hectare."),
    ("species", "Species water use", "intervention", "species_factor", "WUCOLS species factor."),
    ("alloc", "Water allocation", "intervention", "water_allocation_mm", "Planned gross irrigation."),
    ("irr_eff", "Irrigation efficiency", "intervention", "irrigation_efficiency", "Net/gross water."),
    ("maint", "Maintenance", "intervention", "maintenance_usd", "Maintenance spend per tree."),
    ("et0", "Reference ET₀", "intermediate", None, "FAO-56 Penman-Monteith."),
    ("etl", "Landscape water demand", "intermediate", None, "ETL = Ks·Kd·Kmc·ET₀."),
    ("peff", "Effective rainfall", "intermediate", None, "USDA-SCS effective rainfall."),
    ("irrigation", "Irrigation delivered", "intermediate", None, "Demand-driven, allocation-capped."),
    ("soil", "Root-zone soil water", "intermediate", None, "Daily depletion bucket."),
    ("stress", "Water stress", "intermediate", None, "FAO-56 Ks; WSI = 1 − ΣETa/ΣETL."),
    ("transp", "Transpiration", "intermediate", None, "Actual ET relative to demand."),
    ("mortality", "Tree mortality", "intermediate", None, "Annual mortality rate."),
    ("canopy_eff", "Effective canopy", "intermediate", None, "Surviving, vigour-adjusted canopy."),
    ("cooling", "Daytime air cooling", "outcome", None, "Pedestrian-level air temperature reduction."),
    ("survival", "Tree survival", "outcome", None, "Fraction alive at horizon."),
    ("water_use", "Irrigation water use", "outcome", None, "m³/ha/yr."),
    ("cost", "Annual cost", "outcome", None, "Maintenance + water."),
]

# source, target, sign, mechanism, basis, references, topics
EDGES: list[tuple[str, str, str, str, str, list[str], list[str]]] = [
    ("warming", "et0", "+", "Higher temperature raises vapour-pressure deficit and net radiation terms.", "equation", ["allen1998"], ["water_use", "drought_stress"]),
    ("rh", "et0", "-", "Higher humidity lowers vapour-pressure deficit (es − ea).", "equation", ["allen1998"], ["humidity"]),
    ("wind", "et0", "+", "Aerodynamic term scales with u₂.", "equation", ["allen1998"], ["water_use"]),
    ("et0", "etl", "+", "Landscape coefficient method.", "equation", ["costello2014"], ["water_use"]),
    ("species", "etl", "+", "Species factor Ks.", "literature", ["costello2014"], ["water_use"]),
    ("density", "etl", "+", "Density factor Kd (linear mapping is an assumption).", "assumption", ["costello2014"], ["water_use"]),
    ("kmc", "etl", "+", "Microclimate factor Kmc.", "literature", ["costello2014"], ["water_use"]),
    ("precip", "peff", "+", "USDA-SCS effective rainfall.", "equation", ["allen1998"], ["drought_stress"]),
    ("alloc", "irrigation", "+", "Allocation caps cumulative gross irrigation.", "engineering", [], ["water_use"]),
    ("supply", "irrigation", "+", "Delivered = allocation × reliability.", "assumption", [], ["drought_stress"]),
    ("irr_eff", "irrigation", "+", "Net water reaching roots per unit gross.", "engineering", ["allen1998"], ["water_use"]),
    ("peff", "soil", "+", "Rain refills the root zone.", "equation", ["allen1998"], ["drought_stress"]),
    ("irrigation", "soil", "+", "Irrigation refills the root zone.", "equation", ["allen1998"], ["water_use"]),
    ("etl", "soil", "-", "Demand depletes the root zone.", "equation", ["allen1998"], ["water_use"]),
    ("taw", "soil", "+", "Larger reservoir buffers dry spells.", "equation", ["allen1998"], ["drought_stress"]),
    ("soil", "stress", "-", "Ks < 1 once depletion exceeds RAW = p·TAW.", "equation", ["allen1998"], ["drought_stress"]),
    ("stress", "transp", "-", "Stomatal closure reduces actual transpiration.", "equation", ["allen1998", "pataki2011"], ["water_use"]),
    ("stress", "mortality", "+", "Drought stress increases mortality (coefficient uncalibrated).", "assumption", [], ["mortality", "drought_stress"]),
    ("maint", "mortality", "-", "Maintenance lowers baseline mortality (assumed saturating).", "assumption", ["roman2011"], ["mortality"]),
    ("mortality", "survival", "-", "Survival = (1 − m)^H.", "equation", ["roman2011"], ["mortality"]),
    ("survival", "canopy_eff", "+", "Only surviving trees contribute canopy.", "equation", [], ["mortality"]),
    ("canopy", "canopy_eff", "+", "Planned canopy at maturity.", "engineering", [], ["cooling"]),
    ("stress", "canopy_eff", "-", "Stressed trees reach smaller crowns (assumption).", "assumption", [], ["drought_stress"]),
    ("canopy_eff", "cooling", "+", "Shading and evapotranspiration reduce daytime air temperature (saturating).", "literature", ["bowler2010", "ziter2019"], ["cooling"]),
    ("transp", "cooling", "+", "Evaporative share of cooling scales with transpiration.", "literature", ["pataki2011"], ["cooling", "water_use"]),
    ("rh", "cooling", "-", "Evaporative cooling less effective in humid air (factor is an assumption).", "assumption", [], ["humidity"]),
    ("irrigation", "water_use", "+", "Gross irrigation volume.", "equation", [], ["water_use"]),
    ("water_use", "cost", "+", "Water tariff × volume (tariff is an assumption).", "assumption", [], []),
    ("maint", "cost", "+", "Maintenance spend × trees alive.", "equation", [], []),
    ("density", "cost", "+", "More trees, more maintenance cost.", "equation", [], []),
]

ALT_NODES = [
    ("nocturnal", "Nocturnal heat retention", "intermediate", None, "Canopy reduces longwave sky view at night."),
    ("ventilation", "Street ventilation", "intermediate", None, "Dense crowns reduce wind in street canyons."),
    ("local_humidity", "Local humidity increase", "intermediate", None, "Irrigation/transpiration moisten near-surface air."),
    ("socioeconomic", "Socio-economic context", "environment", None, "Wealthier areas tend to have more canopy and better maintenance."),
    ("impervious", "Impervious surface", "environment", None, "Modifies canopy cooling (interaction reported)."),
]
ALT_EDGES = [
    ("canopy_eff", "nocturnal", "+", "Canopy may trap longwave radiation at night.", "hypothesis", [], ["cooling"]),
    ("nocturnal", "cooling", "-", "Reduces (or reverses) cooling at night - not represented in the daytime metric.", "hypothesis", [], ["cooling"]),
    ("density", "ventilation", "-", "Dense planting may reduce ventilation.", "hypothesis", [], ["cooling"]),
    ("ventilation", "cooling", "+", "Ventilation removes heat; reduced ventilation offsets cooling.", "hypothesis", [], ["cooling"]),
    ("irrigation", "local_humidity", "+", "Irrigation raises near-surface humidity.", "hypothesis", [], ["humidity"]),
    ("local_humidity", "cooling", "-", "Higher humidity lowers evaporative cooling and raises heat stress.", "hypothesis", [], ["humidity"]),
    ("socioeconomic", "maint", "+", "Resources drive maintenance.", "hypothesis", [], []),
    ("socioeconomic", "canopy", "+", "Resources drive canopy.", "hypothesis", [], []),
    ("socioeconomic", "cooling", "+", "Other green/blue infrastructure co-varies with wealth - a confounder in observational studies.", "hypothesis", [], ["cooling"]),
    ("impervious", "cooling", "-", "Impervious cover modifies canopy cooling (Ziter et al. 2019 interaction).", "hypothesis", ["ziter2019"], ["cooling"]),
]

BASE_CONF = {"equation": 0.85, "literature": 0.6, "engineering": 0.6, "assumption": 0.35, "hypothesis": 0.2}
LAYER_X = {"environment": 0, "intervention": 0, "intermediate": 1, "outcome": 3}
INTERMEDIATE_COL = {"et0": 1, "peff": 1, "irrigation": 1, "etl": 2, "soil": 2, "stress": 3, "transp": 4, "mortality": 4,
                    "canopy_eff": 5, "nocturnal": 6, "ventilation": 3, "local_humidity": 3}


@dataclass
class BuiltGraph:
    nodes: list[dict]
    edges: list[dict]
    analysis: dict = field(default_factory=dict)


def _layout(nodes: list[tuple]) -> dict[str, tuple[float, float]]:
    cols: dict[int, list[str]] = {}
    for key, _, kind, *_ in nodes:
        if kind in ("environment", "intervention"):
            c = 0
        elif kind == "outcome":
            c = 7
        else:
            c = INTERMEDIATE_COL.get(key, 3)
        cols.setdefault(c, []).append(key)
    pos = {}
    for c, keys in cols.items():
        for i, k in enumerate(keys):
            pos[k] = (c * 230.0, i * 92.0 + (0 if c == 0 else 120 + (c % 2) * 40))
    return pos


def build(passages: list[dict], alternative: bool = False) -> BuiltGraph:
    """``passages``: dicts with id, topic, stance."""
    nodes_def = NODES + (ALT_NODES if alternative else [])
    edges_def = EDGES + (ALT_EDGES if alternative else [])
    pos = _layout(nodes_def)
    nodes = [{"key": k, "label": l, "kind": kind, "parameter_name": p, "description": d, "x": pos[k][0], "y": pos[k][1]}
             for k, l, kind, p, d in nodes_def]
    by_topic: dict[str, list[dict]] = {}
    for p in passages:
        by_topic.setdefault(p["topic"], []).append(p)
    edges = []
    for s, t, sign, mech, basis, refs, topics in edges_def:
        sup = [p["id"] for tp in topics for p in by_topic.get(tp, []) if p["stance"] == "supports"]
        con = [p["id"] for tp in topics for p in by_topic.get(tp, []) if p["stance"] == "contradicts"]
        neutral = [p["id"] for tp in topics for p in by_topic.get(tp, []) if p["stance"] == "neutral"]
        conf = BASE_CONF[basis] + min(0.15, 0.05 * len(set(sup))) - min(0.2, 0.07 * len(set(con)))
        unc = []
        if basis == "assumption":
            unc.append("Uncalibrated modelling assumption.")
        if basis == "literature":
            unc.append("Literature evidence is largely observational: association, causal effect size not identified.")
        if basis == "hypothesis":
            unc.append("Alternative hypothesis - NOT implemented in the computational model.")
        if con:
            unc.append(f"{len(set(con))} retrieved passage(s) heuristically flagged as contradicting.")
        edges.append({
            "source_key": s, "target_key": t, "sign": sign, "mechanism": mech, "basis": basis,
            "in_model": basis != "hypothesis", "confidence": round(max(0.05, min(0.95, conf)), 3),
            "uncertainty": " ".join(unc) or "Deterministic model equation.", "references": refs,
            "evidence_ids": list(dict.fromkeys(sup + neutral))[:8], "contradicting_ids": list(dict.fromkeys(con))[:8],
        })
    return BuiltGraph(nodes, edges, analyse(nodes, edges))


def analyse(nodes: list[dict], edges: list[dict]) -> dict:
    g = nx.DiGraph()
    g.add_nodes_from(n["key"] for n in nodes)
    g.add_edges_from((e["source_key"], e["target_key"]) for e in edges)
    acyclic = nx.is_directed_acyclic_graph(g)
    pairs = [("canopy", "cooling"), ("irrigation", "survival"), ("species", "cooling"), ("maint", "survival")]
    confounding = []
    for treat, out in pairs:
        if treat not in g or out not in g:
            continue
        anc_t = nx.ancestors(g, treat)
        g_cut = g.copy()
        g_cut.remove_node(treat)
        anc_o = nx.ancestors(g_cut, out) if out in g_cut else set()
        common = sorted(anc_t & anc_o)
        paths = list(nx.all_simple_paths(g, treat, out, cutoff=8))
        confounding.append({
            "treatment": treat, "outcome": out, "common_causes": common,
            "directed_paths": [" → ".join(p) for p in paths[:6]], "n_paths": len(paths),
        })
    return {
        "acyclic": acyclic,
        "n_nodes": g.number_of_nodes(),
        "n_edges": g.number_of_edges(),
        "confounding": confounding,
        "note": "Common causes are structural (from the graph), not estimated from data. With observational data, "
                "they must be adjusted for before interpreting associations causally.",
    }
