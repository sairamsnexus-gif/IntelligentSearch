# Deployment

## Local development (default)

```bash
cp .env.example .env
npm install
npm run dev
```

Embedded Postgres (PGlite) + in-process worker + demo mode — no services needed. Optional real providers:

```bash
docker compose up -d searxng osint-python     # SEARXNG_URL=http://localhost:8080, MAIGRET_SERVICE_URL=http://localhost:8090
docker compose up -d postgres                 # DATABASE_URL=postgres://intelligentsearch:intelligentsearch@localhost:5432/intelligentsearch
```

> PGlite is single-process: with PGlite, keep `RUN_WORKER_IN_PROCESS=true`. The standalone worker requires Postgres.

## Option A — everything in Docker (single host / VM)

```bash
cp .env.example .env            # set AUTH_SECRET, APP_ENV=production, provider keys
docker compose --profile app up -d --build
# app → http://127.0.0.1:3000 (put a TLS reverse proxy such as Caddy/nginx in front)
```

Services: `postgres`, `searxng`, `osint-python` (Maigret), `app` (Next.js, `RUN_WORKER_IN_PROCESS=false`), `worker` (`npm run worker`), optional `changedetection` profile. Migrations run automatically on startup.

## Option B — Vercel + managed Postgres + worker container

Vercel serverless functions are not a scheduler or a long-running worker, so split the roles:

| Component | Where | Settings |
|---|---|---|
| Web app (UI + API) | Vercel | `DATABASE_URL` (Supabase/Neon pooled URL), `AUTH_SECRET`, `APP_ENV=production`, `RUN_WORKER_IN_PROCESS=false`, provider keys |
| Worker + scheduler | Any container host (Fly.io, Railway, Render, ECS, a VM) running this repo’s `Dockerfile` with `npm run worker` | same env as the app |
| SearXNG / Maigret sidecar | Same private network as the worker (or a VM) | referenced via `SEARXNG_URL`, `MAIGRET_SERVICE_URL` |
| Postgres | Supabase / Neon / RDS | the queue uses `FOR UPDATE SKIP LOCKED` — use a direct (session) connection for the worker |

Notes:
- API routes only **enqueue** work; the worker executes searches, baselines and scans, so request latency stays low.
- The worker writes a heartbeat to `app_state`; the header shows **WORKER ONLINE** when it is < 90 s old.
- Scale workers horizontally — job claiming is concurrency-safe.

## Option C — single Node process

`npm run build && npm start` with `RUN_WORKER_IN_PROCESS=true` (the default) runs web + worker + scheduler in one process. Suitable for a small internal deployment on a VM.

## Upgrades & migrations

- Edit `src/lib/db/schema.ts` → `npm run db:generate` → commit the new file in `drizzle/`.
- Migrations are applied automatically on first DB access by the app and the worker.

## Backups

Back up Postgres (`pg_dump`). With PGlite, back up `./.data/pglite` while the app is stopped.
