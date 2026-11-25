# Free provider setup (FreeLLMAPI gateway)

NEXUS uses [FreeLLMAPI](https://github.com/joshcohen-ai/free-ai-tokens) (MIT) as its only LLM gateway. FreeLLMAPI is a **single-user, operator-run** OpenAI-compatible proxy that routes among the free-tier provider keys *you* add.

## 1. Run the gateway locally (private)

```bash
export FREELLMAPI_ENCRYPTION_KEY=$(openssl rand -hex 32)   # keep it; it encrypts your stored provider keys
docker compose --profile llm up -d freellmapi              # bound to 127.0.0.1:3001
```

Without Docker: `git clone https://github.com/joshcohen-ai/free-ai-tokens && cd free-ai-tokens && npm install && npm run db:migration:up -w server && ENCRYPTION_KEY=… HOST=127.0.0.1 npm run dev -w server`.

Never expose port 3001 publicly. The dashboard, unified key and provider keys are private to you.

## 2. Add free-tier providers only

Open `http://127.0.0.1:3001`, create your account, and add keys **only** for providers whose free tier you have checked yourself (the FreeLLMAPI catalog lists free-tier models). Free terms change, so re-check them periodically. You can also add a self-hosted OpenAI-compatible server (for example Ollama or llama.cpp) as a **custom provider**.

- Do **not** activate *Premium*: it is a paid licence.
- Do **not** add pay-as-you-go keys.
- Do **not** add keys that are not yours.

## 3. Connect NEXUS

Copy the unified key from FreeLLMAPI *Settings → API key* into NEXUS's server-side `.env`:

```
FREELLMAPI_BASE_URL=http://127.0.0.1:3001
FREELLMAPI_API_KEY=freellmapi-…
FREELLMAPI_MODEL=auto
FREELLMAPI_MODEL_ALLOWLIST=auto
```

If `auto` does not route to a custom provider (FreeLLMAPI's `auto` routes over its own fallback chain), set `FREELLMAPI_MODEL` and `FREELLMAPI_MODEL_ALLOWLIST` to the exact free model id, or add that model to the fallback chain in the dashboard.

The Engines panel shows "FreeLLMAPI gateway … READY" when `/v1/models` answers.

## 4. GPT Researcher through the gateway

The sidecar sets `OPENAI_BASE_URL=<gateway>/v1` and `OPENAI_API_KEY=<unified key>`, and points `FAST_LLM`, `SMART_LLM` and `STRATEGIC_LLM` at `openai:<FREELLMAPI_MODEL>`. Embeddings use `NEXUS_GPTR_EMBEDDING` (default `custom:auto`, i.e. FreeLLMAPI's `/v1/embeddings`). Set it to an embedding model that one of your free providers serves.

## Verified integration

`tests/nexus/gateway.test.ts` includes an integration test that runs against a **real FreeLLMAPI server** configured with a custom provider that points at a mock free upstream:

```bash
NEXUS_IT_FREELLMAPI_URL=http://127.0.0.1:3902 NEXUS_IT_FREELLMAPI_KEY=freellmapi-… NEXUS_IT_FREELLMAPI_MODEL=mock-free-1 npx vitest run tests/nexus/gateway.test.ts
```

It confirms model listing, quote-verified extraction (a fabricated fact with no on-page quote is dropped), and that an upstream 429 reaches NEXUS as a quota stop.
