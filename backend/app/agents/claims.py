"""Claim Extraction Agent logic: structured outputs + deterministic extractor."""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field

from ..science.parameters import METRICS, PARAMETERS

MetricName = Literal["cooling_c", "survival_rate", "water_stress_index", "irrigation_m3_ha", "annual_cost_usd_ha"]


class ExtractedClaim(BaseModel):
    text: str = Field(..., description="Verbatim or near-verbatim sentence from the proposal")
    metric: MetricName | None = None
    operator: Literal[">=", "<="] | None = None
    threshold: float | None = None
    unit: str | None = None
    horizon_years: int | None = None
    measurable: bool = True


class ExtractedAssumption(BaseModel):
    text: str
    parameter_name: str | None = None


class ClaimExtractionOutput(BaseModel):
    claims: list[ExtractedClaim] = Field(default_factory=list)
    assumptions: list[ExtractedAssumption] = Field(default_factory=list)
    parameter_hints: dict[str, float] = Field(default_factory=dict)


SYSTEM_PROMPT = (
    "You extract measurable claims from environmental intervention proposals. Only report claims that are "
    "stated in the text. Copy the sentence containing each claim into 'text'. Do not invent numbers. Map claims to "
    "metrics: cooling_c (daytime air temperature reduction, °C), survival_rate (fraction 0-1 alive at horizon), "
    "water_stress_index (0-1), irrigation_m3_ha (m³ per hectare per year), annual_cost_usd_ha. Mark vague claims "
    "as measurable=false. List stated or implied assumptions."
)

NUM = r"(\d+(?:[.,]\d+)?)"


def _f(s: str) -> float:
    return float(s.replace(",", "")) if s.count(",") and len(s.split(",")[-1]) == 3 else float(s.replace(",", "."))


def sentences(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text)
    return [s.strip() for s in re.split(r"(?<=[.!?;])\s+", text) if len(s.strip()) > 8]


VAGUE = re.compile(r"\b(improv\w*|enhanc\w*|boost\w*|transform\w*|sustainab\w*|resilien\w*|wellbeing|well-being|"
                   r"liveab\w*|biodiversity|significant(ly)?|substantial(ly)?|dramatic(ally)?)\b", re.I)
ASSUME = re.compile(r"\b(assum\w*|expect\w*|provided that|given that|rel(y|ies) on|sufficient water|will be (irrigated|"
                    r"maintained|watered)|is available|are available|anticipat\w*)\b", re.I)


