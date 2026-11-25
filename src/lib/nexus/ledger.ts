/**
 * EVIDENCE LEDGER — applies engine results to an investigation.
 *
 * Rules enforced here:
 *  - every fact keeps its source URL, passage, engine and task provenance;
 *  - organisations merge only on their official domain or exact name+city;
 *  - people are scoped to the organisation/source they appear with and are
 *    never merged across contexts on name alone;
 *  - company contact details are attached to the company, never to a person;
 *  - LLM-proposed facts are kept only with a verbatim quote, flagged as assisted;
 *  - engine provenance is never discarded when the same URL is found twice.
 *
 * All functions mutate the investigation passed in (callers pass a clone).
 */
import { canonicalUrl } from "@/lib/core/resolution";
import { normalizePhone } from "@/lib/core/phone";
import { parseProfileUrl } from "@/lib/core/profiles";
import { PLACES } from "@/lib/core/lexicon";
import { linkPriority, registrableDomain, type PageExtraction } from "./extract";
import { matchName } from "./variants";
import { newId } from "./schema";
import type { Claim, ContactPoint, EngineId, Entity, EntityType, Investigation, Lead, LeadKind, Predicate, Relationship, Source, Task, Verification } from "./schema";
import type { PageRead, TaskResult } from "./engine-types";

const nowIso = () => new Date().toISOString();
export const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();

// ---------------------------------------------------------------------------
// trail

export function trail(inv: Investigation, kind: Investigation["trail"][number]["kind"], engine: Investigation["trail"][number]["engine"], text: string, refs: string[] = []) {
  inv.trail.push({ id: newId("ev"), at: nowIso(), round: inv.round, kind, engine, text: text.slice(0, 1000), refs: refs.slice(0, 20) });
}

// ---------------------------------------------------------------------------
// fingerprints for copy detection

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function fingerprint(text: string, k = 5, n = 24): string {
  const words = norm(text).split(" ").filter(Boolean);
  if (words.length < k) return "";
  const mins = new Array(n).fill(0xffffffff);
  for (let i = 0; i + k <= words.length; i++) {
    const sh = words.slice(i, i + k).join(" ");
    for (let j = 0; j < n; j++) {
      const h = hash32(`${j}:${sh}`);
      if (h < mins[j]) mins[j] = h;
    }
  }
  return mins.map((m) => m.toString(16).padStart(8, "0")).join("");
}

export function fingerprintSimilarity(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 0;
  let eq = 0;
  const n = a.length / 8;
  for (let i = 0; i < n; i++) if (a.slice(i * 8, i * 8 + 8) === b.slice(i * 8, i * 8 + 8)) eq++;
  return eq / n;
}

// ---------------------------------------------------------------------------
// sources & passages

const SOCIAL_HOST = /(^|\.)(instagram|facebook|linkedin|x|twitter|youtube|reddit|pinterest|threads)\.com$/i;

function classifySource(url: string, publishedAt: string | null, officialDomains: Set<string>): Source["sourceType"] {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
  if (SOCIAL_HOST.test(host)) return "social_profile";
  if (officialDomains.has(registrableDomain(url))) return "official_site";
  if (/\.pdf($|\?)/i.test(url)) return "document";
  if (/(directory|listing|justdial|sulekha|indiamart|yellowpages|tradeindia)/i.test(url)) return "directory";
  if (publishedAt || /(news|weekly|times|today|press|newswire|daily|herald)/i.test(host)) return "news";
  if (/(blog|medium\.com|wordpress|blogspot)/i.test(url)) return "blog";
  if (/(forum|community|discuss)/i.test(url)) return "forum";
  return "web";
}

function officialDomains(inv: Investigation): Set<string> {
  return new Set(inv.entities.filter((e) => ["business", "school", "organisation"].includes(e.type) && e.attributes.website).map((e) => e.attributes.website));
}

export function upsertSource(inv: Investigation, url: string, p: { title?: string; snippet?: string; engine: EngineId; taskId: string; via: Source["discoveredBy"][number]["via"]; synthetic: boolean }): Source {
  const cu = canonicalUrl(url);
  let s = inv.sources.find((x) => x.canonicalUrl === cu);
  const at = nowIso();
  if (!s) {
    s = {
      id: newId("src"),
      url,
      canonicalUrl: cu,
      domain: registrableDomain(url),
      title: (p.title ?? "").slice(0, 500),
      sourceType: classifySource(url, null, officialDomains(inv)),
      discoveredBy: [],
      fetch: { status: "not_opened", httpStatus: null, reason: "Discovered, not yet opened" },
      snippet: (p.snippet ?? "").slice(0, 1500),
      publishedAt: null,
      firstSeenAt: at,
      lastCheckedAt: at,
      copyGroup: registrableDomain(url) || cu,
      outboundLinks: [],
      followedLinks: [],
      synthetic: p.synthetic,
    };
    inv.sources.push(s);
  } else {
    if (!s.title && p.title) s.title = p.title.slice(0, 500);
    if (!s.snippet && p.snippet) s.snippet = p.snippet.slice(0, 1500);
  }
  if (!s.discoveredBy.some((d) => d.engine === p.engine && d.taskId === p.taskId)) s.discoveredBy.push({ engine: p.engine, taskId: p.taskId, at, via: p.via });
  return s;
}

