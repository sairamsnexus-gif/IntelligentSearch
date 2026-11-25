"""Sidecar tests (no network, no LLM): job API, robots shim, quota mapping, paid-endpoint refusal."""
import asyncio
import importlib
import os
import time

os.environ.update({"FREELLMAPI_BASE_URL": "http://127.0.0.1:3001", "FREELLMAPI_API_KEY": "test", "SEARX_URL": "http://127.0.0.1:8080"})
import app as sidecar  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def wait(client, jid):
    for _ in range(100):
        j = client.get(f"/research/{jid}").json()
        if j["status"] not in ("queued", "running"):
            return j
        time.sleep(0.02)
    raise AssertionError("job did not finish")


def test_config_points_gptr_at_gateway_and_searx():
    assert sidecar.CONFIG_ERROR is None
    assert os.environ["OPENAI_BASE_URL"] == "http://127.0.0.1:3001/v1"
    assert os.environ["RETRIEVER"] == "searx"
    assert os.environ["FAST_LLM"].startswith("openai:")


def test_paid_endpoint_refused(monkeypatch):
    monkeypatch.setenv("FREELLMAPI_BASE_URL", "https://api.openai.com")
    assert "commercial" in sidecar.configure_env()
    monkeypatch.setenv("FREELLMAPI_BASE_URL", "http://127.0.0.1:3001")
    assert sidecar.configure_env() is None


def test_job_roundtrip_and_failed_reporting():
    async def fake(query, max_sources):
        sidecar._failed.get().append({"url": "https://www.instagram.com/x", "reason": "sign-in walled platform — not accessed"})
        return {"report": f"notes for {query}", "sources": [{"url": "https://a.example/", "title": "A", "excerpt": "x"}], "queries": [query], "llm_calls": 3}

    sidecar.RUNNER = fake
    with TestClient(sidecar.app) as c:
        jid = c.post("/research", json={"query": "Little Lotus Montessori Chennai"}).json()["job_id"]
        j = wait(c, jid)
        assert j["status"] == "done"
        assert j["sources"][0]["url"] == "https://a.example/"
        assert j["failed"][0]["reason"].startswith("sign-in")
        assert j["llm_calls"] == 3
        assert c.get("/research/nope").status_code == 404


def test_quota_maps_to_quota_status_without_fallback():
    async def boom(query, max_sources):
        raise RuntimeError("Error code: 429 - All models exhausted")

    sidecar.RUNNER = boom
    with TestClient(sidecar.app) as c:
        jid = c.post("/research", json={"query": "x query"}).json()["job_id"]
        j = wait(c, jid)
        assert j["status"] == "quota"
        assert "no paid fallback" in j["error"]


def test_llm_budget_exhausted_is_429():
    with TestClient(sidecar.app) as c:
        assert c.post("/research", json={"query": "abc", "allow_llm": False}).status_code == 429


def test_robots_shim(monkeypatch):
    class R:
        def __init__(self, code, text=""):
            self.status_code, self.text = code, text

    monkeypatch.setattr(sidecar.httpx, "get", lambda url, **kw: R(200, "User-agent: *\nDisallow: /private\n"))
    sidecar._robots.clear()
    assert sidecar.robots_allowed("https://site.example/public")[0] is True
    assert sidecar.robots_allowed("https://site.example/private/x") == (False, "robots.txt disallows — not fetched")
    assert sidecar.robots_allowed("https://www.linkedin.com/in/x")[0] is False
    monkeypatch.setattr(sidecar.httpx, "get", lambda url, **kw: R(503))
    sidecar._robots.clear()
    assert sidecar.robots_allowed("https://down.example/a")[0] is False


def test_shim_installs_on_real_gpt_researcher():
    try:
        importlib.import_module("gpt_researcher.scraper.scraper")
    except Exception:  # library not installed in this environment
        return
    sidecar.install_robots_shim()
    from gpt_researcher.scraper.scraper import Scraper

    assert getattr(Scraper, "_nexus_shim", False) is True
    # A disallowed URL is rejected before any scraper runs.
    sidecar._robots.clear()
    sidecar._robots["https://blocked.example"] = (time.time(), None)
    failed = []
    tok = sidecar._failed.set(failed)
    try:
        out = asyncio.run(Scraper.extract_data_from_url(object.__new__(Scraper), "https://blocked.example/page", None))
    finally:
        sidecar._failed.reset(tok)
    assert out["raw_content"] is None and failed[0]["url"] == "https://blocked.example/page"
