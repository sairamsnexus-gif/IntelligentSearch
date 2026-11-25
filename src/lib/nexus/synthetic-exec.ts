/**
 * Synthetic engine executor — runs the REAL extraction/ledger code paths over
 * the fictional SYNTHETIC world. Deterministic; used for demo mode and tests.
 * Includes realistic failure modes: robots-blocked social pages, a 404,
 * a SpiderFoot module failure, and an LLM gateway quota (HTTP 429).
 */
import { extractPage } from "./extract";
import { fingerprint, norm } from "./ledger";
import { SYNTHETIC_PAGES, SYNTHETIC_SPIDERFOOT, SYNTHETIC_USERNAMES, syntheticPage } from "./synthetic";
import type { ExecuteRequest, LlmFact, PageRead, TaskResult } from "./engine-types";
import type { SearchHit } from "./schema";

const now = () => new Date().toISOString();

function terms(query: string): { groups: string[][]; bare: string[] } {
  const groups: string[][] = [];
  const bare: string[] = [];
  // "a" OR "b" → one group of alternatives
  const orParts = query.split(/\s+OR\s+/);
  if (orParts.length > 1) {
    const phrases = orParts.map((p) => p.match(/"([^"]+)"/)?.[1]).filter((x): x is string => Boolean(x));
    groups.push(phrases.map(norm));
    for (const w of orParts.join(" ").replace(/"[^"]+"/g, " ").split(/\s+/).filter(Boolean)) bare.push(norm(w));
    return { groups, bare: bare.filter(Boolean) };
  }
  for (const m of query.matchAll(/"([^"]+)"/g)) groups.push([norm(m[1])]);
  for (const w of query.replace(/"[^"]+"/g, " ").split(/\s+/).filter(Boolean)) bare.push(norm(w));
  return { groups, bare: bare.filter(Boolean) };
}

export function syntheticSearch(query: string): SearchHit[] {
  const { groups, bare } = terms(query);
  const scored: { p: (typeof SYNTHETIC_PAGES)[number]; score: number; text: string }[] = [];
  for (const p of SYNTHETIC_PAGES.filter((x) => x.indexed)) {
    const ex = extractPage(p.html, p.url);
    const hay = ` ${norm(`${ex.title} ${ex.text}`)} `;
    if (!groups.every((g) => g.some((ph) => hay.includes(` ${ph} `)))) continue;
    const hits = bare.filter((b) => hay.includes(` ${b} `) || (b.length > 5 && hay.includes(b.slice(0, -1)))).length;
    if (bare.length && hits === 0) continue;
    scored.push({ p, score: groups.length * 2 + hits, text: ex.text });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((s, i) => {
      const ex = extractPage(s.p.html, s.p.url);
      return { url: s.p.url, title: ex.title, snippet: (ex.description || s.text).slice(0, 220), rank: i, provider: "searxng (synthetic)" };
    });
}

/** Simulated LLM gateway behaviour for synthetic mode. */
function syntheticLlm(url: string, text: string, req: ExecuteRequest): { facts: LlmFact[]; calls: number; tokens: number; quota?: TaskResult["quota"] } {
  if (!req.context.llm.enabled || req.context.llm.remainingCalls <= 0) return { facts: [], calls: 0, tokens: 0 };
  // The second syndicated press release hits the (simulated) free-tier limit.
  if (url.includes("chennai-business-news.example")) return { facts: [], calls: 1, tokens: 0, quota: { provider: "freellmapi (synthetic)", status: 429, message: "All configured free providers are rate-limited (simulated)", retryAfterSec: 3600 } };
  const facts: LlmFact[] = [];
  // Rules cannot read the Tamil sentence; the (simulated) LLM can — with a verbatim quote.
  const tamil = "சென்னை அடையாறில் உள்ள லிட்டில் லோட்டஸ் மாண்டிசோரி பள்ளியை அஸ்மா நடத்துகிறார்.";
  if (text.includes(tamil)) facts.push({ subject: "அஸ்மா", subjectType: "person", predicate: "associated_with", object: "Little Lotus Montessori", objectType: "school", role: "runs the school (per Tamil-language article)", quote: tamil });
  return { facts, calls: 1, tokens: 420 };
}

function readSynthetic(url: string, req: ExecuteRequest): { page: PageRead; llm?: TaskResult["llm"] } {
  const p = syntheticPage(url);
  const base = { url, finalUrl: url, fetchedAt: now(), synthetic: true } as const;
  if (!p) return { page: { ...base, fetchStatus: "network_error", httpStatus: null, reason: "Host not reachable (synthetic world has no such page)" } };
  if (p.robotsDisallow) return { page: { ...base, fetchStatus: "blocked_robots", httpStatus: null, reason: "robots.txt disallows automated access — not fetched (no bypass attempted)" } };
  if (p.status >= 400) return { page: { ...base, fetchStatus: "http_error", httpStatus: p.status, reason: `HTTP ${p.status}` } };
  const extraction = extractPage(p.html, p.url);
  const llm = syntheticLlm(url, extraction.text, req);
  return {
    page: { ...base, fetchStatus: "read", httpStatus: 200, reason: "OK", contentHash: fingerprint(extraction.text).slice(0, 16), extraction, llmFacts: llm.facts },
    llm: llm.calls ? { calls: llm.calls, tokens: llm.tokens, quota: llm.quota } : undefined,
  };
}

const jobs = new Map<string, number>();

export function executeSynthetic(req: ExecuteRequest): TaskResult {
  const t = req.task;
  const base = { taskId: t.id, engine: t.engine, synthetic: true } as const;
  switch (t.engine) {
    case "searxng":
      return { ...base, status: "done", provider: "searxng (synthetic)", hits: syntheticSearch(t.input.query ?? "") };
    case "page": {
      const r = readSynthetic(t.input.url ?? "", req);
      return { ...base, status: "done", provider: "page reader (synthetic world)", pages: [r.page], llm: r.llm };
    }
    case "maigret": {
      const found = SYNTHETIC_USERNAMES[(t.input.username ?? "").toLowerCase()] ?? [];
      return { ...base, status: "done", provider: "maigret (synthetic)", profiles: found.map((f) => ({ site: f.site, url: f.url, username: t.input.username!, note: "Account exists; ownership not established by a username match" })) };
    }
    case "spiderfoot": {
      if (!t.jobRef) {
        const ref = `sf-${t.id}`;
        jobs.set(ref, 0);
        return { ...base, status: "pending", provider: "spiderfoot (synthetic)", job: { ref, pollAfterMs: 500 } };
      }
      const d = (t.input.domain ?? "").toLowerCase();
      const world = SYNTHETIC_SPIDERFOOT[d];
      if (world?.fail) return { ...base, status: "failed", provider: "spiderfoot (synthetic)", error: world.fail };
      return { ...base, status: "done", provider: "spiderfoot (synthetic)", osint: (world?.events ?? []).map((e) => ({ type: e.type, value: e.data, module: e.module })), notes: world ? [] : ["No events for this domain"] };
    }
    case "gpt_researcher": {
      if (!t.jobRef) return { ...base, status: "pending", provider: "gpt-researcher (synthetic)", job: { ref: `gptr-${t.id}`, pollAfterMs: 800 } };
      const q = t.input.query ?? "";
      const keys = [...req.context.clueNames, ...req.context.organisationHints.map((h) => h.split(" ")[0]), ...(q.match(/[A-Z][a-z]+(?:\s[A-Z][a-z]+)+/g) ?? [])].map(norm);
      const rel = SYNTHETIC_PAGES.filter((p) => p.indexed && !p.robotsDisallow && p.status < 400)
        .map((p) => ({ p, ex: extractPage(p.html, p.url) }))
        .map((x) => ({ ...x, score: keys.filter((k) => ` ${norm(`${x.ex.title} ${x.ex.text}`)} `.includes(` ${k} `)).length }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
      const report = `## Research notes (AI-generated, synthetic)\n\nQuestion: ${q}\n\n${rel.map((r, i) => `${i + 1}. ${r.ex.title} — ${r.ex.text.slice(0, 160)}… [source](${r.p.url})`).join("\n")}\n\nThese notes are leads, not evidence: each cited page is opened and verified by the Page Investigator before any fact enters the evidence ledger.`;
      return {
        ...base,
        status: "done",
        provider: "gpt-researcher (synthetic)",
        research: { report, sources: rel.map((r) => ({ url: r.p.url, title: r.ex.title, excerpt: r.ex.text.slice(0, 300) })), failed: [{ url: "https://www.instagram.com/sivasmagarments", reason: "robots.txt disallows — skipped" }], queries: [q] },
      };
    }
  }
}
