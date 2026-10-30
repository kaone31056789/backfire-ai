import io
import uuid

from app.services import worker

H_CSRF = {"X-Requested-With": "backfire"}
BODY = {
    "title": "Test urban forest",
    "description": "Plant 250 trees per hectare to reach 35% canopy and reduce summer air temperatures by 0.5 °C "
                   "within 10 years with 50% survival.",
    "location_name": "Testville", "country": "Testland", "latitude": 28.6, "longitude": 77.2,
    "objectives": [{"metric": "water_stress_index", "operator": "<=", "threshold": 0.25, "label": "WSI <= 0.25"}],
    "settings": {"budget": 400, "methods": ["mpfs", "random"], "mc_samples": 300, "sobol_base": 32},
}


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"


def test_register_validation(client):
    r = client.post("/api/auth/register", json={"email": "weak@example.org", "password": "password"})
    assert r.status_code == 422
    r = client.post("/api/auth/register", json={"email": "not-an-email", "password": "Corr3ct-Horse!"})
    assert r.status_code == 422


def test_duplicate_registration(client, auth):
    _, user = auth
    r = client.post("/api/auth/register", json={"email": user["email"], "password": "Corr3ct-Horse!"})
    assert r.status_code == 409


def test_login_and_refresh(client, auth):
    _, user = auth
    r = client.post("/api/auth/login", json={"email": user["email"], "password": "wrong-Passw0rd"})
    assert r.status_code == 401
    r = client.post("/api/auth/login", json={"email": user["email"], "password": "Corr3ct-Horse!"})
    assert r.status_code == 200
    r2 = client.post("/api/auth/refresh", json={"refresh_token": r.json()["refresh_token"]})
    assert r2.status_code == 200 and r2.json()["access_token"]
    assert client.post("/api/auth/refresh", json={"refresh_token": r.json()["access_token"]}).status_code == 401
    client.cookies.clear()


def test_requires_auth(client):
    client.cookies.clear()
    assert client.get("/api/investigations").status_code == 401


def test_cookie_auth_requires_csrf_header(client, auth):
    _, user = auth
    client.post("/api/auth/login", json={"email": user["email"], "password": "Corr3ct-Horse!"})
    assert client.get("/api/auth/me").status_code == 200  # cookie works for GET
    assert client.post("/api/investigations", json=BODY).status_code == 403  # no CSRF header
    assert client.post("/api/investigations", json=BODY, headers=H_CSRF).status_code == 201
    client.cookies.clear()


def test_investigation_isolation(client, auth):
    h1, _ = auth
    inv = client.post("/api/investigations", json=BODY, headers=h1).json()
    r = client.post("/api/auth/register", json={"email": f"other-{uuid.uuid4().hex[:6]}@example.org", "password": "Corr3ct-Horse!"})
    client.cookies.clear()
    h2 = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get(f"/api/investigations/{inv['id']}", headers=h2).status_code == 404


def test_viewer_cannot_create(client, auth):
    from app.db import session_scope
    from app.models import User

    h, user = auth
    with session_scope() as db:
        db.get(User, uuid.UUID(user["id"])).role = "viewer"
    assert client.post("/api/investigations", json=BODY, headers=h).status_code == 403


def test_input_validation(client, auth):
    h, _ = auth
    assert client.post("/api/investigations", json={**BODY, "latitude": 95}, headers=h).status_code == 422
    assert client.post("/api/investigations", json={**BODY, "parameters": {"not_a_param": {"nominal": 1}}},
                       headers=h).status_code == 422
    assert client.post("/api/investigations", json={**BODY, "parameters": {"warming_c": {"lower": 3, "upper": 1}}},
                       headers=h).status_code == 422


def test_upload_validation(client, auth):
    h, _ = auth
    r = client.post("/api/uploads", files={"file": ("x.txt", b"hello", "text/plain")}, headers=h)
    assert r.status_code == 415
    r = client.post("/api/uploads", files={"file": ("x.pdf", b"not a pdf at all", "application/pdf")}, headers=h)
    assert r.status_code == 415
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 720, "The programme will reduce summer air temperatures by 1.2 C within 10 years.")
    c.save()
    r = client.post("/api/uploads", files={"file": ("report.pdf", buf.getvalue(), "application/pdf")}, headers=h)
    assert r.status_code == 201, r.text
    assert "1.2" in r.json()["preview"]
    inv = client.post("/api/investigations", json={**BODY, "upload_id": r.json()["upload_id"]}, headers=h).json()
    assert inv["source_document_name"] == "report.pdf"


