"""
NEXUS GPT Researcher sidecar (operator / local mode only).

Wraps the upstream GPT Researcher library (Apache-2.0,
https://github.com/assafelovic/gpt-researcher) behind a tiny job API that the
NEXUS orchestrator polls:

    POST /research          {"query": str, "max_sources": int, "allow_llm": bool} -> {"job_id"}
    GET  /research/{job_id} -> {"status", "report", "sources", "failed", "queries", "llm_calls", "error"}
    GET  /health

Compliance shims applied on top of the unmodified library:
  * robots.txt is checked before every page GPT Researcher scrapes; disallowed
    or login-walled pages are rejected and reported in "failed";
  * the only LLM endpoint is the operator's FreeLLMAPI gateway
    (OPENAI_BASE_URL + OPENAI_API_KEY = gateway URL + unified key);
    commercial endpoints are refused at start-up;
  * a provider rate limit (HTTP 429/402) ends the job with status "quota" —
    there is no fallback to another provider;
  * retrieval goes through the operator's SearXNG (RETRIEVER=searx).
"""
from __future__ import annotations

import asyncio
import contextvars
import os
import re
import time
import uuid
from typing import Any
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

UA = "NEXUSBot/1.0 (+public-source research; respects robots.txt)"
PAID_HOSTS = re.compile(
    r"(^|\.)(api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai|api\.groq\.com|"
    r"api\.together\.xyz|api\.fireworks\.ai|api\.deepseek\.com|api\.cohere\.(ai|com)|openrouter\.ai|openai\.azure\.com|api\.x\.ai|api\.perplexity\.ai)$",
    re.I,
)
LOGIN_WALLED = re.compile(r"(^|\.)(linkedin\.com|instagram\.com|facebook\.com|fb\.com|x\.com|twitter\.com|threads\.net|tiktok\.com)$", re.I)
MAX_JOBS = 50
JOB_TIMEOUT = int(os.getenv("NEXUS_GPTR_JOB_TIMEOUT", "600"))

# --------------------------------------------------------------------------- configuration


def configure_env() -> str | None:
    """Point GPT Researcher at SearXNG + the FreeLLMAPI gateway. Returns an error string if misconfigured."""
    gw = os.getenv("FREELLMAPI_BASE_URL", "").rstrip("/")
    key = os.getenv("FREELLMAPI_API_KEY", "")
    model = os.getenv("FREELLMAPI_MODEL", "auto")
    if not gw or not key:
        return "FREELLMAPI_BASE_URL / FREELLMAPI_API_KEY not set"
    host = urlparse(gw).hostname or ""
    if PAID_HOSTS.search(host):
        return f"Refused: {host} is a commercial LLM endpoint (zero-cost policy)"
    if not os.getenv("SEARX_URL"):
        return "SEARX_URL not set"
    os.environ["OPENAI_BASE_URL"] = f"{gw}/v1"
    os.environ["OPENAI_API_KEY"] = key
    for k in ("FAST_LLM", "SMART_LLM", "STRATEGIC_LLM"):
        os.environ[k] = f"openai:{model}"
    os.environ.setdefault("EMBEDDING", os.getenv("NEXUS_GPTR_EMBEDDING", "custom:auto"))
    os.environ["RETRIEVER"] = "searx"
    os.environ.setdefault("SCRAPER", "bs")
    os.environ.setdefault("MAX_SEARCH_RESULTS_PER_QUERY", "5")
    os.environ.setdefault("MAX_ITERATIONS", "2")
    os.environ.setdefault("SCRAPER_RATE_LIMIT_DELAY", "1.0")
    os.environ.setdefault("USER_AGENT", UA)
    return None


CONFIG_ERROR = configure_env()

# --------------------------------------------------------------------------- robots.txt shim

_robots: dict[str, tuple[float, RobotFileParser | None]] = {}
_failed: contextvars.ContextVar[list[dict[str, str]] | None] = contextvars.ContextVar("failed", default=None)


def robots_allowed(url: str) -> tuple[bool, str]:
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        return False, "unsupported URL"
    if LOGIN_WALLED.search(p.hostname.removeprefix("www.")):
        return False, "sign-in walled platform — not accessed"
    origin = f"{p.scheme}://{p.netloc}"
    hit = _robots.get(origin)
    if not hit or time.time() - hit[0] > 12 * 3600:
        rp: RobotFileParser | None = RobotFileParser()
        try:
            r = httpx.get(f"{origin}/robots.txt", headers={"User-Agent": UA}, timeout=6, follow_redirects=True)
            if r.status_code >= 500:
                rp = None  # RFC 9309: server error -> assume complete disallow
            elif r.status_code >= 400:
                rp.parse([])  # 4xx -> allow all
            else:
                rp.parse(r.text.splitlines())
        except Exception:
            rp.parse([])
        _robots[origin] = (time.time(), rp)
        hit = _robots[origin]
    rp = hit[1]
    if rp is None:
        return False, "robots.txt unavailable (server error) — treated as disallow"
    return (True, "") if rp.can_fetch("NEXUSBot", url) else (False, "robots.txt disallows — not fetched")