export function addPassage(inv: Investigation, sourceId: string, text: string): string {
  const t = text.replace(/\s+/g, " ").trim().slice(0, 1200);
  const existing = inv.passages.find((p) => p.sourceId === sourceId && p.text === t);
  if (existing) return existing.id;
  const id = newId("psg");
  inv.passages.push({ id, sourceId, text: t });
  return id;
}

// ---------------------------------------------------------------------------
// entities

export function upsertEntity(inv: Investigation, type: EntityType, name: string, key: string, sourceId: string | null, attributes: Record<string, string> = {}): Entity {
  let e = inv.entities.find((x) => x.key === key);
  if (!e) {
    e = { id: newId("ent"), type, name: name.slice(0, 300), key: key.slice(0, 400), aliases: [], attributes: {}, sourceIds: [], userDecision: null, firstSeenAt: nowIso() };
    inv.entities.push(e);
  } else if (e.name !== name && !e.aliases.includes(name) && e.aliases.length < 20) {
    e.aliases.push(name.slice(0, 300));
  }
  for (const [k, v] of Object.entries(attributes)) if (v && !e.attributes[k]) e.attributes[k] = v.slice(0, 500);
  if (sourceId && !e.sourceIds.includes(sourceId)) e.sourceIds.push(sourceId);
  return e;
}

export function orgKey(name: string, website?: string, city?: string) {
  return website ? `org:site:${website}` : `org:name:${norm(name)}|${norm(city ?? "")}`;
}

/** Find an organisation entity by official domain or (exact) name. */
export function findOrg(inv: Investigation, name?: string, domain?: string): Entity | undefined {
  const orgs = inv.entities.filter((e) => ["business", "school", "organisation"].includes(e.type));
  if (domain) {
    const byDomain = orgs.find((o) => o.attributes.website === domain);
    if (byDomain) return byDomain;
  }
  if (name) {
    const n = norm(name);
    return orgs.find((o) => norm(o.name) === n || o.aliases.some((a) => norm(a) === n));
  }
  return undefined;
}

/** Clue hypotheses: one person node per user-supplied name (dashed in the graph). */
export function ensureClueEntities(inv: Investigation) {
  for (const c of inv.clues.names) {
    upsertEntity(inv, "person", c.original, `clue:${c.id}`, null, { role: "user-supplied clue", clue: c.original });
  }
}

// ---------------------------------------------------------------------------
// relationships, claims, contacts

export function addRelationship(
  inv: Investigation,
  subjectId: string,
  predicate: Predicate,
  objectId: string,
  ev: { sourceId: string; passageId: string } | null,
  provenance: Relationship["provenance"],
  qualifier?: string,
  hypothesis = false,
): Relationship {
  let r = inv.relationships.find((x) => x.subjectId === subjectId && x.predicate === predicate && x.objectId === objectId && (x.qualifier ?? "") === (qualifier ?? ""));
  if (!r) {
    r = { id: newId("rel"), subjectId, predicate, objectId, qualifier, evidence: [], verification: hypothesis ? "unverified_hypothesis" : "single_source", independentSources: 0, contradictions: [], provenance, hypothesis, userDecision: null };
    inv.relationships.push(r);
  }
  if (ev && !r.evidence.some((e) => e.sourceId === ev.sourceId && e.passageId === ev.passageId)) r.evidence.push(ev);
  if (!hypothesis && r.hypothesis && ev) r.hypothesis = false;
  return r;
}

function addClaim(inv: Investigation, c: Omit<Claim, "id" | "verification" | "conflictsWith" | "firstSeenAt" | "lastCheckedAt">): Claim {
  const existing = inv.claims.find((x) => x.subjectId === c.subjectId && x.predicate === c.predicate && norm(x.object) === norm(c.object) && x.sourceId === c.sourceId);
  if (existing) {
    existing.lastCheckedAt = nowIso();
    return existing;
  }
  const claim: Claim = { ...c, id: newId("clm"), verification: "single_source", conflictsWith: [], firstSeenAt: nowIso(), lastCheckedAt: nowIso() };
  inv.claims.push(claim);
  return claim;
}

function addContact(inv: Investigation, c: Omit<ContactPoint, "id" | "firstSeenAt" | "lastCheckedAt" | "verification">): ContactPoint {
  const existing = inv.contacts.find((x) => x.kind === c.kind && x.normalized === c.normalized && x.entityId === c.entityId && x.sourceId === c.sourceId);
  if (existing) {
    existing.lastCheckedAt = nowIso();
    return existing;
  }
  const cp: ContactPoint = { ...c, id: newId("cp"), firstSeenAt: nowIso(), lastCheckedAt: nowIso(), verification: c.official ? "primary_source" : "single_source" };
  inv.contacts.push(cp);
  return cp;
}

