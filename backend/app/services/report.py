"""Falsification certificate: JSON content + PDF rendering (ReportLab)."""
from __future__ import annotations

import hashlib
import io
import json
import platform
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (AgentExecution, AnalysisResult, Assumption, CausalEdge, CausalGraph, Claim, Counterexample,
                      EvidenceSource, Investigation, InvestigationReport, OptimisationRun, ScenarioComparison,
                      VerificationResult)
from ..science import model as M
from ..science.mpfs import MPFS_VERSION
from ..science.parameters import METRICS, PARAMETERS
from ..science.verification import VERIFIER_VERSION
from . import context as C

LIMITATIONS = [
    "Exploratory simulation: the coupled model has not been validated end-to-end against field observations.",
    "Parameters marked 'assumption' are uncalibrated; conclusions are conditional on them.",
    "A simulated failure under plausible conditions does NOT establish that the intervention is environmentally harmful; "
    "it identifies conditions under which the claimed benefit is not delivered by this model.",
    "Cooling refers to modelled daytime pedestrian-level air temperature, not satellite land-surface temperature.",
    "Water use is modelled with the WUCOLS landscape-coefficient method; it is not inferred from vegetation indices.",
    "Climate is a stationary climatological year; multi-year droughts and extremes are not simulated explicitly.",
    "Evidence relevance and stance are keyword heuristics and do not constitute a systematic review.",
    "Benchmark comparisons between search methods apply to the stated problems and budgets only.",
]


def _latest(db: Session, inv_id, kind: str):
    return db.scalars(select(AnalysisResult).where(AnalysisResult.investigation_id == inv_id, AnalysisResult.kind == kind)
                      .order_by(AnalysisResult.created_at.desc())).first()


