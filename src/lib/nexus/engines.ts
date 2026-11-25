import "server-only";
/**
 * Real engine executors (server side). Each call performs ONE unit task and
 * returns quickly: long engines (GPT Researcher, SpiderFoot) return a job
 * reference that the browser-side orchestrator polls. Nothing here runs a long
 * crawl inside a serverless function.
 *
 * Compliance rules enforced here:
 *  - SSRF-safe fetches only; robots.txt is checked before every page fetch;
 *    login-walled platforms are never fetched (no authentication bypass).
 *  - LLM assistance only through the operator's FreeLLMAPI gateway; every
 *    LLM-extracted fact must quote the page verbatim or it is dropped.
 *  - Quota responses (HTTP 429/402) are surfaced as quota signals; there is no
 *    fallback to any other (paid) provider.
 */
import { env } from "@/lib/config/env";
import { safeFetch, SsrfError, assertSafeUrl } from "@/lib/security/ssrf";
import { isAllowed, parseRobots, type RobotsRules } from "@/lib/security/robots";
import { log } from "@/lib/security/logger";
import { extractPage } from "./extract";
import { fingerprint, norm } from "./ledger";
import { chat, gatewayBlocked, gatewayConfig, gatewayHealth, parseJsonReply } from "./freellmapi";
import { executeSynthetic } from "./synthetic-exec";
import { ENGINE_IDS, ENGINE_LABEL, ENTITY_TYPES, type EngineId, type SearchHit } from "./schema";
import type { EngineStatus, EnginesResponse, ExecuteRequest, LlmFact, PageRead, TaskResult } from "./engine-types";

export const NEXUS_UA = "NEXUSBot/1.0 (+public-source research; respects robots.txt)";
const UA_TOKEN = "nexusbot";

// ---------------------------------------------------------------------------
// Mode & availability

export function isHosted(): boolean {
  const e = env();
  return e.NEXUS_HOSTED === "true" || (e.NEXUS_HOSTED !== "false" && Boolean(e.NETLIFY));
}