def extract_rule_based(text: str) -> ClaimExtractionOutput:
    out = ClaimExtractionOutput()
    horizon = None
    m = re.search(r"\b(?:within|over|after)\s+(\d{1,2})\s+years?\b", text, re.I)
    if m:
        horizon = int(m.group(1))
    for s in sentences(text):
        found = False
        low = s.lower()
        m = re.search(r"(reduc\w*|lower\w*|cool\w*|decreas\w*|drop\w*)[^.]{0,100}?" + NUM +
                      r"\s*(?:°\s*c\b|º\s*c\b|℃|degrees?(?:\s*(?:celsius|c))?|deg\s*c\b|k\b)", s, re.I)
        if m and re.search(r"temperat|cool|heat", low):
            out.claims.append(ExtractedClaim(text=s, metric="cooling_c", operator=">=", threshold=_f(m.group(2)), unit="°C",
                                             horizon_years=horizon))
            found = True
        m = re.search(NUM + r"\s*%\s*(?:of\s+(?:the\s+)?(?:planted\s+)?trees?\s+)?(?:tree\s+)?surviv\w*", s, re.I) or \
            re.search(r"surviv\w*(?:\s+rate)?(?:\s+(?:of|at|above|exceeding|at least|≥|>=))*\s*" + NUM + r"\s*%", s, re.I) or             re.search(NUM + r"\s*%\s*of\s+(?:the\s+)?(?:planted\s+|new\s+)?trees?\s+(?:are\s+|stay\s+|remain\s+)?(?:alive|living|surviv\w*)", s, re.I)
        if m:
            out.claims.append(ExtractedClaim(text=s, metric="survival_rate", operator=">=", threshold=_f(m.group(1)) / 100.0,
                                             unit="fraction", horizon_years=horizon))
            found = True
        m = re.search(r"(?:no more than|less than|below|under|at most|maximum of|not exceed\w*|limited to|cap\w* at)\s*" + NUM +
                      r"\s*(?:m3|m³|cubic met(?:er|re)s?)", s, re.I)
        if m:
            out.claims.append(ExtractedClaim(text=s, metric="irrigation_m3_ha", operator="<=", threshold=_f(m.group(1)),
                                             unit="m³/ha/yr", horizon_years=horizon))
            found = True
        m = re.search(r"(?:no more than|less than|below|under|at most|within|budget of)\s*(?:US\$|USD|\$)\s*" + NUM +
                      r"\s*(?:k\b)?\s*(?:per|/)\s*(?:ha|hectare)", s, re.I)
        if m:
            val = _f(m.group(1)) * (1000 if re.search(NUM + r"\s*k\b", m.group(0), re.I) else 1)
            out.claims.append(ExtractedClaim(text=s, metric="annual_cost_usd_ha", operator="<=", threshold=val,
                                             unit="USD/ha/yr", horizon_years=horizon))
            found = True
        # parameter hints (design values stated in the proposal)
        m = re.search(r"canopy(?:\s+cover(?:age)?)?[^.%]{0,40}?" + NUM + r"\s*%", s, re.I) or \
            re.search(NUM + r"\s*%\s*(?:tree\s+)?canopy", s, re.I)
        if m:
            v = _f(m.group(1)) / 100
            if 0.05 <= v <= 0.6:
                out.parameter_hints["canopy_target"] = v
        m = re.search(NUM + r"\s*trees\s*(?:per|/)\s*(?:ha|hectare)", s, re.I)
        if m and 50 <= _f(m.group(1)) <= 600:
            out.parameter_hints["tree_density"] = _f(m.group(1))
        if re.search(r"\bdrip\b", low):
            out.parameter_hints.setdefault("irrigation_efficiency", 0.9)
            out.assumptions.append(ExtractedAssumption(text=s, parameter_name="irrigation_efficiency"))
        if not found and VAGUE.search(s) and not re.search(r"\d", s):
            out.claims.append(ExtractedClaim(text=s, measurable=False))
        if ASSUME.search(s):
            pname = None
            if re.search(r"water|irrigat", low):
                pname = "supply_reliability"
            elif re.search(r"rain|precip", low):
                pname = "precip_change"
            elif re.search(r"surviv|mortal", low):
                pname = "base_mortality"
            elif re.search(r"maint", low):
                pname = "maintenance_usd"
            out.assumptions.append(ExtractedAssumption(text=s, parameter_name=pname))
    # de-duplicate assumptions by text
    seen = set()
    out.assumptions = [a for a in out.assumptions if not (a.text in seen or seen.add(a.text))]
    return out


def model_assumptions() -> list[ExtractedAssumption]:
    """Structural assumptions of the computational model itself (always listed)."""
    items = [ExtractedAssumption(text=f"{p.label}: {p.description} {p.validity}".strip(), parameter_name=p.name)
             for p in PARAMETERS if p.status == "assumption"]
    items += [
        ExtractedAssumption(text="Climate is represented by a stationary climatological year; inter-annual variability "
                                 "and multi-year droughts are not simulated explicitly."),
        ExtractedAssumption(text="Cooling refers to daytime pedestrian-level air temperature, not land-surface temperature."),
        ExtractedAssumption(text="No replanting of dead trees over the horizon."),
    ]
    return items


def traceable(claim_text: str, source: str) -> bool:
    """Check an LLM-reported claim sentence actually appears (approximately) in the source text."""
    norm = lambda t: re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()
    c, s = norm(claim_text), norm(source)
    if not c:
        return False
    if c in s:
        return True
    words = c.split()
    hits = sum(1 for w in words if w in s.split())
    return hits / max(len(words), 1) >= 0.8
