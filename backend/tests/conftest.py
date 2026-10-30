import os
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="backfire-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ["UPLOAD_DIR"] = str(_tmp / "uploads")
os.environ["ENVIRONMENT"] = "test"
os.environ["AUTH_RATE_LIMIT_PER_MINUTE"] = "1000"
os.environ["RATE_LIMIT_PER_MINUTE"] = "10000"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="session")
def client():
    from app.main import app

    with TestClient(app) as c:
        yield c


_counter = {"n": 0}


@pytest.fixture
def auth(client):
    _counter["n"] += 1
    r = client.post("/api/auth/register", json={"email": f"user{_counter['n']}@example.org", "password": "Corr3ct-Horse!",
                                               "full_name": f"User {_counter['n']}"})
    assert r.status_code == 201, r.text
    client.cookies.clear()  # tests authenticate with bearer tokens unless they opt into cookies
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]


@pytest.fixture
def offline_evidence(monkeypatch):
    """Deterministic stand-ins for external providers (tests never hit the network)."""
    from app.science import model as M
    from app.services import evidence as E

    def fake_search(topic, extra="", per_page=6):
        w = E.Work(provider="openalex", title=f"Test study on {topic}", doi=f"10.0000/test.{topic}", year=2020,
                   venue="Test Journal", authors=["A. Author"], source_type="peer_reviewed", url="https://doi.org/10.0000/x",
                   cited_by=10, abstract="Tree canopy cover reduced air temperature by 1.2 °C in summer. "
                                         "However, street tree mortality increased under drought conditions in dry years.",
                   query=E.TOPICS[topic]["query"])
        w.passages = E.extract_passages(w.abstract, topic)
        w.quality, w.limitations = E.assess_quality(w)
        return [w]

    monkeypatch.setattr(E, "search_openalex", fake_search)
    monkeypatch.setattr(E, "nasa_power_climatology", lambda lat, lon, name="": M.synthetic_climatology(lat, name=name))
    monkeypatch.setattr(E, "crossref_lookup", lambda doi: {"title": "Resolved title", "year": 2011, "venue": "J",
                                                           "authors": ["X"], "url": f"https://doi.org/{doi}", "cited_by": 1})
