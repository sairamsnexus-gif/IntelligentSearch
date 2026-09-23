# Architecture

## Overview

```
Browser (Next.js client components, polling)
   │  JSON over /api/* (session cookie, same-origin, rate-limited, zod-validated)
   ▼
Next.js 16 server (App Router, Node runtime)
   ├─ API layer          src/app/api/**            → api() wrapper: auth, RBAC, CSRF origin check, rate limit, errors
   ├─ Services           src/lib/services/**       → discovery, persons (lock/enrich), monitoring, jobs
   ├─ Core (pure)        src/lib/core/**           → planner, extraction, resolution, change detection, scheduling
   ├─ Adapters           src/lib/adapters/**       → one interface, many sources (+ demo)
   └─ Data               src/lib/db/**             → Drizzle ORM → PostgreSQL | PGlite (embedded)
            ▲
Job worker (in-process in dev, `npm run worker` in prod)
   └─ Postgres-backed queue (jobs table, FOR UPDATE SKIP LOCKED) + scheduler tick every 30 s
            │
External (optional): SearXNG · Brave · Serper · Tavily · DeepSearch · GitHub · Reddit · YouTube ·
                     Google News RSS · Maigret sidecar (Python/FastAPI) · changedetection.io · Gemini
```

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| Language split | TypeScript for app/engine; Python only where the mature OSS is Python (Maigret) | One typed codebase for the core; Python behind HTTP so it can scale/fail independently |
| Database | PostgreSQL via Drizzle; PGlite when `DATABASE_URL` is empty | Same SQL + migrations everywhere; zero-config local dev and tests |
| Queue | Postgres `jobs` table with `SKIP LOCKED` | No Redis dependency; durable; works on PGlite and Postgres |
| Long work | Background jobs; UI polls session/person views | The browser never blocks on a 50-query search |
| AI | Optional Gemini for extraction only; outputs grounded in source text | Identity is decided by explainable rules + a human, never by a model score |
| Auth | scrypt + HMAC-signed cookie, roles admin/analyst, first-run setup | Small, dependency-free, secure defaults |
| UI kit | Tailwind v4 + shadcn/ui-style primitives (cva + tailwind-merge) written in-repo | shadcn is copy-in by design; no Radix runtime needed for the few primitives used |

## Core flow

1. **Input** (`core/input.ts`) → zod-validated `PersonQuery` → `TargetProfile` (canonical orgs/cities, normalised handles, E.164 phones). Free text is mined by `core/freetext.ts` (+ Gemini when configured).
2. **Planning** (`core/planner.ts`) → tiered, de-duplicated `PlannedQuery[]` routed to channels (web, news, github, reddit, youtube, username, images).
3. **Execution** (`services/executor.ts`) → per-channel adapter selection, cache (6 h), failures recorded per adapter, every query persisted (including skipped ones and why).
4. **Normalisation** → adapters return canonical `SearchResult`.
5. **Resolution** (`core/resolution.ts`) → candidates with per-attribute evidence, conflicts, corroboration, ambiguity assessment, refinement suggestions and discovered attributes.
6. **Iteration** → discovered attributes become tier-10 queries; repeat up to `MAX_DISCOVERY_ITERATIONS`, stop early when nothing new appears.
7. **Human confirmation** → `POST /api/persons { confirm: true }` → `lockPerson` (transaction) creates person, attributes (with states), identifiers, sources, evidence, timeline, monitoring job; then a **baseline** job.
8. **Monitoring** → scheduled/manual `monitor_scan` jobs (see MONITORING.md).

## Data model (see `src/lib/db/schema.ts`)

```
users
search_sessions ─┬─ search_iterations ── search_queries ── search_results
                 └─ candidates
persons ─┬─ person_attributes     (confirmed | user_supplied | system_discovered | unverified)
         ├─ person_identifiers
         ├─ person_sources ── snapshots ── changes ── alerts
         ├─ evidence
         ├─ timeline_events
         └─ monitoring_jobs
source_adapters (enable/disable, last health)   jobs (queue)   audit_log   app_state
```

## UI states

| # | State | Where |
|---|---|---|
| 1 | Empty search | Console, no `?s=` |
| 2 | Search in progress | Progress panel (scan line, per-category counters) |
| 3 | Discovery results | Candidates + graph + summary |
| 4 | Identity resolution | Progress phase `resolving` |
| 5 | Ask for more information | Refine box with discriminating suggestions |
| 6 | Person selected | Confirm dialog (warnings for conflicts/ties) |
| 7 | Person locked | Redirect to Monitor mode |
| 8 | Monitoring active | Person header / Monitoring tab |
| 9 | New information | 🔴 NEW changes, alerts |
| 10 | Changed information | 🟡 CHANGED with OLD/NEW and diff |
| 11 | Error / source unavailable | Failed queries in history, coverage UNAVAILABLE, session error |
