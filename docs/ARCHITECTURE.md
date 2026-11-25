# Architecture

## NEXUS (multi-engine investigation workspace, `/`)

```
Browser — NEXUS workspace (React, src/components/nexus)
 ├─ InvestigationRunner (src/lib/nexus/orchestrator.ts)   rounds · per-engine concurrency · cross-engine lead routing · checkpoints
 ├─ Evidence ledger    (src/lib/nexus/ledger.ts)          sources · passages · entities · relationships · claims · contacts · leads · trail
 ├─ Analysis           (src/lib/nexus/analysis.ts)        possible matches · coverage/reconciliation (derived, never stored as fact)
 ├─ Investigation JSON (src/lib/nexus/schema.ts, io.ts)   zod schema v1 · export · import · migrations · integrity
 └─ IndexedDB autosave (src/components/nexus/storage.ts)  recovery banner · unsaved indicator
        │ one unit task per call:  POST /api/nexus/execute   (auth · same-origin · rate limit · zod)
        ▼
Next.js server (stateless, src/lib/nexus/engines.ts)
 ├─ Page Investigator   SSRF-safe fetch → robots.txt → sign-in-wall check → extract.ts (+ quote-verified FreeLLMAPI facts)
 ├─ SearXNG             /search?format=json
 ├─ GPT Researcher      sidecar job: POST /research → GET /research/{id}
 ├─ SpiderFoot          /startscan (free-module allowlist) → /scanstatus → /scaneventresults
 ├─ Maigret             sidecar /username
 └─ FreeLLMAPI client   (freellmapi.ts) the only LLM path · caps · 429/402 → quota stop · no fallback
        │
Operator services (local, 127.0.0.1): SearXNG · GPT Researcher sidecar · SpiderFoot · Maigret sidecar · FreeLLMAPI
Synthetic world (src/lib/nexus/synthetic*.ts): fictional *.example pages run through the same extraction/ledger code
```

Design decisions:

| Decision | Choice | Why |
|---|---|---|
| Where orchestration runs | In the browser, calling a stateless per-task endpoint | Fits serverless free tiers (no long functions or background jobs). The investigation data stays with the user |
| Persistence | JSON-first (versioned schema), IndexedDB autosave, explicit export/import | No cloud database in Phase 1; files are portable and auditable |
| Identity | Scoped entity keys (name + organisation / source); user confirm or reject | Never merge on name alone |
| Evidence | Every relationship and claim points at a verbatim passage on a source | Reviewable; verification states are computed, not asserted |
| LLM | FreeLLMAPI only; assists extraction with quote verification | Zero-cost and anti-hallucination; the model never decides identity |
| Engines | Separate services behind adapters; per-engine failure isolation | Licence boundaries (AGPL SearXNG) and resilience |

Details: [ENGINES.md](ENGINES.md) · [INVESTIGATION_JSON.md](INVESTIGATION_JSON.md) · [OPEN_SOURCE_COMPONENTS.md](OPEN_SOURCE_COMPONENTS.md).

---

## Legacy person-search console (`/person-search`, `/monitor`, `/admin` — operator mode only)

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
External (optional): SearXNG · DeepSearch · GitHub · Reddit · YouTube ·
                     Google News RSS · Maigret sidecar (Python/FastAPI) · changedetection.io · FreeLLMAPI
```

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| Language split | TypeScript for app/engine; Python only where the mature OSS is Python (Maigret) | One typed codebase for the core; Python behind HTTP so it can scale/fail independently |
| Database | PostgreSQL via Drizzle; PGlite when `DATABASE_URL` is empty | Same SQL + migrations everywhere; zero-config local dev and tests |
| Queue | Postgres `jobs` table with `SKIP LOCKED` | No Redis dependency; durable; works on PGlite and Postgres |
| Long work | Background jobs; UI polls session/person views | The browser never blocks on a 50-query search |
| AI | Optional FreeLLMAPI-gateway extraction only; outputs grounded in source text | Identity is decided by explainable rules + a human, never by a model score |
| Auth | scrypt + HMAC-signed cookie, roles admin/analyst, first-run setup | Small, dependency-free, secure defaults |
| UI kit | Tailwind v4 + shadcn/ui-style primitives (cva + tailwind-merge) written in-repo | shadcn is copy-in by design; no Radix runtime needed for the few primitives used |

## Core flow

1. **Input** (`core/input.ts`) → zod-validated `PersonQuery` → `TargetProfile` (canonical orgs/cities, normalised handles, E.164 phones). Free text is mined by `core/freetext.ts` (+ FreeLLMAPI when configured).
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
