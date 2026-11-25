/**
 * Possible-match comparison and search-coverage reconciliation (derived views,
 * recomputed from the ledger; never stored as facts).
 */
import { matchName } from "./variants";
import { ENGINE_IDS, type EngineId, type Entity, type Investigation, type Relationship, type Verification } from "./schema";

export interface CandidateMatch {
  entity: Entity;
  clue: string;
  kind: "person" | "organisation";
  matches: { what: string; detail: string; relationshipIds: string[] }[];
  conflicts: { what: string; detail: string }[];
  unknowns: string[];
  relationships: Relationship[];
  bestVerification: Verification;
  sources: number;
}

const RANK: Verification[] = ["primary_source", "independently_corroborated", "single_source", "weak_indication", "unverified_hypothesis", "contradicted", "inaccessible", "not_searched"];

function best(vs: Verification[]): Verification {
  return vs.sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0] ?? "not_searched";
}

const ORG_TYPES = new Set(["business", "school", "organisation"]);

export function candidateMatches(inv: Investigation): CandidateMatch[] {
  const ent = new Map(inv.entities.map((e) => [e.id, e]));
  const out: CandidateMatch[] = [];
  const place = inv.clues.places.map((p) => p.toLowerCase());
  const hints = inv.clues.organisationHints.map((h) => h.toLowerCase());
  const hintMatches = (org: Entity) => hints.filter((h) => {
    const n = `${org.name} ${org.type}`.toLowerCase();
    if (h.includes("montessori")) return n.includes("montessori");
    if (h.includes("garment")) return /garment|clothing|apparel|textile|boutique/.test(n);
    if (h.includes("school") || h.includes("pre-school")) return org.type === "school";
    if (h.includes("clothing")) return /garment|clothing|apparel|textile|boutique/.test(n);
    return n.includes(h.split(" ")[0]);
  });
  const orgCity = (org: Entity): string | undefined => {
    if (org.attributes.city) return org.attributes.city;
    const loc = inv.relationships.find((r) => r.subjectId === org.id && r.predicate === "operates_at");
    return loc ? ent.get(loc.objectId)?.attributes.city : undefined;
  };

  // --- persons
  for (const clue of inv.clues.names) {
    const people = inv.entities.filter((e) => e.type === "person" && !e.key.startsWith("clue:") && matchName(clue, e.name));
    for (const p of people) {
      const rels = inv.relationships.filter((r) => r.subjectId === p.id || r.objectId === p.id);
      const orgs = rels.map((r) => ent.get(r.subjectId === p.id ? r.objectId : r.subjectId)).filter((o): o is Entity => Boolean(o && ORG_TYPES.has(o.type)));
      const v = matchName(clue, p.name)!;
      const matches: CandidateMatch["matches"] = [{ what: "Name", detail: v.isOriginal ? `exact "${clue.original}" in "${p.name}"` : `variant "${v.text}" (${v.method}) in "${p.name}"`, relationshipIds: [] }];
      const conflicts: CandidateMatch["conflicts"] = [];
      for (const o of orgs) {
        const relIds = rels.filter((r) => r.objectId === o.id || r.subjectId === o.id).map((r) => r.id);
        const city = orgCity(o);
        if (city && place.length) {
          if (place.includes(city.toLowerCase())) matches.push({ what: "Location", detail: `${o.name} is in ${city}`, relationshipIds: relIds });
          else conflicts.push({ what: "Location", detail: `${o.name} is in ${city}, clue says ${inv.clues.places.join(", ")}` });
        }
        for (const h of hintMatches(o)) matches.push({ what: "Clue", detail: `${o.name} matches “${h}”`, relationshipIds: relIds });
      }
      // co-association with another clue name through the same organisation
      for (const other of inv.clues.names.filter((c) => c.id !== clue.id)) {
        const shared = orgs.find((o) => inv.relationships.some((r) => r.objectId === o.id && r.subjectId !== p.id && matchName(other, ent.get(r.subjectId)?.name ?? "")));
        if (shared) matches.push({ what: "Co-association", detail: `“${other.original}” is also publicly linked to ${shared.name}`, relationshipIds: inv.relationships.filter((r) => r.objectId === shared.id).map((r) => r.id) });
      }
      if (hints.length && !orgs.some((o) => hintMatches(o).length)) conflicts.push({ what: "Clue", detail: `No ${inv.clues.organisationHints.join(" / ")} link found for this person` });
      const unknowns = ["Whether this is the same individual you are looking for (requires your confirmation)"];
      if (inv.clues.userRelationships.length) unknowns.push("Any personal relationship between the named people (not inferred)");
      const vs = rels.filter((r) => !r.hypothesis).map((r) => r.verification);
      out.push({ entity: p, clue: clue.original, kind: "person", matches, conflicts, unknowns, relationships: rels, bestVerification: best(vs), sources: p.sourceIds.length });
    }
  }
  // --- organisations matching the clue context
  for (const o of inv.entities.filter((e) => ORG_TYPES.has(e.type))) {
    const hm = hintMatches(o);
    if (!hm.length) continue;
    const rels = inv.relationships.filter((r) => r.subjectId === o.id || r.objectId === o.id);
    const city = orgCity(o);
    const matches: CandidateMatch["matches"] = hm.map((h) => ({ what: "Clue", detail: `${o.name} matches “${h}”`, relationshipIds: [] }));
    const conflicts: CandidateMatch["conflicts"] = [];
    if (city && place.length) (place.includes(city.toLowerCase()) ? matches.push({ what: "Location", detail: `In ${city}`, relationshipIds: [] }) : conflicts.push({ what: "Location", detail: `In ${city}, clue says ${inv.clues.places.join(", ")}` }));
    const linkedClues = inv.clues.names.filter((c) => rels.some((r) => matchName(c, ent.get(r.subjectId)?.name ?? "")));
    for (const c of linkedClues) matches.push({ what: "Person", detail: `“${c.original}” publicly linked`, relationshipIds: rels.filter((r) => matchName(c, ent.get(r.subjectId)?.name ?? "")).map((r) => r.id) });
    if (!linkedClues.length) conflicts.push({ what: "Person", detail: "None of the named people are linked by evidence yet" });
    if (o.attributes.conflicts) conflicts.push({ what: "Record", detail: `Sources disagree — ${o.attributes.conflicts}` });
    out.push({ entity: o, clue: hm.join(", "), kind: "organisation", matches, conflicts, unknowns: city ? [] : ["Location not established"], relationships: rels, bestVerification: best(rels.filter((r) => !r.hypothesis).map((r) => r.verification)), sources: o.sourceIds.length });
  }
  // One card per entity: a person matching several clue names ("Asma Siva") is listed once.
  const merged = new Map<string, CandidateMatch>();
  for (const c of out) {
    const m = merged.get(c.entity.id);
    if (!m) {
      merged.set(c.entity.id, c);
      continue;
    }
    m.clue = Array.from(new Set([...m.clue.split(", "), c.clue])).join(", ");
    for (const x of c.matches) if (!m.matches.some((y) => y.what === x.what && y.detail === x.detail)) m.matches.push(x);
    for (const x of c.conflicts) if (!m.conflicts.some((y) => y.detail === x.detail)) m.conflicts.push(x);
  }
  return Array.from(merged.values()).sort((a, b) => b.matches.length - b.conflicts.length * 2 - (a.matches.length - a.conflicts.length * 2));
}