const LOOPBACK = /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?|host\.docker\.internal|[a-z0-9-]+$)/i;
/** In hosted mode a serverless function cannot reach services bound to the operator's machine. */
function reachable(url: string | undefined): boolean {
  if (!url) return false;
  if (!isHosted()) return true;
  try {
    return !LOOPBACK.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

const META: Record<EngineId, { upstream: string; license: string; integration: string }> = {
  page: { upstream: "github.com/web-scout-ai/web-scout-ai (reference only)", license: "Native NEXUS code (MIT); web-scout-ai is MIT, used as design reference", integration: "Native page investigator: SSRF-safe fetch, robots.txt, link following, structured extraction" },
  searxng: { upstream: "github.com/searxng/searxng", license: "AGPL-3.0 — run unmodified as a separate service", integration: "Separate service, JSON API" },
  gpt_researcher: { upstream: "github.com/assafelovic/gpt-researcher", license: "Apache-2.0", integration: "Python sidecar (services/gpt-researcher-sidecar) using SearXNG + FreeLLMAPI" },
  spiderfoot: { upstream: "github.com/smicallef/spiderfoot", license: "MIT", integration: "Separate service, REST adapter with a free-module allowlist" },
  maigret: { upstream: "github.com/soxoj/maigret", license: "MIT", integration: "Python sidecar (services/osint-python)" },
};

function engineConfig(id: EngineId): { configured: boolean; url?: string; reason: string } {
  const e = env();
  switch (id) {
    case "page":
      return { configured: true, reason: isHosted() ? "Direct public fetch from the hosting function (short, single-page)" : "Direct public fetch" };
    case "searxng":
      return { configured: Boolean(e.SEARXNG_URL), url: e.SEARXNG_URL, reason: e.SEARXNG_URL ? "SEARXNG_URL" : "SEARXNG_URL not set" };
    case "gpt_researcher":
      return { configured: Boolean(e.GPTR_SERVICE_URL), url: e.GPTR_SERVICE_URL, reason: e.GPTR_SERVICE_URL ? "GPTR_SERVICE_URL" : "GPTR_SERVICE_URL not set (local sidecar)" };
    case "spiderfoot":
      return { configured: Boolean(e.SPIDERFOOT_URL), url: e.SPIDERFOOT_URL, reason: e.SPIDERFOOT_URL ? "SPIDERFOOT_URL" : "SPIDERFOOT_URL not set (local service)" };
    case "maigret":
      return { configured: Boolean(e.MAIGRET_SERVICE_URL), url: e.MAIGRET_SERVICE_URL, reason: e.MAIGRET_SERVICE_URL ? "MAIGRET_SERVICE_URL" : "MAIGRET_SERVICE_URL not set (local sidecar)" };
  }
}

/** Synthetic world is offered when explicitly enabled, or (auto) when no discovery service is configured. */
export function syntheticOffered(): boolean {
  const m = env().NEXUS_SYNTHETIC;
  if (m === "true") return true;
  if (m === "false") return false;
  return !ENGINE_IDS.filter((x) => x !== "page").some((x) => engineConfig(x).configured);
}

export function engineStatus(id: EngineId): EngineStatus {
  const c = engineConfig(id);
  const hosted = isHosted();
  const ok = id === "page" ? true : c.configured && reachable(c.url);
  const reason = !c.configured ? c.reason : !ok ? `${c.reason} points to a local address the hosted deployment cannot reach — run NEXUS locally (operator mode) for this engine` : c.reason;
  return { id, label: ENGINE_LABEL[id], available: ok, mode: hosted ? "hosted" : "operator", reason, ...META[id] };
}

export async function enginesResponse(): Promise<EnginesResponse> {
  const cfg = gatewayConfig();
  let llm: EnginesResponse["llm"] = { available: false, reason: cfg.reason, models: [], policy: "FreeLLMAPI gateway only · free providers only · no paid fallback" };
  if (cfg.ok && reachable(cfg.baseUrl)) {
    const h = await gatewayHealth();
    const blocked = gatewayBlocked();
    llm = { ...llm, available: h.ok && !blocked, reason: blocked ? blocked.message : h.reason, models: h.models };
  } else if (cfg.ok) llm = { ...llm, reason: "Gateway URL is local; unreachable from the hosted deployment" };
  return { hosted: isHosted(), synthetic: syntheticOffered(), engines: ENGINE_IDS.map(engineStatus), llm };
}

// ---------------------------------------------------------------------------
// Page investigator

const LOGIN_WALLED = /(^|\.)(linkedin\.com|instagram\.com|facebook\.com|fb\.com|x\.com|twitter\.com|threads\.net|tiktok\.com|whatsapp\.com)$/i;

const g = globalThis as unknown as { __nexusRobots?: Map<string, { at: number; rules: RobotsRules | null }> };
const robotsCache = (g.__nexusRobots ??= new Map());

async function robotsFor(origin: string): Promise<RobotsRules | null> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < 12 * 3_600_000) return hit.rules;
  let rules: RobotsRules | null = { allow: [], disallow: [] };
  try {
    const res = await safeFetch(`${origin}/robots.txt`, { timeoutMs: 6000, maxBytes: 300_000, userAgent: NEXUS_UA, accept: "text/plain,*/*;q=0.5" });
    if (res.status >= 200 && res.status < 300) rules = parseRobots(res.body, UA_TOKEN);
    // RFC 9309: 4xx → allow all; 5xx → treat as complete disallow.
    else if (res.status >= 500) rules = null;
  } catch {
    rules = { allow: [], disallow: [] };
  }
  robotsCache.set(origin, { at: Date.now(), rules });
  return rules;
}

const LLM_PREDICATES = new Set(["owns", "founded", "works_at", "holds_position", "associated_with", "represents", "operates_at", "operates"]);
const LLM_PROMPT = `You extract PUBLICLY DOCUMENTED professional facts from one web page.
Return JSON: {"facts":[{"subject":"","subjectType":"person|business|school|organisation","predicate":"owns|founded|works_at|holds_position|associated_with|represents|operates_at|operates","object":"","objectType":"business|school|organisation","role":"","quote":""}]}
Rules:
- "quote" MUST be copied verbatim from the page text (one sentence). Facts without an exact quote are discarded.
- Only facts the page states explicitly. Never infer family or personal relationships, age, religion, health, ethnicity or private details.
- Only facts involving these names (or their spellings/scripts) or the organisations they are linked to: {{NAMES}}.
- At most 8 facts. Return {"facts":[]} if none.`;