// ---------------------------------------------------------------------------
// leads

export function leadKey(kind: LeadKind, value: string) {
  if (kind === "url") return `url:${canonicalUrl(value)}`;
  if (kind === "domain") return `domain:${value.toLowerCase()}`;
  if (kind === "username") return `username:${value.toLowerCase()}`;
  return `${kind}:${norm(value)}`;
}

const LEAD_BASE: Record<LeadKind, number> = { url: 30, domain: 35, business: 42, school: 42, organisation: 38, name: 45, username: 35, place: 12, phrase: 20 };

export function relevance(inv: Investigation, text: string): { score: number; why: string[] } {
  const why: string[] = [];
  let score = 0;
  for (const c of inv.clues.names) {
    const v = matchName(c, text);
    if (v) {
      score += v.isOriginal ? 30 : 15;
      why.push(v.isOriginal ? `mentions "${c.original}"` : `mentions variant "${v.text}" of ${c.original}`);
    }
  }
  const t = text.toLowerCase();
  for (const p of inv.clues.places) if (t.includes(p.toLowerCase())) {
    score += 12;
    why.push(`mentions ${p}`);
  }
  for (const k of inv.clues.keywords) if (k !== "business" && t.includes(k.toLowerCase())) {
    score += 8;
    why.push(`mentions "${k}"`);
    break;
  }
  return { score, why };
}

export function addLead(inv: Investigation, kind: LeadKind, value: string, from: Lead["from"], score: number, reason: string): Lead | null {
  const key = leadKey(kind, value);
  const existing = inv.leads.find((l) => l.key === key);
  if (existing) {
    if (score > existing.score && existing.status === "open") {
      existing.score = Math.round(score);
      existing.reason = reason.slice(0, 600);
    }
    return null;
  }
  // Already-known things are not new leads.
  if (kind === "url" && inv.sources.some((s) => s.canonicalUrl === canonicalUrl(value) && s.fetch.status !== "not_opened")) return null;
  const lead: Lead = { id: newId("lead"), kind, value: value.slice(0, 2000), key: key.slice(0, 2100), from, score: Math.round(score), reason: reason.slice(0, 600), status: "open", round: inv.round, taskIds: [] };
  inv.leads.push(lead);
  return lead;
}

// ---------------------------------------------------------------------------
// apply a page read

function knownOrgInText(inv: Investigation, text: string): Entity | undefined {
  const t = norm(text);
  const orgs = inv.entities.filter((e) => ["business", "school", "organisation"].includes(e.type)).sort((a, b) => b.name.length - a.name.length);
  return orgs.find((o) => [o.name, ...o.aliases].some((n) => norm(n).length > 3 && ` ${t} `.includes(` ${norm(n)} `)));
}

function personEntity(inv: Investigation, name: string, org: Entity | undefined, source: Source): Entity {
  // Scoped identity: same name + same organisation context, else per-source.
  const key = org ? `person:${norm(name)}|${org.key}` : `person:${norm(name)}|src:${source.domain}`;
  const matched = inv.clues.names.find((c) => matchName(c, name));
  return upsertEntity(inv, "person", name, key, source.id, matched ? { matchesClue: matched.original } : {});
}

