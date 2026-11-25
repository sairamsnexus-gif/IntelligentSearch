# Absolute zero-cost policy, quotas and usage tracking

**No paid API calls. No paid fallback. No automatic upgrade. No hidden billing.**

## What NEXUS enforces in code

| Rule | Where |
|---|---|
| The FreeLLMAPI gateway is the only LLM path. Known commercial LLM endpoints (OpenAI, Anthropic, Google AI, Mistral, Groq, Together, Fireworks, DeepSeek, Cohere, OpenRouter, Azure OpenAI, xAI, Perplexity, Bedrock) are **refused** as `FREELLMAPI_BASE_URL` | `src/lib/nexus/freellmapi.ts` `gatewayConfig()`; sidecar `configure_env()` |
| The model must be in `FREELLMAPI_MODEL_ALLOWLIST` | `gatewayConfig()` |
| Per-call token cap (`NEXUS_LLM_MAX_TOKENS`, plus the per-investigation `maxTokensPerCall`) | `chat()` |
| Per-investigation LLM call budget (Advanced controls → *LLM call budget*) | orchestrator `llmRemaining()` |
| Daily in-process call cap (`NEXUS_LLM_DAILY_CALL_CAP`) | `gatewayBlocked()` |
| HTTP **429** (rate limit) or **402** (payment required) from the gateway stops LLM use until `Retry-After` (default 1 h). **No other provider is tried** | `chat()`; orchestrator records a quota event |
| A search or engine returning 429/402 pauses **that engine only**. Other engines keep running. If only quota-blocked work remains, the investigation pauses with the reason shown, findings are kept, and **Resume** re-queues the blocked tasks | `engines.ts` `quotaResult()`, `InvestigationRunner` |
| SpiderFoot runs only key-less modules (`SPIDERFOOT_MODULES`) | `engines.ts` |
| Commercial search APIs (Brave, Serper, Tavily) are not registered | `src/lib/adapters/registry.ts`, `src/lib/nexus/policy.ts` |
| Usage is recorded per investigation (`usage.llmCalls`, `usage.llmTokens`, `usage.searchCalls` per provider) and quota events (`quota[]`) are shown in the Engines panel and Coverage tab | ledger `applyResult()` |

## What the operator must do

1. In FreeLLMAPI, add **free-tier provider keys only** and **do not** activate FreeLLMAPI *Premium* (a paid licence). See [FREE_PROVIDER_SETUP.md](FREE_PROVIDER_SETUP.md).
2. Use only your own keys. **Do not rotate accounts to get around quotas, and do not use leaked, shared or unauthorised keys.**
3. Keep FreeLLMAPI single-user and private: its dashboard, unified key and upstream keys must never be public, and the unified key must never be given to anonymous users. In compose it is bound to `127.0.0.1`.
4. Free tiers change. Check each provider's current terms; if a provider starts charging, remove its key from FreeLLMAPI.

## What NEXUS cannot guarantee

NEXUS sees only the gateway, not the provider keys behind it, so it **cannot** tell whether an operator has added a paid provider inside FreeLLMAPI. The code-level rules above prevent NEXUS itself from calling paid endpoints or switching providers. Keeping the gateway itself free is up to the operator.
