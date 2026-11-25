# Engines and the multi-engine orchestrator

## Engines

| Engine | What it contributes | Unit task | Long-running? | Where it runs |
|---|---|---|---|---|
| **Page Investigator** (native; web-scout-ai method) | Opens pages, extracts organisations (JSON-LD, site name), documented roles ("Founder & Principal: …", "X was co-founded by A and B"), public contact points, addresses, founding year, social links, and the links worth following | `read_page` (one URL) | No (≤ 12 s fetch) | Server function, both modes |
| **SearXNG** | Web metasearch for exact names, variants, regional scripts and discovered organisation names | `search` (one query) | No | Operator service. In hosted mode only if `SEARXNG_URL` is publicly reachable |
| **GPT Researcher** | Independent research plan and narrative. Its cited sources become leads | `research` → job id → poll | Yes (job) | Local sidecar only |
| **SpiderFoot** | Domain OSINT: affiliated hosts, company names, emails and social links linked to a domain | `osint_domain` → scan id → poll | Yes (scan) | Local service only |
| **Maigret** | Shows whether a username exists on public sites (existence only) | `username` | No (≤ 25 s) | Local sidecar only |
| **FreeLLMAPI** (gateway, *not* a discovery engine) | Reads page text the rules cannot, for example a Tamil sentence, and returns facts **with a verbatim quote**. Facts without an exact on-page quote are discarded | in-line during `read_page` | — | Operator gateway |

Engines run independently with per-engine concurrency (page 3, searxng 2, others 1). A failure, timeout or quota stop in one engine never stops the others. Each engine's own results appear separately in **A · Engine findings**.

## Orchestration model

The **browser** runs the orchestrator (`InvestigationRunner`, `src/lib/nexus/orchestrator.ts`). For each unit task it calls the stateless server endpoint `POST /api/nexus/execute`, which performs exactly one short action and returns. GPT Researcher and SpiderFoot return a job reference, and the browser polls it. Because of this:

- no long crawl ever runs inside a serverless function, which suits the Netlify free tier;
- the investigation state lives in the browser (IndexedDB autosave and JSON export), not on the server;
- closing the tab pauses the investigation. Re-opening offers **Restore**, and in-flight tasks are re-queued from the checkpoint.

### Rounds and cross-engine recursion

1. **Round 1 (plan):**
   - Exact-name queries, with and without place and context hints.
   - Name combinations (both orders).
   - Context × place queries.
   - Regional-script variants (Tamil and Devanagari, with the place also in that script).
   - Latin spelling variants.
   - One GPT Researcher plan.
   - Pages, domains and usernames you supplied.
2. **Every result is applied to the evidence ledger** (`ledger.ts`): sources, passages, entities, relationships, claims, contacts and **leads**. Leads are scored for relevance to your clues (names and variants, place, context keywords) and by kind.
3. **Next round:** the best open leads above the threshold are routed to the engine that can best test them. This is the cross-engine handoff:
   - a URL goes to the Page Investigator;
   - a domain goes to SpiderFoot, plus the Page Investigator reads its home page;
   - a business or school name goes to SearXNG (name, and name + place) plus at most one GPT Researcher question per round;
   - a full person name goes to SearXNG;
   - a username goes to Maigret.

   For example, SpiderFoot reports an affiliated host, so the Page Investigator reads it. GPT Researcher cites a page, so the Page Investigator verifies it. A team page names a full name, so SearXNG searches that name.
4. Identical (engine, input) tasks are never repeated. Each domain is limited by *pages per domain*.

### Stop conditions (always reported in the UI)

- Configured round limit reached (`maxRounds`, default 5).
- Configured task limit reached (`maxTotalTasks`, default 150; `maxTasksPerRound`, default 24).
- No new relevant leads above the threshold (`leadThreshold`, default 35).
- Free quota exhausted for every engine that still has work. The investigation pauses, findings are preserved, and **Resume** re-queues the quota-blocked tasks after the reset.
- Paused or stopped by you.

Leads that were never followed (below the threshold, limit reached, or not routed) stay visible in **F · Unresolved leads**, where you can follow any of them manually.

## Evidence rules (implemented)

- **Verification states:** primary-source supported, independently corroborated, single-source supported, weak indication, unverified hypothesis, contradicted, inaccessible, not searched.
- **Primary source:** a page on the organisation's own official domain, recognised from JSON-LD or the site name. Earlier pages read on that domain are re-classified when the official site is identified.
- **Independence:** sources whose text is near-identical (MinHash similarity ≥ 0.6 on 5-word shingles) share a *copy group* and count once. Three syndicated copies of a press release are one source.
- **Contradictions:** functional facts that disagree (for example "Established in 2012" on a directory vs. `foundingDate: 2014` on the official site) mark the outlier `contradicted`, and both sides are shown.
- **People are never merged on name alone.** A person's identity key is name + organisation context, or name + source domain. Two "Asma Siva" records stay separate until you confirm or reject them.
- **No relationship inference.** NEXUS never infers a family or personal relationship from surnames, photographs, proximity or co-occurrence. A link you state in the request (e.g. "Asma and Siva … running a business") is stored as an **unverified hypothesis**, drawn dashed, and never upgraded by itself.
- **Contacts** are attached only to organisations, never to a person. Each records the page that published it and whether that page is the organisation's official site.
- **LLM-assisted facts** are labelled "AI-assisted" and need a verbatim quote on the page. A fact supported only by that one quote stays a **weak indication** until other evidence supports it.
- Username hits (Maigret) are always **weak indications**.

## Feature status

| Feature | Status |
|---|---|
| Rule-based request parsing (names, places, context hints, URLs, usernames, domains, stated link) | Implemented |
| Exact-name preservation; Latin spelling and phonetic variants; Tamil and Devanagari transliteration; combinations | Implemented (Tamil/Devanagari only; other scripts not yet) |
| Page Investigator with robots.txt, SSRF protection, sign-in-wall detection and link following | Implemented |
| SearXNG engine | Implemented (needs a SearXNG instance) |
| GPT Researcher engine | Implemented (local-only sidecar). The sidecar API and robots shim are tested. A full live research run was not executed in the build environment (no web egress) |
| SpiderFoot engine | Implemented (local-only). The adapter is tested against a mock SpiderFoot API. A live SpiderFoot install was not possible in the build environment (dependency build failure, no egress) |
| Maigret engine | Implemented (local-only sidecar) |
| FreeLLMAPI gateway | Implemented. Tested against a **real FreeLLMAPI server** with a mock free upstream: quote verification and 429 → quota stop both confirmed |
| Cross-engine recursion, checkpoint and resume, quota pause and resume | Implemented |
| Possible matches (why / matches / conflicts / unknowns, confirm / reject) | Implemented |
| Evidence ledger, copy groups, contradictions, coverage and reconciliation | Implemented |
| JSON export / import with validation and migration; IndexedDB autosave and recovery | Implemented |
| Hosted mode (Netlify) | Partial: Page Investigator + synthetic world. Other engines are unavailable unless publicly reachable. **Deployment not verified** (no Netlify credentials in the build environment) |
| Monitoring, cloud sync, cloud database | Phase 2 (not in NEXUS). The legacy monitor remains for the legacy console in operator mode |
