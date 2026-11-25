/**
 * FreeLLMAPI gateway client.
 *  - Unit part (always runs): paid-endpoint refusal, model allowlist, mock gateway
 *    with 429 → quota stop and no further calls.
 *  - Integration part (runs when NEXUS_IT_FREELLMAPI_URL + NEXUS_IT_FREELLMAPI_KEY
 *    point at a REAL FreeLLMAPI instance, e.g. one configured with a mock free
 *    upstream as described in docs/FREE_PROVIDER_SETUP.md).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/config/env";

const setEnv = (vars: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
};

async function freshGateway() {
  const mod = await import("@/lib/nexus/freellmapi");
  mod.resetGatewayState();
  return mod;
}

describe("gateway configuration (zero-cost policy)", () => {
  it("refuses commercial LLM endpoints as the gateway", async () => {
    for (const url of ["https://api.openai.com", "https://generativelanguage.googleapis.com", "https://openrouter.ai/api"]) {
      setEnv({ FREELLMAPI_BASE_URL: url, FREELLMAPI_API_KEY: "x", FREELLMAPI_MODEL: undefined, FREELLMAPI_MODEL_ALLOWLIST: undefined });
      const { gatewayConfig, chat } = await freshGateway();
      expect(gatewayConfig().ok).toBe(false);
      expect(gatewayConfig().reason).toMatch(/commercial/);
      const r = await chat([{ role: "user", content: "hi" }], 10);
      expect(r.ok).toBe(false);
    }
  });
  it("requires the model to be allowlisted and is off when unconfigured", async () => {
    setEnv({ FREELLMAPI_BASE_URL: "http://127.0.0.1:9", FREELLMAPI_API_KEY: "x", FREELLMAPI_MODEL: "gpt-4o", FREELLMAPI_MODEL_ALLOWLIST: "auto" });
    expect((await freshGateway()).gatewayConfig().ok).toBe(false);
    setEnv({ FREELLMAPI_BASE_URL: undefined, FREELLMAPI_API_KEY: undefined, FREELLMAPI_MODEL: undefined });
    expect((await freshGateway()).gatewayConfig().reason).toMatch(/not configured/);
  });
});

describe("gateway client against a mock gateway", () => {
  let server: http.Server;
  let calls = 0;
  let auth = "";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        calls++;
        auth = String(req.headers.authorization ?? "");
        const body = JSON.parse(b || "{}") as { max_tokens?: number };
        if (calls >= 2) {
          res.writeHead(429, { "retry-after": "90", "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "all free providers exhausted" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ model: "auto", choices: [{ message: { content: `{"ok":true,"max":${body.max_tokens}}` } }], usage: { total_tokens: 12 } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  });
  afterAll(() => server.close());
  beforeEach(() => {
    const port = (server.address() as AddressInfo).port;
    setEnv({ FREELLMAPI_BASE_URL: `http://127.0.0.1:${port}`, FREELLMAPI_API_KEY: "test-unified-key", FREELLMAPI_MODEL: undefined, FREELLMAPI_MODEL_ALLOWLIST: undefined, NEXUS_LLM_MAX_TOKENS: "500" });
  });

  it("sends the unified key server-side, caps tokens, then stops on 429 without fallback", async () => {
    const { chat, gatewayBlocked, parseJsonReply } = await freshGateway();
    const ok = await chat([{ role: "user", content: "x" }], 4000, { json: true });
    expect(ok.ok).toBe(true);
    expect(auth).toBe("Bearer test-unified-key");
    expect(parseJsonReply<{ max: number }>(ok.content)?.max).toBe(500);
    const q = await chat([{ role: "user", content: "x" }], 100);
    expect(q.ok).toBe(false);
    expect(q.quota?.status).toBe(429);
    expect(q.quota?.retryAfterSec).toBe(90);
    const before = calls;
    const blocked = await chat([{ role: "user", content: "x" }], 100);
    expect(blocked.quota).toBeTruthy();
    expect(calls).toBe(before); // no further upstream call while blocked
    expect(gatewayBlocked()).toBeTruthy();
  });
});

const IT_URL = process.env.NEXUS_IT_FREELLMAPI_URL;
const IT_KEY = process.env.NEXUS_IT_FREELLMAPI_KEY;
describe.skipIf(!IT_URL || !IT_KEY)("REAL FreeLLMAPI instance (integration)", () => {
  const IT_MODEL = process.env.NEXUS_IT_FREELLMAPI_MODEL ?? "auto";
  beforeEach(() => setEnv({ FREELLMAPI_BASE_URL: IT_URL, FREELLMAPI_API_KEY: IT_KEY, FREELLMAPI_MODEL: IT_MODEL, FREELLMAPI_MODEL_ALLOWLIST: IT_MODEL }));
  it("lists models, extracts quote-verified facts, and reports the upstream free-tier limit as quota", async () => {
    const g = await freshGateway();
    const h = await g.gatewayHealth();
    expect(h.ok).toBe(true);
    expect(h.models).toContain(IT_MODEL);
    const { llmFacts } = await import("@/lib/nexus/engines");
    const text = "Montessori schools in Adyar. Little Lotus Montessori, founded by Asma Siva, focuses on practical-life activities. The school is on Gandhi Nagar 2nd Main Road.";
    const ctx = { task: { id: "t1", engine: "page" as const, kind: "read_page" as const, input: { url: "https://x.example/" } }, context: { synthetic: false, clueNames: ["Asma", "Siva"], places: ["Chennai"], organisationHints: [], llm: { enabled: true, remainingCalls: 5, maxTokensPerCall: 600 } } };
    const r = await llmFacts(text, ctx);
    expect(r.calls).toBe(1);
    // The fabricated "Fake Corp" fact has no verbatim quote on the page and must be dropped.
    expect(r.facts.map((f) => f.object)).toEqual(["Little Lotus Montessori"]);
    let quota: unknown = null;
    for (let i = 0; i < 4 && !quota; i++) quota = (await llmFacts(text, ctx)).quota ?? null;
    expect(quota).toBeTruthy();
  });
});
