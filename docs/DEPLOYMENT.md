# Deployment

NEXUS has two run modes.

| | **Operator mode (local)** | **Hosted mode (Netlify free tier)** |
|---|---|---|
| Who | You, on your own machine or private server | You, from anywhere (single operator login) |
| Engines | All five (Page Investigator, SearXNG, GPT Researcher, SpiderFoot, Maigret) + FreeLLMAPI | Page Investigator. SearXNG/FreeLLMAPI only if *publicly* reachable. GPT Researcher, SpiderFoot and Maigret show as **unavailable** |
| Storage | Browser IndexedDB + JSON files (+ local DB for the legacy console) | Browser IndexedDB + JSON files. **No database** |
| Login | Local account created at first run (`/setup`) | `NEXUS_OPERATOR_EMAIL` + `NEXUS_OPERATOR_PASSWORD_HASH` env vars |
| Legacy console / monitor | Available | Disabled (redirects home; APIs return 404) |
| Synthetic demo world | Available | Available |

## Operator mode (recommended for real investigations)

```bash
cp .env.example .env              # never commit .env
npm install
npm run dev                       # http://localhost:3000 → /setup creates your account
```

Add engines as you need them. Every port is bound to `127.0.0.1`:

```bash
docker compose up -d searxng osint-python               # SEARXNG_URL=http://localhost:8080  MAIGRET_SERVICE_URL=http://localhost:8090
docker compose --profile engines up -d                  # GPTR_SERVICE_URL=http://localhost:8095  SPIDERFOOT_URL=http://localhost:5001
export FREELLMAPI_ENCRYPTION_KEY=$(openssl rand -hex 32)
docker compose --profile llm up -d freellmapi           # then follow docs/FREE_PROVIDER_SETUP.md
```

SearXNG must allow JSON output (`deploy/searxng/settings.yml` already sets `formats: [html, json]`). In SpiderFoot's settings, set `sfp_spider` → *robotsonly* = True. Without it, NEXUS leaves the spider module out.

Production on a private VM: `npm run build && npm start` (or `docker compose --profile app up -d --build`) behind an HTTPS reverse proxy, with `AUTH_SECRET` and `APP_ENV=production` set.

## Hosted mode on Netlify (free tier)

> **Status:** configuration is included and hosted mode was tested locally (`NEXUS_HOSTED=true`: operator login, engines endpoint, synthetic execution, legacy routes disabled, no database touched). **An actual Netlify deployment has not been verified.** The build environment had no Netlify account or token, and pushing to the repository was blocked.

1. Generate the operator password hash locally:
   ```bash
   npm run hash-password            # prints scrypt$…  (the password itself is never stored)
   ```
2. In Netlify → *Add new site → Import from Git*, select the repository. `netlify.toml` sets the build command, `NEXUS_HOSTED=true` and `RUN_WORKER_IN_PROCESS=false`. Netlify's Next.js runtime is detected automatically.
3. Set these site environment variables (*Site configuration → Environment variables*), marked as secret:
   - `AUTH_SECRET` (`openssl rand -hex 32`)
   - `NEXUS_OPERATOR_EMAIL`
   - `NEXUS_OPERATOR_PASSWORD_HASH`
   - Optional: `SEARXNG_URL` (a SearXNG you run that is publicly reachable over HTTPS; protect it with your own access controls).
   - Optional: `FREELLMAPI_BASE_URL` + `FREELLMAPI_API_KEY`. Only if your gateway is reachable over HTTPS **and** you accept that the hosted app (behind your operator login) uses your unified key server-side. The key is never sent to the browser. **Never** make the gateway's dashboard public, and never share the unified key.
4. Deploy, open the site, and sign in.

Why it fits the free tier: each function invocation runs one short unit task (one search, one page fetch ≤ 12 s, one job poll). The browser runs the rounds, so there are no long-running or background functions, no scheduled functions and no database.

## Phase 2 (not implemented)

Continuous monitoring of investigations, cloud sync, multi-user sharing and a cloud database (e.g. Supabase) are out of scope for Phase 1.

## Legacy console deployment

The previous person-search console (`/person-search`, `/monitor`, `/admin`) still runs in operator mode with embedded PGlite or Postgres. Its worker and deployment options are unchanged: run `npm run worker` as a separate process with Postgres, or keep the in-process worker with PGlite. See the earlier sections of [ARCHITECTURE.md](ARCHITECTURE.md).