def test_claim_editing(client, auth):
    h, _ = auth
    inv = client.post("/api/investigations", json=BODY, headers=h).json()
    r = client.post(f"/api/investigations/{inv['id']}/claims", headers=h,
                    json={"text": "Cooling of at least 0.8 °C", "metric": "cooling_c", "operator": ">=", "threshold": 0.8,
                          "is_success_criterion": True})
    assert r.status_code == 201
    cid = r.json()["id"]
    r = client.patch(f"/api/claims/{cid}", json={"threshold": 0.9}, headers=h)
    assert r.json()["threshold"] == 0.9 and r.json()["edited"]
    crit = client.get(f"/api/investigations/{inv['id']}/claims", headers=h).json()["criteria"]
    assert any(c["metric"] == "cooling_c" and c["threshold"] == 0.9 for c in crit)
    assert client.patch(f"/api/claims/{cid}", json={"threshold": None}, headers=h).status_code == 422
    assert client.delete(f"/api/claims/{cid}", headers=h).status_code == 204


def test_full_workflow(client, auth, offline_evidence):
    h, user = auth
    inv = client.post("/api/investigations", json=BODY, headers=h).json()
    iid = inv["id"]
    worker.run_sync(iid, user["id"], "full")
    d = client.get(f"/api/investigations/{iid}", headers=h).json()
    assert d["status"] == "completed", d["error"]

    claims = client.get(f"/api/investigations/{iid}/claims", headers=h).json()
    metrics = {c["metric"] for c in claims["claims"] if c["is_success_criterion"]}
    assert {"cooling_c", "survival_rate", "water_stress_index"} <= metrics

    ev = client.get(f"/api/investigations/{iid}/evidence", headers=h).json()
    assert any(s["provider"] == "openalex" for s in ev["sources"])
    assert client.get(f"/api/investigations/{iid}/evidence/search", params={"q": "canopy temperature"}, headers=h).status_code == 200

    g = client.get(f"/api/investigations/{iid}/causal-graph", headers=h).json()
    assert len(g["graphs"]) == 2

    opt = client.get(f"/api/investigations/{iid}/optimisation", headers=h).json()
    assert {r["method_key"] for r in opt["runs"]} == {"mpfs", "random"}
    run = opt["runs"][0]
    evs = client.get(f"/api/optimisation/runs/{run['id']}/evaluations", headers=h).json()
    assert len(evs["evaluations"]) == run["evaluations"]  # every evaluation recorded

    cex = client.get(f"/api/investigations/{iid}/counterexamples", headers=h).json()
    assert cex and all(c["verification"] for c in cex)
    r = client.post(f"/api/counterexamples/{cex[0]['id']}/verify", headers=h)
    assert r.status_code == 200 and r.json()["verification"]["status"] != "rejected"

    sim = client.post(f"/api/investigations/{iid}/simulate", json={"parameters": {"warming_c": 3}}, headers=h).json()
    assert len(sim["series"]["et0_mm"]) == 12
    bm = client.post(f"/api/investigations/{iid}/boundary", json={"x": "warming_c", "y": "supply_reliability", "resolution": 10,
                                                                 "counterexample_id": cex[0]["id"]}, headers=h).json()
    assert len(bm["z"]) == 10
    alts = client.get(f"/api/investigations/{iid}/alternatives", headers=h).json()
    assert alts["alternatives"]["rows"][0]["key"] == "proposal"
    custom = client.post(f"/api/investigations/{iid}/alternatives",
                         json={"custom": [{"label": "Low water species", "changes": {"species_factor": 0.2}}]}, headers=h)
    assert custom.status_code == 200 and len(custom.json()["rows"]) == 2
    bad = client.post(f"/api/investigations/{iid}/alternatives",
                      json={"custom": [{"label": "Cheat", "changes": {"warming_c": 0}}]}, headers=h)
    assert bad.status_code == 422  # alternatives cannot change environmental conditions

    rep = client.get(f"/api/investigations/{iid}/report", headers=h).json()
    assert rep["certificate"]["investigation_id"] == iid
    assert rep["reproducibility"]["seed"] == 42
    pdf = client.get(f"/api/investigations/{iid}/report/pdf", headers=h)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    js = client.get(f"/api/investigations/{iid}/report/json", headers=h)
    assert js.status_code == 200 and "attachment" in js.headers["content-disposition"]

    events = client.get(f"/api/investigations/{iid}/events", headers=h).json()
    seqs = [e["seq"] for e in events]
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
    assert any(e["type"] == "failure_found" for e in events)

    stats = client.get("/api/stats/global", headers=h).json()
    assert stats["totals"]["investigations"] >= 1

    usage = client.get("/api/settings/usage", headers=h).json()
    assert usage["compute"]["model_evaluations"] > 0

    assert client.delete(f"/api/investigations/{iid}", headers=h).status_code == 204
    assert client.get(f"/api/investigations/{iid}", headers=h).status_code == 404


