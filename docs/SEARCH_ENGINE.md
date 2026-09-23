# Search engine

## Search planner (`src/lib/core/planner.ts`)

The planner builds **hypotheses**, not a Cartesian product. Each query carries a tier, category, channel and a human-readable reason.

| Tier | Hypothesis | Example |
|---|---|---|
| 0 | Name + variations | `"Rajesh Kumar"`, `"R Kumar"`, `"Rajesh K"`, `"RajeshKumar"`, `"Kumar Rajesh"` |
| 1 | Name + strongest identifier (profile URL, email, phone, handle) | `"linkedin.com/in/example"`, `"Rajesh Kumar" "rajeshkumar78"` |
| 2 | Name + company | `"Rajesh Kumar" TCS` |
| 3 | Name + city (state/country) | `"Rajesh Kumar" Chennai` |
| 4 | Name + designation / previous company / school | `"Rajesh Kumar" "Project Manager"` |
| 5 | Name + company + city | `"Rajesh Kumar" TCS Chennai` |
| 6 | Name + company + designation; name + city + designation | `"Rajesh Kumar" TCS "Project Manager"` |
| 7 | Username (+ company) and cross-platform username discovery | `"rajeshkumar78" TCS` |
| 8 | Username + city; platforms hinted by free text | `"rajeshkumar78" Chennai` |
| 9 | Platform-specific, news, documents, images | `site:linkedin.com "Rajesh Kumar" TCS`, `… filetype:pdf` |
| 10 | Newly discovered attributes | `"Rajesh Kumar" Infosys`, `"rajeshkumar78"` |

### De-duplication and budget

- `queryKey()` is order-, case- and whitespace-insensitive and channel-scoped: `"Rajesh Kumar" TCS` ≡ `tcs "rajesh  kumar"`.
- Duplicates, queries already executed in the session (`history`), queries for channels with no available adapter and queries over `MAX_QUERIES_PER_ITERATION` are **recorded as skipped** with the reason — never silently dropped.
- Planned queries are sorted by tier, so a budget cut always removes the lowest-priority hypotheses.

### Monitor mode

`mode: "monitor"` drops name variations and already-known platform lookups and caps the plan (15 queries) — precise, cheap re-checks built from the **confirmed identity**, including identifiers added after locking.

## Iterative discovery (`src/lib/services/discovery.ts`)

```
iteration 1: plan(input) → execute → resolve → discovered attributes
iteration 2: plan(input + discovered, history) → execute → resolve → …
stop when: MAX_DISCOVERY_ITERATIONS reached, or no new attributes
```

Discovered attributes come only from **plausible** candidates (no conflicts, within one matched attribute of the leader), so noise from unrelated namesakes does not steer the search. A user refinement starts a new run of iterations in the same session; the query history prevents repeats, and resolution is always re-run with the enriched target.

## Execution (`src/lib/services/executor.ts`)

- Channel routing: `web/news/images` → first 2 capable engines by priority (`searxng, brave, serper, tavily, deepsearch`); `github/reddit/youtube` → that platform’s official API; `username` → FindME rules + Maigret sidecar.
- Parallelism: `SEARCH_CONCURRENCY` (default 4) queries in flight; each provider has its own token bucket; 429/5xx/network errors retry with exponential backoff honoring `Retry-After`.
- Cache: identical `(queryKey, adapter)` within 6 h re-uses stored results (`status = cached`).
- A failing adapter marks only its own row `failed`; results from other adapters are kept.

## Normalisation

Every adapter returns the canonical `SearchResult` (`src/lib/core/types.ts`): `id, query, sourceEngine, sourcePlatform, url, title, description, publishedAt, discoveredAt, author, username, name, location, organization, designation, emails, phoneNumbers, imageUrl, contentText, rawMetadata, sourceType`. Source URL and discovery timestamp are always preserved. Content is capped at 20 KB per result.

## Free-text extraction

`core/freetext.ts` parses notes such as *“He worked at Infosys before TCS, probably around 40, lives in Chennai and may have a YouTube channel”* into `previous_organization=Infosys, organization=TCS, age=40, city=Chennai, hint=youtube`. With `GEMINI_API_KEY`, Gemini adds structured extraction; every AI value must literally occur in the note (`groundInText`) or it is discarded.