async function llmFacts(text: string, req: ExecuteRequest): Promise<{ facts: LlmFact[]; calls: number; tokens: number; quota?: TaskResult["quota"]; note?: string }> {
  const l = req.context.llm;
  if (!l.enabled || l.remainingCalls <= 0 || !gatewayConfig().ok) return { facts: [], calls: 0, tokens: 0 };
  const tn = norm(text);
  if (!req.context.clueNames.some((n) => tn.includes(norm(n))) && !/[஀-௿ऀ-ॿ]/.test(text)) return { facts: [], calls: 0, tokens: 0 };
  const r = await chat(
    [
      { role: "system", content: LLM_PROMPT.replace("{{NAMES}}", req.context.clueNames.join(", ")) },
      { role: "user", content: `PAGE TEXT:\n${text.slice(0, 6000)}` },
    ],
    l.maxTokensPerCall,
    { json: true, timeoutMs: 20_000 },
  );
  if (r.quota) return { facts: [], calls: 1, tokens: 0, quota: r.quota };
  if (!r.ok) return { facts: [], calls: 1, tokens: 0, note: `LLM assistance failed: ${r.error}` };
  const parsed = parseJsonReply<{ facts?: Partial<LlmFact>[] }>(r.content);
  const facts: LlmFact[] = [];
  for (const f of parsed?.facts ?? []) {
    if (!f.subject || !f.object || !f.quote || !f.predicate || !LLM_PREDICATES.has(f.predicate)) continue;
    // Quote verification: the sentence must exist on the page, and must contain subject and object.
    const q = norm(f.quote);
    if (q.length < 12 || !tn.includes(q) || !q.includes(norm(f.subject)) || !q.includes(norm(f.object).split(" ")[0])) continue;
    const subjectType = (ENTITY_TYPES as readonly string[]).includes(f.subjectType ?? "") ? f.subjectType! : "person";
    const objectType = (["business", "school", "organisation"] as const).find((t) => t === f.objectType) ?? "organisation";
    facts.push({ subject: f.subject.slice(0, 120), subjectType: subjectType as LlmFact["subjectType"], predicate: f.predicate as LlmFact["predicate"], object: f.object.slice(0, 160), objectType, role: f.role?.slice(0, 80), quote: f.quote.slice(0, 400) });
  }
  return { facts, calls: 1, tokens: r.tokens };
}

