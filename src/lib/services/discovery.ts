import "server-only";
/**
 * Discovery sessions: INPUT → SEARCH GENERATION → MULTI-SOURCE DISCOVERY →
 * NORMALISATION → IDENTITY RESOLUTION → CANDIDATES (→ ASK USER).
 * Runs as a background job; the UI polls getSessionView().
 */
import { and, asc, desc, eq, inArray, isNotNull, max } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { env } from "@/lib/config/env";
import { activeAdapters, computeCoverage } from "@/lib/adapters/registry";
import { planQueries, queryKey } from "@/lib/core/planner";
import { resolveCandidates } from "@/lib/core/resolution";
import { extractSignals } from "@/lib/core/extract";
import { extractFromFreeText } from "@/lib/core/freetext";
import { buildTargetProfile, canonicalAttributeValue, mergeIntoProfile, type PersonQuery } from "@/lib/core/input";
import { profileFromInput } from "@/lib/core/profiles";
import { extractWithAi, aiConfigured } from "@/lib/ai/assist";
import { mapWithConcurrency } from "@/lib/security/rate-limit";
import { log } from "@/lib/security/logger";
import { enqueue, registerHandler } from "./jobs";
import { executeQuery, recordSkipped, rowToResult } from "./executor";
import type { AttributeKind, CandidateProfile, DiscoveredAttribute, Platform, TargetAttribute, TargetIdentifier, TargetProfile } from "@/lib/core/types";
import type { EvidenceDocView, SessionProgress, SessionView, UiState } from "@/lib/view-types";

function emptyProgress(maxIterations: number): SessionProgress {
  return { phase: "queued", iteration: 0, maxIterations, planned: 0, completed: 0, failed: 0, categories: {}, sourcesFound: 0, potentialMatches: 0, attributesDiscovered: 0, log: [] };
}

interface SessionMeta {
  extracted: SessionView["extracted"];
  platformHints: Platform[];
  discovered: DiscoveredAttribute[];
  usedDiscovered: string[];
  demoReason: string;
}

export async function createSession(q: PersonQuery, userId: string | null): Promise<string> {
  let target = buildTargetProfile(q);
  let extracted: SessionView["extracted"] = null;
  const note = [q.freeText, q.otherInfo].filter(Boolean).join("\n");
  let hints: Platform[] = [];
  if (note) {
    const fx = extractFromFreeText(note);
    const ai = aiConfigured() ? await extractWithAi(note) : null;
    const aiAttrs: TargetAttribute[] = [];
    const aiIds: TargetIdentifier[] = [];
    if (ai) {
      const push = (kind: AttributeKind, v?: string | null) => v && aiAttrs.push({ kind, value: canonicalAttributeValue(kind, v), state: "user_supplied" });
      push("city", ai.city);
      push("state", ai.state);
      push("country", ai.country);
      push("organization", ai.organization);
      push("designation", ai.designation);
      push("school", ai.school);
      if (ai.approximate_age) push("age", String(ai.approximate_age));
      for (const p of ai.previous_organizations ?? []) push("previous_organization", p);
      for (const u of ai.usernames ?? []) {
        const plat = (["linkedin", "instagram", "facebook", "x", "youtube", "github", "reddit"].includes(u.platform.toLowerCase()) ? u.platform.toLowerCase() : "other_social") as Platform;
        const p = profileFromInput(plat, u.handle);
        if (p) aiIds.push({ platform: plat, handle: p.handle, url: p.url || undefined, state: "user_supplied" });
      }
    }
    // Explicit form fields win over note-derived values of the same kind.
    const explicitKinds = new Set(target.attributes.map((a) => a.kind));
    const fromNote = [...fx.attributes, ...aiAttrs].filter((a) => !explicitKinds.has(a.kind) || a.kind === "previous_organization");
    const idsFromNote = [...fx.identifiers, ...aiIds];
    target = mergeIntoProfile(target, fromNote, idsFromNote);
    hints = fx.platformHints;
    extracted = {
      attributes: fromNote.map((a) => ({ kind: a.kind, value: a.value })),
      identifiers: idsFromNote.map((i) => ({ platform: i.platform, handle: i.handle })),
      platformHints: hints,
      usedAi: Boolean(ai),
    };
  }
  const db = await getDb();
  const maxIt = env().MAX_DISCOVERY_ITERATIONS;
  const meta: SessionMeta = { extracted, platformHints: hints, discovered: [], usedDiscovered: [], demoReason: "" };
  const [row] = await db
    .insert(schema.searchSessions)
    .values({ userId, input: { ...q, __meta: meta }, target, purpose: q.purpose, progress: emptyProgress(maxIt) })
    .returning({ id: schema.searchSessions.id });
  await enqueue("discovery", { sessionId: row.id, fromIteration: 1, iterations: maxIt }, { maxAttempts: 1 });
  log.info("session.created", { sessionId: row.id, attributes: target.attributes.length, identifiers: target.identifiers.length });
  return row.id;
}

