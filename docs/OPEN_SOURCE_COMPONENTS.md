# Open-source components

Evaluated September 2026 by cloning and reading each repository. Nothing was copied blindly; integration is via adapters, and where a project was unsuitable it is documented and not forced in.

| Repository | Purpose | Integration method | License | Maintenance (last commit seen) | Dependency risk | Used? |
|---|---|---|---|---|---|---|
| [soxoj/maigret](https://github.com/soxoj/maigret) | Username search across ~5,900 site definitions with profile parsing (socid-extractor) | **Python sidecar** `services/osint-python` (FastAPI) calls `maigret.search()` as a library; TS `MaigretAdapter` calls it over HTTP (`MAIGRET_SERVICE_URL`). NSFW/dating tags excluded, top-N ranked sites, bounded timeouts. | MIT | Active (2026-09-21, v0.6.6) | Medium: large dependency tree (aiohttp, curl_cffi…) isolated in its own container | **Yes** (optional) |
| [0xSaikat/findme](https://github.com/0xSaikat/findme) | Username existence checks over 400+ sites (Sherlock-style `data.json`) | Curated 18-site subset of its `data.json` vendored at `src/lib/adapters/data/findme-sites.json` (with its MIT licence file); rules re-implemented in TS (`FindmeAdapter`) through the SSRF-safe fetcher. Third-party proxy probes (picuki, nitter) removed. | MIT | Active (2026-08-28) | Low: data file only, no runtime dependency | **Yes** (default on) |
| [dgtlmoon/changedetection.io](https://github.com/dgtlmoon/changedetection.io) | Mature web-page change monitoring | REST API (`/api/v1/watch`, `/history`, `x-api-key`) via `ChangeDetectionAdapter`; runs as optional compose service. Our own hash/diff pipeline is used when it is not configured. | Apache-2.0 | Very active (2026-09-21) | Low: separate service, HTTP contract | **Yes** (optional) |
| [Tasmay-Tibrewal/deepsearch](https://github.com/Tasmay-Tibrewal/deepsearch) | Streamlit research agent; `search.py` (SearXNG via pyppeteer) and `scraper.py` (aiohttp/BS4) HTTP services | HTTP only: `DeepSearchAdapter` posts to `SEARCH_API_URL` (`{query,max_pages}` → `[{title,url,description}]`) and optionally enriches via `SCRAPER_API_URL`. | **No licence file** → no code reused | Low activity (2025-05-29) | High: headless-browser stealth scraping of public SearXNG instances; users should run it only where that complies with the instance’s terms | **Yes** (optional, HTTP contract only) |
| [searxng/searxng](https://github.com/searxng/searxng) | Self-hosted metasearch with JSON API | `SearxngAdapter` (`/search?format=json`); compose service + `deploy/searxng/settings.yml` enabling JSON | AGPL-3.0 (separate service, unmodified) | Very active | Low: separate container | **Yes** (primary free provider) |
| [smicallef/spiderfoot](https://github.com/smicallef/spiderfoot) | Broad OSINT automation (200+ modules: DNS, breach, dark-web, infrastructure) | **Not integrated.** Its scope is mostly infrastructure/breach reconnaissance rather than person identity; several modules touch breach/credential data that this product must not surface; heavy runtime. | MIT | Stale (last commit 2023-11-05) | High | **No** |
| GitHub topic: [person-search](https://github.com/topics/person-search) / [people-finder](https://github.com/topics/people-finder) | Mostly Sherlock/Maigret forks, scrapers of commercial people-search sites, and data-broker lookups | Reviewed; commercial people-search scrapers violate site ToS and aggregate non-public data. Username-discovery functionality is covered by Maigret + FindME. | various | – | – | **No** |
| GitHub topic: [phone-number-information](https://github.com/topics/phone-number-information) (e.g. PhoneInfoga) | Phone OSINT: carrier/line lookups, dorks, reputation | **Not integrated** by design: carrier/subscriber lookups and location features are out of scope. Phone numbers are handled only as an identity *signal* with offline normalisation via libphonenumber-js. | GPL-3.0 (PhoneInfoga) | – | – | **No** |

## JavaScript / TypeScript libraries

| Library | Use | License |
|---|---|---|
| next, react | Web framework | MIT |
| tailwindcss, class-variance-authority, clsx, tailwind-merge | Styling / shadcn-style primitives | MIT |
| lucide-react | Icons | ISC |
| drizzle-orm, drizzle-kit, pg | ORM, migrations, Postgres driver | Apache-2.0 / MIT |
| @electric-sql/pglite | Embedded Postgres (dev/test) | Apache-2.0 / PostgreSQL |
| zod | Input validation | MIT |
| libphonenumber-js | Phone normalisation (offline metadata) | MIT |
| diff | Text diffs | BSD-3-Clause |
| fast-xml-parser | RSS parsing | MIT |
| geist | Fonts | OFL |
| vitest, playwright, tsx | Tests / e2e / worker runner | MIT / Apache-2.0 |
