import "server-only";
/**
 * Username discovery.
 *  - FindME adapter: TypeScript re-implementation of FindME's site-check rules
 *    over a curated, licence-attributed subset of its data.json (MIT). Runs
 *    in-process, no Python needed. Existence of a username is a *weak* signal.
 *  - Maigret adapter: calls the Python sidecar in services/osint-python which
 *    wraps the Maigret library (3000+ sites, profile parsing).
 */
import sites from "./data/findme-sites.json";
import { BaseAdapter } from "./base";
import { AdapterError, type AdapterCapabilities, type AdapterContext } from "./types";
import { health, makeResult, providerJson, timed } from "./http";
import { env } from "@/lib/config/env";
import { safeFetch } from "@/lib/security/ssrf";
import { mapWithConcurrency } from "@/lib/security/rate-limit";
import type { PlannedQuery, SearchResult } from "@/lib/core/types";

interface FindmeSite {
  errorType: "status_code" | "message" | "response_url";
  errorMsg?: string | string[];
  regexCheck?: string;
  url: string;
  urlMain: string;
  urlProbe?: string;
}

const SITES = (sites as { sites: Record<string, FindmeSite> }).sites;

export function findmeVerdict(site: FindmeSite, status: number, body: string): "found" | "not_found" | "unknown" {
  if (status === 0 || status >= 500 || status === 429 || status === 403) return "unknown";
  if (site.errorType === "status_code") return status >= 200 && status < 300 ? "found" : status === 404 || status === 410 ? "not_found" : "unknown";
  if (site.errorType === "message") {
    const msgs = Array.isArray(site.errorMsg) ? site.errorMsg : site.errorMsg ? [site.errorMsg] : [];
    if (status === 404) return "not_found";
    return msgs.some((m) => body.includes(m)) ? "not_found" : status >= 200 && status < 300 ? "found" : "unknown";
  }
  return "unknown";
}

export class FindmeAdapter extends BaseAdapter {
  name = "findme";
  label = "FindME username check";
  description = `Checks ${Object.keys(SITES).length} public platforms for a username (rules from FindME, MIT). Existence ≠ identity.`;
  isConfigured() {
    return true;
  }
  capabilities(): AdapterCapabilities {
    return { roles: ["username"], channels: ["username"], coverage: ["username"], cost: "free", requires: [], upstream: "https://github.com/0xSaikat/findme" };
  }
  protected async probe() {
    return health("active", `${Object.keys(SITES).length} platforms`);
  }
  supportedPlatforms() {
    return Object.keys(SITES);
  }
  async search(q: PlannedQuery, ctx: AdapterContext) {
    return this.searchUsername(q.handle ?? q.query, ctx);
  }
  async searchUsername(username: string, ctx: AdapterContext): Promise<SearchResult[]> {
    const u = username.trim().replace(/^@/, "");
    const entries = Object.entries(SITES).filter(([, s]) => !s.regexCheck || new RegExp(s.regexCheck).test(u));
    const found = await mapWithConcurrency(entries, 4, async ([siteName, s]) => {
      if (ctx.signal?.aborted) return null;
      const probe = (s.urlProbe ?? s.url).replace("{}", encodeURIComponent(u));
      try {
        const res = await safeFetch(probe, { timeoutMs: 8000, maxRedirects: 2, maxBytes: 400_000 });
        return findmeVerdict(s, res.status, res.body) === "found" ? { siteName, url: s.url.replace("{}", u) } : null;
      } catch {
        return null;
      }
    });
    return found
      .filter((f): f is { siteName: string; url: string } => Boolean(f))
      .map((f) =>
        makeResult({
          query: username,
          sourceEngine: this.name,
          sourcePlatform: f.siteName.toLowerCase(),
          url: f.url,
          title: `${u} on ${f.siteName}`,
          description: `A public account named "${u}" exists on ${f.siteName}. Ownership not verified.`,
          contentText: `Username ${u} exists on ${f.siteName}.`,
          username: u,
          sourceType: "profile",
          rawMetadata: { weakSignal: true },
        }),
      );
  }
}

export class MaigretAdapter extends BaseAdapter {
  name = "maigret";
  label = "Maigret (Python sidecar)";
  description = "Username search across thousands of sites with profile parsing, via services/osint-python.";
  isConfigured() {
    return Boolean(env().MAIGRET_SERVICE_URL);
  }
  capabilities(): AdapterCapabilities {
    return { roles: ["username"], channels: ["username"], coverage: ["username"], cost: "local", requires: ["MAIGRET_SERVICE_URL"], upstream: "https://github.com/soxoj/maigret" };
  }
  private base() {
    return env().MAIGRET_SERVICE_URL!.replace(/\/+$/, "");
  }
  protected async probe() {
    const [data, ms] = await timed(() => providerJson<{ ok: boolean; maigret?: string; sites?: number }>(`${this.base()}/health`, {}, { adapter: this.name, timeoutMs: 5000, retries: 0 }));
    return data.ok ? health("active", `maigret ${data.maigret ?? ""} · ${data.sites ?? "?"} sites`, ms) : health("unavailable", "Sidecar reports not ready", ms);
  }
  supportedPlatforms() {
    return ["maigret:top-500"];
  }
  async search(q: PlannedQuery, ctx: AdapterContext) {
    return this.searchUsername(q.handle ?? q.query, ctx);
  }
  async searchUsername(username: string, ctx: AdapterContext): Promise<SearchResult[]> {
    type Resp = { username: string; found: { site: string; url: string; tags?: string[]; ids?: Record<string, string> }[] };
    const data = await providerJson<Resp>(
      `${this.base()}/username`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, top_sites: 500 }) },
      { adapter: this.name, signal: ctx.signal, timeoutMs: 120_000, retries: 0 },
    );
    if (!Array.isArray(data.found)) throw new AdapterError(this.name, "Unexpected response");
    return data.found.map((f) => {
      const ids = f.ids ?? {};
      return makeResult({
        query: username,
        sourceEngine: this.name,
        url: f.url,
        title: `${username} on ${f.site}`,
        description: Object.entries(ids)
          .slice(0, 6)
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · "),
        contentText: [ids.fullname, ids.bio, ids.location && `Location: ${ids.location}`, ids.company && `Works at ${ids.company}`, ...Object.values(ids).filter((v) => /^https?:\/\//.test(v))].filter(Boolean).join(". "),
        name: ids.fullname ?? null,
        username,
        location: ids.location ?? null,
        sourceType: "profile",
        rawMetadata: { site: f.site, tags: f.tags ?? [], weakSignal: !ids.fullname },
      });
    });
  }
}
