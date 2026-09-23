import "server-only";
/**
 * General web-search providers: SearXNG (local, free), Brave, Serper, Tavily
 * (optional keys) and the DeepSearch search/scrape services (optional).
 */
import { BaseAdapter } from "./base";
import { AdapterError, type AdapterCapabilities, type AdapterContext } from "./types";
import { health, makeResult, providerFetch, providerJson, stripHtml, timed } from "./http";
import { env } from "@/lib/config/env";
import type { PlannedQuery, SearchResult } from "@/lib/core/types";

const MAX_RESULTS = 10;

// ---------------------------------------------------------------------------
export class SearxngAdapter extends BaseAdapter {
  name = "searxng";
  label = "SearXNG";
  description = "Self-hosted privacy-respecting metasearch (web, news, images). Free.";
  isConfigured() {
    return Boolean(env().SEARXNG_URL);
  }
  capabilities(): AdapterCapabilities {
    return { roles: ["search"], channels: ["web", "news", "images"], coverage: ["web", "news", "images", "documents"], cost: "local", requires: ["SEARXNG_URL"], upstream: "https://github.com/searxng/searxng" };
  }
  private base() {
    return env().SEARXNG_URL!.replace(/\/+$/, "");
  }
  protected async probe() {
    const [res, ms] = await timed(() => providerFetch(`${this.base()}/search?q=test&format=json`, {}, { adapter: this.name, timeoutMs: 5000, retries: 0 }));
    if (res.status === 403) return health("unavailable", "JSON format disabled — enable `formats: [html, json]` in SearXNG settings.yml", ms);
    return res.ok ? health("active", "Reachable", ms) : health("unavailable", `HTTP ${res.status}`, ms);
  }
  async search(q: PlannedQuery, ctx: AdapterContext): Promise<SearchResult[]> {
    const category = q.channel === "news" ? "news" : q.channel === "images" ? "images" : "general";
    const url = `${this.base()}/search?${new URLSearchParams({ q: q.query, format: "json", categories: category, safesearch: "1" })}`;
    const data = await providerJson<{ results?: { url: string; title: string; content?: string; publishedDate?: string; img_src?: string; engine?: string; author?: string }[] }>(url, {}, { adapter: this.name, signal: ctx.signal, ratePerSec: 2 });
    return (data.results ?? []).slice(0, MAX_RESULTS).map((r) =>
      makeResult({
        query: q.query,
        sourceEngine: `searxng:${r.engine ?? "mixed"}`,
        url: r.url,
        title: stripHtml(r.title ?? ""),
        description: stripHtml(r.content ?? ""),
        contentText: stripHtml(r.content ?? ""),
        publishedAt: r.publishedDate ?? null,
        imageUrl: r.img_src ?? null,
        author: r.author ?? null,
        sourceType: q.channel === "news" ? "article" : q.channel === "images" ? "image" : undefined,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
export class BraveAdapter extends BaseAdapter {
  name = "brave";
  label = "Brave Search API";
  description = "Independent web index. Free tier available (key required).";
  isConfigured() {
    return Boolean(env().BRAVE_SEARCH_API_KEY);
  }
  capabilities(): AdapterCapabilities {
    return { roles: ["search"], channels: ["web", "news"], coverage: ["web", "news", "documents"], cost: "free_tier", requires: ["BRAVE_SEARCH_API_KEY"] };
  }
  protected async probe() {
    return health("active", "Key configured (quota checked on use)");
  }
  async search(q: PlannedQuery, ctx: AdapterContext): Promise<SearchResult[]> {
    const endpoint = q.channel === "news" ? "news/search" : "web/search";
    const url = `https://api.search.brave.com/res/v1/${endpoint}?${new URLSearchParams({ q: q.query, count: String(MAX_RESULTS) })}`;
    const data = await providerJson<{ web?: { results?: BraveItem[] }; results?: BraveItem[] }>(
      url,
      { headers: { "X-Subscription-Token": env().BRAVE_SEARCH_API_KEY!, Accept: "application/json" } },
      { adapter: this.name, signal: ctx.signal, ratePerSec: 1 },
    );
    const items = data.web?.results ?? data.results ?? [];
    return items.map((r) =>
      makeResult({
        query: q.query,
        sourceEngine: this.name,
        url: r.url,
        title: stripHtml(r.title),
        description: stripHtml(r.description ?? ""),
        contentText: stripHtml([r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join(" ")),
        publishedAt: r.page_age ?? null,
        imageUrl: r.thumbnail?.src ?? null,
        sourceType: q.channel === "news" ? "article" : undefined,
      }),
    );
  }
}
interface BraveItem {
  url: string;
  title: string;
  description?: string;
  extra_snippets?: string[];
  page_age?: string;
  thumbnail?: { src?: string };
}

// ---------------------------------------------------------------------------
export class SerperAdapter extends BaseAdapter {
  name = "serper";
  label = "Serper (Google results)";
  description = "Google SERP API. Free trial credits (key required).";
  isConfigured() {
    return Boolean(env().SERPER_API_KEY);
  }
  capabilities(): AdapterCapabilities {
    return { roles: ["search"], channels: ["web", "news", "images"], coverage: ["web", "news", "images", "documents"], cost: "free_tier", requires: ["SERPER_API_KEY"] };
  }
  protected async probe() {
    return health("active", "Key configured (quota checked on use)");
  }
  async search(q: PlannedQuery, ctx: AdapterContext): Promise<SearchResult[]> {
    const path = q.channel === "news" ? "news" : q.channel === "images" ? "images" : "search";
    const data = await providerJson<{ organic?: SerperItem[]; news?: SerperItem[]; images?: SerperItem[] }>(
      `https://google.serper.dev/${path}`,
      { method: "POST", headers: { "X-API-KEY": env().SERPER_API_KEY!, "Content-Type": "application/json" }, body: JSON.stringify({ q: q.query, num: MAX_RESULTS }) },
      { adapter: this.name, signal: ctx.signal, ratePerSec: 2 },
    );
    const items = data.organic ?? data.news ?? data.images ?? [];
    return items.map((r) =>
      makeResult({
        query: q.query,
        sourceEngine: this.name,
        url: r.link,
        title: r.title,
        description: r.snippet ?? "",
        contentText: r.snippet ?? "",
        publishedAt: r.date ?? null,
        imageUrl: r.imageUrl ?? null,
        sourceType: q.channel === "news" ? "article" : q.channel === "images" ? "image" : undefined,
      }),
    );
  }
}
interface SerperItem {
  link: string;
  title: string;
  snippet?: string;
  date?: string;
  imageUrl?: string;
}

// ---------------------------------------------------------------------------
export class TavilyAdapter extends BaseAdapter {
  name = "tavily";
  label = "Tavily";
  description = "LLM-oriented search API with page content. Free tier (key required).";
  isConfigured() {
    return Boolean(env().TAVILY_API_KEY);
  }
  capabilities(): AdapterCapabilities {
    return { roles: ["search"], channels: ["web", "news"], coverage: ["web", "news"], cost: "free_tier", requires: ["TAVILY_API_KEY"] };
  }
  protected async probe() {
    return health("active", "Key configured (quota checked on use)");
  }
  async search(q: PlannedQuery, ctx: AdapterContext): Promise<SearchResult[]> {
    const data = await providerJson<{ results?: { url: string; title: string; content?: string; published_date?: string }[] }>(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env().TAVILY_API_KEY!}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.query, max_results: MAX_RESULTS, topic: q.channel === "news" ? "news" : "general", search_depth: "basic" }),
      },
      { adapter: this.name, signal: ctx.signal, ratePerSec: 1 },
    );
    return (data.results ?? []).map((r) =>
      makeResult({ query: q.query, sourceEngine: this.name, url: r.url, title: r.title, description: (r.content ?? "").slice(0, 400), contentText: r.content ?? "", publishedAt: r.published_date ?? null }),
    );
  }
}

// ---------------------------------------------------------------------------
/**
 * DeepSearch (github.com/Tasmay-Tibrewal/deepsearch) exposes two aiohttp
 * services: POST /search {query, max_pages} → [{title,url,description}] and
 * POST /scrape {urls} → {scraped_data:[{url,title,text_content}]}. The
 * upstream repo has no licence file, so we integrate over HTTP only and vendor
 * no code. Run it yourself and set SEARCH_API_URL / SCRAPER_API_URL.
 */
export class DeepSearchAdapter extends BaseAdapter {
  name = "deepsearch";
  label = "DeepSearch services";
  description = "External DeepSearch search + scraper microservices (optional, self-run).";
  isConfigured() {
    return Boolean(env().SEARCH_API_URL);
  }
  capabilities(): AdapterCapabilities {
    return { roles: ["search"], channels: ["web"], coverage: ["web"], cost: "local", requires: ["SEARCH_API_URL"], upstream: "https://github.com/Tasmay-Tibrewal/deepsearch" };
  }
  protected async probe() {
    const url = env().SEARCH_API_URL!;
    const [res, ms] = await timed(() => providerFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, { adapter: this.name, timeoutMs: 5000, retries: 0 }));
    // Service answers 400 "Missing 'query'" to an empty body when healthy.
    return res.status === 400 || res.ok ? health("active", "Reachable", ms) : health("unavailable", `HTTP ${res.status}`, ms);
  }
  async search(q: PlannedQuery, ctx: AdapterContext): Promise<SearchResult[]> {
    const data = await providerJson<{ title?: string; url: string; description?: string }[]>(
      env().SEARCH_API_URL!,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q.query, max_pages: 1 }) },
      { adapter: this.name, signal: ctx.signal, timeoutMs: 45_000, retries: 1 },
    );
    if (!Array.isArray(data)) throw new AdapterError(this.name, "Unexpected response shape");
    const results = data.slice(0, MAX_RESULTS).map((r) =>
      makeResult({ query: q.query, sourceEngine: this.name, url: r.url, title: r.title ?? r.url, description: r.description ?? "", contentText: r.description ?? "" }),
    );
    return this.enrich(results, ctx);
  }

  /** Optional: fetch page text via the DeepSearch scraper to improve extraction. */
  private async enrich(results: SearchResult[], ctx: AdapterContext): Promise<SearchResult[]> {
    const scraper = env().SCRAPER_API_URL;
    if (!scraper || !results.length) return results;
    try {
      const data = await providerJson<{ scraped_data?: { url: string; title?: string; text_content?: string }[] }>(
        scraper,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls: results.slice(0, 5).map((r) => r.url), timeout: 15 }) },
        { adapter: `${this.name}-scraper`, signal: ctx.signal, timeoutMs: 30_000, retries: 0 },
      );
      const byUrl = new Map((data.scraped_data ?? []).map((d) => [d.url, d]));
      return results.map((r) => {
        const d = byUrl.get(r.url);
        return d?.text_content ? { ...r, contentText: d.text_content.slice(0, 20_000) } : r;
      });
    } catch {
      return results;
    }
  }
}