function applyPage(inv: Investigation, task: Task, page: PageRead, engine: EngineId, assisted: boolean) {
  const source = upsertSource(inv, page.url, { title: page.extraction?.title, engine, taskId: task.id, via: task.input.url ? "link" : "search", synthetic: page.synthetic });
  source.fetch = { status: page.fetchStatus, httpStatus: page.httpStatus, reason: page.reason, at: page.fetchedAt, engine };
  source.lastCheckedAt = page.fetchedAt;
  if (!task.output.sourceIds.includes(source.id)) task.output.sourceIds.push(source.id);
  if (page.fetchStatus !== "read" || !page.extraction) {
    trail(inv, "error", engine, `${page.url} — ${page.fetchStatus.replace(/_/g, " ")}: ${page.reason}`, [source.id]);
    return;
  }
  const x: PageExtraction = page.extraction;
  source.title = x.title || source.title;
  source.contentHash = page.contentHash;
  source.publishedAt = x.publishedAt ? new Date(x.publishedAt).toISOString() : source.publishedAt;
  source.outboundLinks = x.links.map((l) => l.url).slice(0, 200);
  const fp = fingerprint(x.text);
  source.fingerprint = fp || undefined;
  // Copy detection: syndicated/copied text joins the earlier source's copy group.
  if (fp) {
    const twin = inv.sources.find((s) => s.id !== source.id && s.fingerprint && fingerprintSimilarity(s.fingerprint, fp) >= 0.6);
    if (twin && twin.domain !== source.domain) source.copyGroup = twin.copyGroup;
  }
  trail(inv, "page_read", engine, `Opened ${page.url}${x.title ? ` — “${x.title}”` : ""}`, [source.id]);

  // Organisations; the page's own org (JSON-LD/site name on its domain) makes it an official site.
  const domain = source.domain;
  let siteOrg: Entity | undefined = findOrg(inv, undefined, domain);
  for (const o of x.organisations) {
    const declaresSite = o.from === "jsonld" ? !o.website || registrableDomain(o.website) === domain : o.from === "site_name" || o.from === "title";
    const city = x.localities[0];
    const existing = findOrg(inv, o.name, declaresSite ? domain : undefined);
    const ent = existing ?? upsertEntity(inv, o.kind, o.name, orgKey(o.name, declaresSite ? domain : undefined, city), source.id);
    if (declaresSite && !ent.attributes.website) {
      ent.attributes.website = domain;
      siteOrg = ent;
    }
    if (city && !ent.attributes.city) ent.attributes.city = city;
    if (!ent.sourceIds.includes(source.id)) ent.sourceIds.push(source.id);
    const pid = addPassage(inv, source.id, o.passage);
    if (declaresSite) {
      const web = upsertEntity(inv, "website", domain, `website:${domain}`, source.id, { url: `https://${domain}` });
      addRelationship(inv, web.id, "represents", ent.id, { sourceId: source.id, passageId: pid }, { engine, taskId: task.id, round: inv.round });
      addClaim(inv, { subjectId: ent.id, predicate: "has_official_website", object: domain, objectId: web.id, sourceId: source.id, passageId: pid, engine });
    }
  }
  if (siteOrg) {
    // Pages read earlier on this domain are now known to be the organisation's own site.
    for (const s of inv.sources) if (s.domain === domain) s.sourceType = "official_site";
  }
  if (siteOrg) source.sourceType = "official_site";
  else source.sourceType = classifySource(page.url, source.publishedAt, officialDomains(inv));
  const pageOrg = siteOrg ?? knownOrgInText(inv, `${x.title} ${x.text.slice(0, 600)}`);

  // People with publicly documented roles
  for (const p of x.people) {
    const org = (p.orgName ? findOrg(inv, p.orgName) ?? upsertEntity(inv, /montessori|school/i.test(p.orgName) ? "school" : "business", p.orgName, orgKey(p.orgName, undefined, x.localities[0]), source.id) : undefined) ?? knownOrgInText(inv, p.passage) ?? pageOrg;
    const person = personEntity(inv, p.name, org, source);
    const pid = addPassage(inv, source.id, p.passage);
    if (org) {
      addRelationship(inv, person.id, p.predicate, org.id, { sourceId: source.id, passageId: pid }, { engine, taskId: task.id, round: inv.round }, p.role);
      const claim = addClaim(inv, { subjectId: person.id, predicate: p.predicate, object: `${p.role ? `${p.role} of ` : ""}${org.name}`, objectId: org.id, sourceId: source.id, passageId: pid, engine });
      if (!task.output.claimIds.includes(claim.id)) task.output.claimIds.push(claim.id);
    }
    trail(inv, "extracted", engine, `${p.name}${p.role ? ` — ${p.role}` : ""}${org ? ` · ${org.name}` : ""}`, [source.id, person.id]);
  }

  // LLM-assisted facts (quote-verified server-side) — added as assisted single-source evidence.
  for (const f of page.llmFacts ?? []) {
    const org = findOrg(inv, f.object) ?? upsertEntity(inv, f.objectType, f.object, orgKey(f.object, undefined, x.localities[0]), source.id);
    const person = personEntity(inv, f.subject, org, source);
    const pid = addPassage(inv, source.id, f.quote);
    addRelationship(inv, person.id, f.predicate, org.id, { sourceId: source.id, passageId: pid }, { engine, taskId: task.id, round: inv.round, assistedBy: assisted ? "freellmapi" : undefined }, f.role);
    addClaim(inv, { subjectId: person.id, predicate: f.predicate, object: `${f.role ? `${f.role} of ` : ""}${org.name}`, objectId: org.id, sourceId: source.id, passageId: pid, engine, assistedBy: "freellmapi" });
  }

  // Public contact points — attached to the organisation, never to a person.
  const contactOrg = pageOrg;
  for (const c of x.contacts) {
    if (c.kind === "social") continue;
    if (!contactOrg) continue;
    const pid = addPassage(inv, source.id, c.passage);
    const official = Boolean(siteOrg && contactOrg.id === siteOrg.id);
    addContact(inv, { kind: c.kind, value: c.value, normalized: c.normalized, entityId: contactOrg.id, sourceId: source.id, passageId: pid, publishedAt: source.publishedAt, official });
    if (c.kind === "address") {
      const city = PLACES.find((pl) => new RegExp(`\\b${pl.city}\\b`, "i").test(c.value))?.city;
      const loc = upsertEntity(inv, "location", c.value, `loc:${norm(c.value).replace(/\b(in|india)\b/g, "").trim()}`, source.id, city ? { city } : {});
      addRelationship(inv, contactOrg.id, "operates_at", loc.id, { sourceId: source.id, passageId: pid }, { engine, taskId: task.id, round: inv.round });
    }
  }
  for (const f of x.facts) {
    if (f.predicate !== "established_in_year" || !contactOrg) continue;
    const pid = addPassage(inv, source.id, f.passage);
    addClaim(inv, { subjectId: contactOrg.id, predicate: "established_in_year", object: f.value, sourceId: source.id, passageId: pid, engine });
  }

  // Social profiles linked from the page
  for (const sp of x.socialProfiles) {
    const prof = upsertEntity(inv, "social_profile", `${sp.platform}:${sp.handle}`, `social:${sp.platform}:${sp.handle}`, source.id, { url: sp.url, platform: sp.platform });
    if (contactOrg) {
      const pid = addPassage(inv, source.id, sp.passage);
      addRelationship(inv, prof.id, "represents", contactOrg.id, { sourceId: source.id, passageId: pid }, { engine, taskId: task.id, round: inv.round });
      addContact(inv, { kind: "social", value: sp.url, normalized: sp.url.toLowerCase(), entityId: contactOrg.id, sourceId: source.id, passageId: pid, publishedAt: source.publishedAt, official: Boolean(siteOrg) });
    }
    addLead(inv, "url", sp.url, { engine, taskId: task.id, sourceId: source.id }, 40 + (siteOrg ? 10 : 0), `Social profile linked from ${domain}`);
    addLead(inv, "username", sp.handle, { engine, taskId: task.id, sourceId: source.id }, 38 + (siteOrg ? 10 : 0), `Username @${sp.handle} linked from ${domain}`);
  }

  // Clue-name mentions → weak claims against the clue hypothesis
  for (const c of inv.clues.names) {
    const v = matchName(c, x.text) ?? matchName(c, x.title);
    if (!v) continue;
    const clueEnt = inv.entities.find((e) => e.key === `clue:${c.id}`);
    const sent = x.text.split(/(?<=[.!?])\s+|\n+/).find((s) => matchName(c, s)) ?? x.title;
    const pid = addPassage(inv, source.id, sent.slice(0, 400));
    if (clueEnt) addClaim(inv, { subjectId: clueEnt.id, predicate: "mentions", object: `${source.domain}: "${v.text}"`, sourceId: source.id, passageId: pid, engine });
  }

  // Follow-up leads: relevant internal pages (web-scout-ai style link following)
  const rel = relevance(inv, `${x.title} ${x.text}`);
  const domainRead = inv.sources.filter((s) => s.domain === domain && s.fetch.status === "read").length;
  if (rel.score > 0 || siteOrg) {
    for (const l of x.links) {
      const pr = linkPriority(l);
      if (pr < 40 || domainRead >= inv.settings.maxPagesPerDomain) continue;
      const lead = addLead(inv, "url", l.url, { engine, taskId: task.id, sourceId: source.id }, 20 + pr * 0.4 + Math.min(rel.score, 30) * 0.5, `Linked "${l.text || l.url}" (${pr >= 85 ? "about/contact/team" : "relevant section"}) from ${domain}`);
      if (lead) task.output.leadIds.push(lead.id);
      if (!source.followedLinks.includes(l.url) && lead) source.followedLinks.push(l.url);
    }
    // Site root of a relevant non-news/non-directory site (the organisation's own home page)
    const root = `https://${new URL(page.url).hostname}/`;
    if (canonicalUrl(root) !== canonicalUrl(page.url) && !SOCIAL_HOST.test(domain) && !/news|weekly|daily|times|directory|wire|today/i.test(domain) && domainRead < inv.settings.maxPagesPerDomain) {
      const lead = addLead(inv, "url", root, { engine, taskId: task.id, sourceId: source.id }, 45 + Math.min(rel.score, 30) * 0.5, `Home page of ${domain} (relevant page found on this site)`);
      if (lead) task.output.leadIds.push(lead.id);
    }
    // External organisation sites linked from a relevant page
    for (const l of x.links.filter((k) => k.rel === "external" && !SOCIAL_HOST.test(new URL(k.url).hostname.replace(/^www\./, "")))) {
      if (!/(about|official|website|sister|partner|our)/i.test(l.text) && !/(garment|montessori|school|export|textile)/i.test(l.url)) continue;
      const lead = addLead(inv, "url", l.url, { engine, taskId: task.id, sourceId: source.id }, 45 + Math.min(rel.score, 20) * 0.5, `External link "${l.text}" from ${domain}`);
      if (lead) task.output.leadIds.push(lead.id);
    }
  }
  // Organisation & people leads → new searches / OSINT
  for (const o of inv.entities.filter((e) => ["business", "school", "organisation"].includes(e.type) && e.sourceIds.includes(source.id))) {
    const r = relevance(inv, `${o.name} ${x.text.slice(0, 2000)}`);
    if (r.score <= 0) continue;
    const l1 = addLead(inv, o.type === "school" ? "school" : o.type === "business" ? "business" : "organisation", o.name, { engine, taskId: task.id, sourceId: source.id }, LEAD_BASE.business + Math.min(r.score, 30) * 0.6, `${o.type} discovered on ${domain} (${r.why.slice(0, 2).join(", ")})`);
    if (l1) task.output.leadIds.push(l1.id);
    if (o.attributes.website) {
      const l2 = addLead(inv, "domain", o.attributes.website, { engine, taskId: task.id, sourceId: source.id }, LEAD_BASE.domain + Math.min(r.score, 30) * 0.5, `Official domain of ${o.name}`);
      if (l2) task.output.leadIds.push(l2.id);
    }
  }
  for (const p of x.people) {
    const full = p.name.split(" ").length >= 2;
    if (!full) continue;
    const r = relevance(inv, p.name);
    if (r.score <= 0) continue;
    const l = addLead(inv, "name", p.name, { engine, taskId: task.id, sourceId: source.id }, LEAD_BASE.name + r.score * 0.5, `Full name "${p.name}" found on ${domain} (${p.role ?? "mentioned"})`);
    if (l) task.output.leadIds.push(l.id);
  }
}