async function readPage(url: string, req: ExecuteRequest): Promise<{ page: PageRead; llm?: TaskResult["llm"]; notes: string[] }> {
  const at = new Date().toISOString();
  const base = { url, finalUrl: url, fetchedAt: at, synthetic: false };
  let u: URL;
  try {
    u = assertSafeUrl(url);
  } catch (e) {
    return { page: { ...base, fetchStatus: "unsafe_url", httpStatus: null, reason: e instanceof Error ? e.message : "Unsafe URL" }, notes: [] };
  }
  if (LOGIN_WALLED.test(u.hostname.replace(/^www\./, ""))) {
    return { page: { ...base, fetchStatus: "login_wall", httpStatus: null, reason: "Platform content requires sign-in; NEXUS does not access content behind authentication" }, notes: [] };
  }
  const rules = await robotsFor(u.origin);
  if (!rules || !isAllowed(rules, u.pathname + u.search)) {
    return { page: { ...base, fetchStatus: "blocked_robots", httpStatus: null, reason: rules ? "robots.txt disallows this path for automated agents — not fetched" : "robots.txt unavailable (server error) — treated as disallow per RFC 9309" }, notes: [] };
  }
  try {
    const res = await safeFetch(u.toString(), { timeoutMs: 12_000, maxBytes: 2_500_000, userAgent: NEXUS_UA });
    if (res.status === 415) return { page: { ...base, finalUrl: res.url, fetchStatus: "unsupported_type", httpStatus: res.status, reason: "Not an HTML/text document" }, notes: [] };
    if (res.status === 401 || res.status === 403) return { page: { ...base, finalUrl: res.url, fetchStatus: "login_wall", httpStatus: res.status, reason: `HTTP ${res.status} — access restricted; not bypassed` }, notes: [] };
    if (res.status >= 400 || res.status === 0) return { page: { ...base, finalUrl: res.url, fetchStatus: "http_error", httpStatus: res.status, reason: `HTTP ${res.status}` }, notes: [] };
    const extraction = extractPage(res.body, res.url);
    if (/(sign in|log in) to (continue|view)|please log in/i.test(extraction.text.slice(0, 600)) && extraction.text.length < 1500)
      return { page: { ...base, finalUrl: res.url, fetchStatus: "login_wall", httpStatus: res.status, reason: "Page shows a sign-in wall; content not accessed" }, notes: [] };
    const llm = await llmFacts(extraction.text, req);
    const notes = llm.note ? [llm.note] : [];
    return {
      page: { ...base, finalUrl: res.url, fetchStatus: "read", httpStatus: res.status, reason: "OK", contentHash: fingerprint(extraction.text).slice(0, 16), extraction, llmFacts: llm.facts },
      llm: llm.calls ? { calls: llm.calls, tokens: llm.tokens, quota: llm.quota } : undefined,
      notes,
    };
  } catch (e) {
    if (e instanceof SsrfError) return { page: { ...base, fetchStatus: "unsafe_url", httpStatus: null, reason: e.message }, notes: [] };
    return { page: { ...base, fetchStatus: "network_error", httpStatus: null, reason: e instanceof Error ? e.message : "Network error" }, notes: [] };
  }
}

// ---------------------------------------------------------------------------
// Service clients

async function getJson<T>(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<{ status: number; data?: T; text?: string; retryAfter?: number }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  const retryAfter = Number(res.headers.get("retry-after")) || undefined;
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) as T, retryAfter };
  } catch {
    return { status: res.status, text: text.slice(0, 300), retryAfter };
  }
}

function quotaResult(base: Pick<TaskResult, "taskId" | "engine">, provider: string, status: number, retryAfter?: number, msg?: string): TaskResult {
  return { ...base, status: "quota", provider, quota: { provider, status, message: msg ?? (status === 402 ? "Provider requires payment — refused (no paid fallback)" : "Rate limited by the free service"), retryAfterSec: retryAfter ?? 900 } };
}

async function searx(base: Pick<TaskResult, "taskId" | "engine">, query: string): Promise<TaskResult> {
  const root = env().SEARXNG_URL!.replace(/\/+$/, "");
  const r = await getJson<{ results?: { url: string; title?: string; content?: string; engine?: string; publishedDate?: string }[] }>(`${root}/search?${new URLSearchParams({ q: query, format: "json", safesearch: "1" })}`);
  if (r.status === 429 || r.status === 402) return quotaResult(base, "searxng", r.status, r.retryAfter);
  if (r.status === 403) return { ...base, status: "failed", provider: "searxng", error: "SearXNG JSON output disabled — enable `formats: [html, json]` in settings.yml" };
  if (r.status !== 200 || !r.data) return { ...base, status: "failed", provider: "searxng", error: `SearXNG HTTP ${r.status}` };
  const hits: SearchHit[] = (r.data.results ?? []).slice(0, 10).map((x, i) => ({ url: x.url, title: (x.title ?? "").replace(/<[^>]+>/g, "").slice(0, 300), snippet: (x.content ?? "").replace(/<[^>]+>/g, "").slice(0, 500), rank: i, provider: `searxng:${x.engine ?? "mixed"}`.slice(0, 80) }));
  return { ...base, status: "done", provider: "searxng", hits };
}

