import "server-only";
/**
 * HUMAN CONFIRMATION → PERSON LOCK → IDENTITY PROFILE → ENRICHMENT.
 * A person record is only ever created from an explicit user action.
 */
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "@/lib/db/client";
import { env } from "@/lib/config/env";
import { activeAdapters, type ActiveSet } from "@/lib/adapters/registry";
import { latestCandidates } from "./discovery";
import { executeQuery, rowToResult } from "./executor";
import { enqueue } from "./jobs";
import { addTimeline, audit } from "./timeline";
import { canonicalUrl } from "@/lib/core/resolution";
import { extractSignals } from "@/lib/core/extract";
import { canonicalAttributeValue } from "@/lib/core/input";
import { PLATFORM_LABEL, PLATFORM_SITE, parseProfileUrl, profileFromInput } from "@/lib/core/profiles";
import { planQueries, queryKey } from "@/lib/core/planner";
import { domainOf, norm } from "@/lib/core/text";
import { sha256 } from "@/lib/security/hash";
import type { AttributeKind, AttributeState, CandidateProfile, ExtractedSignals, Platform, PlannedQuery, SearchResult, TargetProfile } from "@/lib/core/types";
import type { VerificationReport } from "@/lib/view-types";

import { DomainError } from "@/lib/errors";
export { DomainError };

export function monitorMethodFor(url: string, isDemo: boolean): string {
  if (isDemo) return "demo";
  const p = parseProfileUrl(url);
  if (p?.platform === "github") return "github_api";
  if (p?.platform === "reddit" && env().REDDIT_CLIENT_ID) return "reddit_api";
  if (p && ["linkedin", "instagram", "facebook", "x"].includes(p.platform)) return "search_only";
  if (/(^|\.)(linkedin|instagram|facebook|twitter|x)\.com$/i.test(domainOf(url))) return "search_only";
  if (env().CHANGEDETECTION_URL && env().CHANGEDETECTION_API_KEY) return "changedetection";
  return "web_fetch";
}

export function sourceNameFor(url: string): string {
  const p = parseProfileUrl(url);
  if (p) return PLATFORM_LABEL[p.platform];
  return domainOf(url);
}

export function signalsToAttributes(s: ExtractedSignals): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const put = (k: string, v: string[]) => v.length && (out[k] = v);
  put("name", s.nameMatchedAs ? [s.nameMatchedAs] : []);
  put("organization", s.organizations);
  put("previous_organization", s.previousOrganizations);
  put("designation", s.designations);
  put("city", s.cities);
  put("country", s.countries);
  put("school", s.schools);
  put("age", s.ages.map(String));
  put("event", s.events);
  put("profiles", [...(s.subjectProfile ? [`${s.subjectProfile.platform}:${s.subjectProfile.handle}`] : []), ...s.mentionedProfiles.map((p) => `${p.platform}:${p.handle}`)]);
  return out;
}

/** Target profile used for all future searches of a locked person. */
export async function targetFromPerson(personId: string, db?: Db): Promise<TargetProfile> {
  db ??= await getDb();
  const person = await db.query.persons.findFirst({ where: eq(schema.persons.id, personId) });
  if (!person) throw new DomainError("Person not found", 404);
  const attrs = await db.select().from(schema.personAttributes).where(and(eq(schema.personAttributes.personId, personId), isNull(schema.personAttributes.removedAt)));
  const ids = await db.select().from(schema.personIdentifiers).where(and(eq(schema.personIdentifiers.personId, personId), isNull(schema.personIdentifiers.removedAt)));
  const usable = (st: string) => st !== "unverified";
  return {
    name: person.displayName,
    attributes: attrs.filter((a) => a.kind !== "name" && usable(a.state)).map((a) => ({ kind: a.kind as AttributeKind, value: a.value, state: a.state as AttributeState })),
    identifiers: ids.filter((i) => usable(i.state)).map((i) => ({ platform: i.platform as Platform, handle: i.handle, url: i.url ?? undefined, state: i.state as AttributeState })),
  };
}

export async function adaptersForPerson(isDemo: boolean): Promise<ActiveSet> {
  return activeAdapters({ forceDemo: isDemo });
}