// ---------------------------------------------------------------------------

export function applyResult(inv: Investigation, result: TaskResult): Investigation {
  const task = inv.tasks.find((t) => t.id === result.taskId);
  if (!task) return inv;
  const engine = result.engine;
  task.provider = result.provider ?? task.provider;
  task.completedAt = nowIso();
  task.error = result.error?.slice(0, 1000);
  if (result.notes) task.output.notes.push(...result.notes.slice(0, 20));
  inv.updatedAt = nowIso();

  if (result.llm) {
    inv.usage.llmCalls += result.llm.calls;
    inv.usage.llmTokens += result.llm.tokens;
    if (result.llm.quota) recordQuota(inv, "freellmapi", result.llm.quota);
  }
  if (result.status === "pending" && result.job) {
    task.status = "pending";
    task.jobRef = result.job.ref;
    return inv;
  }
  if (result.status === "quota") {
    task.status = "quota";
    if (result.quota) recordQuota(inv, engine, result.quota);
    return inv;
  }
  task.status = result.status === "done" ? "done" : result.status;
  if (result.status !== "done") {
    trail(inv, "error", engine, `${task.kind} ${task.input.query ?? task.input.url ?? task.input.domain ?? task.input.username ?? ""} — ${result.status}: ${result.error ?? "no detail"}`, [task.id]);
  }

  // Search hits → sources (snippet only) + url leads
  if (result.hits?.length) {
    inv.usage.searchCalls[result.provider ?? engine] = (inv.usage.searchCalls[result.provider ?? engine] ?? 0) + 1;
    task.output.hits = result.hits.slice(0, 50);
    trail(inv, "search", engine, `“${task.input.query}” → ${result.hits.length} result(s) via ${result.provider ?? engine}`, [task.id]);
    for (const h of result.hits) {
      const s = upsertSource(inv, h.url, { title: h.title, snippet: h.snippet, engine, taskId: task.id, via: "search", synthetic: Boolean(result.synthetic) });
      if (!task.output.sourceIds.includes(s.id)) task.output.sourceIds.push(s.id);
      const r = relevance(inv, `${h.title} ${h.snippet}`);
      if (r.score <= 0) continue;
      const lead = addLead(inv, "url", h.url, { engine, taskId: task.id, sourceId: s.id }, LEAD_BASE.url + r.score * 0.6 - h.rank, `Search result #${h.rank + 1} for “${task.input.query}” (${r.why.join(", ")})`);
      if (lead) task.output.leadIds.push(lead.id);
    }
  } else if (task.kind === "search" && result.status === "done") {
    trail(inv, "search", engine, `“${task.input.query}” → no results via ${result.provider ?? engine}`, [task.id]);
  }

  for (const p of result.pages ?? []) applyPage(inv, task, p, engine, Boolean(p.llmFacts?.length));

  // Username discovery (Maigret): a matching username is NOT identity
  for (const pr of result.profiles ?? []) {
    const s = upsertSource(inv, pr.url, { title: `${pr.username} on ${pr.site}`, snippet: pr.note, engine, taskId: task.id, via: "username", synthetic: Boolean(result.synthetic) });
    s.sourceType = "social_profile";
    const prof = upsertEntity(inv, "social_profile", `${pr.site}:${pr.username}`, `social:${pr.site.toLowerCase()}:${pr.username.toLowerCase()}`, s.id, { url: pr.url, platform: pr.site, note: "Username exists — ownership not established" });
    const pid = addPassage(inv, s.id, `${pr.site}: account "${pr.username}" exists at ${pr.url}. ${pr.note}`);
    const claim = addClaim(inv, { subjectId: prof.id, predicate: "username_found_on", object: pr.site, sourceId: s.id, passageId: pid, engine });
    claim.verification = "weak_indication";
    task.output.sourceIds.push(s.id);
    const lead = addLead(inv, "url", pr.url, { engine, taskId: task.id, sourceId: s.id }, 34, `Profile for username "${pr.username}" on ${pr.site} (existence only)`);
    if (lead) task.output.leadIds.push(lead.id);
  }
  if (result.profiles) trail(inv, "search", engine, `Username “${task.input.username}” → ${result.profiles.length} public profile(s) exist (not identity proof)`, [task.id]);

  // SpiderFoot events
  for (const ev of result.osint ?? []) {
    const urlMatch = ev.value.match(/https?:\/\/[^\s<]+/)?.[0];
    // Independent re-discovery of an already-known page is recorded (cross-engine corroboration of coverage).
    const evUrl = ev.type === "AFFILIATE_INTERNET_NAME" || ev.type === "INTERNET_NAME" ? `https://${ev.value}/` : urlMatch;
    if (evUrl && inv.sources.some((x) => x.canonicalUrl === canonicalUrl(evUrl))) {
      const known = upsertSource(inv, evUrl, { engine, taskId: task.id, via: "osint", synthetic: Boolean(result.synthetic) });
      if (!task.output.sourceIds.includes(known.id)) task.output.sourceIds.push(known.id);
    }
    if (ev.type === "AFFILIATE_INTERNET_NAME" || ev.type === "INTERNET_NAME") {
      const lead = addLead(inv, "url", `https://${ev.value}/`, { engine, taskId: task.id }, 46, `${ev.module}: affiliated host ${ev.value} of ${task.input.domain}`);
      if (lead) task.output.leadIds.push(lead.id);
    } else if (urlMatch) {
      const lead = addLead(inv, "url", urlMatch, { engine, taskId: task.id }, 40, `${ev.module}: ${ev.type} for ${task.input.domain}`);
      if (lead) task.output.leadIds.push(lead.id);
    } else if (ev.type === "COMPANY_NAME") {
      const lead = addLead(inv, "business", ev.value, { engine, taskId: task.id }, 44, `${ev.module}: company name associated with ${task.input.domain}`);
      if (lead) task.output.leadIds.push(lead.id);
    }
    task.output.notes.push(`${ev.type} (${ev.module}): ${ev.value.replace(/<\/?SFURL>/g, "")}`.slice(0, 2000));
  }
  if (result.osint) trail(inv, "search", engine, `OSINT on ${task.input.domain}: ${result.osint.length} event(s)`, [task.id]);

  // GPT Researcher: report is narrative (not evidence); its sources become leads for verification by reading.
  if (result.research) {
    task.output.narrative = result.research.report.slice(0, 20000);
    for (const src of result.research.sources) {
      const s = upsertSource(inv, src.url, { title: src.title, snippet: src.excerpt, engine, taskId: task.id, via: "research", synthetic: Boolean(result.synthetic) });
      task.output.sourceIds.push(s.id);
      const r = relevance(inv, `${src.title} ${src.excerpt}`);
      const lead = addLead(inv, "url", src.url, { engine, taskId: task.id, sourceId: s.id }, 36 + r.score * 0.5, `Cited by GPT Researcher for “${task.input.query}”`);
      if (lead) task.output.leadIds.push(lead.id);
    }
    for (const f of result.research.failed) {
      const s = upsertSource(inv, f.url, { engine, taskId: task.id, via: "research", synthetic: Boolean(result.synthetic) });
      if (s.fetch.status === "not_opened") s.fetch = { status: /robots/i.test(f.reason) ? "blocked_robots" : "network_error", httpStatus: null, reason: `GPT Researcher: ${f.reason}`, at: nowIso(), engine };
    }
    trail(inv, "search", engine, `Research “${task.input.query}” → ${result.research.sources.length} source(s), ${result.research.failed.length} failed`, [task.id]);
  }

  for (const id of task.output.leadIds) {
    const l = inv.leads.find((x) => x.id === id);
    if (l) trail(inv, "lead", engine, `New lead (${l.kind}): ${l.value} — ${l.reason}`, [l.id]);
  }
  recomputeVerification(inv);
  return inv;
}

