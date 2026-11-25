# Configuration (environment variables)

1. `cp .env.example .env` (never commit `.env`; it is git-ignored).
2. Fill in only what you have, then restart the app.
3. Check the **Engines** panel in NEXUS, or **Admin → Providers & health** for the legacy console.

All values are read server-side only (`src/lib/config/env.ts`, `server-only`). They never reach the browser or investigation files. NEXUS follows the [zero-cost policy](NO_PAID_FALLBACK.md).

## NEXUS

| Variable | Default | Meaning |
|---|---|---|
| `FREELLMAPI_BASE_URL` | – | Your FreeLLMAPI gateway (e.g. `http://127.0.0.1:3001`). Commercial LLM endpoints are refused |
| `FREELLMAPI_API_KEY` | – | FreeLLMAPI unified key (server-side only) |
| `FREELLMAPI_MODEL` | `auto` | Model requested from the gateway |
| `FREELLMAPI_MODEL_ALLOWLIST` | `auto` | Comma-separated models NEXUS may request |
| `NEXUS_LLM_DAILY_CALL_CAP` | 200 | Hard daily LLM call cap per server process |
| `NEXUS_LLM_MAX_TOKENS` | 1500 | Max tokens per LLM call |
| `SEARXNG_URL` | – | SearXNG instance (JSON output enabled) |
| `GPTR_SERVICE_URL` | – | GPT Researcher sidecar (`services/gpt-researcher-sidecar`, port 8095) |
| `SPIDERFOOT_URL` | – | SpiderFoot web/API (port 5001, localhost only) |
| `MAIGRET_SERVICE_URL` | – | Maigret sidecar (`services/osint-python`, port 8090) |
| `NEXUS_SYNTHETIC` | `auto` | Synthetic demo world: `auto` (offered when no discovery service is configured), `true`, `false` |
| `NEXUS_HOSTED` | – | `true` for hosted (no-database) mode; implied when `NETLIFY` is set. `false` overrides |
| `NEXUS_OPERATOR_EMAIL`, `NEXUS_OPERATOR_PASSWORD_HASH` | – | Hosted-mode operator login (hash from `npm run hash-password`) |
| `AUTH_SECRET` | – | Session signing secret (`openssl rand -hex 32`); required in production and hosted mode |

GPT Researcher sidecar variables (set on the sidecar container): `SEARX_URL`, `FREELLMAPI_BASE_URL`, `FREELLMAPI_API_KEY`, `FREELLMAPI_MODEL`, `NEXUS_GPTR_EMBEDDING` (default `custom:auto`), `NEXUS_GPTR_JOB_TIMEOUT` (600 s), `NEXUS_GPTR_CONCURRENCY` (1).

## Legacy person-search console (operator mode)

### Providers

| Variable(s) | Provider | Cost | How to get it | Notes |
|---|---|---|---|---|
| `SEARXNG_URL` | SearXNG | free (self-hosted) | `docker compose up -d searxng` → `http://localhost:8080` | JSON output must be enabled (already in `deploy/searxng/settings.yml`) |
| `BRAVE_SEARCH_API_KEY`, `SERPER_API_KEY`, `TAVILY_API_KEY` | Brave / Serper / Tavily | — | — | **Excluded** under the zero-cost policy; ignored even if set |
| `SEARCH_API_URL`, `SCRAPER_API_URL` | DeepSearch services | self-run | run upstream `search.py` (port 8081) / `scraper.py` (port 8082) | e.g. `http://localhost:8081/search`, `http://localhost:8082/scrape` |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT` | Reddit API | free | reddit.com/prefs/apps → “script” app | client-credentials OAuth, read-only public data; no user passwords |
| `GITHUB_TOKEN` | GitHub REST | free | fine-grained token with **no** scopes | optional; raises rate limit from 60 to 5,000/h |
| `YOUTUBE_API_KEY` | YouTube Data API v3 | free quota | Google Cloud console → enable YouTube Data API | channel search |
| `MAIGRET_SERVICE_URL` | Maigret sidecar | free | `docker compose up -d osint-python` → `http://localhost:8090` | or `pip install -r services/osint-python/requirements.txt && uvicorn app:app --port 8090` |
| `CHANGEDETECTION_URL`, `CHANGEDETECTION_API_KEY` | changedetection.io | free (self-hosted) | `docker compose --profile changedetection up -d` → Settings → API | optional external page watcher |

### Application settings

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | empty | Postgres URL; empty → embedded PGlite at `PGLITE_DATA_DIR` (`./.data/pglite`) |
| `MONITOR_INTERVAL_HOURS` | 24 | default scan interval (1–720) |
| `MAX_DISCOVERY_ITERATIONS` | 3 | discovery rounds (1–6) |
| `MAX_QUERIES_PER_ITERATION` | 40 | query budget per round |
| `SEARCH_CONCURRENCY` | 4 | parallel queries |
| `DEMO_MODE` | auto | `auto` / `true` / `false` |
| `AUTH_SECRET` | – | session signing secret (required in production) |
| `RUN_WORKER_IN_PROCESS` | true | set `false` when running `npm run worker` separately |
| `APP_ENV` | development | `production` enforces `AUTH_SECRET` |

Missing or invalid optional keys never crash the app: the adapter reports `not_configured`/`unavailable`, the planner marks its channel unavailable, and coverage shows it honestly.
