# Investigation files (JSON): schema, export, import, migration

Phase 1 is **JSON-first**: an investigation is one versioned JSON document. It lives in your browser (IndexedDB autosave) and in files you export. There is no server database for NEXUS and no cloud sync (Phase 2).

## Top level (`schema: "nexus.investigation"`, `schemaVersion: 1`)

| Field | Meaning |
|---|---|
| `id`, `title`, `createdAt`, `updatedAt`, `status` (`draft/running/paused/completed/stopped`), `stopReason` | Identity and lifecycle |
| `request` | Your original text, purpose and time |
| `clues` | Parsed names (each with `original` + `variants[]` {text, script, method, isOriginal}), places, organisation hints, keywords, URLs, usernames, domains, user-stated relationships, `parsedBy` |
| `settings` | Rounds, tasks per round, total tasks, pages per domain, lead threshold, engines on/off, LLM {enabled, maxCalls, maxTokensPerCall}, synthetic |
| `round`, `tasks[]` | Every engine unit task with input, reason, status, attempts, provider, error, `jobRef`, output {hits, sourceIds, leadIds, claimIds, notes, narrative} |
| `sources[]` | URL, canonical URL, domain, title, source type, `discoveredBy[]` {engine, taskId, via}, fetch {status, httpStatus, reason, engine}, snippet, content hash, fingerprint, published / first-seen / last-checked dates, `copyGroup`, outbound / followed links, `synthetic` |
| `passages[]` | Verbatim evidence text, tied to a source |
| `entities[]` | Person / business / school / organisation / website / social profile / location, with identity `key`, aliases, attributes, `sourceIds`, `userDecision` |
| `relationships[]` | subject–predicate–object with `evidence[]` (source + passage), `verification`, `independentSources`, `contradictions`, `provenance` {engine/user, taskId, round, assistedBy}, `hypothesis`, `userDecision` |
| `contacts[]` | Public organisational contact points (email, phone, WhatsApp, address, website, social) with source, passage, official flag, verification |
| `claims[]` | Atomic facts with verification and `conflictsWith` |
| `leads[]` | Kind, value, origin, priority, reason, status (`open/queued/investigated/discarded/limit_reached`), task ids |
| `trail[]` | Ordered investigation log (plan, search, page read, extraction, follow-up, error, quota, user, checkpoint) |
| `quota[]`, `usage` | Free-quota events and usage counters |
| `checkpoint` | Last save point and pending task ids (used to resume) |
| `synthetic` | `true` when the data comes from the fictional demo world |

The zod definition in `src/lib/nexus/schema.ts` is the normative schema.

## What is never stored

- API keys, gateway tokens, provider secrets, passwords and session credentials. Export also strips any credential-named field as a second safeguard.
- Private model chain-of-thought. Only quoted facts and the narrative notes an engine returns are stored.

## Export

**Export JSON** downloads `nexus-<title>-<date>.json`. The workspace is **not** cleared afterwards. The *not exported* badge shows whenever there are changes since the last export, and the browser warns before you leave the page with unexported changes.

## Import

**Import** accepts a `.json` file up to 25 MB. In order, it:

1. rejects non-JSON and files whose `schema` is not `nexus.investigation`;
2. **migrates** older versions step by step (v0 drafts → v1) and refuses files from a newer app version;
3. validates every field (zod);
4. checks referential integrity (every passage, relationship, claim, contact and lead must point at existing records);
5. re-queues tasks that were `running` when the file was saved and sets the status to `paused`, so you can **Resume**.

If the current investigation has unexported changes, NEXUS asks before replacing it.

## Autosave and recovery

Every change is saved (debounced) to IndexedDB in this browser. When you reopen NEXUS, a banner offers to **Restore** the last investigation or **Discard** it. Autosave is per browser profile and is not a backup; export the file to keep a copy. **Clear** removes the workspace and the autosave, and asks first if there are unexported changes.

## Security note

Investigation files can contain personal data from public sources. Store them carefully. `.gitignore` excludes `nexus-*.json` so exports are never committed by accident.
