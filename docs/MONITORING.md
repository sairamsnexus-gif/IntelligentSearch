# Monitoring

Implementation: `src/lib/services/monitoring.ts`, `src/lib/core/change.ts`, `src/lib/core/schedule.ts`.

## Lifecycle

```
LOCK → baseline job → [scheduled | manual] monitor_scan jobs → changes / alerts / timeline
```

| Setting | Where | Default |
|---|---|---|
| Default interval | `MONITOR_INTERVAL_HOURS` | 24 h |
| Per-person interval | Person → Settings (admin) | inherits default |
| Pause / resume | Admin table or Person → Monitoring (admin) | active |
| Manual scan | “Run manual scan” | – |

The scheduler runs every 30 s inside the worker, atomically claims due persons (`running=false AND next_run_at <= now()`), and enqueues `monitor_scan`. Stale runs (> 30 min) are released. Failed scans retry within the hour.

## Per-source check method

| Method | Used for | How |
|---|---|---|
| `github_api` | github.com profiles | GitHub REST: profile fields + recent public events |
| `reddit_api` | reddit.com/user/… (if configured) | OAuth client-credentials, user overview |
| `web_fetch` | other public pages | SSRF-safe fetch, robots.txt respected, markup stripped |
| `changedetection` | other public pages when configured | watch created via REST API; latest snapshot compared |
| `search_only` (**LIMITED**) | LinkedIn, Instagram, Facebook, X | never fetched directly; compared via search-result snippets |
| `demo` | demo data | fictional “world” that evolves per scan |

## Change detection

Each observation stores `first_seen / last_checked / last_changed / content_hash` on the source and a **snapshot** (only when content or availability changes):

| Result | Rule |
|---|---|
| NEW | URL never seen for this person; attributed via a confirmed identifier (strong) or name + ≥ 2 agreeing attributes with no conflicting identifier/age (weak, stored as *unverified* “possible mention”) |
| CHANGED | SHA-256 of normalised text differs → word-level diff + attribute-level OLD → NEW (e.g. designation *Project Manager → Senior Project Manager*) |
| UNCHANGED / EXISTING | Same hash |
| NO_LONGER_AVAILABLE | HTTP 404/410 immediately; other errors after 3 consecutive failures |

UI badges: 🔴 NEW · 🟡 CHANGED · 🟢 EXISTING · ⚫ NO LONGER AVAILABLE. Every change creates an alert and a timeline event linked to its evidence and source.

## Cost control

- 6-hour result cache per (query, provider); query de-duplication; monitor plans capped at 15 queries.
- Content hashing avoids storing identical snapshots.
- Per-provider token buckets + exponential backoff; robots.txt cached for 24 h.
- Direct checks run 3 at a time per person.
