import "server-only";
/**
 * Platform adapters using official public APIs: GitHub REST, Reddit OAuth
 * (client credentials), YouTube Data API v3, and Google News RSS.
 * No scraping of logged-in pages, no private data.
 */
import { XMLParser } from "fast-xml-parser";
import { BaseAdapter } from "./base";
import { AdapterError, type AdapterCapabilities, type AdapterContext, type CheckResult } from "./types";
import { health, makeResult, providerFetch, providerJson, stripHtml, timed } from "./http";
import { env } from "@/lib/config/env";
import { parseProfileUrl } from "@/lib/core/profiles";
import type { PlannedQuery, SearchResult } from "@/lib/core/types";

// ---------------------------------------------------------------------------
interface GhUser {
  login: string;
  html_url: string;
  name?: string | null;
  company?: string | null;
  location?: string | null;
  bio?: string | null;
  blog?: string | null;
  email?: string | null;
  twitter_username?: string | null;
  avatar_url?: string;
  public_repos?: number;
  created_at?: string;
}

export class GitHubAdapter extends BaseAdapter {
  name = "github";
  label = "GitHub public API";
  description = "Public user profiles, user search and public activity. Works without a token (60 req/h); GITHUB_TOKEN raises limits.";
  isConfigured() {
    return true;
  }
  capabilities(): AdapterCapabilities {
    return { roles: ["search", "username", "monitor"], channels: ["github"], coverage: ["github"], cost: "free", requires: [] };
  }
  private headers(): HeadersInit {
    const h: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "IntelligentSearch" };
    const t = env().GITHUB_TOKEN;
    if (t) h.Authorization = `Bearer ${t}`;
    return h;
  }
  protected async probe() {
    const [res, ms] = await timed(() => providerFetch("https://api.github.com/rate_limit", { headers: this.headers() }, { adapter: this.name, timeoutMs: 5000, retries: 0 }));
    if (!res.ok) return health("unavailable", `HTTP ${res.status}`, ms);
    const data = (await res.json()) as { resources?: { core?: { remaining: number; limit: number } } };
    const core = data.resources?.core;
    return health(core && core.remaining < 5 ? "limited" : "active", core ? `${core.remaining}/${core.limit} requests left` : "Reachable", ms);
  }
  private toResult(u: GhUser, query: string): SearchResult {
    const text = [u.name, u.bio, u.company && `Works at ${u.company}`, u.location, u.blog && `Website: ${u.blog}`, u.twitter_username && `https://x.com/${u.twitter_username}`].filter(Boolean).join(". ");
    return makeResult({
      query,
      sourceEngine: this.name,
      sourcePlatform: "github",
      url: u.html_url,
      title: `${u.name ?? u.login} (${u.login}) · GitHub`,
      description: u.bio ?? "",
      contentText: text,
      name: u.name ?? null,
      username: u.login,
      location: u.location ?? null,
      organization: u.company?.replace(/^@/, "") ?? null,
      emails: u.email ? [u.email] : [],
      imageUrl: u.avatar_url ?? null,
      sourceType: "profile",
      rawMetadata: { public_repos: u.public_repos, created_at: u.created_at },
    });
  }
  async getUser(login: string, ctx?: AdapterContext): Promise<GhUser | null> {
    const res = await providerFetch(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers: this.headers() }, { adapter: this.name, signal: ctx?.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new AdapterError(this.name, `HTTP ${res.status}`, res.status >= 500, res.status);
    return (await res.json()) as GhUser;
  }
  async search(q: PlannedQuery, ctx: AdapterContext): Promise<SearchResult[]> {
    if (q.handle) {
      const u = await this.getUser(q.handle, ctx);
      return u ? [this.toResult(u, q.query)] : [];
    }
    // "Name" City → fullname search qualified by location
    const phrase = q.query.match(/"([^"]+)"/)?.[1] ?? q.query;
    const rest = q.query.replace(/"[^"]+"/, "").trim();
    const ghq = `${phrase} in:name${rest ? ` location:${rest.split(/\s+/)[0]}` : ""} type:user`;
    const data = await providerJson<{ items?: { login: string }[] }>(`https://api.github.com/search/users?${new URLSearchParams({ q: ghq, per_page: "5" })}`, { headers: this.headers() }, { adapter: this.name, signal: ctx.signal, ratePerSec: 0.5 });
    const out: SearchResult[] = [];
    for (const item of (data.items ?? []).slice(0, 5)) {
      const u = await this.getUser(item.login, ctx);
      if (u) out.push(this.toResult(u, q.query));
    }
    return out;
  }
  async searchUsername(username: string, ctx: AdapterContext) {
    const u = await this.getUser(username, ctx);
    return u ? [this.toResult(u, username)] : [];
  }
  supportedPlatforms() {
    return ["github"];
  }
  canMonitor(url: string) {
    return parseProfileUrl(url)?.platform === "github";
  }
  async check(url: string, ctx: AdapterContext): Promise<CheckResult> {
    const p = parseProfileUrl(url);
    if (!p) return { available: false, httpStatus: null, contentText: "", method: "github_api", error: "Not a GitHub profile URL" };
    const u = await this.getUser(p.handle, ctx);
    if (!u) return { available: false, httpStatus: 404, contentText: "", method: "github_api" };
    const events = await providerJson<{ type: string; repo?: { name: string }; created_at: string }[]>(
      `https://api.github.com/users/${encodeURIComponent(p.handle)}/events/public?per_page=10`,
      { headers: this.headers() },
      { adapter: this.name, signal: ctx.signal },
    ).catch(() => []);
    const lines = [
      `Name: ${u.name ?? ""}`,
      `Bio: ${u.bio ?? ""}`,
      `Company: ${u.company ?? ""}`,
      `Location: ${u.location ?? ""}`,
      `Website: ${u.blog ?? ""}`,
      `Public repositories: ${u.public_repos ?? 0}`,
      ...events.slice(0, 10).map((e) => `Activity: ${e.type} ${e.repo?.name ?? ""} ${e.created_at.slice(0, 10)}`),
    ];
    return { available: true, httpStatus: 200, title: `${u.name ?? u.login} · GitHub`, contentText: lines.join("\n"), method: "github_api" };
  }
}