export function recordQuota(inv: Investigation, engine: EngineId | "freellmapi", q: { provider: string; status: number | null; message: string; retryAfterSec: number | null }) {
  const at = new Date();
  inv.quota.push({ provider: q.provider, engine, at: at.toISOString(), status: q.status, message: q.message.slice(0, 500), resumeAfter: q.retryAfterSec ? new Date(at.getTime() + q.retryAfterSec * 1000).toISOString() : null });
  trail(inv, "quota", engine, `Free quota / rate limit reached for ${q.provider}${q.status ? ` (HTTP ${q.status})` : ""}: ${q.message}. No paid fallback is used.`);
}

// ---------------------------------------------------------------------------
// verification

const FUNCTIONAL: Predicate[] = ["established_in_year", "has_official_website"];

export function recomputeVerification(inv: Investigation) {
  const src = new Map(inv.sources.map((s) => [s.id, s]));
  const ent = new Map(inv.entities.map((e) => [e.id, e]));
  const isPrimary = (sourceId: string, entityIds: string[]) => {
    const s = src.get(sourceId);
    if (!s || s.sourceType !== "official_site") return false;
    return entityIds.some((id) => ent.get(id)?.attributes.website === s.domain);
  };
  const verdict = (sourceIds: string[], entityIds: string[], weakOnly = false): { v: Verification; independent: number } => {
    const read = sourceIds.filter((id) => src.get(id)?.fetch.status === "read");
    const groups = new Set(read.map((id) => src.get(id)!.copyGroup));
    if (!sourceIds.length) return { v: "not_searched", independent: 0 };
    if (!read.length) return { v: sourceIds.every((id) => ["blocked_robots", "login_wall", "http_error", "network_error"].includes(src.get(id)?.fetch.status ?? "")) ? "inaccessible" : "weak_indication", independent: 0 };
    if (weakOnly) return { v: "weak_indication", independent: groups.size };
    if (read.some((id) => isPrimary(id, entityIds))) return { v: "primary_source", independent: groups.size };
    if (groups.size >= 2) return { v: "independently_corroborated", independent: groups.size };
    return { v: "single_source", independent: groups.size };
  };

  for (const r of inv.relationships) {
    if (r.hypothesis) {
      r.verification = "unverified_hypothesis";
      continue;
    }
    const llmOnly = Boolean(r.provenance.assistedBy) && r.evidence.length <= 1;
    const { v, independent } = verdict(r.evidence.map((e) => e.sourceId), [r.subjectId, r.objectId], llmOnly);
    r.verification = r.contradictions.length && v !== "primary_source" ? "contradicted" : v;
    r.independentSources = independent;
  }

  // claims: per-claim verdict, then functional-predicate contradictions
  const bySubjectPred = new Map<string, Claim[]>();
  for (const c of inv.claims) {
    if (c.predicate === "mentions" || c.predicate === "username_found_on") {
      c.verification = "weak_indication";
      continue;
    }
    const sameFact = inv.claims.filter((o) => o.subjectId === c.subjectId && o.predicate === c.predicate && norm(o.object) === norm(c.object));
    const { v } = verdict(
      sameFact.map((o) => o.sourceId),
      [c.subjectId, ...(c.objectId ? [c.objectId] : [])],
      Boolean(c.assistedBy) && sameFact.length === 1,
    );
    c.verification = v;
    c.conflictsWith = [];
    if (FUNCTIONAL.includes(c.predicate)) {
      const k = `${c.subjectId}|${c.predicate}`;
      bySubjectPred.set(k, [...(bySubjectPred.get(k) ?? []), c]);
    }
  }
  for (const list of bySubjectPred.values()) {
    const values = new Set(list.map((c) => norm(c.object)));
    if (values.size < 2) continue;
    for (const c of list) {
      c.conflictsWith = list.filter((o) => norm(o.object) !== norm(c.object)).map((o) => o.id);
      if (c.verification !== "primary_source") c.verification = "contradicted";
    }
  }
  for (const cp of inv.contacts) {
    const same = inv.contacts.filter((o) => o.kind === cp.kind && o.normalized === cp.normalized && o.entityId === cp.entityId);
    const { v } = verdict(same.map((o) => o.sourceId), [cp.entityId]);
    cp.verification = cp.official ? "primary_source" : v;
  }
  // relationship-level contradiction text for display
  for (const r of inv.relationships) r.contradictions = [];
  for (const list of bySubjectPred.values()) {
    const values = Array.from(new Set(list.map((c) => c.object)));
    if (values.length < 2) continue;
    const subj = ent.get(list[0].subjectId);
    if (subj) subj.attributes.conflicts = `${list[0].predicate.replace(/_/g, " ")}: ${values.join(" vs ")}`;
  }
}

export function setDecision(inv: Investigation, kind: "entity" | "relationship", id: string, decision: "confirmed" | "rejected" | null) {
  if (kind === "entity") {
    const e = inv.entities.find((x) => x.id === id);
    if (e) e.userDecision = decision;
  } else {
    const r = inv.relationships.find((x) => x.id === id);
    if (r) r.userDecision = decision;
  }
  trail(inv, "user", "user", `User ${decision ?? "cleared decision on"} ${kind} ${id}`, [id]);
  inv.updatedAt = nowIso();
}

export function normalizedPhone(v: string) {
  return normalizePhone(v, "India").e164 ?? v;
}

export function profileOf(url: string) {
  return parseProfileUrl(url);
}
