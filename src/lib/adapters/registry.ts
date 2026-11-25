import "server-only";
/**
 * Adapter registry: instantiation, admin enable/disable (persisted in
 * source_adapters), demo-mode decision and honest SOURCE COVERAGE.
 */
import { eq } from "drizzle-orm";
import { DemoAdapter } from "./demo/adapter";
import { DeepSearchAdapter, SearxngAdapter } from "./web-search";
import { GitHubAdapter, NewsRssAdapter, RedditAdapter, YouTubeAdapter } from "./platforms";
import { FindmeAdapter, MaigretAdapter } from "./username";
import { ChangeDetectionAdapter, WebFetchAdapter } from "./monitors";
import type { AdapterHealth, CoverageKey, SourceAdapter } from "./types";
import { env } from "@/lib/config/env";
import { getDb, schema } from "@/lib/db/client";
import type { QueryChannel } from "@/lib/core/types";

const g = globalThis as unknown as { __isAdapters?: SourceAdapter[] };

export function allAdapters(): SourceAdapter[] {
  return (g.__isAdapters ??= [
    new SearxngAdapter(),
    // Brave / Serper / Tavily adapters remain in web-search.ts for reference but are
    // NOT registered: excluded under the zero-cost policy (see lib/nexus/policy.ts).
    new DeepSearchAdapter(),
    new NewsRssAdapter(),
    new GitHubAdapter(),
    new RedditAdapter(),
    new YouTubeAdapter(),
    new FindmeAdapter(),
    new MaigretAdapter(),
    new WebFetchAdapter(),
    new ChangeDetectionAdapter(),
    new DemoAdapter(),
  ]);
}

export function adapterByName(name: string): SourceAdapter | undefined {
  return allAdapters().find((a) => a.name === name);
}

async function enabledMap(): Promise<Map<string, boolean>> {
  const db = await getDb();
  const rows = await db.select().from(schema.sourceAdapters);
  return new Map(rows.map((r) => [r.name, r.enabled]));
}

export async function setAdapterEnabled(name: string, enabled: boolean) {
  const db = await getDb();
  await db
    .insert(schema.sourceAdapters)
    .values({ name, enabled })
    .onConflictDoUpdate({ target: schema.sourceAdapters.name, set: { enabled } });
}

async function recordHealth(name: string, h: AdapterHealth) {
  const db = await getDb();
  await db
    .insert(schema.sourceAdapters)
    .values({ name, lastHealth: h, lastCheckedAt: new Date() })
    .onConflictDoUpdate({ target: schema.sourceAdapters.name, set: { lastHealth: h, lastCheckedAt: new Date() } });
}

export interface AdapterStatusRow {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  health: AdapterHealth;
  roles: string[];
  channels: QueryChannel[];
  cost: string;
  requires: string[];
  upstream?: string;
  isDemo: boolean;
}

export async function adapterStatuses(force = false): Promise<AdapterStatusRow[]> {
  const enabled = await enabledMap();
  const rows = await Promise.all(
    allAdapters().map(async (a) => {
      const isEnabled = enabled.get(a.name) ?? true;
      const h = isEnabled ? await (a as SourceAdapter & { healthCheck(force?: boolean): Promise<AdapterHealth> }).healthCheck(force) : { status: "disabled" as const, message: "Disabled by admin", checkedAt: new Date().toISOString() };
      const caps = a.capabilities();
      return { name: a.name, label: a.label, description: a.description, enabled: isEnabled, configured: a.isConfigured(), health: h, roles: caps.roles, channels: caps.channels, cost: caps.cost, requires: caps.requires, upstream: caps.upstream, isDemo: Boolean(a.isDemo) };
    }),
  );
  if (force) await Promise.all(rows.map((r) => recordHealth(r.name, r.health)));
  return rows;
}

const WEB_PROVIDERS = new Set(["searxng", "brave", "serper", "tavily", "deepsearch"]);

export interface ActiveSet {
  demo: boolean;
  demoReason: string;
  search: SourceAdapter[];
  username: SourceAdapter[];
  monitor: SourceAdapter[];
  channels: Set<QueryChannel>;
}

/**
 * Demo mode rules:
 *  DEMO_MODE=true  → always demo
 *  DEMO_MODE=false → never demo (real adapters only, even if none are healthy)
 *  DEMO_MODE=auto  → demo when no real web-search provider is available
 * Demo and real adapters are never mixed in one search.
 */
