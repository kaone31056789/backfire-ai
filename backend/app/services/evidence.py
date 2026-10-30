"""Evidence retrieval from OpenAlex, Crossref, NASA POWER and GBIF.

Nothing here fabricates content: if a provider is unreachable the caller gets an
explicit error and the investigation records that evidence retrieval failed.
Retrieved records are metadata + abstracts; they are *evidence candidates*, not
proof of any claim. Stance labels are keyword heuristics and labelled as such.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..core.config import get_settings
from ..science.model import Climatology
from . import safe_http

TOPICS: dict[str, dict] = {
    "cooling": {
        "query": "urban tree canopy cooling air temperature",
        "keywords": ["cool", "temperature", "heat", "thermal", "canopy", "shade", "shading", "uhi"],
    },
    "water_use": {
        "query": "urban tree transpiration water use irrigation",
        "keywords": ["water use", "transpiration", "irrigation", "evapotranspiration", "sap flow", "water demand"],
    },
    "mortality": {
        "query": "urban street tree mortality survival drought",
        "keywords": ["mortality", "survival", "died", "death", "dieback", "establishment"],
    },
    "drought_stress": {
        "query": "urban trees drought stress soil moisture",
        "keywords": ["drought", "water stress", "soil moisture", "deficit", "dry"],
    },
    "humidity": {
        "query": "urban greening evapotranspiration humidity cooling efficiency",
        "keywords": ["humidity", "humid", "vapour pressure", "vapor pressure", "latent heat"],
    },
}

CONTRA_CUES = [
    r"\bno significant\b", r"\bnot significant", r"\bdid not\b", r"\bfailed to\b", r"\blimited\b", r"\bnegligible\b",
    r"\bincreas\w* mortality\b", r"\bhigh(er)? mortality\b", r"\breduc\w* survival\b", r"\bwarm(ing|er) (at night|nocturnal)",
    r"\bnocturnal\b.*\bwarm", r"\btrade-?off", r"\bdeclin\w*\b", r"\bweak(er)?\b", r"\bcounterproductive\b", r"\bincreas\w* water (use|demand)",
]
SUPPORT_CUES = [
    r"\bcool(ing|er)\b", r"\breduc\w* (air |surface )?temperature", r"\blower (air )?temperature", r"\bmitigat\w*",
    r"\bsignificant(ly)? (reduc|lower|decreas)", r"\bhigh(er)? survival\b", r"\bbenefit",
]

PREPRINT_VENUES = ("arxiv", "biorxiv", "medrxiv", "ssrn", "preprint", "research square", "eartharxiv")


def classify_source(work_type: str | None, venue: str | None, source_type_hint: str | None = None) -> str:
    v = (venue or "").lower()
    t = (work_type or "").lower()
    if any(p in v for p in PREPRINT_VENUES) or t in ("preprint", "posted-content"):
        return "preprint"
    if t in ("report", "report-component") or "government" in (source_type_hint or ""):
        return "government_report"
    if t in ("article", "journal-article", "review", "book-chapter"):
        return "peer_reviewed" if v else "other"
    return "other"


def reconstruct_abstract(inv: dict | None) -> str | None:
    if not inv:
        return None
    positions = [(pos, word) for word, idxs in inv.items() for pos in idxs]
    return " ".join(w for _, w in sorted(positions))


@dataclass
class Passage:
    text: str
    topic: str
    stance: str
    relevance: float


@dataclass
class Work:
    provider: str
    title: str
    doi: str | None
    year: int | None
    venue: str | None
    authors: list[str]
    source_type: str
    url: str | None
    cited_by: int | None
    abstract: str | None
    query: str
    passages: list[Passage] = field(default_factory=list)
    limitations: list[str] = field(default_factory=list)
    quality: dict = field(default_factory=dict)


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", text) if 40 <= len(s.strip()) <= 700]


def stance_of(sentence: str) -> str:
    s = sentence.lower()
    contra = sum(bool(re.search(p, s)) for p in CONTRA_CUES)
    sup = sum(bool(re.search(p, s)) for p in SUPPORT_CUES)
    if contra > sup:
        return "contradicts"
    if sup > contra:
        return "supports"
    return "neutral"


def extract_passages(abstract: str | None, topic_hint: str) -> list[Passage]:
    if not abstract:
        return []
    out = []
    for sent in split_sentences(abstract):
        s = sent.lower()
        best_topic, best_score = topic_hint, 0
        for key, t in TOPICS.items():
            score = sum(1 for k in t["keywords"] if k in s)
            if score > best_score:
                best_topic, best_score = key, score
        if best_score == 0:
            continue
        has_number = bool(re.search(r"\d", sent))
        out.append(Passage(sent, best_topic, stance_of(sent), min(1.0, 0.3 * best_score + (0.2 if has_number else 0))))
    return sorted(out, key=lambda p: -p.relevance)[:4]


def assess_quality(w: Work) -> tuple[dict, list[str]]:
    lim = []
    if w.source_type == "preprint":
        lim.append("Preprint: not peer reviewed.")
    if w.source_type == "other":
        lim.append("Source type could not be classified as peer-reviewed.")
    if not w.abstract:
        lim.append("No abstract available; relevance not assessed from text.")
    if w.year and w.year < 2005:
        lim.append("Older study (pre-2005); climate and urban form may differ.")
    lim.append("Relevance and stance are keyword heuristics; read the source before relying on it.")
    score = {"peer_reviewed": 0.8, "government_report": 0.7, "preprint": 0.45, "other": 0.3}.get(w.source_type, 0.3)
    if w.cited_by:
        score += min(0.15, 0.03 * (w.cited_by ** 0.25))
    return {"score": round(min(score, 1.0), 3), "basis": "source type + citation count (heuristic)"}, lim


def search_openalex(topic: str, extra: str = "", per_page: int = 6) -> list[Work]:
    s = get_settings()
    q = (TOPICS[topic]["query"] + " " + extra).strip()
    data = safe_http.get_json(
        "https://api.openalex.org/works",
        params={
            "search": q,
            "per-page": per_page,
            "filter": "has_abstract:true,type:article|review",
            "sort": "relevance_score:desc",
            "select": "id,doi,title,publication_year,primary_location,authorships,type,cited_by_count,abstract_inverted_index",
            "mailto": s.contact_email,
        },
    )
    works = []
    for r in data.get("results", []):
        loc = r.get("primary_location") or {}
        src = loc.get("source") or {}
        venue = src.get("display_name")
        doi = (r.get("doi") or "").replace("https://doi.org/", "") or None
        abstract = reconstruct_abstract(r.get("abstract_inverted_index"))
        w = Work(
            provider="openalex",
            title=r.get("title") or "(untitled)",
            doi=doi,
            year=r.get("publication_year"),
            venue=venue,
            authors=[a.get("author", {}).get("display_name", "") for a in (r.get("authorships") or [])[:8]],
            source_type=classify_source(r.get("type"), venue, src.get("type")),
            url=f"https://doi.org/{doi}" if doi else r.get("id"),
            cited_by=r.get("cited_by_count"),
            abstract=abstract,
            query=q,
        )
        w.passages = extract_passages(abstract, topic)
        w.quality, w.limitations = assess_quality(w)
        works.append(w)
    return works


def crossref_lookup(doi: str) -> dict | None:
    s = get_settings()
    try:
        data = safe_http.get_json(f"https://api.crossref.org/works/{doi}", params={"mailto": s.contact_email})
    except Exception:
        return None
    m = data.get("message") or {}
    return {
        "title": (m.get("title") or [""])[0],
        "year": ((m.get("issued") or {}).get("date-parts") or [[None]])[0][0],
        "venue": (m.get("container-title") or [None])[0],
        "type": m.get("type"),
        "authors": [f"{a.get('given', '')} {a.get('family', '')}".strip() for a in (m.get("author") or [])[:8]],
        "url": m.get("URL"),
        "cited_by": m.get("is-referenced-by-count"),
    }


MONTH_KEYS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def nasa_power_climatology(lat: float, lon: float, name: str = "") -> Climatology:
    """Long-term monthly climatology (NASA POWER, MERRA-2 meteorology). Raises on failure.

    POWER's climatology T2M_MAX/T2M_MIN are monthly *extremes*, so mean daily Tmax/Tmin
    (what FAO-56 requires) are derived as T2M ± T2M_RANGE/2, T2M_RANGE being the mean diurnal range.
    """
    data = safe_http.get_json(
        "https://power.larc.nasa.gov/api/temporal/climatology/point",
        params={"parameters": "T2M,T2M_RANGE,RH2M,PRECTOTCORR", "community": "AG", "longitude": round(lon, 4),
                "latitude": round(lat, 4), "format": "JSON"},
        timeout=40,
    )
    p = data["properties"]["parameter"]
    coords = (data.get("geometry") or {}).get("coordinates") or [lon, lat, 100.0]
    elevation = float(coords[2]) if len(coords) > 2 and coords[2] is not None else 100.0
    vals = {k: [float(p[k][m]) for m in MONTH_KEYS] for k in ("T2M", "T2M_RANGE", "RH2M", "PRECTOTCORR")}
    if any(v <= -900 for arr in vals.values() for v in arr):
        raise ValueError("NASA POWER returned fill values for this location")
    return Climatology(
        tmax=[round(t + r / 2, 2) for t, r in zip(vals["T2M"], vals["T2M_RANGE"])],
        tmin=[round(t - r / 2, 2) for t, r in zip(vals["T2M"], vals["T2M_RANGE"])],
        rh=vals["RH2M"],
        precip_mm=[round(v * d, 2) for v, d in zip(vals["PRECTOTCORR"], DAYS)],
        latitude=lat, elevation_m=max(0.0, elevation),
        source="NASA POWER monthly climatology (T2M ± T2M_RANGE/2, RH2M, PRECTOTCORR); ~0.5° reanalysis 2 m air "
               "temperature, not land-surface temperature",
        synthetic=False, location_name=name,
    )


def gbif_occurrences(scientific_name: str, lat: float, lon: float, radius_deg: float = 1.0) -> dict:
    data = safe_http.get_json(
        "https://api.gbif.org/v1/occurrence/search",
        params={"scientificName": scientific_name, "decimalLatitude": f"{lat - radius_deg},{lat + radius_deg}",
                "decimalLongitude": f"{lon - radius_deg},{lon + radius_deg}", "limit": 0, "hasCoordinate": "true"},
    )
    match = safe_http.get_json("https://api.gbif.org/v1/species/match", params={"name": scientific_name})
    return {
        "scientific_name": scientific_name,
        "matched_name": match.get("scientificName"),
        "match_type": match.get("matchType"),
        "occurrences_nearby": data.get("count", 0),
        "radius_deg": radius_deg,
        "note": "Occurrence records indicate presence reports, not suitability, drought tolerance or planting success.",
    }