// ---------------------------------------------------------------------------
// LOCK

export async function lockPerson(sessionId: string, clusterKey: string, userId: string | null): Promise<{ personId: string; publicId: string }> {
  const db = await getDb();
  const session = await db.query.searchSessions.findFirst({ where: eq(schema.searchSessions.id, sessionId) });
  if (!session) throw new DomainError("Session not found", 404);
  if (session.personId) throw new DomainError("This search is already locked to a person", 409);
  if (session.status === "running" || session.status === "queued") throw new DomainError("Wait for the search to finish before locking", 409);
  const candidate = (await latestCandidates(sessionId)).find((c) => c.clusterKey === clusterKey);
  if (!candidate) throw new DomainError("Candidate not found", 404);
  const target = session.target as TargetProfile;

  const results = candidate.resultIds.length ? (await db.select().from(schema.searchResults).where(inArray(schema.searchResults.id, candidate.resultIds))).map(rowToResult) : [];
  const isDemo = session.isDemo;

  const personId = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(schema.persons)
      .values({ publicId: `PENDING-${crypto.randomUUID()}`, displayName: candidate.displayName || target.name, sessionId, candidateKey: clusterKey, purpose: session.purpose, isDemo, lockedBy: userId, imageUrl: isDemo ? null : candidate.imageUrl ?? null })
      .returning({ id: schema.persons.id, seq: schema.persons.seq });
    const publicId = `PERSON-${String(p.seq).padStart(6, "0")}`;
    await tx.update(schema.persons).set({ publicId }).where(eq(schema.persons.id, p.id));

    // --- attributes
    const rows: (typeof schema.personAttributes.$inferInsert)[] = [{ personId: p.id, kind: "name", value: candidate.displayName || target.name, normalizedValue: norm(target.name), state: "confirmed" }];
    for (const a of target.attributes) {
      const b = candidate.match.breakdown.find((x) => x.key === a.kind && norm(x.expected) === norm(canonicalAttributeValue(a.kind, a.value)));
      const state: AttributeState = b?.status === "match" ? "confirmed" : b?.status === "conflict" ? "unverified" : "user_supplied";
      rows.push({ personId: p.id, kind: a.kind, value: a.value, normalizedValue: norm(a.value), state, note: b?.status === "conflict" ? `Conflicts with evidence: ${b.found.join(", ")}` : b?.status === "match" ? "Matched by evidence and confirmed at lock" : "Supplied by user; no evidence yet" });
    }
    const discoverKinds: AttributeKind[] = ["city", "country", "organization", "designation", "previous_organization", "school", "age", "event"];
    for (const k of discoverKinds) {
      for (const v of (candidate.attributes[k] ?? []).slice(0, 2)) {
        if (rows.some((r) => r.kind === k && norm(r.value) === norm(v.value))) continue;
        if (rows.some((r) => r.kind === k) && v.count < 2) continue;
        rows.push({ personId: p.id, kind: k, value: v.value, normalizedValue: norm(v.value), state: "system_discovered", note: `Seen in ${v.evidence.length} source(s)` });
      }
    }
    await tx.insert(schema.personAttributes).values(rows);

    // --- identifiers
    const idRows: (typeof schema.personIdentifiers.$inferInsert)[] = [];
    for (const prof of candidate.profiles) {
      const supplied = target.identifiers.find((i) => i.platform === prof.platform && i.handle === prof.handle);
      idRows.push({ personId: p.id, platform: prof.platform, handle: prof.handle, url: prof.url, state: supplied ? "confirmed" : "system_discovered", identifierType: "profile_url", verifiedAt: supplied ? new Date() : null });
    }
    for (const i of target.identifiers) {
      if (idRows.some((r) => r.platform === i.platform && r.handle === i.handle)) continue;
      const conflict = candidate.profiles.some((pp) => pp.platform === i.platform);
      idRows.push({ personId: p.id, platform: i.platform, handle: i.handle, url: i.url ?? null, state: conflict ? "unverified" : "user_supplied" });
    }
    if (idRows.length) await tx.insert(schema.personIdentifiers).values(idRows).onConflictDoNothing();

    // --- sources + evidence
    const seen = new Set<string>();
    for (const r of results) {
      const cu = canonicalUrl(r.url);
      if (seen.has(cu)) continue;
      seen.add(cu);
      const [src] = await tx
        .insert(schema.personSources)
        .values({
          personId: p.id,
          url: r.url,
          canonicalUrl: cu,
          title: r.title,
          sourceType: r.sourceType,
          sourceName: sourceNameFor(r.url),
          platform: parseProfileUrl(r.url)?.platform ?? r.sourcePlatform,
          monitorMethod: monitorMethodFor(r.url, isDemo),
          status: "EXISTING",
          verificationStatus: "confirmed",
          firstSeenAt: new Date(r.discoveredAt),
          lastCheckedAt: new Date(r.discoveredAt),
          isDemo,
        })
        .returning({ id: schema.personSources.id });
      const sig = extractSignals(r, target);
      const [evRow] = await tx
        .insert(schema.evidence)
        .values({
          personId: p.id,
          sourceId: src.id,
          sourceUrl: r.url,
          sourceType: r.sourceType,
          sourceName: sourceNameFor(r.url),
          firstSeenAt: new Date(r.discoveredAt),
          lastSeenAt: new Date(r.discoveredAt),
          title: r.title,
          summary: (r.description || r.contentText).slice(0, 300),
          contentSnapshot: r.contentText.slice(0, 5000),
          contentHash: sha256(r.contentText),
          extractedAttributes: signalsToAttributes(sig),
          verificationStatus: "confirmed",
          isDemo,
        })
        .onConflictDoNothing()
        .returning({ id: schema.evidence.id });
      await addTimeline(tx, { personId: p.id, occurredAt: new Date(r.discoveredAt), type: "source_found", title: `${sourceNameFor(r.url)} source found`, detail: r.title, url: r.url, sourceId: src.id, evidenceId: evRow?.id });
    }

    await addTimeline(tx, { personId: p.id, occurredAt: session.createdAt, type: "discovered", title: "Person discovered", detail: `Search for "${target.name}" · candidate ${clusterKey} matched ${candidate.match.matched}/${candidate.match.total}` });
    await addTimeline(tx, { personId: p.id, type: "locked", title: "Identity confirmed & locked", detail: `${publicId} locked by user after reviewing ${candidate.evidenceCount} evidence item(s)` });

    const interval = env().MONITOR_INTERVAL_HOURS;
    await tx.insert(schema.monitoringJobs).values({ personId: p.id, status: "active", intervalHours: interval, nextRunAt: new Date(Date.now() + interval * 3_600_000) });
    await tx.update(schema.searchSessions).set({ personId: p.id, uiState: "person_locked", updatedAt: new Date() }).where(eq(schema.searchSessions.id, sessionId));
    await tx.update(schema.searchQueries).set({ personId: p.id }).where(eq(schema.searchQueries.sessionId, sessionId));
    await tx.update(schema.searchIterations).set({ personId: p.id }).where(eq(schema.searchIterations.sessionId, sessionId));
    return p.id;
  });

  await audit(userId, "person.lock", personId, { sessionId, clusterKey });
  await enqueue("baseline", { personId });
  const person = await db.query.persons.findFirst({ where: eq(schema.persons.id, personId) });
  return { personId, publicId: person!.publicId };
}