async function gptResearcher(base: Pick<TaskResult, "taskId" | "engine">, req: ExecuteRequest): Promise<TaskResult> {
  const root = env().GPTR_SERVICE_URL!.replace(/\/+$/, "");
  const t = req.task;
  if (!t.jobRef) {
    const r = await getJson<{ job_id?: string; error?: string }>(`${root}/research`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: t.input.query, max_sources: 8, allow_llm: req.context.llm.enabled && req.context.llm.remainingCalls > 0 }) });
    if (r.status === 429 || r.status === 402) return quotaResult(base, "gpt-researcher", r.status, r.retryAfter, r.data?.error);
    if (!r.data?.job_id) return { ...base, status: "failed", provider: "gpt-researcher", error: r.data?.error ?? `Sidecar HTTP ${r.status}` };
    return { ...base, status: "pending", provider: "gpt-researcher", job: { ref: r.data.job_id, pollAfterMs: 5000 } };
  }
  type Job = { status: "queued" | "running" | "done" | "failed" | "quota"; report?: string; sources?: { url: string; title?: string; excerpt?: string }[]; failed?: { url: string; reason: string }[]; queries?: string[]; error?: string; llm_calls?: number; retry_after?: number };
  const r = await getJson<Job>(`${root}/research/${encodeURIComponent(t.jobRef)}`);
  if (r.status === 404) return { ...base, status: "failed", provider: "gpt-researcher", error: "Research job not found (sidecar restarted?)" };
  const j = r.data;
  if (!j) return { ...base, status: "failed", provider: "gpt-researcher", error: `Sidecar HTTP ${r.status}` };
  if (j.status === "queued" || j.status === "running") return { ...base, status: "pending", provider: "gpt-researcher", job: { ref: t.jobRef, pollAfterMs: 5000 } };
  if (j.status === "quota") return quotaResult(base, "gpt-researcher → freellmapi", 429, j.retry_after, j.error);
  if (j.status === "failed") return { ...base, status: "failed", provider: "gpt-researcher", error: j.error ?? "Research failed" };
  return {
    ...base,
    status: "done",
    provider: "gpt-researcher",
    research: { report: (j.report ?? "").slice(0, 20_000), sources: (j.sources ?? []).slice(0, 20).map((s) => ({ url: s.url, title: s.title ?? s.url, excerpt: (s.excerpt ?? "").slice(0, 600) })), failed: (j.failed ?? []).slice(0, 30), queries: (j.queries ?? []).slice(0, 20) },
    llm: j.llm_calls ? { calls: j.llm_calls, tokens: 0 } : undefined,
  };
}

/** Free, key-less SpiderFoot modules only. Anything needing an API key (often paid) is excluded. */
export const SPIDERFOOT_MODULES = ["sfp_dnsresolve", "sfp_crt", "sfp_whois", "sfp_spider", "sfp_email", "sfp_phone", "sfp_company", "sfp_social", "sfp_pageinfo", "sfp_names", "sfp_webanalytics"];