def install_robots_shim() -> None:
    from gpt_researcher.scraper.scraper import Scraper  # imported lazily: heavy

    if getattr(Scraper, "_nexus_shim", False):
        return
    original = Scraper.extract_data_from_url

    async def guarded(self, link, session):  # type: ignore[no-untyped-def]
        ok, why = await asyncio.get_running_loop().run_in_executor(None, robots_allowed, link)
        if not ok:
            lst = _failed.get()
            if lst is not None:
                lst.append({"url": link, "reason": why})
            return {"url": link, "raw_content": None, "image_urls": [], "title": "", "failure_reason": why}
        out = await original(self, link, session)
        if out.get("raw_content") is None:
            lst = _failed.get()
            if lst is not None:
                lst.append({"url": link, "reason": str(out.get("failure_reason") or "fetch failed")})
        return out

    Scraper.extract_data_from_url = guarded  # type: ignore[method-assign]
    Scraper._nexus_shim = True  # type: ignore[attr-defined]


# --------------------------------------------------------------------------- jobs

class ResearchIn(BaseModel):
    query: str = Field(min_length=3, max_length=500)
    max_sources: int = Field(default=8, ge=1, le=20)
    allow_llm: bool = True


jobs: dict[str, dict[str, Any]] = {}
gate = asyncio.Semaphore(int(os.getenv("NEXUS_GPTR_CONCURRENCY", "1")))


def is_quota_error(e: BaseException) -> bool:
    s = f"{type(e).__name__} {e}".lower()
    return any(x in s for x in ("429", "rate limit", "ratelimit", "quota", "402", "payment required", "all models exhausted"))


async def default_runner(query: str, max_sources: int) -> dict[str, Any]:
    """Run upstream GPT Researcher and return report + sources."""
    from gpt_researcher import GPTResearcher

    install_robots_shim()
    researcher = GPTResearcher(query=query, report_type="research_report", verbose=False)
    await researcher.conduct_research()
    report = await researcher.write_report()
    sources = []
    for s in researcher.get_research_sources()[:max_sources]:
        sources.append({"url": s.get("url", ""), "title": s.get("title", ""), "excerpt": (s.get("content") or "")[:600]})
    if not sources:
        sources = [{"url": u, "title": u, "excerpt": ""} for u in list(researcher.visited_urls)[:max_sources]]
    calls = 0
    try:
        calls = int(getattr(researcher, "llm_calls", 0) or 0)
    except Exception:
        calls = 0
    return {"report": report, "sources": sources, "queries": list(getattr(researcher, "research_queries", []) or [])[:20], "llm_calls": calls}


RUNNER = default_runner  # tests replace this with a fake


async def run_job(job_id: str, body: ResearchIn) -> None:
    job = jobs[job_id]
    failed: list[dict[str, str]] = []
    token = _failed.set(failed)
    try:
        async with gate:
            job["status"] = "running"
            out = await asyncio.wait_for(RUNNER(body.query, body.max_sources), timeout=JOB_TIMEOUT)
        job.update(status="done", report=out.get("report", "")[:20000], sources=out.get("sources", []), queries=out.get("queries", []), llm_calls=out.get("llm_calls", 0))
    except asyncio.TimeoutError:
        job.update(status="failed", error=f"Research exceeded {JOB_TIMEOUT}s")
    except Exception as e:  # noqa: BLE001
        if is_quota_error(e):
            job.update(status="quota", error="Free LLM provider limit reached via FreeLLMAPI — stopped (no paid fallback)", retry_after=3600)
        else:
            job.update(status="failed", error=f"{type(e).__name__}: {str(e)[:300]}")
    finally:
        job["failed"] = failed[:50]
        job["finished_at"] = time.time()
        _failed.reset(token)


app = FastAPI(title="NEXUS GPT Researcher sidecar", docs_url=None, redoc_url=None)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": CONFIG_ERROR is None, "error": CONFIG_ERROR, "jobs": len(jobs)}


@app.post("/research")
async def start(body: ResearchIn) -> dict[str, str]:
    if CONFIG_ERROR:
        raise HTTPException(503, CONFIG_ERROR)
    if not body.allow_llm:
        raise HTTPException(429, "LLM budget for this investigation is exhausted or disabled; GPT Researcher needs the LLM gateway")
    if len(jobs) >= MAX_JOBS:
        for k in sorted(jobs, key=lambda k: jobs[k].get("created", 0))[: len(jobs) - MAX_JOBS + 1]:
            if jobs[k]["status"] not in ("queued", "running"):
                jobs.pop(k, None)
    job_id = uuid.uuid4().hex
    jobs[job_id] = {"status": "queued", "created": time.time(), "query": body.query}
    asyncio.create_task(run_job(job_id, body))
    return {"job_id": job_id}


@app.get("/research/{job_id}")
async def status(job_id: str) -> dict[str, Any]:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job")
    return {k: v for k, v in job.items() if k not in ("created", "finished_at")}