// ---------------------------------------------------------------------------

export interface Coverage {
  byEngine: Record<EngineId, { tasks: number; done: number; failed: number; urls: number; pagesRead: number }>;
  onlyOneEngine: { url: string; engine: EngineId }[];
  severalEngines: { url: string; engines: EngineId[] }[];
  viaLinks: string[];
  unexplored: string[];
  inaccessible: { url: string; reason: string }[];
  providers: { provider: string; calls: number }[];
  quota: Investigation["quota"];
}

export function reconcile(inv: Investigation): Coverage {
  const byEngine = Object.fromEntries(ENGINE_IDS.map((e) => [e, { tasks: 0, done: 0, failed: 0, urls: 0, pagesRead: 0 }])) as Coverage["byEngine"];
  for (const t of inv.tasks) {
    byEngine[t.engine].tasks++;
    if (t.status === "done") byEngine[t.engine].done++;
    if (["failed", "blocked", "quota", "unavailable"].includes(t.status)) byEngine[t.engine].failed++;
  }
  const out: Coverage = { byEngine, onlyOneEngine: [], severalEngines: [], viaLinks: [], unexplored: [], inaccessible: [], providers: Object.entries(inv.usage.searchCalls).map(([provider, calls]) => ({ provider, calls })), quota: inv.quota };
  for (const s of inv.sources) {
    const engines = Array.from(new Set(s.discoveredBy.map((d) => d.engine)));
    for (const e of engines) byEngine[e].urls++;
    if (s.fetch.status === "read" && s.fetch.engine) byEngine[s.fetch.engine].pagesRead++;
    if (engines.length >= 2) out.severalEngines.push({ url: s.url, engines });
    else if (engines.length === 1) out.onlyOneEngine.push({ url: s.url, engine: engines[0] });
    if (s.discoveredBy.every((d) => d.via === "link")) out.viaLinks.push(s.url);
    if (s.fetch.status === "not_opened") out.unexplored.push(s.url);
    if (["blocked_robots", "login_wall", "http_error", "network_error", "unsafe_url", "unsupported_type", "too_large"].includes(s.fetch.status)) out.inaccessible.push({ url: s.url, reason: `${s.fetch.status.replace(/_/g, " ")} — ${s.fetch.reason}` });
  }
  return out;
}