def build_report(db: Session, inv_id: uuid.UUID) -> dict:
    inv = db.get(Investigation, inv_id)
    iv = inv.intervention
    mc_row = C.latest_model_config(db, inv_id)
    cfg = C.build_config(db, inv)
    rows = C.get_params(db, inv_id)
    claims = list(db.scalars(select(Claim).where(Claim.investigation_id == inv_id)))
    assumptions = list(db.scalars(select(Assumption).where(Assumption.investigation_id == inv_id)))
    sources = list(db.scalars(select(EvidenceSource).where(EvidenceSource.investigation_id == inv_id)))
    graph = db.scalars(select(CausalGraph).where(CausalGraph.investigation_id == inv_id, CausalGraph.is_alternative.is_(False))).first()
    edges = list(db.scalars(select(CausalEdge).where(CausalEdge.graph_id == graph.id))) if graph else []
    runs = list(db.scalars(select(OptimisationRun).where(OptimisationRun.investigation_id == inv_id).order_by(OptimisationRun.created_at)))
    cexs = list(db.scalars(select(Counterexample).where(Counterexample.investigation_id == inv_id).order_by(Counterexample.distance)))
    vers = {v.counterexample_id: v for v in db.scalars(select(VerificationResult).where(VerificationResult.investigation_id == inv_id))}
    mc = _latest(db, inv_id, "monte_carlo")
    sob = _latest(db, inv_id, "sobol")
    alts = db.scalars(select(ScenarioComparison).where(ScenarioComparison.investigation_id == inv_id,
                                                       ScenarioComparison.kind == "alternatives")
                      .order_by(ScenarioComparison.created_at.desc())).first()
    execs = list(db.scalars(select(AgentExecution).where(AgentExecution.investigation_id == inv_id).order_by(AgentExecution.started_at)))
    v0, _, _ = C.param_arrays(rows)
    nominal = M.single(v0, cfg)
    verified = [c for c in cexs if c.status in ("verified", "verified_with_warnings")]
    mpfs_best = next((c for c in cexs if c.method.startswith("MPFS") and c.rank == 1), None)

    if not cexs:
        verdict = "NOT YET TESTED" if not runs else "NOT FALSIFIED WITHIN SEARCH BUDGET"
    elif nominal["net_benefit"] < 0:
        verdict = "CLAIM FAILS UNDER NOMINAL CONDITIONS"
    elif verified:
        verdict = "FALSIFIABLE UNDER PLAUSIBLE CONDITIONS"
    else:
        verdict = "COUNTEREXAMPLES NOT VERIFIED"
    return {
        "certificate": {
            "title": "BACKFIRE AI — Falsification Certificate",
            "investigation_id": str(inv.id),
            "verdict": verdict,
            "verdict_note": "Verdicts describe model behaviour under the documented assumptions, not real-world outcomes.",
            "status": inv.status,
            "created_at": inv.created_at.isoformat(),
        },
        "intervention": {
            "title": inv.title, "category": inv.category, "description": iv.description if iv else "",
            "source_document": iv.source_document_name if iv else None,
            "location": {"name": inv.location_name, "country": inv.country, "latitude": inv.latitude, "longitude": inv.longitude},
        },
        "claims": [{"id": str(c.id), "text": c.text, "metric": c.metric, "operator": c.operator, "threshold": c.threshold,
                    "unit": c.unit, "measurable": c.measurable, "success_criterion": c.is_success_criterion,
                    "support_status": c.support_status, "source": c.source} for c in claims],
        "success_criteria": [c.to_dict() for c in cfg.criteria],
        "net_benefit_definition": "B(x,θ) = min_k normalised margin_k; success iff B ≥ B_min = 0.",
        "assumptions": [{"text": a.text, "parameter": a.parameter_name, "source": a.source} for a in assumptions],
        "evidence_sources": [{"title": s.title, "doi": s.doi, "year": s.year, "venue": s.venue, "type": s.source_type,
                              "provider": s.provider, "url": s.url, "doi_verified": s.doi_verified,
                              "limitations": s.limitations} for s in sources],
        "causal_assumptions": [{"edge": f"{e.source_key} → {e.target_key}", "sign": e.sign, "basis": e.basis,
                                "mechanism": e.mechanism, "confidence": e.confidence, "references": e.references} for e in edges],
        "mathematical_model": {
            "name": M.MODEL_NAME, "version": M.MODEL_VERSION,
            "components": [
                "ET₀: FAO-56 Penman-Monteith (eq. 6), Rs from temperature range (eq. 50)",
                "ETL = Ks·Kd·Kmc·ET₀ (WUCOLS landscape coefficient method)",
                "Effective rainfall: USDA-SCS (FAO CROPWAT)",
                "Daily root-zone depletion bucket with FAO-56 stress coefficient (eq. 84), p = 0.5",
                "WSI = 1 − ΣETa/ΣETL; mortality m = m₀·f(maintenance) + β·WSI; survival (1 − m)^H",
                "Cooling = Cmax·f(canopy_eff)·[(1 − e) + e·TR_summer·h(RH)]",
            ],
            "climatology_source": cfg.climatology.source,
            "synthetic_climate": cfg.climatology.synthetic,
            "horizon_years": cfg.horizon_years,
            "cooling_response": cfg.cooling_response,
            "nominal_result": {k: nominal[k] for k in list(METRICS) + ["net_benefit", "success", "binding_criterion"] if k in nominal},
        },
        "parameter_ranges": [{"name": r.name, "label": r.label, "kind": r.kind, "unit": r.unit, "nominal": r.nominal,
                              "lower": r.lower, "upper": r.upper, "status": r.status, "sources": r.sources,
                              "active": r.active, "weight": r.weight} for r in rows],
        "plausibility_dependencies": [c.to_dict() for c in cfg.constraints],
        "optimisation": {
            "objective": "min ||Δx||²_W + λ||Δθ||²_W  s.t.  B(x+Δx, θ+Δθ) < 0, bounds, dependencies",
            "algorithm": "Minimum Plausible Failure Search", "mpfs_version": MPFS_VERSION,
            "runs": [{"method": r.method, "version": r.version, "budget": r.budget, "seed": r.seed, "evaluations": r.evaluations,
                      "found": r.found, "best_distance": r.best_distance, "first_failure_at": r.first_failure_at,
                      "runtime_s": round(r.runtime_s, 3), "config": r.config, "notes": r.notes} for r in runs],
        },
        "counterexamples": [{"id": str(c.id), "method": c.method, "rank": c.rank, "distance": c.distance,
                             "net_benefit": c.net_benefit, "binding_criterion": c.binding_criterion, "deltas": c.deltas,
                             "metrics": c.metrics, "status": c.status} for c in cexs],
        "headline_counterexample": None if not mpfs_best else {"distance": mpfs_best.distance, "deltas": mpfs_best.deltas,
                                                              "metrics": mpfs_best.metrics, "status": mpfs_best.status,
                                                              "binding_criterion": mpfs_best.binding_criterion},
        "uncertainty_analysis": None if not mc else {k: mc.result[k] for k in ("method", "n_valid", "failure_probability",
                                                                                 "failure_ci95", "per_criterion", "uncertain_parameters", "note")},
        "sensitivity_analysis": None if not sob else {"method": sob.result["method"], "names": sob.result["names"],
                                                      "total_order_net_benefit": sob.result["results"]["net_benefit"]["ST"],
                                                      "first_order_net_benefit": sob.result["results"]["net_benefit"]["S1"]},
        "verification": [{"counterexample_id": str(cid), "status": v.status, "verifier": v.verifier,
                          "verifier_version": v.verifier_version, "recomputed_b": v.recomputed_b, "robustness": v.robustness,
                          "checks": v.checks, "flags": v.flags} for cid, v in vers.items()],
        "alternatives": None if not alts else [{"label": r["label"], "category": r["category"], "changes": r["changes"],
                                                "failure_probability": r["failure_probability"], "failure_ci95": r["failure_ci95"],
                                                "survives_counterexamples": r["survives_counterexamples"],
                                                "nominal": r["nominal"]} for r in alts.result["rows"]],
        "agent_executions": [{"agent": e.agent, "status": e.status, "attempts": e.attempts, "summary": e.summary,
                              "started_at": e.started_at.isoformat(),
                              "finished_at": e.finished_at.isoformat() if e.finished_at else None} for e in execs],
        "reproducibility": {
            "seed": inv.seed, "settings": C.merged_settings(inv),
            "algorithm_versions": inv.algorithm_versions or {"mpfs": MPFS_VERSION, "model": M.MODEL_VERSION, "verifier": VERIFIER_VERSION},
            "model_config_hash": mc_row.config_hash if mc_row else None,
            "model_config": cfg.to_dict(),
            "python": platform.python_version(),
            "how_to_reproduce": "POST /api/investigations/{id}/run-backfire with the stored settings and seed, or load "
                                "model_config into app.science.model.ModelConfig.from_dict and re-run the listed methods.",
        },
        "known_limitations": LIMITATIONS + (["Baseline climate is SYNTHETIC (NASA POWER was unavailable)."]
                                            if cfg.climatology.synthetic else []),
    }