export async function refineSession(sessionId: string, attrs: TargetAttribute[], ids: TargetIdentifier[]): Promise<void> {
  const db = await getDb();
  const s = await db.query.searchSessions.findFirst({ where: eq(schema.searchSessions.id, sessionId) });
  if (!s) throw new Error("Session not found");
  if (s.status === "running" || s.status === "queued") throw new Error("A search is already running for this session");
  if (s.personId) throw new Error("Session already locked to a person");
  const target = mergeIntoProfile(s.target as TargetProfile, attrs, ids);
  const lastIt = await db.select({ n: max(schema.searchIterations.number) }).from(schema.searchIterations).where(eq(schema.searchIterations.sessionId, sessionId));
  const from = (lastIt[0]?.n ?? 0) + 1;
  const progress = s.progress as SessionProgress;
  const iterations = Math.max(1, env().MAX_DISCOVERY_ITERATIONS - 1);
  await db
    .update(schema.searchSessions)
    .set({
      target,
      status: "queued",
      uiState: "search_in_progress",
      progress: { ...progress, phase: "queued", maxIterations: from + iterations - 1, log: [...progress.log, { t: new Date().toISOString(), msg: `User added: ${[...attrs.map((a) => `${a.kind}=${a.value}`), ...ids.map((i) => `${i.platform}=${i.handle}`)].join(", ")}`, level: "new" as const }].slice(-60) },
      updatedAt: new Date(),
    })
    .where(eq(schema.searchSessions.id, sessionId));
  await enqueue("discovery", { sessionId, fromIteration: from, iterations, reason: "User refinement" }, { maxAttempts: 1 });
}

// ---------------------------------------------------------------------------

