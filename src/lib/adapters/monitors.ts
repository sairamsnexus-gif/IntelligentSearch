import "server-only";
/**
 * Monitor adapters:
 *  - WebFetchAdapter: direct public-page fetch via the SSRF-safe client,
 *    honouring robots.txt. Login-walled social platforms are excluded (they are
 *    monitored through search results only — see LIMITED coverage).
 *  - ChangeDetectionAdapter: delegates watching to a changedetection.io
 *    instance through its REST API (optional).
 */
import { BaseAdapter } from "./base";
import type { AdapterCapabilities, AdapterContext, CheckResult } from "./types";
import { health, providerFetch, providerJson, timed } from "./http";
import { env } from "@/lib/config/env";
import { normalizeContent } from "@/lib/core/change";
import { safeFetch } from "@/lib/security/ssrf";
import { isAllowed, parseRobots, type RobotsRules } from "@/lib/security/robots";

const LOGIN_WALLED = /(^|\.)(linkedin\.com|instagram\.com|facebook\.com|x\.com|twitter\.com)$/i;

const g = globalThis as unknown as { __isRobots?: Map<string, { at: number; rules: RobotsRules }> };
const robotsCache = (g.__isRobots ??= new Map());

async function robotsFor(origin: string): Promise<RobotsRules> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < 24 * 3_600_000) return hit.rules;
  let rules: RobotsRules = { allow: [], disallow: [] };
  try {
    const res = await safeFetch(`${origin}/robots.txt`, { timeoutMs: 6000, maxBytes: 200_000 });
    if (res.status >= 200 && res.status < 300) rules = parseRobots(res.body);
  } catch {
    /* unreachable robots.txt → treat as allow-all, per RFC 9309 */
  }
  robotsCache.set(origin, { at: Date.now(), rules });
  return rules;
}

export class WebFetchAdapter extends BaseAdapter {
  name = "web";
  label = "Direct public web";
  description = "Fetches public pages directly (robots.txt respected, SSRF-protected). Not used for login-walled platforms.";
  isConfigured() {
    return true;
  }
  capabilities(): AdapterCapabilities {
    return { roles: ["monitor"], channels: [], coverage: [], cost: "free", requires: [] };
  }
  protected async probe() {
    return health("active", "Enabled");
  }
  canMonitor(url: string) {
    try {
      const h = new URL(url).hostname.replace(/^www\./, "");
      return !LOGIN_WALLED.test(h);
    } catch {
      return false;
    }
  }
  async check(url: string): Promise<CheckResult> {
    const u = new URL(url);
    const rules = await robotsFor(u.origin);
    if (!isAllowed(rules, u.pathname + u.search)) {
      return { available: true, httpStatus: null, contentText: "", method: "web_fetch", skipped: true, error: "Disallowed by robots.txt — not fetched" };
    }
    const res = await safeFetch(url);
    const title = res.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    const available = res.status >= 200 && res.status < 400;
    return { available, httpStatus: res.status, title, contentText: available ? normalizeContent(res.body) : "", method: "web_fetch" };
  }
}

export class ChangeDetectionAdapter extends BaseAdapter {
  name = "changedetection";
  label = "changedetection.io";
  description = "Delegates page watching to a self-hosted changedetection.io instance (REST API).";
  isConfigured() {
    const e = env();
    return Boolean(e.CHANGEDETECTION_URL && e.CHANGEDETECTION_API_KEY);
  }
  capabilities(): AdapterCapabilities {
    return { roles: ["monitor"], channels: [], coverage: [], cost: "local", requires: ["CHANGEDETECTION_URL", "CHANGEDETECTION_API_KEY"], upstream: "https://github.com/dgtlmoon/changedetection.io" };
  }
  private base() {
    return env().CHANGEDETECTION_URL!.replace(/\/+$/, "");
  }
  private headers() {
    return { "x-api-key": env().CHANGEDETECTION_API_KEY!, "Content-Type": "application/json" };
  }
  protected async probe() {
    const [res, ms] = await timed(() => providerFetch(`${this.base()}/api/v1/systeminfo`, { headers: this.headers() }, { adapter: this.name, timeoutMs: 5000, retries: 0 }));
    return res.ok ? health("active", "API reachable", ms) : health("unavailable", `HTTP ${res.status}`, ms);
  }
  canMonitor(url: string) {
    return new WebFetchAdapter().canMonitor(url);
  }
  async monitor(url: string): Promise<string | null> {
    const data = await providerJson<{ uuid?: string }>(`${this.base()}/api/v1/watch`, { method: "POST", headers: this.headers(), body: JSON.stringify({ url, title: "IntelligentSearch", time_between_check: { hours: env().MONITOR_INTERVAL_HOURS } }) }, { adapter: this.name });
    return data.uuid ?? null;
  }
  async getChanges(uuid: string) {
    const history = await providerJson<Record<string, string>>(`${this.base()}/api/v1/watch/${uuid}/history`, { headers: this.headers() }, { adapter: this.name });
    const stamps = Object.keys(history).sort();
    const latest = stamps.at(-1);
    if (!latest) return { changed: false };
    const res = await providerFetch(`${this.base()}/api/v1/watch/${uuid}/history/${latest}`, { headers: this.headers() }, { adapter: this.name });
    return { changed: stamps.length > 1, latestText: await res.text(), timestamp: latest };
  }
  async check(url: string, _ctx: AdapterContext, externalRef?: string): Promise<CheckResult> {
    void _ctx;
    const ref = externalRef ?? (await this.monitor(url));
    if (!ref) return { available: false, httpStatus: null, contentText: "", method: "changedetection", error: "Watch not created" };
    const c = await this.getChanges(ref);
    if (!c.latestText) return { available: true, httpStatus: null, contentText: "", method: "changedetection", skipped: true, error: "No snapshot yet (first check pending)" };
    return { available: true, httpStatus: 200, contentText: normalizeContent(c.latestText), method: "changedetection" };
  }
}
