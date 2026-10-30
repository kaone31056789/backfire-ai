import pytest

from app.agents import causal as CA
from app.agents.claims import ClaimExtractionOutput, extract_rule_based, traceable
from app.agents.providers import MockProvider
from app.services import safe_http

PROPOSAL = ("The city will plant 300 trees per hectare to reach 30% canopy cover. The programme will reduce summer air "
            "temperatures by 1.5 °C within 10 years, with 80% tree survival. Irrigation will not exceed 2,000 m3 per "
            "hectare per year using drip irrigation. We assume sufficient water is available from the municipal supply. "
            "The project will improve wellbeing and resilience.")


def test_rule_based_extraction():
    out = extract_rule_based(PROPOSAL)
    by = {c.metric: c for c in out.claims if c.metric}
    assert by["cooling_c"].threshold == 1.5 and by["cooling_c"].operator == ">="
    assert by["survival_rate"].threshold == pytest.approx(0.8)
    assert by["irrigation_m3_ha"].threshold == 2000 and by["irrigation_m3_ha"].operator == "<="
    assert by["cooling_c"].horizon_years == 10
    assert any(not c.measurable for c in out.claims)
    assert out.parameter_hints["tree_density"] == 300
    assert out.parameter_hints["canopy_target"] == pytest.approx(0.3)
    assert any(a.parameter_name == "supply_reliability" for a in out.assumptions)


def test_traceability_rejects_fabricated_claims():
    assert traceable("The programme will reduce summer air temperatures by 1.5 °C within 10 years", PROPOSAL)
    assert not traceable("Trees will sequester 50 tonnes of carbon per hectare annually", PROPOSAL)


def test_mock_provider_structured_output():
    p = MockProvider({"claims": [{"text": "x", "metric": "cooling_c", "operator": ">=", "threshold": 1}], "assumptions": []})
    out, usage = p.structured("s", "u", ClaimExtractionOutput)
    assert out.claims[0].threshold == 1 and usage.provider == "mock"


def test_causal_graph_is_acyclic_and_alternatives_flagged():
    g = CA.build([{"id": "p1", "topic": "cooling", "stance": "supports"}, {"id": "p2", "topic": "cooling", "stance": "contradicts"}])
    assert g.analysis["acyclic"]
    assert all(e["in_model"] for e in g.edges)
    alt = CA.build([], alternative=True)
    assert any(not e["in_model"] for e in alt.edges)
    conf = {c["treatment"]: c for c in alt.analysis["confounding"]}
    assert "socioeconomic" in conf["canopy"]["common_causes"]
    edge = next(e for e in g.edges if e["source_key"] == "canopy_eff" and e["target_key"] == "cooling")
    assert "p1" in edge["evidence_ids"] and "p2" in edge["contradicting_ids"]


@pytest.mark.parametrize("url", ["http://api.openalex.org/works", "https://169.254.169.254/latest", "https://evil.example.com/",
                                 "https://user:pw@api.openalex.org/works", "file:///etc/passwd"])
def test_ssrf_protection(url):
    with pytest.raises(safe_http.BlockedRequest):
        safe_http._check_url(url)