export async function activeAdapters(opts: { forceDemo?: boolean } = {}): Promise<ActiveSet> {
  const mode = opts.forceDemo === undefined ? env().DEMO_MODE : opts.forceDemo ? "true" : "false";
  if (mode === "true") {
    const d = adapterByName("demo")!;
    return { demo: true, demoReason: opts.forceDemo ? "Person was locked from demo data" : "DEMO_MODE=true", search: [d], username: [d], monitor: [d], channels: new Set(d.capabilities().channels) };
  }
  const enabled = await enabledMap();
  const isOn = (a: SourceAdapter) => (enabled.get(a.name) ?? true) && !a.isDemo;
  const avail = await Promise.all(allAdapters().map(async (a) => ({ a, ok: isOn(a) && (await a.isAvailable()) })));
  const real = avail.filter((x) => x.ok).map((x) => x.a);
  const hasWeb = real.some((a) => WEB_PROVIDERS.has(a.name));

  let demo = false;
  let demoReason = "";
  if (mode === "auto" && !hasWeb) {
    demo = true;
    demoReason = "No real web-search provider is reachable (configure SEARXNG_URL or an API key)";
  }
  if (demo) {
    const d = adapterByName("demo")!;
    return { demo, demoReason, search: [d], username: [d], monitor: [d], channels: new Set(d.capabilities().channels) };
  }
  const search = real.filter((a) => a.capabilities().roles.includes("search"));
  const username = real.filter((a) => a.capabilities().roles.includes("username"));
  const monitor = real.filter((a) => a.capabilities().roles.includes("monitor"));
  const channels = new Set<QueryChannel>();
  for (const a of [...search, ...username]) for (const c of a.capabilities().channels) channels.add(c);
  return { demo, demoReason, search, username, monitor, channels };
}

export type CoverageStatus = "ACTIVE" | "LIMITED" | "UNAVAILABLE" | "DEMO";

export interface CoverageRow {
  key: CoverageKey;
  label: string;
  status: CoverageStatus;
  via: string[];
  note: string;
}

const COVERAGE_LABEL: Record<CoverageKey, string> = {
  web: "Web",
  news: "News",
  reddit: "Reddit",
  github: "GitHub",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X / Twitter",
  username: "Username discovery",
  images: "Images",
  documents: "Documents",
};

/** Never claims a source is searched when it is not. */
export function computeCoverage(active: ActiveSet): CoverageRow[] {
  const keys = Object.keys(COVERAGE_LABEL) as CoverageKey[];
  if (active.demo) {
    return keys.map((k) => ({ key: k, label: COVERAGE_LABEL[k], status: "DEMO", via: ["demo"], note: "Fictional demo corpus" }));
  }
  const all = [...active.search, ...active.username, ...active.monitor];
  const webVia = active.search.filter((a) => a.capabilities().coverage.includes("web")).map((a) => a.name);
  return keys.map((k) => {
    const native = all.filter((a) => a.capabilities().coverage.includes(k)).map((a) => a.name);
    const unique = Array.from(new Set(native));
    if (["linkedin", "instagram", "facebook", "x"].includes(k)) {
      return webVia.length
        ? { key: k, label: COVERAGE_LABEL[k], status: "LIMITED", via: webVia, note: "Public search-engine results only (site: queries). No login, no private content." }
        : { key: k, label: COVERAGE_LABEL[k], status: "UNAVAILABLE", via: [], note: "Needs a web-search provider" };
    }
    if (unique.length) return { key: k, label: COVERAGE_LABEL[k], status: "ACTIVE", via: unique, note: "" };
    if ((k === "youtube" || k === "reddit" || k === "github") && webVia.length) {
      return { key: k, label: COVERAGE_LABEL[k], status: "LIMITED", via: webVia, note: "Via web search only — configure the official API for full coverage" };
    }
    return { key: k, label: COVERAGE_LABEL[k], status: "UNAVAILABLE", via: [], note: "No provider configured" };
  });
}

export async function isAdapterEnabled(name: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.query.sourceAdapters.findFirst({ where: eq(schema.sourceAdapters.name, name) });
  return row?.enabled ?? true;
}
