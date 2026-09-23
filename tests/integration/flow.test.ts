/**
 * End-to-end pipeline against embedded Postgres (PGlite, in-memory) in DEMO
 * mode: DISCOVER → MATCH → SHOW EVIDENCE → ASK USER → CONFIRM → LOCK → MONITOR.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb, schema } from "@/lib/db/client";
import { runOnce } from "@/lib/services/jobs";
import "@/lib/services/bootstrap";
import { candidateEvidence, createSession, getSessionView, refineSession, sessionQueries } from "@/lib/services/discovery";
import { addIdentifier, lockPerson, searchPlanForPerson, verifyIdentifier } from "@/lib/services/persons";
import { listPersons, personDetail, schedulerTick, triggerScan, updateMonitoring } from "@/lib/services/monitoring";
import { DomainError } from "@/lib/errors";
import { baseQuery } from "../fixtures";

async function drain(max = 50) {
  for (let i = 0; i < max; i++) if (!(await runOnce("test"))) return;
}

let sessionId = "";
let personId = "";
let p1Key = "";

beforeAll(async () => {
  await getDb();
});
afterAll(async () => {
  await closeDb();
});

describe("discovery session", () => {
  it("runs generated searches iteratively and records every query", async () => {
    sessionId = await createSession({ ...baseQuery, freeText: "may have a YouTube channel" }, null);
    await drain();
    const v = (await getSessionView(sessionId))!;
    expect(v.status).toBe("completed");
    expect(v.isDemo).toBe(true);
    expect(v.progress.completed).toBeGreaterThan(20);
    expect(v.progress.iteration).toBeGreaterThanOrEqual(2);
    const qs = await sessionQueries(sessionId);
    expect(qs.some((q) => q.query === '"Rajesh Kumar" TCS Chennai' && q.iteration === 1 && q.status === "done")).toBe(true);
    expect(qs.some((q) => q.iteration === 2 && q.query === '"Rajesh Kumar" Infosys')).toBe(true);
    expect(qs.some((q) => q.status.startsWith("skipped_"))).toBe(true);
    expect(qs.every((q) => q.reason.length > 0)).toBe(true);
  });

  it("asks the user for more information while ambiguity remains", async () => {
    const v = (await getSessionView(sessionId))!;
    expect(v.uiState).toBe("ask_for_more_information");
    expect(v.resolution?.state).toBe("ambiguous");
    expect(v.resolution?.suggestions.map((s) => s.kind)).toContain("previous_organization");
    expect(v.coverage.every((c) => c.status === "DEMO")).toBe(true);
  });

  it("exposes evidence for each candidate", async () => {
    const v = (await getSessionView(sessionId))!;
    const p1 = v.candidates.find((c) => c.profiles.some((p) => p.handle === "rajeshkumar-pm-chennai"))!;
    p1Key = p1.clusterKey;
    const ev = (await candidateEvidence(sessionId, p1Key))!;
    expect(ev.documents.length).toBeGreaterThanOrEqual(4);
    expect(ev.documents.every((d) => d.isDemo)).toBe(true);
    expect(ev.documents.some((d) => d.signals.some((s) => s.label === "Profiles"))).toBe(true);
  });

  it("refuses to lock while the search is running and narrows after refinement", async () => {
    await refineSession(sessionId, [{ kind: "previous_organization", value: "Infosys", state: "user_supplied" }], []);
    await expect(lockPerson(sessionId, p1Key, null)).rejects.toBeInstanceOf(DomainError);
    await drain();
    const v = (await getSessionView(sessionId))!;
    expect(v.resolution?.state).toBe("leading");
    expect(v.uiState).toBe("discovery_results");
    expect(v.candidates[0].clusterKey).toBe(p1Key);
    expect(v.candidates[0].match.matched).toBe(v.candidates[0].match.total);
  });
});

describe("person lock", () => {
  it("creates a locked identity with states, sources and evidence", async () => {
    const r = await lockPerson(sessionId, p1Key, null);
    personId = r.personId;
    expect(r.publicId).toMatch(/^PERSON-\d{6}$/);
    await drain();
    const p = (await personDetail(personId))!;
    const attr = (k: string) => p.attributesList.filter((a) => a.kind === k);
    expect(attr("organization")[0].state).toBe("confirmed");
    expect(attr("previous_organization")[0].state).toBe("confirmed");
    expect(p.attributesList.some((a) => a.state === "system_discovered")).toBe(true);
    expect(p.identifiers.map((i) => `${i.platform}:${i.handle}`)).toEqual(expect.arrayContaining(["linkedin:rajeshkumar-pm-chennai", "github:rajeshkumar78", "youtube:agiletalks-rajesh"]));
    expect(p.sourcesList.length).toBeGreaterThanOrEqual(4);
    expect(p.evidence.every((e) => e.sourceUrl.startsWith("https://") && e.firstSeenAt && e.lastSeenAt)).toBe(true);
    expect(p.timeline.map((t) => t.type)).toEqual(expect.arrayContaining(["discovered", "source_found", "locked", "baseline"]));
    expect(p.status).toBe("monitoring");
  });

  it("cannot lock the same search twice", async () => {
    await expect(lockPerson(sessionId, p1Key, null)).rejects.toThrow(/already locked/);
  });
});

describe("monitoring & change detection", () => {
  it("detects NEW, CHANGED and NO_LONGER_AVAILABLE on a manual scan", async () => {
    await triggerScan(personId, null);
    await expect(triggerScan(personId, null)).rejects.toThrow(/already running/);
    await drain();
    const p = (await personDetail(personId))!;
    const types = p.changes.map((c) => c.changeType);
    expect(types).toContain("CHANGED");
    expect(types).toContain("NO_LONGER_AVAILABLE");
    expect(types).toContain("NEW");
    const changed = p.changes.find((c) => c.changeType === "CHANGED" && c.sourceUrl?.includes("linkedin"))!;
    expect(changed.attributeChanges).toEqual(expect.arrayContaining([{ kind: "designation", old: ["Project Manager"], new: ["Senior Project Manager"] }]));
    expect(changed.diff.some((d) => d.op === "add" && d.text.includes("Senior"))).toBe(true);
    const newSrc = p.sourcesList.find((s) => s.url.includes("ai-in-project-delivery-summit"))!;
    expect(newSrc.status).toBe("NEW");
    expect(newSrc.verificationStatus).toBe("system_discovered");
    expect(p.newFindings).toBeGreaterThanOrEqual(1);
    expect(p.changedFindings).toBeGreaterThanOrEqual(1);
    expect(p.monitoring.runCount).toBe(1);
    expect(p.alerts.length).toBeGreaterThanOrEqual(3);
  });

  it("a second scan reports existing sources as unchanged", async () => {
    await triggerScan(personId, null);
    await drain();
    const p = (await personDetail(personId))!;
    expect(p.monitoring.lastSummary?.changed).toBe(0);
    expect(p.sourcesList.find((s) => s.url.includes("ai-in-project-delivery-summit"))?.status).toBe("EXISTING");
  });

  it("scheduler enqueues due persons and respects pause", async () => {
    const db = await getDb();
    await db.update(schema.monitoringJobs).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(schema.monitoringJobs.personId, personId));
    await updateMonitoring(personId, { status: "paused" }, null);
    expect(await schedulerTick()).toBe(0);
    await updateMonitoring(personId, { status: "active" }, null);
    await db.update(schema.monitoringJobs).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(schema.monitoringJobs.personId, personId));
    expect(await schedulerTick()).toBe(1);
    await drain();
    const row = await db.query.monitoringJobs.findFirst({ where: eq(schema.monitoringJobs.personId, personId) });
    expect(row?.runCount).toBe(3);
    expect(row?.nextRunAt && row.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("identity enrichment", () => {
  it("verifies a new identifier and adds it to the SAME person", async () => {
    const before = (await listPersons()).length;
    const report = await verifyIdentifier(personId, "instagram", "rajeshkumar78", null);
    expect(report.verdict).toBe("corroborated");
    expect(report.findings[0].nameMatch).toBe(true);
    const added = await addIdentifier(personId, "instagram", "rajeshkumar78", report, null);
    expect(added.state).toBe("confirmed");
    await drain();
    expect((await listPersons()).length).toBe(before);
    const p = (await personDetail(personId))!;
    expect(p.identifiers.find((i) => i.platform === "instagram")?.state).toBe("confirmed");
    expect(p.sourcesList.some((s) => s.url.includes("instagram.com/rajeshkumar78"))).toBe(true);
    expect(p.timeline.some((t) => t.type === "identifier_added")).toBe(true);
  });

  it("uses the new identifier in future search generation", async () => {
    const plan = await searchPlanForPerson(personId);
    expect(plan.target.identifiers.some((i) => i.platform === "instagram" && i.handle === "rajeshkumar78")).toBe(true);
    expect(plan.planned.some((q) => q.query.includes("rajeshkumar78"))).toBe(true);
  });

  it("stores evidence once per content version", async () => {
    const db = await getDb();
    const rows = await db.select().from(schema.evidence).where(and(eq(schema.evidence.personId, personId)));
    const keys = rows.map((r) => `${r.sourceUrl}|${r.contentHash}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