// ---------------------------------------------------------------------------
// ENRICHMENT

export async function verifyIdentifier(personId: string, platform: Platform, rawValue: string, userId: string | null): Promise<VerificationReport> {
  const db = await getDb();
  const person = await db.query.persons.findFirst({ where: eq(schema.persons.id, personId) });
  if (!person) throw new DomainError("Person not found", 404);
  const prof = profileFromInput(platform, rawValue);
  if (!prof) throw new DomainError(`Not a valid ${PLATFORM_LABEL[platform]} username or URL`);

  const other = await db
    .select({ publicId: schema.persons.publicId })
    .from(schema.personIdentifiers)
    .innerJoin(schema.persons, eq(schema.persons.id, schema.personIdentifiers.personId))
    .where(and(eq(schema.personIdentifiers.platform, platform), eq(schema.personIdentifiers.handle, prof.handle), ne(schema.personIdentifiers.personId, personId), isNull(schema.personIdentifiers.removedAt)));

  const target = await targetFromPerson(personId, db);
  const active = await adaptersForPerson(person.isDemo);
  const site = PLATFORM_SITE[platform];
  const queries: PlannedQuery[] = [
    { query: prof.handle, key: queryKey(prof.handle, "username"), tier: 1, category: "username", channel: "username", reason: `Verify ${PLATFORM_LABEL[platform]} identifier`, handle: prof.handle, platform },
    ...(site ? [{ query: `site:${site} "${prof.handle}"`, key: queryKey(`site:${site} "${prof.handle}"`), tier: 1, category: "cross_reference" as const, channel: "web" as const, reason: `Verify ${PLATFORM_LABEL[platform]} identifier`, platform }] : []),
    { query: `"${prof.handle}"`, key: queryKey(`"${prof.handle}"`), tier: 1, category: "cross_reference", channel: "web", reason: `Verify ${PLATFORM_LABEL[platform]} identifier` },
  ];
  const [it] = await db.insert(schema.searchIterations).values({ personId, number: 0, reason: `Identifier verification: ${platform}:${prof.handle}`, queryCount: queries.length }).returning({ id: schema.searchIterations.id });
  const all: SearchResult[] = [];
  const searched: string[] = [];
  for (const q of queries) {
    const r = await executeQuery(q, { active, personId, iterationId: it.id, iteration: 0, demoEpoch: 0 });
    all.push(...r.results);
    searched.push(...r.adapters.map((a) => `${a}: ${q.query}`));
  }
  await db.update(schema.searchIterations).set({ completedAt: new Date() }).where(eq(schema.searchIterations.id, it.id));

  const findings: VerificationReport["findings"] = [];
  const seen = new Set<string>();
  for (const r of all) {
    const s = extractSignals(r, target);
    const isProfile = s.subjectProfile?.platform === platform && s.subjectProfile.handle === prof.handle;
    const mentions = s.mentionedProfiles.some((m) => m.platform === platform && m.handle === prof.handle);
    if (!isProfile && !mentions) continue;
    const cu = canonicalUrl(r.url);
    if (seen.has(cu)) continue;
    seen.add(cu);
    const matched: string[] = [];
    const conflicts: string[] = [];
    const check = (kind: AttributeKind, found: string[]) => {
      const exp = target.attributes.filter((a) => a.kind === kind);
      if (!exp.length || !found.length) return;
      if (exp.some((e) => found.some((f) => norm(f) === norm(e.value) || norm(f).includes(norm(e.value))))) matched.push(`${kind}: ${found.join(", ")}`);
      else if (kind !== "organization" || !s.previousOrganizations.length) conflicts.push(`${kind}: ${found.join(", ")}`);
    };
    check("city", s.cities);
    check("organization", s.organizations);
    check("designation", s.designations);
    const linked = s.mentionedProfiles.filter((m) => target.identifiers.some((i) => i.platform === m.platform && i.handle === m.handle));
    for (const l of linked) matched.push(`links to known ${PLATFORM_LABEL[l.platform]} (${l.handle})`);
    findings.push({ url: r.url, title: r.title, nameMatch: s.nameHit, matched, conflicts, isDemo: Boolean(r.isDemo) });
  }

  let verdict: VerificationReport["verdict"] = "not_found";
  let message = `No public ${PLATFORM_LABEL[platform]} profile "${prof.handle}" was found by the active sources. You can still add it as user-supplied.`;
  const best = findings.find((f) => f.nameMatch && f.matched.length && !f.conflicts.length);
  if (best) {
    verdict = "corroborated";
    message = `Found a public profile whose name and ${best.matched.length} attribute(s) agree with ${person.publicId}. Confirm only if you are sure this is the same person.`;
  } else if (findings.length) {
    verdict = "exists_unlinked";
    message = `The ${PLATFORM_LABEL[platform]} account exists publicly but nothing links it to ${person.publicId}. Adding it relies on your own knowledge.`;
  }
  if (["instagram", "facebook", "linkedin", "x"].includes(platform) && !person.isDemo) message += ` ${PLATFORM_LABEL[platform]} is checked through public search results only (LIMITED).`;
  if (other.length) message += ` Note: this identifier is already attached to ${other.map((o) => o.publicId).join(", ")}.`;

  await audit(userId, "identifier.verify", personId, { platform, verdict });
  return { platform, handle: prof.handle, url: prof.url || null, verdict, message, findings, searched };
}

