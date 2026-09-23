import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/config/env";
import { activeAdapters, computeCoverage, type ActiveSet } from "@/lib/adapters/registry";
import { BraveAdapter, SearxngAdapter } from "@/lib/adapters/web-search";
import { parseRss, RedditAdapter } from "@/lib/adapters/platforms";
import { findmeVerdict } from "@/lib/adapters/username";
import { DemoAdapter, demoMatches, parseDemoQuery } from "@/lib/adapters/demo/adapter";
import { DEMO_DOCS } from "@/lib/adapters/demo/corpus";
import { AdapterError, type SourceAdapter } from "@/lib/adapters/types";
import { executeQuery } from "@/lib/services/executor";
import { closeDb, getDb, schema } from "@/lib/db/client";
import { queryKey } from "@/lib/core/planner";
import type { PlannedQuery } from "@/lib/core/types";
import { eq } from "drizzle-orm";

const q = (query: string, channel: PlannedQuery["channel"] = "web"): PlannedQuery => ({ query, key: queryKey(query, channel), tier: 2, category: "company_location", channel, reason: "test" });

function withEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
  resetEnvCache();
}

beforeAll(async () => {
  await getDb();
});
afterAll(async () => {
  await closeDb();
});
afterEach(() => {
  vi.unstubAllGlobals();
  withEnv({ DEMO_MODE: "true", SEARXNG_URL: "", BRAVE_SEARCH_API_KEY: "" });
});

describe("missing API keys", () => {
  it("reports unconfigured providers instead of failing", async () => {
    withEnv({ BRAVE_SEARCH_API_KEY: "" });
    const b = new BraveAdapter();
    expect(b.isConfigured()).toBe(false);
    expect((await b.healthCheck()).status).toBe("not_configured");
    expect(await b.isAvailable()).toBe(false);
    withEnv({ REDDIT_CLIENT_ID: "", REDDIT_CLIENT_SECRET: "" });
    expect((await new RedditAdapter().healthCheck()).message).toMatch(/REDDIT_CLIENT_ID/);
  });

  it("falls back to clearly-labelled demo mode when no web provider is reachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    withEnv({ DEMO_MODE: "auto", SEARXNG_URL: "" });
    const a = await activeAdapters();
    expect(a.demo).toBe(true);
    expect(a.demoReason).toMatch(/No real web-search provider/);
    expect(computeCoverage(a).every((c) => c.status === "DEMO")).toBe(true);
  });

  it("never mixes demo data into a real search and reports honest coverage", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("localhost:8080") ? new Response(JSON.stringify({ results: [] }), { status: 200 }) : Promise.reject(new Error("offline")))));
    withEnv({ DEMO_MODE: "auto", SEARXNG_URL: "http://localhost:8080" });
    const a = await activeAdapters();
    expect(a.demo).toBe(false);
    expect(a.search.some((s) => s.isDemo)).toBe(false);
    const cov = Object.fromEntries(computeCoverage(a).map((c) => [c.key, c.status]));
    expect(cov.web).toBe("ACTIVE");
    expect(cov.linkedin).toBe("LIMITED");
    expect(cov.instagram).toBe("LIMITED");
    expect(cov.reddit).toBe("LIMITED");
  });
});