def store_report(db: Session, inv_id: uuid.UUID) -> InvestigationReport:
    content = build_report(db, inv_id)
    h = hashlib.sha256(json.dumps(content, sort_keys=True, default=str).encode()).hexdigest()
    n = db.scalar(select(func.coalesce(func.max(InvestigationReport.version), 0)).where(InvestigationReport.investigation_id == inv_id)) or 0
    content["certificate"]["version"] = n + 1
    content["certificate"]["content_sha256"] = h
    rep = InvestigationReport(investigation_id=inv_id, version=n + 1, content=content, content_hash=h)
    db.add(rep)
    db.flush()
    return rep


# --------------------------------------------------------------------------- PDF
def render_pdf(content: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                            title="BACKFIRE Falsification Certificate", author="BACKFIRE AI")
    ss = getSampleStyleSheet()
    ink = colors.HexColor("#0b1220")
    accent = colors.HexColor("#0f766e")
    muted = colors.HexColor("#475569")
    H1 = ParagraphStyle("H1", parent=ss["Title"], fontSize=18, textColor=ink, alignment=TA_LEFT, spaceAfter=4)
    H2 = ParagraphStyle("H2", parent=ss["Heading2"], fontSize=12, textColor=accent, spaceBefore=10, spaceAfter=4)
    B = ParagraphStyle("B", parent=ss["BodyText"], fontSize=8.6, leading=11.5, textColor=ink)
    S = ParagraphStyle("S", parent=B, fontSize=7.6, leading=10, textColor=muted)

    def esc(t) -> str:
        return (str(t) if t is not None else "–").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    def table(rows, widths=None, header=True):
        t = Table([[Paragraph(esc(c), S if i else B) if not isinstance(c, Paragraph) else c for c in r]
                   for i, r in enumerate(rows)], colWidths=widths, repeatRows=1 if header else 0)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0") if header else colors.white),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ]))
        return t

    c = content
    cert = c["certificate"]
    el = [Paragraph("BACKFIRE AI — Falsification Certificate", H1),
          Paragraph(f"Investigation {esc(cert['investigation_id'])} · version {esc(cert.get('version'))} · "
                    f"SHA-256 {esc(cert.get('content_sha256', '')[:16])}…", S), Spacer(1, 6),
          table([["Verdict", "Note"], [cert["verdict"], cert["verdict_note"]]], [60 * mm, None])]
    iv = c["intervention"]
    el += [Paragraph("1. Intervention", H2), Paragraph(f"<b>{esc(iv['title'])}</b> — {esc(iv['location']['name'])} "
                                                       f"({iv['location']['latitude']:.3f}, {iv['location']['longitude']:.3f})", B),
           Paragraph(esc(iv["description"][:2500]), B)]
    el += [Paragraph("2. Claims and success criteria", H2),
           table([["Claim", "Metric", "Criterion", "Support", "Source"]] +
                 [[cl["text"][:220], cl["metric"] or "—",
                   f"{cl['operator']} {cl['threshold']:g}" if cl["threshold"] is not None else "not measurable",
                   cl["support_status"], cl["source"]] for cl in c["claims"]],
                 [70 * mm, 28 * mm, 24 * mm, 22 * mm, 20 * mm]),
           Paragraph(esc(c["net_benefit_definition"]), S)]
    m = c["mathematical_model"]
    el += [Paragraph("3. Mathematical model", H2), Paragraph(f"{esc(m['name'])} v{esc(m['version'])}; climate: {esc(m['climatology_source'])}", B)]
    el += [Paragraph("• " + esc(x), B) for x in m["components"]]
    nr = m["nominal_result"]
    el += [Paragraph(f"Nominal: cooling {nr['cooling_c']:.2f} °C, survival {nr['survival_rate']:.1%}, WSI {nr['water_stress_index']:.3f}, "
                     f"irrigation {nr['irrigation_m3_ha']:.0f} m³/ha/yr, B = {nr['net_benefit']:.3f}.", B)]
    el += [Paragraph("4. Parameter ranges", H2),
           table([["Parameter", "Unit", "Nominal", "Range", "Status", "Sources"]] +
                 [[p["label"], p["unit"], f"{p['nominal']:.4g}", f"{p['lower']:.4g} – {p['upper']:.4g}", p["status"],
                   ", ".join(p["sources"]) or "—"] for p in c["parameter_ranges"]],
                 [48 * mm, 22 * mm, 18 * mm, 30 * mm, 22 * mm, 34 * mm])]
    el += [PageBreak(), Paragraph("5. Optimisation", H2), Paragraph(esc(c["optimisation"]["objective"]), B),
           table([["Method", "Version", "Budget", "Seed", "Found", "Min distance", "1st failure at"]] +
                 [[r["method"], r["version"], r["budget"], r["seed"], "yes" if r["found"] else "no",
                   f"{r['best_distance']:.4f}" if r["best_distance"] is not None else "—", r["first_failure_at"] or "—"]
                  for r in c["optimisation"]["runs"]])]
    el += [Paragraph("6. Discovered counterexamples", H2)]
    for ce in c["counterexamples"][:8]:
        el += [Paragraph(f"<b>{esc(ce['method'])} #{ce['rank']}</b> — distance {ce['distance']:.4f}, B = {ce['net_benefit']:.4f}, "
                         f"violates <i>{esc(ce['binding_criterion'])}</i>, status <b>{esc(ce['status'])}</b>", B)]
        top = sorted(ce["deltas"].values(), key=lambda d: -abs(d["normalised"]))[:6]
        if top:
            el.append(table([["Parameter", "From", "To", "Normalised Δ"]] +
                            [[d["label"], f"{d['from']:.4g}", f"{d['to']:.4g}", f"{d['normalised']:+.3f}"] for d in top],
                            [60 * mm, 30 * mm, 30 * mm, 30 * mm]))
        el.append(Spacer(1, 4))
    ua = c.get("uncertainty_analysis")
    if ua:
        el += [Paragraph("7. Uncertainty analysis", H2),
               Paragraph(f"{esc(ua['method'])}; n = {ua['n_valid']}. Failure probability {ua['failure_probability']:.1%} "
                         f"(95% Wilson CI {ua['failure_ci95'][0]:.1%} – {ua['failure_ci95'][1]:.1%}). {esc(ua['note'])}", B),
               table([["Criterion", "P(failure)", "95% CI"]] +
                     [[pc["label"] or pc["metric"], f"{pc['failure_probability']:.1%}",
                       f"{pc['ci95'][0]:.1%} – {pc['ci95'][1]:.1%}"] for pc in ua["per_criterion"]])]
    el += [Paragraph("8. Verification", H2)]
    for v in c["verification"][:8]:
        el.append(Paragraph(f"{esc(v['counterexample_id'][:8])}: <b>{esc(v['status'])}</b> by {esc(v['verifier'])} "
                            f"v{esc(v['verifier_version'])}; recomputed B {v['recomputed_b']:.5f}; robustness {v['robustness']:.0%}. "
                            + "; ".join(f"{ck['name']}: {'pass' if ck['passed'] else 'FAIL'}" for ck in v["checks"]), S))
    if c.get("alternatives"):
        el += [Paragraph("9. Alternative interventions (model-evaluated)", H2),
               table([["Alternative", "P(failure)", "Survives counterexamples", "Nominal cooling", "Nominal water"]] +
                     [[a["label"], f"{a['failure_probability']:.1%}", a["survives_counterexamples"],
                       f"{a['nominal']['cooling_c']:.2f} °C", f"{a['nominal']['irrigation_m3_ha']:.0f} m³/ha"] for a in c["alternatives"]])]
    el += [Paragraph("10. Evidence sources", H2)]
    for s in c["evidence_sources"][:40]:
        el.append(Paragraph(f"[{esc(s['type'])}] {esc(s['title'])} ({esc(s['year'])}). {esc(s['venue'])}. "
                            f"{'doi:' + esc(s['doi']) if s['doi'] else esc(s['url'])}"
                            f"{'' if s['doi_verified'] or not s['doi'] else ' — DOI unverified'}", S))
    r = c["reproducibility"]
    el += [Paragraph("11. Reproducibility", H2),
           Paragraph(f"Seed {r['seed']}; versions {esc(json.dumps(r['algorithm_versions']))}; model config SHA-256 "
                     f"{esc(r['model_config_hash'])}; Python {esc(r['python'])}.", S),
           Paragraph(esc(json.dumps(r["settings"])), S), Paragraph(esc(r["how_to_reproduce"]), S)]
    el += [Paragraph("12. Known limitations", H2)] + [Paragraph("• " + esc(x), B) for x in c["known_limitations"]]
    doc.build(el)
    return buf.getvalue()