export async function addIdentifier(personId: string, platform: Platform, rawValue: string, report: VerificationReport | null, userId: string | null) {
  const db = await getDb();
  const person = await db.query.persons.findFirst({ where: eq(schema.persons.id, personId) });
  if (!person) throw new DomainError("Person not found", 404);
  const prof = profileFromInput(platform, rawValue);
  if (!prof) throw new DomainError(`Not a valid ${PLATFORM_LABEL[platform]} username or URL`);
  const state: AttributeState = report?.verdict === "corroborated" ? "confirmed" : "user_supplied";

  const existing = await db.query.personIdentifiers.findFirst({ where: and(eq(schema.personIdentifiers.personId, personId), eq(schema.personIdentifiers.platform, platform), eq(schema.personIdentifiers.handle, prof.handle)) });
  if (existing) {
    await db.update(schema.personIdentifiers).set({ state, removedAt: null, verification: report, verifiedAt: new Date(), url: prof.url || existing.url }).where(eq(schema.personIdentifiers.id, existing.id));
  } else {
    await db.insert(schema.personIdentifiers).values({ personId, platform, handle: prof.handle, url: prof.url || null, state, identifierType: "username", verification: report, verifiedAt: new Date() });
  }

  // The profile URL becomes a monitored source.
  const url = report?.findings.find((f) => parseProfileUrl(f.url)?.handle === prof.handle)?.url ?? prof.url;
  let sourceId: string | undefined;
  let evidenceId: string | undefined;
  if (url) {
    const cu = canonicalUrl(url);
    const found = await db.query.personSources.findFirst({ where: and(eq(schema.personSources.personId, personId), eq(schema.personSources.canonicalUrl, cu)) });
    if (found) sourceId = found.id;
    else {
      const [src] = await db
        .insert(schema.personSources)
        .values({ personId, url, canonicalUrl: cu, title: `${PLATFORM_LABEL[platform]} · ${prof.handle}`, sourceType: "profile", sourceName: PLATFORM_LABEL[platform], platform, monitorMethod: monitorMethodFor(url, person.isDemo), status: "NEW", verificationStatus: state === "confirmed" ? "confirmed" : "user_supplied", isDemo: person.isDemo })
        .returning({ id: schema.personSources.id });
      sourceId = src.id;
      await enqueue("baseline", { personId, sourceIds: [src.id] });
    }
    const f = report?.findings.find((x) => canonicalUrl(x.url) === cu);
    const summary = f ? `${f.nameMatch ? "Name matches. " : ""}${f.matched.join("; ")}` : "Added by user";
    const [ev] = await db
      .insert(schema.evidence)
      .values({ personId, sourceId, sourceUrl: url, sourceType: "profile", sourceName: PLATFORM_LABEL[platform], title: f?.title ?? `${PLATFORM_LABEL[platform]} ${prof.handle}`, summary, contentHash: sha256(`${url}|${summary}`), extractedAttributes: { profiles: [`${platform}:${prof.handle}`] }, verificationStatus: state, isDemo: person.isDemo })
      .onConflictDoNothing()
      .returning({ id: schema.evidence.id });
    evidenceId = ev?.id;
  }
  await addTimeline(db, { personId, type: "identifier_added", title: `${PLATFORM_LABEL[platform]} identifier ${state === "confirmed" ? "confirmed" : "added"}`, detail: `${prof.handle} — ${report?.verdict ?? "not verified"}; now part of future searches`, url: url ?? null, sourceId, evidenceId });
  await audit(userId, "identifier.add", personId, { platform, state });
  return { handle: prof.handle, state };
}

