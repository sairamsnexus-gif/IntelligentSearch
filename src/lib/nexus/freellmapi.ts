import "server-only";
/**
 * FreeLLMAPI gateway client (github.com/joshcohen-ai/free-ai-tokens — the
 * FreeLLMAPI project). The gateway is operator-run and single-user by design:
 *  - its unified key and URL live only in server env, never in the browser;
 *  - only the gateway is called — known paid LLM endpoints are refused;
 *  - every call is capped (tokens, daily calls) and a 429/402 stops further
 *    calls until the reset; there is NO fallback to any other provider.
 */
import { env } from "@/lib/config/env";
import { log } from "@/lib/security/logger";

export interface GatewayQuota {
  provider: string;
  status: number | null;
  message: string;
  retryAfterSec: number | null;
}

export interface GatewayResult {
  ok: boolean;
  content?: string;
  tokens: number;
  model?: string;
  quota?: GatewayQuota;
  error?: string;
}

/** Commercial endpoints that must never be configured as "the gateway". */
const PAID_HOSTS = /(^|\.)(api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai|api\.groq\.com|api\.together\.xyz|api\.fireworks\.ai|api\.deepseek\.com|api\.cohere\.(ai|com)|openrouter\.ai|bedrock[^.]*\.amazonaws\.com|openai\.azure\.com|api\.x\.ai|api\.perplexity\.ai)$/i;

export function gatewayConfig(): { ok: boolean; reason: string; baseUrl?: string; model: string; allow: string[] } {
  const e = env();
  const model = e.FREELLMAPI_MODEL || "auto";
  const allow = (e.FREELLMAPI_MODEL_ALLOWLIST ?? "auto").split(",").map((s) => s.trim()).filter(Boolean);
  if (!e.FREELLMAPI_BASE_URL || !e.FREELLMAPI_API_KEY) return { ok: false, reason: "FreeLLMAPI gateway not configured (FREELLMAPI_BASE_URL + FREELLMAPI_API_KEY)", model, allow };
  let host = "";
  try {
    host = new URL(e.FREELLMAPI_BASE_URL).hostname;
  } catch {
    return { ok: false, reason: "FREELLMAPI_BASE_URL is not a valid URL", model, allow };
  }
  if (PAID_HOSTS.test(host)) return { ok: false, reason: `Refused: ${host} is a commercial LLM endpoint, not the operator's FreeLLMAPI gateway (no paid providers)`, model, allow };
  if (!allow.includes(model)) return { ok: false, reason: `Model "${model}" is not in FREELLMAPI_MODEL_ALLOWLIST`, model, allow };
  return { ok: true, reason: "Operator FreeLLMAPI gateway", baseUrl: e.FREELLMAPI_BASE_URL.replace(/\/+$/, ""), model, allow };
}

// In-process daily safety cap (in addition to the gateway's own per-provider tracking).
const g = globalThis as unknown as { __nexusLlm?: { day: string; calls: number; blockedUntil: number } };
const state = (g.__nexusLlm ??= { day: "", calls: 0, blockedUntil: 0 });

/** Test helper: clear the in-process call counter and quota block. */
export function resetGatewayState() {
  state.day = "";
  state.calls = 0;
  state.blockedUntil = 0;
}

export function gatewayBlocked(): GatewayQuota | null {
  const day = new Date().toISOString().slice(0, 10);
  if (state.day !== day) {
    state.day = day;
    state.calls = 0;
  }
  if (Date.now() < state.blockedUntil) return { provider: "freellmapi", status: 429, message: "Gateway rate-limited earlier; waiting for reset", retryAfterSec: Math.ceil((state.blockedUntil - Date.now()) / 1000) };
  if (state.calls >= env().NEXUS_LLM_DAILY_CALL_CAP) return { provider: "freellmapi", status: null, message: `NEXUS daily LLM call cap (${env().NEXUS_LLM_DAILY_CALL_CAP}) reached`, retryAfterSec: null };
  return null;
}

export async function chat(messages: { role: "system" | "user"; content: string }[], maxTokens: number, opts: { json?: boolean; timeoutMs?: number } = {}): Promise<GatewayResult> {
  const cfg = gatewayConfig();
  if (!cfg.ok || !cfg.baseUrl) return { ok: false, tokens: 0, error: cfg.reason };
  const blocked = gatewayBlocked();
  if (blocked) return { ok: false, tokens: 0, quota: blocked };
  state.calls++;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(`${cfg.baseUrl}/v1/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env().FREELLMAPI_API_KEY}` },
      body: JSON.stringify({ model: cfg.model, messages, max_tokens: Math.min(maxTokens, env().NEXUS_LLM_MAX_TOKENS), temperature: 0, ...(opts.json ? { response_format: { type: "json_object" } } : {}) }),
      cache: "no-store",
    });
    if (res.status === 429 || res.status === 402) {
      const ra = Number(res.headers.get("retry-after"));
      const retryAfterSec = Number.isFinite(ra) && ra > 0 ? ra : 3600;
      state.blockedUntil = Date.now() + retryAfterSec * 1000;
      const body = await res.text().catch(() => "");
      return { ok: false, tokens: 0, quota: { provider: "freellmapi", status: res.status, message: (res.status === 402 ? "Upstream requires payment — refused (no paid fallback). " : "All free providers rate-limited. ") + body.slice(0, 200), retryAfterSec } };
    }
    if (!res.ok) return { ok: false, tokens: 0, error: `Gateway HTTP ${res.status}` };
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number }; model?: string };
    return { ok: true, content: data.choices?.[0]?.message?.content ?? "", tokens: data.usage?.total_tokens ?? 0, model: data.model };
  } catch (e) {
    log.warn("freellmapi.error", { error: e instanceof Error ? e.message : "unknown" });
    return { ok: false, tokens: 0, error: e instanceof Error ? e.message : "Gateway request failed" };
  } finally {
    clearTimeout(timer);
  }
}

export async function gatewayHealth(): Promise<{ ok: boolean; reason: string; models: string[] }> {
  const cfg = gatewayConfig();
  if (!cfg.ok || !cfg.baseUrl) return { ok: false, reason: cfg.reason, models: [] };
  try {
    const res = await fetch(`${cfg.baseUrl}/v1/models`, { headers: { Authorization: `Bearer ${env().FREELLMAPI_API_KEY}` }, signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (!res.ok) return { ok: false, reason: `Gateway HTTP ${res.status}`, models: [] };
    const data = (await res.json()) as { data?: { id: string }[] };
    return { ok: true, reason: cfg.reason, models: (data.data ?? []).map((m) => m.id).slice(0, 50) };
  } catch (e) {
    return { ok: false, reason: `Gateway unreachable: ${e instanceof Error ? e.message : "error"}`, models: [] };
  }
}

/** Parse a JSON object out of a model reply (tolerates code fences). */
export function parseJsonReply<T>(content: string | undefined): T | null {
  if (!content) return null;
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}