async function runDiscovery(payload: Record<string, unknown>) {
  const sessionId = String(payload.sessionId);
  const fromIteration = Number(payload.fromIteration ?? 1);
  const iterations = Number(payload.iterations ?? env().MAX_DISCOVERY_ITERATIONS);
  const db = await getDb();
  const s = await db.query.searchSessions.findFirst({ where: eq(schema.searchSessions.id, sessionId) });
  if (!s) return;
  const input = s.input as PersonQuery & { __meta: SessionMeta };
  const meta = input.__meta;
  const target = s.target as TargetProfile;
  const active = await activeAdapters();
  const coverage = computeCoverage(active);
  const progress: SessionProgress = { ...(s.progress as SessionProgress), phase: "planning", maxIterations: fromIteration + iterations - 1 };
  const push = (msg: string, level: "info" | "warn" | "new" = "info") => {
    progress.log = [...progress.log, { t: new Date().toISOString(), msg, level }].slice(-60);
  };
  let lastFlush = 0;
  const flush = async (force = false) => {
    if (!force && Date.now() - lastFlush < 400) return;
    lastFlush = Date.now();
    await db.update(schema.searchSessions).set({ progress, updatedAt: new Date() }).where(eq(schema.searchSessions.id, sessionId));
  };
  meta.demoReason = active.demo ? active.demoReason : "";
  await db.update(schema.searchSessions).set({ status: "running", isDemo: active.demo, coverage, input: { ...input, __meta: meta } }).where(eq(schema.searchSessions.id, sessionId));
  if (active.demo) push(`DEMO MODE — ${active.demoReason}`, "warn");
  push(`Adapters: ${[...new Set([...active.search, ...active.username].map((a) => a.name))].join(", ") || "none"}`);

  const executedKeys = new Set(
    (await db.select({ k: schema.searchQueries.queryKey }).from(schema.searchQueries).where(and(eq(schema.searchQueries.sessionId, sessionId), isNotNull(schema.searchQueries.adapter)))).map((r) => r.k),
  );
  let discovered: DiscoveredAttribute[] = meta.discovered ?? [];
  const used = new Set(meta.usedDiscovered ?? []);
  let resolution: ReturnType<typeof resolveCandidates> | null = null;
  const concurrency = env().SEARCH_CONCURRENCY;

  try {
    for (let it = fromIteration; it < fromIteration + iterations; it++) {
      progress.iteration = it;
      progress.phase = "planning";
      const fresh = discovered.filter((d) => !used.has(`${d.kind}|${d.value}`));
      if (it > fromIteration && !fresh.length) {
        push(`Iteration ${it}: no new attributes discovered — stopping`);
        break;
      }
      fresh.forEach((d) => used.add(`${d.kind}|${d.value}`));
      const plan = planQueries(target, {
        maxQueries: env().MAX_QUERIES_PER_ITERATION,
        channels: active.channels,
        history: executedKeys,
        discovered: it === fromIteration && fromIteration === 1 ? [] : fresh,
        platformHints: meta.platformHints,
        iteration: it,
      });
      const reason = it === 1 ? "Initial input" : payload.reason && it === fromIteration ? String(payload.reason) : `Discovered ${fresh.length} new attribute(s)`;
      const [iterRow] = await db.insert(schema.searchIterations).values({ sessionId, number: it, reason, queryCount: plan.planned.length }).returning({ id: schema.searchIterations.id });
      const ctx = { active, sessionId, iterationId: iterRow.id, iteration: it, demoEpoch: 0 };
      await recordSkipped(plan.skipped, ctx);
      push(`Iteration ${it}: ${plan.planned.length} queries planned (${plan.skipped.length} skipped: duplicate/history/budget/unavailable)`);
      const nothingToRun = plan.planned.length === 0;

      progress.phase = "searching";
      progress.planned += plan.planned.length;
      for (const p of plan.planned) {
        const c = (progress.categories[p.category] ??= { planned: 0, done: 0 });
        c.planned++;
      }
      await flush(true);

      await mapWithConcurrency(plan.planned, concurrency, async (p) => {
        const r = await executeQuery(p, ctx);
        executedKeys.add(p.key);
        progress.completed++;
        progress.failed += r.failures;
        progress.categories[p.category].done++;
        if (r.results.length) push(`${p.query} → ${r.results.length} result(s) [${r.adapters.join(", ")}]`);
        await flush();
      });

      progress.phase = "resolving";
      await flush(true);
      const rows = await db.select().from(schema.searchResults).where(eq(schema.searchResults.sessionId, sessionId));
      resolution = resolveCandidates(target, rows.map(rowToResult));
      progress.sourcesFound = new Set(rows.map((r) => r.canonicalUrl)).size;
      progress.potentialMatches = resolution.candidates.length;
      await saveCandidates(sessionId, it, resolution.candidates);
      const newDisc = resolution.discovered.filter((d) => !used.has(`${d.kind}|${d.value}`) && !discovered.some((x) => x.kind === d.kind && x.value === d.value));
      discovered = [...discovered, ...newDisc];
      progress.attributesDiscovered = discovered.length;
      for (const d of newDisc.slice(0, 8)) push(`Discovered ${d.kind.replace("platform:", "")}: ${d.value} (candidate ${d.fromCandidate})`, "new");
      push(`Iteration ${it}: ${resolution.candidates.length} candidate(s) — ${resolution.summary.state}`);
      await flush(true);
      if (nothingToRun) break;
    }

    const uiState: UiState = !resolution || resolution.summary.state !== "leading" ? "ask_for_more_information" : "discovery_results";
    progress.phase = "done";
    push(resolution?.summary.message ?? "No results");
    await db
      .update(schema.searchSessions)
      .set({
        status: "completed",
        uiState,
        progress,
        resolution: resolution?.summary ?? null,
        unattributed: resolution?.unattributed ?? [],
        input: { ...input, __meta: { ...meta, discovered, usedDiscovered: Array.from(used) } },
        updatedAt: new Date(),
      })
      .where(eq(schema.searchSessions.id, sessionId));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Search failed";
    progress.phase = "error";
    push(`Error: ${message}`, "warn");
    await db.update(schema.searchSessions).set({ status: "failed", uiState: "error", error: message, progress, updatedAt: new Date() }).where(eq(schema.searchSessions.id, sessionId));
    throw e;
  }
}

async function saveCandidates(sessionId: string, iteration: number, cands: CandidateProfile[]) {
  const db = await getDb();
  if (!cands.length) return;
  await db.insert(schema.candidates).values(cands.map((c, i) => ({ sessionId, iteration, clusterKey: c.clusterKey, rank: i + 1, displayName: c.displayName, profile: c, score: c.match.score })));
}

registerHandler("discovery", runDiscovery);

// ---------------------------------------------------------------------------

export async function latestCandidates(sessionId: string): Promise<CandidateProfile[]> {
  const db = await getDb();
  const last = await db.select({ n: max(schema.candidates.iteration) }).from(schema.candidates).where(eq(schema.candidates.sessionId, sessionId));
  const n = last[0]?.n;
  if (!n) return [];
  const rows = await db.select().from(schema.candidates).where(and(eq(schema.candidates.sessionId, sessionId), eq(schema.candidates.iteration, n))).orderBy(asc(schema.candidates.rank));
  return rows.map((r) => r.profile as CandidateProfile);
}