// ---------------------------------------------------------------------------
export class RedditAdapter extends BaseAdapter {
  name = "reddit";
  label = "Reddit API";
  description = "Public posts and user profiles via official OAuth (client credentials).";
  private token?: { value: string; exp: number };
  isConfigured() {
    const e = env();
    return Boolean(e.REDDIT_CLIENT_ID && e.REDDIT_CLIENT_SECRET);
  }
  capabilities(): AdapterCapabilities {
    return { roles: ["search", "username", "monitor"], channels: ["reddit"], coverage: ["reddit"], cost: "free", requires: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"] };
  }
  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const e = env();
    const basic = Buffer.from(`${e.REDDIT_CLIENT_ID}:${e.REDDIT_CLIENT_SECRET}`).toString("base64");
    const data = await providerJson<{ access_token?: string; expires_in?: number }>(
      "https://www.reddit.com/api/v1/access_token",
      { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": e.REDDIT_USER_AGENT }, body: "grant_type=client_credentials" },
      { adapter: this.name, retries: 1 },
    );
    if (!data.access_token) throw new AdapterError(this.name, "OAuth token not issued");
    this.token = { value: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }
  private async api<T>(path: string, ctx?: AdapterContext): Promise<T> {
    const tok = await this.accessToken();
    return providerJson<T>(`https://oauth.reddit.com${path}`, { headers: { Authorization: `Bearer ${tok}`, "User-Agent": env().REDDIT_USER_AGENT } }, { adapter: this.name, signal: ctx?.signal, ratePerSec: 0.8 });
  }
  protected async probe() {
    const [, ms] = await timed(() => this.accessToken());
    return health("active", "OAuth token issued", ms);
  }
  async search(q: PlannedQuery, ctx: AdapterContext): Promise<SearchResult[]> {
    if (q.handle) return this.searchUsername(q.handle, ctx);
    type Listing = { data?: { children?: { data: { permalink: string; title: string; selftext?: string; author: string; created_utc: number; subreddit: string } }[] } };
    const data = await this.api<Listing>(`/search?${new URLSearchParams({ q: q.query, limit: "10", sort: "relevance", type: "link" })}`, ctx);
    return (data.data?.children ?? []).map(({ data: p }) =>
      makeResult({
        query: q.query,
        sourceEngine: this.name,
        sourcePlatform: "reddit",
        url: `https://www.reddit.com${p.permalink}`,
        title: p.title,
        description: (p.selftext ?? "").slice(0, 300),
        contentText: `${p.title}\n${p.selftext ?? ""}\nPosted by u/${p.author} in r/${p.subreddit}`,
        author: p.author,
        publishedAt: new Date(p.created_utc * 1000).toISOString(),
        sourceType: "post",
      }),
    );
  }
  async searchUsername(username: string, ctx: AdapterContext) {
    try {
      const about = await this.api<{ data?: { name: string; subreddit?: { public_description?: string; title?: string }; created_utc?: number } }>(`/user/${encodeURIComponent(username)}/about`, ctx);
      if (!about.data) return [];
      return [
        makeResult({
          query: username,
          sourceEngine: this.name,
          sourcePlatform: "reddit",
          url: `https://www.reddit.com/user/${about.data.name}`,
          title: `u/${about.data.name} · Reddit`,
          description: about.data.subreddit?.public_description ?? "",
          contentText: [about.data.subreddit?.title, about.data.subreddit?.public_description].filter(Boolean).join(". "),
          username: about.data.name,
          sourceType: "profile",
        }),
      ];
    } catch (e) {
      if (e instanceof AdapterError && e.status === 404) return [];
      throw e;
    }
  }
  supportedPlatforms() {
    return ["reddit"];
  }
  canMonitor(url: string) {
    return parseProfileUrl(url)?.platform === "reddit";
  }
  async check(url: string, ctx: AdapterContext): Promise<CheckResult> {
    const p = parseProfileUrl(url);
    if (!p) return { available: false, httpStatus: null, contentText: "", method: "reddit_api", error: "Not a Reddit profile" };
    type Listing = { data?: { children?: { data: { title?: string; body?: string; subreddit: string; created_utc: number; permalink: string } }[] } };
    try {
      const data = await this.api<Listing>(`/user/${encodeURIComponent(p.handle)}/overview?limit=10`, ctx);
      const lines = (data.data?.children ?? []).map(({ data: d }) => `r/${d.subreddit} ${new Date(d.created_utc * 1000).toISOString().slice(0, 10)}: ${(d.title ?? d.body ?? "").slice(0, 160)}`);
      return { available: true, httpStatus: 200, title: `u/${p.handle}`, contentText: lines.join("\n"), method: "reddit_api" };
    } catch (e) {
      if (e instanceof AdapterError && (e.status === 404 || e.status === 403)) return { available: false, httpStatus: e.status ?? null, contentText: "", method: "reddit_api" };
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
export class YouTubeAdapter extends BaseAdapter {
  name = "youtube";
  label = "YouTube Data API";
  description = "Public channel search via YouTube Data API v3 (key required).";
  isConfigured() {
    return Boolean(env().YOUTUBE_API_KEY);
  }
  capabilities(): AdapterCapabilities {
    return { roles: ["search"], channels: ["youtube"], coverage: ["youtube"], cost: "free_tier", requires: ["YOUTUBE_API_KEY"] };
  }
  protected async probe() {
    return health("active", "Key configured (quota checked on use)");
  }
  async search(q: PlannedQuery, ctx: AdapterContext): Promise<SearchResult[]> {
    type Resp = { items?: { id: { channelId?: string }; snippet: { title: string; description: string; customUrl?: string; thumbnails?: { default?: { url: string } } } }[] };
    const data = await providerJson<Resp>(
      `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({ part: "snippet", type: "channel", maxResults: "8", q: q.query.replace(/"/g, "") })}`,
      { headers: { "X-goog-api-key": env().YOUTUBE_API_KEY! } },
      { adapter: this.name, signal: ctx.signal },
    );
    return (data.items ?? [])
      .filter((i) => i.id.channelId)
      .map((i) =>
        makeResult({
          query: q.query,
          sourceEngine: this.name,
          sourcePlatform: "youtube",
          url: `https://www.youtube.com/channel/${i.id.channelId}`,
          title: `${i.snippet.title} · YouTube`,
          description: i.snippet.description,
          contentText: `${i.snippet.title}. ${i.snippet.description}`,
          name: i.snippet.title,
          imageUrl: i.snippet.thumbnails?.default?.url ?? null,
          sourceType: "profile",
        }),
      );
  }
}

// ---------------------------------------------------------------------------
export class NewsRssAdapter extends BaseAdapter {
  name = "news_rss";
  label = "Google News RSS";
  description = "Public news mentions via the Google News RSS search feed. Free, no key.";
  isConfigured() {
    return true;
  }
  capabilities(): AdapterCapabilities {
    return { roles: ["search"], channels: ["news"], coverage: ["news"], cost: "free", requires: [] };
  }
  protected async probe() {
    const [res, ms] = await timed(() => providerFetch("https://news.google.com/rss/search?q=test&hl=en-IN&gl=IN&ceid=IN:en", {}, { adapter: this.name, timeoutMs: 6000, retries: 0 }));
    return res.ok ? health("active", "Reachable", ms) : health("unavailable", `HTTP ${res.status}`, ms);
  }
  async search(q: PlannedQuery, ctx: AdapterContext): Promise<SearchResult[]> {
    const res = await providerFetch(`https://news.google.com/rss/search?${new URLSearchParams({ q: q.query, hl: "en-IN", gl: "IN", ceid: "IN:en" })}`, {}, { adapter: this.name, signal: ctx.signal, ratePerSec: 0.5 });
    if (!res.ok) throw new AdapterError(this.name, `HTTP ${res.status}`, res.status >= 500, res.status);
    return parseRss(await res.text(), q.query, this.name);
  }
}

export function parseRss(xml: string, query: string, engine: string): SearchResult[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: RssItem | RssItem[] } } };
  const items = doc.rss?.channel?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  return list.slice(0, 10).map((i) => {
    const desc = stripHtml(String(i.description ?? ""));
    const source = typeof i.source === "object" ? i.source?.["#text"] : i.source;
    return makeResult({
      query,
      sourceEngine: engine,
      sourcePlatform: "news",
      url: String(i.link),
      title: stripHtml(String(i.title ?? "")),
      description: desc,
      contentText: `${stripHtml(String(i.title ?? ""))}. ${desc}`,
      publishedAt: i.pubDate ? new Date(String(i.pubDate)).toISOString() : null,
      author: source ? String(source) : null,
      sourceType: "article",
    });
  });
}
interface RssItem {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  source?: string | { "#text"?: string };
}
