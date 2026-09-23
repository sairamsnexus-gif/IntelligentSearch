# API configuration

1. `cp .env.example .env`
2. Fill in only what you have. Restart the app after editing `.env`.
3. Check **Admin → Providers & health → Check health**.

Never paste keys into chats, tickets or the UI. `.env` is git-ignored and read only on the server.

## Providers

| Variable(s) | Provider | Cost | How to get it | Notes |
|---|---|---|---|---|
| `SEARXNG_URL` | SearXNG | free (self-hosted) | `docker compose up -d searxng` → `http://localhost:8080` | JSON output must be enabled (already in `deploy/searxng/settings.yml`) |
| `BRAVE_SEARCH_API_KEY` | Brave Search API | free tier | api-dashboard.search.brave.com | web + news |
| `SERPER_API_KEY` | Serper.dev | trial credits | serper.dev | web, news, images |
| `TAVILY_API_KEY` | Tavily | free tier | app.tavily.com | returns page content |
| `SEARCH_API_URL`, `SCRAPER_API_URL` | DeepSearch services | self-run | run upstream `search.py` (port 8081) / `scraper.py` (port 8082) | e.g. `http://localhost:8081/search`, `http://localhost:8082/scrape` |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT` | Reddit API | free | reddit.com/prefs/apps → “script” app | client-credentials OAuth, read-only public data; no user passwords |
| `GITHUB_TOKEN` | GitHub REST | free | fine-grained token with **no** scopes | optional; raises rate limit from 60 to 5,000/h |
| `YOUTUBE_API_KEY` | YouTube Data API v3 | free quota | Google Cloud console → enable YouTube Data API | channel search |
| `MAIGRET_SERVICE_URL` | Maigret sidecar | free | `docker compose up -d osint-python` → `http://localhost:8090` | or `pip install -r services/osint-python/requirements.txt && uvicorn app:app --port 8090` |
| `CHANGEDETECTION_URL`, `CHANGEDETECTION_API_KEY` | changedetection.io | free (self-hosted) | `docker compose --profile changedetection up -d` → Settings → API | optional external page watcher |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Google Gemini | free tier | aistudio.google.com | extraction only; outputs grounded in source text |

## Application settings

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
