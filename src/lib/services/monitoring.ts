import "server-only";
/**
 * BASELINE → CONTINUOUS PUBLIC-SOURCE MONITORING → NEW / CHANGED → TIMELINE + ALERTS
 */
import { and, asc, count, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { adapterByName } from "@/lib/adapters/registry";
import type { AdapterContext, CheckResult } from "@/lib/adapters/types";
import { ChangeDetectionAdapter } from "@/lib/adapters/monitors";
import { compareSnapshots, normalizeContent, availabilityFromFetch } from "@/lib/core/change";
import { planQueries } from "@/lib/core/planner";
import { canonicalUrl, compareToCluster } from "@/lib/core/resolution";
import { extractSignals } from "@/lib/core/extract";
import { isDue, nextRunAt } from "@/lib/core/schedule";
import { norm, uniq } from "@/lib/core/text";
import type { ChangeType, SearchResult, TargetProfile } from "@/lib/core/types";
import { sha256 } from "@/lib/security/hash";
import { mapWithConcurrency } from "@/lib/security/rate-limit";
import { log } from "@/lib/security/logger";
import { enqueue, registerHandler } from "./jobs";
import { executeQuery } from "./executor";
import { addTimeline, audit } from "./timeline";
import { adaptersForPerson, DomainError, monitorMethodFor, signalsToAttributes, sourceNameFor, targetFromPerson } from "./persons";
import type { ChangeView, PersonDetailView, PersonSummaryView } from "@/lib/view-types";

type SourceRow = typeof schema.personSources.$inferSelect;

async function checkSource(src: SourceRow, ctx: AdapterContext): Promise<CheckResult | null> {
  switch (src.monitorMethod) {
    case "demo":
      return adapterByName("demo")!.check!(src.url, ctx);
    case "github_api":
      return adapterByName("github")!.check!(src.url, ctx);
    case "reddit_api":
      return adapterByName("reddit")!.check!(src.url, ctx);
    case "changedetection": {
      const cd = adapterByName("changedetection") as ChangeDetectionAdapter;
      let ref = src.externalRef;
      if (!ref) {
        ref = await cd.monitor(src.url);
        if (ref) await (await getDb()).update(schema.personSources).set({ externalRef: ref }).where(eq(schema.personSources.id, src.id));
      }
      return cd.check(src.url, ctx, ref ?? undefined);
    }
    case "web_fetch":
      return adapterByName("web")!.check!(src.url, ctx);
    default:
      return null; // search_only — handled via search results
  }
}

function attrDiff(prevText: string, currText: string, target: TargetProfile) {
  const mk = (t: string): SearchResult => ({ id: "x", query: "", sourceEngine: "", sourcePlatform: "", url: "https://x.invalid", title: "", description: "", discoveredAt: new Date().toISOString(), emails: [], phoneNumbers: [], contentText: t, rawMetadata: {}, sourceType: "web" });
  const a = signalsToAttributes(extractSignals(mk(prevText), target));
  const b = signalsToAttributes(extractSignals(mk(currText), target));
  const out: { kind: string; old: string[]; new: string[] }[] = [];
  for (const k of uniq([...Object.keys(a), ...Object.keys(b)])) {
    if (k === "name" || k === "profiles") continue;
    const o = (a[k] ?? []).map(norm).sort().join("|");
    const n = (b[k] ?? []).map(norm).sort().join("|");
    if (o !== n) out.push({ kind: k, old: a[k] ?? [], new: b[k] ?? [] });
  }
  return out;
}

interface ScanCounters {
  checked: number;
  unchanged: number;
  changed: number;
  new: number;
  gone: number;
  errors: number;
  skipped: number;
}

async function lastSnapshot(sourceId: string) {
  const db = await getDb();
  return db.query.snapshots.findFirst({ where: eq(schema.snapshots.sourceId, sourceId), orderBy: desc(schema.snapshots.capturedAt) });
}

/** Store an observation and emit change/alert/timeline records. */
async function observe(personId: string, src: SourceRow, obs: { available: boolean; httpStatus: number | null; title?: string; text: string }, target: TargetProfile, c: ScanCounters, baseline: boolean) {
  const db = await getDb();
  const prev = await lastSnapshot(src.id);
  const text = obs.available ? normalizeContent(obs.text) : "";
  const hash = sha256(text);
  const now = new Date();
  const cmp = compareSnapshots(prev ? { contentHash: prev.contentHash, contentText: prev.contentText, available: prev.available } : null, { contentHash: hash, contentText: text, available: obs.available });
  const type: ChangeType = baseline && cmp.type === "NEW" ? "UNCHANGED" : cmp.type;
  let snapId = prev?.id ?? null;
  if (!prev || type !== "UNCHANGED") {
    const [s] = await db.insert(schema.snapshots).values({ sourceId: src.id, personId, available: obs.available, httpStatus: obs.httpStatus, title: obs.title ?? null, contentHash: hash, contentText: text }).returning({ id: schema.snapshots.id });
    snapId = s.id;
  }
  c.checked++;
  const status = type === "CHANGED" ? "CHANGED" : type === "NO_LONGER_AVAILABLE" ? "NO_LONGER_AVAILABLE" : src.status === "NEW" && !baseline ? "EXISTING" : src.status === "NO_LONGER_AVAILABLE" && obs.available ? "EXISTING" : src.status === "CHANGED" ? "EXISTING" : src.status;
  await db
    .update(schema.personSources)
    .set({ lastCheckedAt: now, contentHash: hash, status, consecutiveFailures: 0, ...(type === "CHANGED" || type === "NO_LONGER_AVAILABLE" ? { lastChangedAt: now } : {}), ...(obs.title && !src.title ? { title: obs.title } : {}) })
    .where(eq(schema.personSources.id, src.id));
  await db.update(schema.evidence).set({ lastSeenAt: now }).where(and(eq(schema.evidence.sourceId, src.id), eq(schema.evidence.contentHash, hash)));

  if (type === "UNCHANGED") {
    c.unchanged++;
    return;
  }
  if (type === "CHANGED") c.changed++;
  if (type === "NO_LONGER_AVAILABLE") c.gone++;

  let evidenceId: string | null = null;
  if (type === "CHANGED") {
    const sig = extractSignals({ id: "x", query: "", sourceEngine: "", sourcePlatform: "", url: src.url, title: obs.title ?? src.title ?? "", description: "", discoveredAt: now.toISOString(), emails: [], phoneNumbers: [], contentText: text, rawMetadata: {}, sourceType: "web" }, target);
    const [ev] = await db
      .insert(schema.evidence)
      .values({ personId, sourceId: src.id, sourceUrl: src.url, sourceType: src.sourceType, sourceName: src.sourceName, title: obs.title ?? src.title ?? src.url, summary: cmp.summary.slice(0, 300), contentSnapshot: text.slice(0, 5000), contentHash: hash, extractedAttributes: signalsToAttributes(sig), verificationStatus: src.verificationStatus === "confirmed" ? "confirmed" : "unverified", isDemo: src.isDemo })
      .onConflictDoNothing()
      .returning({ id: schema.evidence.id });
    evidenceId = ev?.id ?? null;
  }
  const attributeChanges = type === "CHANGED" && prev ? attrDiff(prev.contentText, text, target) : [];
  const summary = attributeChanges.length ? attributeChanges.map((a) => `${a.kind.replace("_", " ")}: ${a.old.join(", ") || "—"} → ${a.new.join(", ") || "—"}`).join("; ") : cmp.summary;
  const [ch] = await db
    .insert(schema.changes)
    .values({ personId, sourceId: src.id, changeType: type, previousSnapshotId: prev?.id ?? null, currentSnapshotId: snapId, diff: cmp.diff, attributeChanges, summary, evidenceId })
    .returning({ id: schema.changes.id });
  const sev = type === "CHANGED" ? "changed" : "gone";
  const title = type === "CHANGED" ? `${src.sourceName} changed` : `${src.sourceName} no longer available`;
  await db.insert(schema.alerts).values({ personId, changeId: ch.id, severity: sev, title, body: summary });
  await addTimeline(db, { personId, type: type === "CHANGED" ? "changed" : "gone", title: type === "CHANGED" ? `Profile changed · ${src.sourceName}` : `Source no longer available · ${src.sourceName}`, detail: summary, url: src.url, sourceId: src.id, changeId: ch.id, evidenceId });
}

async function recordFailure(src: SourceRow, err: unknown, httpStatus: number | null, personId: string, target: TargetProfile, c: ScanCounters) {
  const db = await getDb();
  const verdict = availabilityFromFetch(httpStatus, src.consecutiveFailures);
  if (verdict === "gone") {
    await observe(personId, src, { available: false, httpStatus, text: "" }, target, c, false);
    return;
  }
  c.errors++;
  await db.update(schema.personSources).set({ lastCheckedAt: new Date(), consecutiveFailures: src.consecutiveFailures + 1 }).where(eq(schema.personSources.id, src.id));
  log.warn("monitor.check_failed", { sourceId: src.id, method: src.monitorMethod, error: err instanceof Error ? err.message : String(err) });
}

async function checkAll(personId: string, sources: SourceRow[], ctx: AdapterContext, target: TargetProfile, c: ScanCounters, baseline: boolean) {
  await mapWithConcurrency(sources, 3, async (src) => {
    try {
      const res = await checkSource(src, ctx);
      if (!res) return;
      if (res.skipped) {
        c.skipped++;
        return;
      }
      if (!res.available && res.httpStatus !== 404 && res.httpStatus !== 410) return recordFailure(src, res.error, res.httpStatus, personId, target, c);
      await observe(personId, src, { available: res.available, httpStatus: res.httpStatus, title: res.title, text: res.contentText }, target, c, baseline);
    } catch (e) {
      await recordFailure(src, e, null, personId, target, c);
    }
  });
}

// ---------------------------------------------------------------------------

async function runBaseline(payload: Record<string, unknown>) {
  const personId = String(payload.personId);
  const db = await getDb();
  const person = await db.query.persons.findFirst({ where: eq(schema.persons.id, personId) });
  if (!person) return;
  const job = await db.query.monitoringJobs.findFirst({ where: eq(schema.monitoringJobs.personId, personId) });
  const ids = Array.isArray(payload.sourceIds) ? (payload.sourceIds as string[]) : null;
  const sources = await db.select().from(schema.personSources).where(and(eq(schema.personSources.personId, personId), eq(schema.personSources.monitored, true), ids ? inArray(schema.personSources.id, ids) : undefined));
  const target = await targetFromPerson(personId, db);
  const c: ScanCounters = { checked: 0, unchanged: 0, changed: 0, new: 0, gone: 0, errors: 0, skipped: 0 };
  // search_only sources: the baseline is the evidence snapshot captured at discovery time.
  for (const src of sources.filter((s) => s.monitorMethod === "search_only")) {
    const ev = await db.query.evidence.findFirst({ where: eq(schema.evidence.sourceId, src.id), orderBy: asc(schema.evidence.firstSeenAt) });
    if (ev && !(await lastSnapshot(src.id))) await observe(personId, src, { available: true, httpStatus: null, title: ev.title, text: ev.contentSnapshot }, target, c, true);
  }
  await checkAll(personId, sources.filter((s) => s.monitorMethod !== "search_only"), { demoEpoch: job?.runCount ?? 0 }, target, c, true);
  if (!ids) {
    await addTimeline(db, { personId, type: "baseline", title: "Baseline created", detail: `${c.checked} source snapshot(s) stored${c.errors ? `, ${c.errors} unreachable` : ""}${c.skipped ? `, ${c.skipped} skipped (robots.txt / pending)` : ""}` });
    await db.update(schema.persons).set({ status: "monitoring" }).where(eq(schema.persons.id, personId));
  }
}

async function attributeNewResult(r: SearchResult, target: TargetProfile): Promise<"strong" | "weak" | null> {
  const s = extractSignals(r, target);
  const ids = target.identifiers;
  const hitsId = (p?: { platform: string; handle: string }) => Boolean(p && ids.some((i) => i.platform === p.platform && i.handle === p.handle));
  if (hitsId(s.subjectProfile) || (s.nameHit && s.mentionedProfiles.some((m) => hitsId(m)))) return "strong";
  if (s.emails.some((e) => target.attributes.some((a) => a.kind === "email" && a.value === e))) return "strong";
  if (!s.nameHit) return null;
  const facets = { organization: [] as string[], city: [] as string[], designation: [] as string[], previous_organization: [] as string[], school: [] as string[] };
  for (const a of target.attributes) if (a.kind in facets) facets[a.kind as keyof typeof facets].push(a.value);
  const { agree, conflict } = compareToCluster(s, { facets });
  return agree >= 2 && !conflict ? "weak" : null;
}

async function runMonitorScan(payload: Record<string, unknown>) {
  const personId = String(payload.personId);
  const db = await getDb();
  const person = await db.query.persons.findFirst({ where: eq(schema.persons.id, personId) });
  const job = await db.query.monitoringJobs.findFirst({ where: eq(schema.monitoringJobs.personId, personId) });
  if (!person || !job) return;
  const scanNo = job.runCount + 1;
  const started = new Date();
  await db.update(schema.monitoringJobs).set({ running: true, lockedAt: started }).where(eq(schema.monitoringJobs.id, job.id));
  const c: ScanCounters = { checked: 0, unchanged: 0, changed: 0, new: 0, gone: 0, errors: 0, skipped: 0 };
  try {
    const target = await targetFromPerson(personId, db);
    const active = await adaptersForPerson(person.isDemo);
    const ctx: AdapterContext = { demoEpoch: scanNo };
    const sources = await db.select().from(schema.personSources).where(and(eq(schema.personSources.personId, personId), eq(schema.personSources.monitored, true)));

    // 1. Direct checks of known URLs
    await checkAll(personId, sources.filter((s) => s.monitorMethod !== "search_only"), ctx, target, c, false);

    // 2. Search-based monitoring from CONFIRMED identity (includes newly added identifiers)
    const plan = planQueries(target, { maxQueries: 15, channels: active.channels, mode: "monitor" });
    const [it] = await db.insert(schema.searchIterations).values({ personId, number: scanNo, reason: `Monitoring scan #${scanNo} (${String(payload.trigger ?? "scheduled")})`, queryCount: plan.planned.length }).returning({ id: schema.searchIterations.id });
    const results: SearchResult[] = [];
    await mapWithConcurrency(plan.planned, 3, async (q) => {
      const r = await executeQuery(q, { active, personId, iterationId: it.id, iteration: scanNo, demoEpoch: scanNo });
      results.push(...r.results);
    });
    await db.update(schema.searchIterations).set({ completedAt: new Date() }).where(eq(schema.searchIterations.id, it.id));

    const known = new Map((await db.select().from(schema.personSources).where(eq(schema.personSources.personId, personId))).map((s) => [s.canonicalUrl, s]));
    const handled = new Set<string>();
    for (const r of results) {
      const cu = canonicalUrl(r.url);
      if (handled.has(cu)) continue;
      handled.add(cu);
      const src = known.get(cu);
      if (src) {
        if (src.monitorMethod === "search_only" && src.monitored) await observe(personId, src, { available: true, httpStatus: null, title: r.title, text: `${r.title}\n${r.contentText || r.description}` }, target, c, false);
        continue;
      }
      const verdict = await attributeNewResult(r, target);
      if (!verdict) continue;
      c.new++;
      const [newSrc] = await db
        .insert(schema.personSources)
        .values({ personId, url: r.url, canonicalUrl: cu, title: r.title, sourceType: r.sourceType, sourceName: sourceNameFor(r.url), platform: r.sourcePlatform, monitorMethod: monitorMethodFor(r.url, person.isDemo), status: "NEW", verificationStatus: verdict === "strong" ? "system_discovered" : "unverified", isDemo: person.isDemo })
        .onConflictDoNothing()
        .returning();
      if (!newSrc) continue;
      // Baseline the new source with the same method future checks will use, so the next scan compares like with like.
      let baseText = `${r.title}\n${r.contentText || r.description}`;
      if (newSrc.monitorMethod !== "search_only") {
        const res = await checkSource(newSrc, ctx).catch(() => null);
        if (res?.available && !res.skipped) baseText = res.contentText;
      }
      const text = normalizeContent(baseText);
      const hash = sha256(text);
      const [snap] = await db.insert(schema.snapshots).values({ sourceId: newSrc.id, personId, available: true, httpStatus: null, title: r.title, contentHash: hash, contentText: text }).returning({ id: schema.snapshots.id });
      const sig = extractSignals(r, target);
      const [ev] = await db
        .insert(schema.evidence)
        .values({ personId, sourceId: newSrc.id, sourceUrl: r.url, sourceType: r.sourceType, sourceName: sourceNameFor(r.url), title: r.title, summary: (r.description || r.contentText).slice(0, 300), contentSnapshot: r.contentText.slice(0, 5000), contentHash: hash, extractedAttributes: signalsToAttributes(sig), verificationStatus: verdict === "strong" ? "system_discovered" : "unverified", isDemo: person.isDemo })
        .onConflictDoNothing()
        .returning({ id: schema.evidence.id });
      const summary = verdict === "strong" ? "Linked to a confirmed identifier" : "Possible mention — name + 2 attributes agree, not linked by an identifier";
      const [ch] = await db.insert(schema.changes).values({ personId, sourceId: newSrc.id, changeType: "NEW", currentSnapshotId: snap.id, diff: [], summary: `${r.title} — ${summary}`, evidenceId: ev?.id ?? null }).returning({ id: schema.changes.id });
      await db.insert(schema.alerts).values({ personId, changeId: ch.id, severity: "new", title: `New ${r.sourceType === "article" ? "article" : "source"} detected`, body: r.title });
      await addTimeline(db, { personId, type: "new", title: `New ${r.sourceType === "article" ? "article" : "source"} detected · ${sourceNameFor(r.url)}`, detail: `${r.title} (${summary})`, url: r.url, sourceId: newSrc.id, changeId: ch.id, evidenceId: ev?.id });
    }

    const summary = { ...c, queries: plan.planned.length };
    await db.update(schema.monitoringJobs).set({ running: false, lockedAt: null, lastRunAt: new Date(), nextRunAt: nextRunAt(new Date(), job.intervalHours), runCount: scanNo, lastError: null, lastSummary: summary }).where(eq(schema.monitoringJobs.id, job.id));
    await addTimeline(db, { personId, type: "scan", title: `Monitoring scan #${scanNo} completed`, detail: `${c.checked} checked · ${c.new} new · ${c.changed} changed · ${c.gone} gone · ${c.unchanged} unchanged${c.errors ? ` · ${c.errors} errors` : ""}` });
    await db.update(schema.persons).set({ status: job.status === "paused" ? "paused" : "monitoring" }).where(eq(schema.persons.id, personId));
  } catch (e) {
    await db.update(schema.monitoringJobs).set({ running: false, lockedAt: null, lastError: e instanceof Error ? e.message.slice(0, 300) : "scan failed", nextRunAt: nextRunAt(new Date(), Math.min(job.intervalHours, 1)) }).where(eq(schema.monitoringJobs.id, job.id));
    throw e;
  }
}

registerHandler("baseline", runBaseline);
registerHandler("monitor_scan", runMonitorScan);

// ---------------------------------------------------------------------------
// Scheduler + controls

export async function schedulerTick(now = new Date()): Promise<number> {
  const db = await getDb();
  const due = await db.select().from(schema.monitoringJobs).where(and(eq(schema.monitoringJobs.status, "active"), eq(schema.monitoringJobs.running, false), lte(schema.monitoringJobs.nextRunAt, now)));
  let n = 0;
  for (const j of due) {
    if (!isDue({ status: j.status as "active", intervalHours: j.intervalHours, nextRunAt: j.nextRunAt, running: j.running }, now)) continue;
    const claimed = await db.update(schema.monitoringJobs).set({ running: true, lockedAt: now }).where(and(eq(schema.monitoringJobs.id, j.id), eq(schema.monitoringJobs.running, false))).returning({ id: schema.monitoringJobs.id });
    if (!claimed.length) continue;
    await enqueue("monitor_scan", { personId: j.personId, trigger: "scheduled" });
    n++;
  }
  // Recover scans stuck in "running" (crashed worker).
  await db.update(schema.monitoringJobs).set({ running: false, lockedAt: null }).where(and(eq(schema.monitoringJobs.running, true), lte(schema.monitoringJobs.lockedAt, new Date(now.getTime() - 30 * 60_000))));
  return n;
}

export async function triggerScan(personId: string, userId: string | null) {
  const db = await getDb();
  const job = await db.query.monitoringJobs.findFirst({ where: eq(schema.monitoringJobs.personId, personId) });
  if (!job) throw new DomainError("Person is not monitored", 404);
  const claimed = await db.update(schema.monitoringJobs).set({ running: true, lockedAt: new Date() }).where(and(eq(schema.monitoringJobs.id, job.id), eq(schema.monitoringJobs.running, false))).returning({ id: schema.monitoringJobs.id });
  if (!claimed.length) throw new DomainError("A scan is already running", 409);
  await enqueue("monitor_scan", { personId, trigger: "manual" }, { maxAttempts: 1 });
  await audit(userId, "monitor.scan", personId);
}

export async function updateMonitoring(personId: string, patch: { status?: "active" | "paused"; intervalHours?: number }, userId: string | null) {
  const db = await getDb();
  const job = await db.query.monitoringJobs.findFirst({ where: eq(schema.monitoringJobs.personId, personId) });
  if (!job) throw new DomainError("Person is not monitored", 404);
  const set: Partial<typeof schema.monitoringJobs.$inferInsert> = {};
  if (patch.intervalHours) {
    set.intervalHours = patch.intervalHours;
    set.nextRunAt = nextRunAt(job.lastRunAt ?? new Date(), patch.intervalHours);
  }
  if (patch.status) {
    set.status = patch.status;
    if (patch.status === "active" && job.status === "paused") set.nextRunAt = nextRunAt(new Date(), patch.intervalHours ?? job.intervalHours);
  }
  await db.update(schema.monitoringJobs).set(set).where(eq(schema.monitoringJobs.id, job.id));
  if (patch.status) await db.update(schema.persons).set({ status: patch.status === "paused" ? "paused" : "monitoring" }).where(eq(schema.persons.id, personId));
  await addTimeline(db, { personId, type: "monitoring", title: patch.status === "paused" ? "Monitoring paused" : patch.status === "active" ? "Monitoring resumed" : "Monitoring interval changed", detail: `Interval: every ${patch.intervalHours ?? job.intervalHours}h` });
  await audit(userId, "monitor.update", personId, patch);
}

export async function markChangesSeen(personId: string) {
  const db = await getDb();
  await db.update(schema.changes).set({ seen: true }).where(eq(schema.changes.personId, personId));
  await db.update(schema.alerts).set({ readAt: new Date() }).where(and(eq(schema.alerts.personId, personId), isNull(schema.alerts.readAt)));
}

// ---------------------------------------------------------------------------
// Views

export async function listPersons(): Promise<PersonSummaryView[]> {
  const db = await getDb();
  const persons = await db.select().from(schema.persons).orderBy(desc(schema.persons.lockedAt));
  if (!persons.length) return [];
  const ids = persons.map((p) => p.id);
  const jobs = await db.select().from(schema.monitoringJobs).where(inArray(schema.monitoringJobs.personId, ids));
  const attrCounts = await db.select({ personId: schema.personAttributes.personId, state: schema.personAttributes.state, n: count() }).from(schema.personAttributes).where(and(inArray(schema.personAttributes.personId, ids), isNull(schema.personAttributes.removedAt))).groupBy(schema.personAttributes.personId, schema.personAttributes.state);
  const idCounts = await db.select({ personId: schema.personIdentifiers.personId, state: schema.personIdentifiers.state, n: count() }).from(schema.personIdentifiers).where(and(inArray(schema.personIdentifiers.personId, ids), isNull(schema.personIdentifiers.removedAt))).groupBy(schema.personIdentifiers.personId, schema.personIdentifiers.state);
  const srcCounts = await db.select({ personId: schema.personSources.personId, n: count() }).from(schema.personSources).where(inArray(schema.personSources.personId, ids)).groupBy(schema.personSources.personId);
  const chCounts = await db.select({ personId: schema.changes.personId, type: schema.changes.changeType, n: count() }).from(schema.changes).where(and(inArray(schema.changes.personId, ids), eq(schema.changes.seen, false))).groupBy(schema.changes.personId, schema.changes.changeType);
  return persons.map((p) => {
    const j = jobs.find((x) => x.personId === p.id);
    const a = attrCounts.filter((x) => x.personId === p.id);
    const i = idCounts.filter((x) => x.personId === p.id);
    const ch = (t: string) => Number(chCounts.find((x) => x.personId === p.id && x.type === t)?.n ?? 0);
    return {
      id: p.id,
      publicId: p.publicId,
      displayName: p.displayName,
      status: p.status,
      monitoringStatus: j?.status ?? "none",
      confirmedAttributes: [...a, ...i].filter((x) => x.state === "confirmed").reduce((s, x) => s + Number(x.n), 0),
      attributes: [...a, ...i].reduce((s, x) => s + Number(x.n), 0),
      sources: Number(srcCounts.find((x) => x.personId === p.id)?.n ?? 0),
      lastScanAt: j?.lastRunAt?.toISOString() ?? null,
      nextScanAt: j?.nextRunAt?.toISOString() ?? null,
      newFindings: ch("NEW"),
      changedFindings: ch("CHANGED"),
      goneFindings: ch("NO_LONGER_AVAILABLE"),
      isDemo: p.isDemo,
      running: j?.running ?? false,
      intervalHours: j?.intervalHours ?? 0,
    };
  });
}

export async function personDetail(personId: string): Promise<PersonDetailView | null> {
  const db = await getDb();
  const summary = (await listPersons()).find((p) => p.id === personId);
  const p = await db.query.persons.findFirst({ where: eq(schema.persons.id, personId) });
  if (!summary || !p) return null;
  const [attrs, ids, sources, ev, chs, tl, al, job] = await Promise.all([
    db.select().from(schema.personAttributes).where(eq(schema.personAttributes.personId, personId)).orderBy(asc(schema.personAttributes.createdAt)),
    db.select().from(schema.personIdentifiers).where(eq(schema.personIdentifiers.personId, personId)).orderBy(asc(schema.personIdentifiers.createdAt)),
    db.select().from(schema.personSources).where(eq(schema.personSources.personId, personId)).orderBy(asc(schema.personSources.firstSeenAt)),
    db.select().from(schema.evidence).where(eq(schema.evidence.personId, personId)).orderBy(desc(schema.evidence.lastSeenAt)),
    db.select().from(schema.changes).where(eq(schema.changes.personId, personId)).orderBy(desc(schema.changes.detectedAt)).limit(200),
    db.select().from(schema.timelineEvents).where(eq(schema.timelineEvents.personId, personId)).orderBy(asc(schema.timelineEvents.occurredAt)),
    db.select().from(schema.alerts).where(eq(schema.alerts.personId, personId)).orderBy(desc(schema.alerts.createdAt)).limit(50),
    db.query.monitoringJobs.findFirst({ where: eq(schema.monitoringJobs.personId, personId) }),
  ]);
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const changes: ChangeView[] = chs.map((c) => ({
    id: c.id,
    sourceId: c.sourceId,
    sourceUrl: c.sourceId ? srcById.get(c.sourceId)?.url ?? null : null,
    sourceTitle: c.sourceId ? srcById.get(c.sourceId)?.title ?? null : null,
    changeType: c.changeType,
    detectedAt: c.detectedAt.toISOString(),
    diff: c.diff as ChangeView["diff"],
    attributeChanges: c.attributeChanges as ChangeView["attributeChanges"],
    summary: c.summary,
    seen: c.seen,
    evidenceId: c.evidenceId,
  }));
  return {
    ...summary,
    purpose: p.purpose,
    lockedAt: p.lockedAt.toISOString(),
    sessionId: p.sessionId,
    attributesList: attrs.map((a) => ({ id: a.id, kind: a.kind, value: a.value, state: a.state, note: a.note, createdAt: a.createdAt.toISOString(), removedAt: a.removedAt?.toISOString() ?? null })),
    identifiers: ids.map((i) => ({ id: i.id, platform: i.platform as PersonDetailView["identifiers"][number]["platform"], handle: i.handle, url: i.url, state: i.state, verifiedAt: i.verifiedAt?.toISOString() ?? null, createdAt: i.createdAt.toISOString(), removedAt: i.removedAt?.toISOString() ?? null })),
    sourcesList: sources.map((s) => ({ id: s.id, url: s.url, title: s.title, sourceType: s.sourceType, sourceName: s.sourceName, platform: s.platform, monitorMethod: s.monitorMethod, status: s.status, verificationStatus: s.verificationStatus, firstSeenAt: s.firstSeenAt.toISOString(), lastCheckedAt: s.lastCheckedAt?.toISOString() ?? null, lastChangedAt: s.lastChangedAt?.toISOString() ?? null, isDemo: s.isDemo })),
    evidence: ev.map((e) => ({ id: e.id, sourceUrl: e.sourceUrl, sourceType: e.sourceType, sourceName: e.sourceName, firstSeenAt: e.firstSeenAt.toISOString(), lastSeenAt: e.lastSeenAt.toISOString(), title: e.title, summary: e.summary, contentSnapshot: e.contentSnapshot, extractedAttributes: e.extractedAttributes as Record<string, string[]>, verificationStatus: e.verificationStatus, isDemo: e.isDemo })),
    changes,
    timeline: tl.map((t) => ({ id: t.id, occurredAt: t.occurredAt.toISOString(), type: t.type, title: t.title, detail: t.detail, url: t.url, evidenceId: t.evidenceId, changeId: t.changeId })),
    alerts: al.map((a) => ({ id: a.id, severity: a.severity, title: a.title, body: a.body, createdAt: a.createdAt.toISOString(), readAt: a.readAt?.toISOString() ?? null })),
    monitoring: {
      status: job?.status ?? "none",
      intervalHours: job?.intervalHours ?? 0,
      lastRunAt: job?.lastRunAt?.toISOString() ?? null,
      nextRunAt: job?.nextRunAt?.toISOString() ?? null,
      running: job?.running ?? false,
      runCount: job?.runCount ?? 0,
      lastError: job?.lastError ?? null,
      lastSummary: (job?.lastSummary as Record<string, number>) ?? null,
    },
  };
}

export async function personSearchHistory(personId: string) {
  const db = await getDb();
  const rows = await db.select().from(schema.searchQueries).where(eq(schema.searchQueries.personId, personId)).orderBy(asc(schema.searchQueries.iteration), asc(schema.searchQueries.createdAt));
  const iterations = await db.select().from(schema.searchIterations).where(eq(schema.searchIterations.personId, personId)).orderBy(asc(schema.searchIterations.startedAt));
  return { iterations: iterations.map((i) => ({ id: i.id, number: i.number, reason: i.reason, queryCount: i.queryCount, startedAt: i.startedAt.toISOString() })), queries: rows };
}