export async function addAttribute(personId: string, kind: AttributeKind, value: string, userId: string | null) {
  const db = await getDb();
  const v = canonicalAttributeValue(kind, value);
  const existing = await db.query.personAttributes.findFirst({ where: and(eq(schema.personAttributes.personId, personId), eq(schema.personAttributes.kind, kind), eq(schema.personAttributes.normalizedValue, norm(v))) });
  if (existing) await db.update(schema.personAttributes).set({ state: "confirmed", removedAt: null, updatedAt: new Date(), note: "Confirmed by user" }).where(eq(schema.personAttributes.id, existing.id));
  else await db.insert(schema.personAttributes).values({ personId, kind, value: v, normalizedValue: norm(v), state: "confirmed", note: "Added and confirmed by user" });
  await addTimeline(db, { personId, type: "attribute_added", title: `Attribute confirmed: ${kind.replace("_", " ")}`, detail: v });
  await audit(userId, "attribute.add", personId, { kind });
}

export async function removeAttribute(personId: string, attributeId: string, userId: string | null) {
  const db = await getDb();
  const a = await db.query.personAttributes.findFirst({ where: and(eq(schema.personAttributes.id, attributeId), eq(schema.personAttributes.personId, personId)) });
  if (!a) throw new DomainError("Attribute not found", 404);
  if (a.kind === "name") throw new DomainError("The name of a locked person cannot be removed");
  await db.update(schema.personAttributes).set({ removedAt: new Date(), updatedAt: new Date() }).where(eq(schema.personAttributes.id, a.id));
  await addTimeline(db, { personId, type: "attribute_removed", title: `Attribute removed as incorrect: ${a.kind.replace("_", " ")}`, detail: a.value });
  await audit(userId, "attribute.remove", personId, { kind: a.kind });
}

