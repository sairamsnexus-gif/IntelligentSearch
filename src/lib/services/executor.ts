import "server-only";
/**
 * Executes planned queries against the active adapters, records every query
 * (including skipped ones) and persists canonical results. Adapter failures
 * are recorded and never abort the run.
 */
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { ActiveSet } from "@/lib/adapters/registry";
import type { SourceAdapter } from "@/lib/adapters/types";
import { getDb, schema } from "@/lib/db/client";
import { canonicalUrl } from "@/lib/core/resolution";
import type { PlannedQuery, SearchResult } from "@/lib/core/types";
import type { PlanOutput } from "@/lib/core/planner";
import { log } from "@/lib/security/logger";

const CACHE_TTL_MS = 6 * 3_600_000;
const ENGINE_PRIORITY = ["searxng", "brave", "serper", "tavily", "deepsearch", "news_rss", "github", "reddit", "youtube", "findme", "maigret", "demo"];
const WEB_ENGINES_PER_QUERY = 2;

export interface ExecContext {
  active: ActiveSet;
  sessionId?: string;
  personId?: string;
  iterationId: string;
  iteration: number;
  demoEpoch: number;
  signal?: AbortSignal;
}

export function adaptersFor(q: PlannedQuery, active: ActiveSet): SourceAdapter[] {
  const pool = q.channel === "username" ? active.username : active.search;
  const capable = pool.filter((a) => a.capabilities().channels.includes(q.channel));
  capable.sort((a, b) => ENGINE_PRIORITY.indexOf(a.name) - ENGINE_PRIORITY.indexOf(b.name));
  if (q.channel === "web" || q.channel === "news" || q.channel === "images") return capable.slice(0, WEB_ENGINES_PER_QUERY);
  return capable;
}

export async function recordSkipped(skipped: PlanOutput["skipped"], ctx: ExecContext) {
  if (!skipped.length) return;
  const db = await getDb();
  await db.insert(schema.searchQueries).values(
    skipped.map((s) => ({
      iterationId: ctx.iterationId,
      sessionId: ctx.sessionId,
      personId: ctx.personId,
      iteration: ctx.iteration,
      query: s.query,
      queryKey: s.key,
      tier: s.tier,
      category: s.category,
      channel: s.channel,
      reason: s.reason,
      status: `skipped_${s.skipReason}`,
    })),
  );
}

async function cachedResults(q: PlannedQuery, adapter: string): Promise<SearchResult[] | null> {
  if (adapter === "demo") return null;
  const db = await getDb();
  const prev = await db.query.searchQueries.findFirst({
    where: and(eq(schema.searchQueries.queryKey, q.key), eq(schema.searchQueries.adapter, adapter), inArray(schema.searchQueries.status, ["done", "cached"]), gt(schema.searchQueries.executedAt, new Date(Date.now() - CACHE_TTL_MS))),
    orderBy: desc(schema.searchQueries.executedAt),
  });
  if (!prev) return null;
  const rows = await db.select().from(schema.searchResults).where(eq(schema.searchResults.queryId, prev.id));
  return rows.map(rowToResult);
}

export function rowToResult(r: typeof schema.searchResults.$inferSelect): SearchResult {
  return {
    id: r.id,
    query: r.query,
    sourceEngine: r.sourceEngine,
    sourcePlatform: r.sourcePlatform,
    url: r.url,
    title: r.title,
    description: r.description,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    discoveredAt: r.discoveredAt.toISOString(),
    author: r.author,
    username: r.username,
    name: r.name,
    location: r.location,
    organization: r.organization,
    designation: r.designation,
    emails: (r.emails as string[]) ?? [],
    phoneNumbers: (r.phoneNumbers as string[]) ?? [],
    imageUrl: r.imageUrl,
    contentText: r.contentText,
    rawMetadata: (r.rawMetadata as Record<string, unknown>) ?? {},
    sourceType: r.sourceType as SearchResult["sourceType"],
    isDemo: r.isDemo,
  };
}

export async function executeQuery(q: PlannedQuery, ctx: ExecContext): Promise<{ results: SearchResult[]; failures: number; adapters: string[] }> {
  const db = await getDb();
  const adapters = adaptersFor(q, ctx.active);
  if (!adapters.length) {
    await recordSkipped([{ ...q, skipReason: "channel_unavailable" }], ctx);
    return { results: [], failures: 0, adapters: [] };
  }
  const all: SearchResult[] = [];
  let failures = 0;
  for (const adapter of adapters) {
    const started = Date.now();
    const [row] = await db
      .insert(schema.searchQueries)
      .values({
        iterationId: ctx.iterationId,
        sessionId: ctx.sessionId,
        personId: ctx.personId,
        iteration: ctx.iteration,
        query: q.query,
        queryKey: q.key,
        tier: q.tier,
        category: q.category,
        channel: q.channel,
        reason: q.reason,
        adapter: adapter.name,
        status: "running",
      })
      .returning({ id: schema.searchQueries.id });
    try {
      let status = "done";
      let results = await cachedResults(q, adapter.name);
      if (results) status = "cached";
      else if (q.channel === "username" && adapter.searchUsername) results = await adapter.searchUsername(q.handle ?? q.query, { demoEpoch: ctx.demoEpoch, signal: ctx.signal });
      else if (adapter.search) results = await adapter.search(q, { demoEpoch: ctx.demoEpoch, signal: ctx.signal });
      else results = [];
      const fresh = results.map((r) => ({ ...r, id: crypto.randomUUID(), query: q.query }));
      if (fresh.length) {
        await db.insert(schema.searchResults).values(
          fresh.map((r) => ({
            id: r.id,
            queryId: row.id,
            sessionId: ctx.sessionId,
            personId: ctx.personId,
            iteration: ctx.iteration,
            query: r.query,
            sourceEngine: r.sourceEngine,
            sourcePlatform: r.sourcePlatform,
            url: r.url,
            canonicalUrl: canonicalUrl(r.url),
            title: r.title.slice(0, 500),
            description: r.description.slice(0, 2000),
            publishedAt: r.publishedAt && !Number.isNaN(Date.parse(r.publishedAt)) ? new Date(r.publishedAt) : null,
            discoveredAt: new Date(),
            author: r.author ?? null,
            username: r.username ?? null,
            name: r.name ?? null,
            location: r.location ?? null,
            organization: r.organization ?? null,
            designation: r.designation ?? null,
            emails: r.emails,
            phoneNumbers: r.phoneNumbers,
            imageUrl: r.imageUrl ?? null,
            contentText: r.contentText.slice(0, 20_000),
            rawMetadata: r.rawMetadata,
            sourceType: r.sourceType,
            isDemo: Boolean(r.isDemo),
          })),
        );
      }
      await db.update(schema.searchQueries).set({ status, resultCount: fresh.length, durationMs: Date.now() - started, executedAt: new Date() }).where(eq(schema.searchQueries.id, row.id));
      all.push(...fresh);
    } catch (e) {
      failures++;
      const message = e instanceof Error ? e.message.slice(0, 300) : "failed";
      await db.update(schema.searchQueries).set({ status: "failed", error: message, durationMs: Date.now() - started, executedAt: new Date() }).where(eq(schema.searchQueries.id, row.id));
      log.warn("query.failed", { adapter: adapter.name, channel: q.channel, error: message });
    }
  }
  return { results: all, failures, adapters: adapters.map((a) => a.name) };
}
