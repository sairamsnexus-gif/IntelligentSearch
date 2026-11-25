# Open-source components: audit, compatibility and integration decisions

NEXUS combines five discovery engines with one LLM gateway. Each upstream repository was cloned and inspected before integration (licence, runtime, network behaviour, paid dependencies, compliance with the NEXUS rules). This file records what was found and what was decided.

Decision vocabulary: **direct** (library code imported), **adapter** (NEXUS calls the tool's own API), **separate service** (runs unmodified as its own process/container), **reference only** (design studied and re-implemented natively; no code copied), **excluded**.

## Compatibility matrix

| Component | Upstream | Licence (verified in repo) | Runtime | Paid dependency by default? | Compliance findings | Decision | Status in NEXUS |
|---|---|---|---|---|---|---|---|
| Page investigation | [web-scout-ai/web-scout-ai](https://github.com/web-scout-ai/web-scout-ai) | MIT | Python 3.11+, OpenAI Agents SDK, LiteLLM, Scrapling | **Yes** — default models on Amazon Bedrock and Gemini, open-web search via Serper (all metered) | Escalates to a "stealth Chromium browser" and "Cloudflare challenge handling" (README §fetching). That circumvents technical restrictions, which NEXUS must not do | **Reference only** | Implemented natively as the *Page Investigator* (`src/lib/nexus/extract.ts`, `engines.ts`): page-level reading, link prioritisation (about/contact/team first), evidence passages per claim, and explicit reporting of pages that could not be read, which mirrors web-scout's `bot_detected` taxonomy. There is no stealth browser, no challenge solving and no paid backend. |
| Deep research | [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) | Apache-2.0 | Python 3.11+, FastAPI, LangChain | Defaults to Tavily (commercial) and OpenAI | No robots.txt check in its scrapers. Configurable retrievers include `searx`, and the LLM base URL is configurable | **Separate service** (sidecar wrapping the unmodified library) | `services/gpt-researcher-sidecar`: `RETRIEVER=searx`; the LLM is set to the FreeLLMAPI gateway via `OPENAI_BASE_URL`. A robots.txt and sign-in-wall shim runs before every scrape. A 429/402 ends the job as `quota`. Its report is shown as **AI-generated notes (leads, not evidence)**; every cited URL is re-read by the Page Investigator before anything enters the evidence ledger. **Local-only.** |
| OSINT automation | [smicallef/spiderfoot](https://github.com/smicallef/spiderfoot) | MIT | Python 3, CherryPy web UI with a JSON API | Many modules need API keys, some for paid services | `sfp_spider` honours robots.txt only when its `robotsonly` option is on. The web UI has optional digest auth | **Separate service + adapter** | REST adapter (`engines.ts`) using `/startscan`, `/scanstatus` and `/scaneventresults`. Only an **allowlist of key-less modules** runs (`SPIDERFOOT_MODULES`). `sfp_spider` is dropped unless `robotsonly` is on. Bound to 127.0.0.1. **Local-only.** |
| Metasearch | [searxng/searxng](https://github.com/searxng/searxng) | **AGPL-3.0** | Python service | No | The JSON output format must be enabled in `settings.yml` | **Separate service, unmodified** | Called only over HTTP (`/search?format=json`). It is not linked into or bundled with NEXUS, and no modified copy is distributed, so the AGPL obligations stay with the SearXNG instance itself. If you modify SearXNG and expose it to users over a network, you must publish your modifications under AGPL-3.0. |
| Username discovery | [soxoj/maigret](https://github.com/soxoj/maigret) | MIT | Python | No | Results show that an account exists, not who owns it | **Separate service** (existing `services/osint-python`) | Each profile hit is recorded as a **weak indication** ("account exists; ownership not established"). **Local-only.** |
| LLM gateway | [joshcohen-ai/free-ai-tokens](https://github.com/joshcohen-ai/free-ai-tokens) (FreeLLMAPI) | MIT | Node 20+, Express, SQLite | Not by default. It **does** have an optional paid "Premium" licence for catalog sync, and it will route to any provider key you add | Single-user by design: the dashboard, unified key and upstream keys must stay private | **Adapter** (operator-run gateway, OpenAI-compatible `/v1`) | `src/lib/nexus/freellmapi.ts`. It is the **only** LLM path and assists extraction only; it is **not** counted as a discovery engine. The key lives in server env only. Known commercial endpoints are refused as the gateway URL. There is a model allowlist, per-call token cap, per-investigation call budget and daily call cap. A 429/402 stops LLM use until reset, with **no fallback**. Do not enable Premium; add only free-tier provider keys. |

### Removed or excluded in this phase

| Item | Reason |
|---|---|
| Direct Gemini client (previous `src/lib/ai/gemini.ts`) | Removed. All LLM use goes through FreeLLMAPI (single gateway; no competing gateway). |
| Brave Search API adapter | Excluded: its free plan requires a payment card on file (zero-cost policy). |
| Serper and Tavily adapters | Excluded: commercial search APIs with paid plans (zero-cost policy). Their classes stay in `web-search.ts` for reference, but they are not registered. |
| web-scout-ai stealth/Cloudflare fetching | Excluded: it circumvents technical access restrictions. |

## Licence compliance summary

- NEXUS's own code does not import code from any of these projects. The GPT Researcher sidecar imports the `gpt-researcher` package (Apache-2.0) from PyPI and keeps its notices.
- SearXNG (AGPL-3.0), SpiderFoot (MIT), Maigret (MIT) and FreeLLMAPI (MIT) run as separate, unmodified services that NEXUS reaches over HTTP.
- web-scout-ai (MIT) was used as a design reference only.

## How the engines work together

See [ENGINES.md](ENGINES.md) for the orchestrator, cross-engine handoff, stop conditions and failure isolation.