export async function getSessionView(sessionId: string, userId?: string | null): Promise<SessionView | null> {
  const db = await getDb();
  const s = await db.query.searchSessions.findFirst({ where: eq(schema.searchSessions.id, sessionId) });
  if (!s || (userId && s.userId && s.userId !== userId)) return null;
  const input = s.input as Record<string, unknown> & { __meta?: SessionMeta };
  const meta = input.__meta;
  const { __meta, ...cleanInput } = input;
  void __meta;
  const candidates = await latestCandidates(sessionId);
  const recent = await db.select().from(schema.searchQueries).where(eq(schema.searchQueries.sessionId, sessionId)).orderBy(desc(schema.searchQueries.createdAt)).limit(40);
  return {
    id: s.id,
    status: s.status,
    uiState: (s.personId ? "person_locked" : s.uiState) as UiState,
    input: cleanInput,
    target: s.target as TargetProfile,
    extracted: meta?.extracted ?? null,
    purpose: s.purpose,
    isDemo: s.isDemo,
    demoReason: meta?.demoReason ?? "",
    progress: s.progress as SessionProgress,
    resolution: (s.resolution as SessionView["resolution"]) ?? null,
    candidates,
    unattributed: (s.unattributed as SessionView["unattributed"]) ?? [],
    discovered: meta?.discovered ?? [],
    coverage: (s.coverage as SessionView["coverage"]) ?? computeCoverage(await activeAdapters()),
    recentQueries: recent.map(queryView),
    personId: s.personId,
    error: s.error,
    createdAt: s.createdAt.toISOString(),
  };
}

export function queryView(q: typeof schema.searchQueries.$inferSelect) {
  return {
    id: q.id,
    iteration: q.iteration,
    query: q.query,
    tier: q.tier,
    category: q.category,
    channel: q.channel,
    reason: q.reason,
    adapter: q.adapter,
    status: q.status,
    resultCount: q.resultCount,
    error: q.error,
    executedAt: q.executedAt?.toISOString() ?? null,
    createdAt: q.createdAt.toISOString(),
  };
}

export async function sessionQueries(sessionId: string) {
  const db = await getDb();
  const rows = await db.select().from(schema.searchQueries).where(eq(schema.searchQueries.sessionId, sessionId)).orderBy(asc(schema.searchQueries.iteration), asc(schema.searchQueries.tier), asc(schema.searchQueries.createdAt));
  return rows.map(queryView);
}

export async function candidateEvidence(sessionId: string, clusterKey: string): Promise<{ candidate: CandidateProfile; documents: EvidenceDocView[] } | null> {
  const cands = await latestCandidates(sessionId);
  const candidate = cands.find((c) => c.clusterKey === clusterKey);
  if (!candidate) return null;
  const db = await getDb();
  const s = await db.query.searchSessions.findFirst({ where: eq(schema.searchSessions.id, sessionId) });
  const target = s!.target as TargetProfile;
  const rows = candidate.resultIds.length ? await db.select().from(schema.searchResults).where(inArray(schema.searchResults.id, candidate.resultIds)) : [];
  const documents = rows.map((r) => {
    const res = rowToResult(r);
    const sig = extractSignals(res, target);
    const signals = [
      { label: "Name", values: sig.nameMatchedAs ? [sig.nameMatchedAs] : [] },
      { label: "Company", values: sig.organizations },
      { label: "Previous company", values: sig.previousOrganizations },
      { label: "Designation", values: sig.designations },
      { label: "Location", values: [...sig.cities, ...sig.countries] },
      { label: "Profiles", values: [...(sig.subjectProfile ? [`${sig.subjectProfile.platform}:${sig.subjectProfile.handle} (this page)`] : []), ...sig.mentionedProfiles.map((p) => `${p.platform}:${p.handle}`)] },
      { label: "Age", values: sig.ages.map(String) },
      { label: "Events", values: sig.events },
    ].filter((x) => x.values.length);
    return {
      resultId: r.id,
      url: r.url,
      title: r.title,
      description: r.description,
      contentText: r.contentText.slice(0, 1500),
      sourceEngine: r.sourceEngine,
      sourcePlatform: r.sourcePlatform,
      sourceType: r.sourceType,
      discoveredAt: r.discoveredAt.toISOString(),
      publishedAt: r.publishedAt?.toISOString() ?? null,
      query: r.query,
      isDemo: r.isDemo,
      signals,
    };
  });
  return { candidate, documents };
}

export { queryKey };