def test_settings_api_keys_encrypted(client, auth):
    from app.db import session_scope
    from app.models import ApiKey

    h, _ = auth
    r = client.post("/api/settings/api-keys", json={"provider": "anthropic", "api_key": "sk-ant-test-1234567890abcd"}, headers=h)
    assert r.status_code == 201 and r.json()["masked"].endswith("abcd")
    with session_scope() as db:
        k = db.get(ApiKey, uuid.UUID(r.json()["id"]))
        assert "sk-ant" not in k.encrypted_key
    s = client.get("/api/settings", headers=h).json()
    assert all("sk-ant" not in str(k) for k in s["api_keys"])


def test_websocket_ticket(client, auth):
    h, _ = auth
    inv = client.post("/api/investigations", json=BODY, headers=h).json()
    t = client.post("/api/ws-ticket", json={"investigation_id": inv["id"]}, headers=h).json()["ticket"]
    with client.websocket_connect(f"/api/ws/investigations/{inv['id']}?ticket={t}") as ws:
        from app.services.events import bus

        bus.emit(inv["id"], "orchestrator", "info", "hello")
        assert ws.receive_json()["message"] == "hello"


def test_scenario_draft_and_preview(client, auth, offline_evidence):
    h, _ = auth
    # an empty idea means "surprise me": a hypothetical proposal for a known city is invented
    r = client.post("/api/scenario/draft", json={"description": ""}, headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["invented"] and len(d["idea"]) > 40 and d["latitude"] is not None
    assert {o["metric"] for o in d["objectives"]} >= {"cooling_c", "survival_rate"}
    # the preview runs the real model for the site: the plan plus a labelled hotter-and-drier what-if
    r = client.post("/api/scenario/preview", headers=h, json={"title": d["title"], "location_name": d["location_name"],
                    "latitude": d["latitude"], "longitude": d["longitude"], "objectives": d["objectives"], "parameter_hints": d["parameter_hints"]})
    assert r.status_code == 200, r.text
    f = r.json()
    assert [s["key"] for s in f["scenes"]] == ["plan", "break"]
    assert f["biome"]["key"] in {"desert", "semi_arid", "mediterranean", "monsoon", "humid"}
    assert len(f["scenes"][0]["survival_by_year"]) == f["horizon_years"] + 1
    assert f["scenes"][1]["metrics"]["survival_rate"] <= f["scenes"][0]["metrics"]["survival_rate"] + 1e-9


def test_biome_classes():
    from app.api.assistant import biome_of
    from app.science.model import Climatology

    def clim(rain, tmax=None):
        return Climatology(tmax=tmax or [30.0] * 12, tmin=[18.0] * 12, rh=[50.0] * 12, precip_mm=rain, latitude=25.0)

    assert biome_of(clim([5.0] * 12))["key"] == "desert"
    assert biome_of(clim([80, 70, 60, 40, 20, 5, 1, 2, 15, 50, 80, 90], [14, 15, 18, 21, 26, 31, 34, 33, 28, 22, 17, 14]))["key"] == "mediterranean"
    assert biome_of(clim([10, 10, 10, 10, 30, 150, 250, 230, 120, 10, 5, 5], [21, 24, 30, 36, 40, 39, 35, 33, 33, 32, 28, 23]))["key"] == "monsoon"
    assert biome_of(clim([110.0] * 12))["key"] == "humid"


def test_ai_number_grounding():
    from app.api.assistant import stray_numbers

    facts = '{"failure_probability": 0.8481, "ci": [0.8293, 0.8654], "survival": 0.722, "samples": 1542, "years": 10}'
    # rounded values and percentages of fractions are traceable to the facts
    assert stray_numbers("Fails in 84.8% (95% CI 82.9–86.5%) of 1542 futures; 72% of trees survive over 10 years.", facts, {"95"}) == set()
    # invented numbers are caught, and 10 is not confused with 1
    assert stray_numbers("Streets end up 2.3 °C cooler and 99% survive.", facts) == {"2.3", "99"}