describe("adapter mapping", () => {
  it("maps SearXNG JSON into canonical results", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [{ url: "https://example.com/a", title: "<b>Rajesh</b> Kumar", content: "Project Manager at TCS", engine: "duckduckgo" }] }), { status: 200 })));
    withEnv({ SEARXNG_URL: "http://localhost:8080" });
    const r = await new SearxngAdapter().search(q('"Rajesh Kumar" TCS'), { demoEpoch: 0 });
    expect(r[0]).toMatchObject({ url: "https://example.com/a", title: "Rajesh Kumar", sourceEngine: "searxng:duckduckgo", contentText: "Project Manager at TCS", query: '"Rajesh Kumar" TCS' });
    expect(r[0].discoveredAt).toBeTruthy();
  });

  it("parses news RSS", () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>Rajesh Kumar wins award</title><link>https://news.example.com/1</link><description>&lt;p&gt;TCS Chennai&lt;/p&gt;</description><pubDate>Tue, 22 Sep 2026 10:00:00 GMT</pubDate><source url="https://news.example.com">Example News</source></item></channel></rss>`;
    const r = parseRss(xml, "q", "news_rss");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ url: "https://news.example.com/1", sourceType: "article", author: "Example News" });
    expect(r[0].publishedAt).toBe("2026-09-22T10:00:00.000Z");
  });

  it("applies FindME existence rules conservatively", () => {
    expect(findmeVerdict({ errorType: "status_code", url: "", urlMain: "" }, 200, "")).toBe("found");
    expect(findmeVerdict({ errorType: "status_code", url: "", urlMain: "" }, 404, "")).toBe("not_found");
    expect(findmeVerdict({ errorType: "status_code", url: "", urlMain: "" }, 403, "")).toBe("unknown");
    expect(findmeVerdict({ errorType: "message", errorMsg: "Whoops", url: "", urlMain: "" }, 200, "<h1>Whoops, that page is gone.</h1>")).toBe("not_found");
  });

  it("demo adapter honours phrases, site: and filetype: operators", async () => {
    const doc = DEMO_DOCS.find((d) => d.id === "p1-linkedin")!;
    expect(demoMatches(doc, parseDemoQuery('site:linkedin.com "Rajesh Kumar" TCS'), 0)).toBe(true);
    expect(demoMatches(doc, parseDemoQuery('site:github.com "Rajesh Kumar"'), 0)).toBe(false);
    expect(demoMatches(doc, parseDemoQuery('"Rajesh Kumar" Wipro'), 0)).toBe(false);
    const d = new DemoAdapter();
    const pdf = await d.search(q('"Rajesh Kumar" TCS filetype:pdf'), { demoEpoch: 0 });
    expect(pdf.map((r) => r.url)).toEqual(["https://tcs-alumni.example.org/newsletters/2024-q4.pdf"]);
    expect((await d.search(q('"Rajesh Kumar" summit'), { demoEpoch: 0 })).length).toBe(0);
    expect((await d.search(q('"Rajesh Kumar" summit'), { demoEpoch: 1 })).length).toBe(1);
    expect((await d.check("https://rajeshkumar78.blogspot.com/2023/05/sprint-retrospectives-that-work.html", { demoEpoch: 1 })).httpStatus).toBe(404);
  });
});

describe("adapter failures", () => {
  it("records a failing adapter and still keeps results from healthy ones", async () => {
    const failing = { name: "broken", label: "Broken", description: "", isConfigured: () => true, isAvailable: async () => true, healthCheck: async () => ({ status: "active", message: "", checkedAt: "" }), capabilities: () => ({ roles: ["search"], channels: ["web"], coverage: ["web"], cost: "free", requires: [] }), search: async () => { throw new AdapterError("broken", "HTTP 503", true, 503); } } as unknown as SourceAdapter;
    const demo = new DemoAdapter();
    const active: ActiveSet = { demo: false, demoReason: "", search: [failing, demo], username: [], monitor: [], channels: new Set(["web"]) };
    const db = await getDb();
    const [it] = await db.insert(schema.searchIterations).values({ number: 1, reason: "test" }).returning();
    const r = await executeQuery(q('"Rajesh Kumar" TCS Chennai'), { active, iterationId: it.id, iteration: 1, demoEpoch: 0 });
    expect(r.failures).toBe(1);
    expect(r.results.length).toBeGreaterThan(0);
    const rows = await db.select().from(schema.searchQueries).where(eq(schema.searchQueries.iterationId, it.id));
    expect(rows.find((x) => x.adapter === "broken")).toMatchObject({ status: "failed", error: "[broken] HTTP 503" });
    expect(rows.find((x) => x.adapter === "demo")?.status).toBe("done");
    expect(rows.find((x) => x.adapter === "demo")?.resultCount).toBe(r.results.length);
  });
});
