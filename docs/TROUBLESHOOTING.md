# Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Every engine except the Page Investigator shows **UNAVAILABLE** | Its URL env var is not set, or you are in hosted mode and the URL points at `localhost`. Run NEXUS locally, or set a publicly reachable URL (SearXNG only). |
| SearXNG tasks fail with "JSON output disabled" | Add `formats: [html, json]` under `search:` in SearXNG `settings.yml` and restart it. |
| SearXNG tasks show **quota** | The SearXNG instance or one of its upstream engines is rate-limiting. Wait, then press **Resume**. |
| FreeLLMAPI shows "not configured" | Set `FREELLMAPI_BASE_URL` and `FREELLMAPI_API_KEY` in the server `.env` and restart. |
| FreeLLMAPI "Refused: … commercial LLM endpoint" | `FREELLMAPI_BASE_URL` points at a paid provider. It must be your own FreeLLMAPI gateway. |
| FreeLLMAPI "Model … not in allowlist" | Add the model to `FREELLMAPI_MODEL_ALLOWLIST` or change `FREELLMAPI_MODEL`. |
| FreeLLMAPI returns "All models exhausted" | No free provider in FreeLLMAPI can serve the model (no keys, or all rate-limited). With `auto`, custom providers may not be in the fallback chain: name the model explicitly or add it to the chain. |
| GPT Researcher job fails at once | Check `GET http://localhost:8095/health`. The sidecar needs `SEARX_URL`, `FREELLMAPI_BASE_URL` and `FREELLMAPI_API_KEY`, plus an embedding model your free providers serve (`NEXUS_GPTR_EMBEDDING`). |
| SpiderFoot "Scan not started" / 401 | NEXUS expects SpiderFoot on `127.0.0.1` without a password file (digest auth is not supported). Keep it private. |
| SpiderFoot note "sfp_spider skipped" | Enable *robotsonly* for `sfp_spider` in SpiderFoot settings. |
| Investigation stops with "Configured round limit reached" | Normal. Raise *Rounds* in Advanced controls, or follow individual leads from **F · Unresolved leads**. |
| "Free quota exhausted … resume after the quota resets" | All remaining work is waiting on a rate-limited free provider. Findings are saved; press **Resume** after the time shown. |
| Import rejected: "references missing …" | The file was edited by hand or truncated; integrity checks failed. Use an original export. |
| Import rejected: "newer than this app" | The file was exported by a newer NEXUS version; update NEXUS. |
| Autosave failed | IndexedDB is unavailable (private browsing or storage disabled). Export regularly. |
| Hosted login: "Hosted login is not configured" | Set `NEXUS_OPERATOR_EMAIL` and `NEXUS_OPERATOR_PASSWORD_HASH` (from `npm run hash-password`) and `AUTH_SECRET`, then redeploy. |
| Legacy pages redirect to home | Hosted mode has no database. Run locally for `/person-search`, `/monitor` and `/admin`. |