export async function removeIdentifier(personId: string, identifierId: string, userId: string | null) {
  const db = await getDb();
  const i = await db.query.personIdentifiers.findFirst({ where: and(eq(schema.personIdentifiers.id, identifierId), eq(schema.personIdentifiers.personId, personId)) });
  if (!i) throw new DomainError("Identifier not found", 404);
  await db.update(schema.personIdentifiers).set({ removedAt: new Date() }).where(eq(schema.personIdentifiers.id, i.id));
  await db.update(schema.personSources).set({ monitored: false }).where(and(eq(schema.personSources.personId, personId), eq(schema.personSources.platform, i.platform), sql`${schema.personSources.canonicalUrl} ILIKE ${"%" + i.handle + "%"}`));
  await addTimeline(db, { personId, type: "identifier_removed", title: `${PLATFORM_LABEL[i.platform as Platform] ?? i.platform} identifier removed as incorrect`, detail: i.handle });
  await audit(userId, "identifier.remove", personId, { platform: i.platform });
}

/** Queries the next monitoring scan will run — proves enrichment feeds search generation. */
export async function searchPlanForPerson(personId: string) {
  const db = await getDb();
  const person = await db.query.persons.findFirst({ where: eq(schema.persons.id, personId) });
  if (!person) throw new DomainError("Person not found", 404);
  const target = await targetFromPerson(personId, db);
  const active = await adaptersForPerson(person.isDemo);
  const plan = planQueries(target, { maxQueries: 20, channels: active.channels, mode: "monitor" });
  return { target, planned: plan.planned };
}

export async function listRecentSessions(userId: string | null, limit = 10) {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.searchSessions.id, target: schema.searchSessions.target, status: schema.searchSessions.status, uiState: schema.searchSessions.uiState, isDemo: schema.searchSessions.isDemo, createdAt: schema.searchSessions.createdAt, personId: schema.searchSessions.personId })
    .from(schema.searchSessions)
    .where(userId ? eq(schema.searchSessions.userId, userId) : undefined)
    .orderBy(desc(schema.searchSessions.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, name: (r.target as TargetProfile).name, createdAt: r.createdAt.toISOString() }));
}

export type { CandidateProfile };
