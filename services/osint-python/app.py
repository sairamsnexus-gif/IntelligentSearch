"""
IntelligentSearch OSINT sidecar — wraps the Maigret library (MIT) behind a
tiny HTTP API so the TypeScript app can call it (MAIGRET_SERVICE_URL).

Endpoints
  GET  /health            → {"ok": true, "maigret": "<version>", "sites": <n>}
  POST /username          → {"username": str, "found": [{site, url, tags, ids}]}

Safety
  * Public profile existence checks only (no login, no private data).
  * NSFW/dating sites excluded; top-N ranked sites only; bounded timeouts.
  * Usernames validated; results are *signals*, not identity proof.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from importlib.metadata import version

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from maigret import search as maigret_search
from maigret.sites import MaigretDatabase

logging.basicConfig(level=logging.WARNING)
log = logging.getLogger("osint-sidecar")

DB_PATH = os.path.join(os.path.dirname(__import__("maigret").__file__), "resources", "data.json")
DB = MaigretDatabase().load_from_path(DB_PATH)
EXCLUDED_TAGS = ["nsfw", "dating", "porn", "adult"]
MAX_TOP = int(os.getenv("MAIGRET_MAX_TOP_SITES", "500"))
TIMEOUT = int(os.getenv("MAIGRET_TIMEOUT", "15"))
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{2,60}$")
_lock = asyncio.Semaphore(int(os.getenv("MAIGRET_CONCURRENT_SEARCHES", "2")))

app = FastAPI(title="IntelligentSearch OSINT sidecar", version="1.0.0")


class UsernameRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=60)
    top_sites: int = Field(500, ge=10, le=3000)


@app.get("/health")
def health():
    return {"ok": True, "maigret": version("maigret"), "sites": len(DB.sites)}


@app.post("/username")
async def username(req: UsernameRequest):
    if not USERNAME_RE.match(req.username):
        raise HTTPException(status_code=400, detail="Invalid username")
    sites = DB.ranked_sites_dict(top=min(req.top_sites, MAX_TOP), excluded_tags=EXCLUDED_TAGS)
    async with _lock:
        results = await maigret_search(
            username=req.username,
            site_dict=sites,
            logger=log,
            timeout=TIMEOUT,
            is_parsing_enabled=True,
            no_progressbar=True,
            max_connections=50,
        )
    found = []
    for site_name, r in results.items():
        status = r.get("status")
        if status is None or not status.is_found():
            continue
        ids = {k: str(v) for k, v in (r.get("ids_data") or {}).items() if isinstance(v, (str, int, float))}
        found.append({"site": site_name, "url": r.get("url_user"), "tags": list(getattr(status, "tags", []) or []), "ids": ids})
    return {"username": req.username, "found": found}