async function spiderfoot(base: Pick<TaskResult, "taskId" | "engine">, req: ExecuteRequest): Promise<TaskResult> {
  const root = env().SPIDERFOOT_URL!.replace(/\/+$/, "");
  const t = req.task;
  const hdr = { Accept: "application/json" };
  if (!t.jobRef) {
    const domain = (t.input.domain ?? "").toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return { ...base, status: "failed", provider: "spiderfoot", error: "Invalid domain" };
    const notes: string[] = [];
    let modules = SPIDERFOOT_MODULES;
    // The spider module must be configured to honour robots.txt; otherwise it is left out.
    const opts = await getJson<[string, { data?: Record<string, unknown> }]>(`${root}/optsraw`, { headers: hdr }).catch(() => ({ status: 0 }) as { status: number; data?: undefined });
    const robotsOnly = opts.data?.[1]?.data?.["sfp_spider:robotsonly"];
    if (robotsOnly !== true && robotsOnly !== 1 && robotsOnly !== "1" && robotsOnly !== "True") {
      modules = modules.filter((m) => m !== "sfp_spider");
      notes.push("sfp_spider skipped: set its 'robotsonly' option to True in SpiderFoot to enable crawling");
    }
    const form = new URLSearchParams({ scanname: `nexus ${domain}`, scantarget: domain, modulelist: modules.map((m) => `module_${m}`).join(","), typelist: "", usecase: "" });
    const r = await getJson<[string, string]>(`${root}/startscan`, { method: "POST", headers: { ...hdr, "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
    if (r.status === 401) return { ...base, status: "failed", provider: "spiderfoot", error: "SpiderFoot requires authentication; NEXUS expects it bound to localhost without a password file" };
    if (!Array.isArray(r.data) || r.data[0] !== "SUCCESS") return { ...base, status: "failed", provider: "spiderfoot", error: `Scan not started: ${Array.isArray(r.data) ? r.data[1] : `HTTP ${r.status}`}` };
    return { ...base, status: "pending", provider: "spiderfoot", job: { ref: r.data[1], pollAfterMs: 8000 }, notes };
  }
  const st = await getJson<unknown[]>(`${root}/scanstatus?id=${encodeURIComponent(t.jobRef)}`, { headers: hdr });
  const status = Array.isArray(st.data) ? String(st.data[5] ?? "") : "";
  if (!status) return { ...base, status: "failed", provider: "spiderfoot", error: "Scan not found" };
  if (["CREATED", "STARTING", "STARTED", "RUNNING", "INITIALIZING"].includes(status)) return { ...base, status: "pending", provider: "spiderfoot", job: { ref: t.jobRef, pollAfterMs: 8000 } };
  if (status.startsWith("ERROR") || status === "ABORTED") return { ...base, status: "failed", provider: "spiderfoot", error: `SpiderFoot scan ${status}` };
  const ev = await getJson<unknown[][]>(`${root}/scaneventresults?id=${encodeURIComponent(t.jobRef)}&eventType=ALL`, { headers: hdr });
  const rows = Array.isArray(ev.data) ? ev.data : [];
  const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
  const osint = rows
    .map((row) => ({ type: String(row[10] ?? ""), value: decode(String(row[1] ?? "")), module: String(row[3] ?? "") }))
    .filter((e) => e.type && e.type !== "ROOT" && e.value)
    .slice(0, 300);
  return { ...base, status: "done", provider: "spiderfoot", osint };
}

async function maigret(base: Pick<TaskResult, "taskId" | "engine">, username: string): Promise<TaskResult> {
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(username)) return { ...base, status: "failed", provider: "maigret", error: "Invalid username" };
  const root = env().MAIGRET_SERVICE_URL!.replace(/\/+$/, "");
  const r = await getJson<{ found?: { site: string; url: string }[]; error?: string }>(`${root}/username`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, top_sites: 500 }) }, 25_000);
  if (r.status === 429) return quotaResult(base, "maigret", 429, r.retryAfter);
  if (!r.data?.found) return { ...base, status: "failed", provider: "maigret", error: r.data?.error ?? `Sidecar HTTP ${r.status}` };
  return { ...base, status: "done", provider: "maigret", profiles: r.data.found.slice(0, 100).map((f) => ({ site: f.site, url: f.url, username, note: "Account exists; ownership not established by a username match" })) };
}

// ---------------------------------------------------------------------------

export async function executeTask(req: ExecuteRequest): Promise<TaskResult> {
  const t = req.task;
  const base = { taskId: t.id, engine: t.engine };
  if (req.context.synthetic) {
    if (!syntheticOffered() && env().NEXUS_SYNTHETIC === "false") return { ...base, status: "unavailable", error: "Synthetic demo world disabled on this deployment" };
    return executeSynthetic(req);
  }
  const s = engineStatus(t.engine);
  if (!s.available) return { ...base, status: "unavailable", provider: s.label, error: s.reason };
  try {
    switch (t.engine) {
      case "page": {
        const r = await readPage(t.input.url ?? "", req);
        return { ...base, status: "done", provider: "NEXUS page investigator", pages: [r.page], llm: r.llm, notes: r.notes };
      }
      case "searxng":
        return await searx(base, t.input.query ?? "");
      case "gpt_researcher":
        return await gptResearcher(base, req);
      case "spiderfoot":
        return await spiderfoot(base, req);
      case "maigret":
        return await maigret(base, t.input.username ?? "");
    }
  } catch (e) {
    log.warn("nexus.engine_error", { engine: t.engine, error: e instanceof Error ? e.message : "unknown" });
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? "Engine timed out" : e.message) : "Engine error";
    return { ...base, status: "failed", error: msg.slice(0, 300) };
  }
}
