/**
 * ENTITY / IDENTITY RESOLUTION ENGINE
 *
 * Groups normalised search results into candidate persons and explains, per
 * attribute, why each candidate does or does not match the user's input.
 *
 * Design rules (see docs/IDENTITY_RESOLUTION.md):
 *  1. Results are only *bound* together by strong identifiers: the same profile
 *     (platform + handle), the same e-mail, or the same phone number.
 *  2. A name match alone never merges two results.
 *  3. A result with no strong identifier attaches to an anchored cluster only
 *     when ≥2 attributes agree, nothing conflicts, and exactly one cluster
 *     qualifies. Ties stay "unattributed" instead of being guessed.
 *  4. Nothing here decides identity. Output is candidates + evidence; a human
 *     confirms and locks.
 */
import { extractSignals } from "./extract";
import { ATTRIBUTE_LABEL } from "./input";
import { canonicalOrg, sameCity, sameCountry, sameOrg } from "./lexicon";
import { PLATFORM_LABEL } from "./profiles";
import { compareNames, domainOf, norm, uniq } from "./text";
import type {
  AttributeEvidenceRef,
  AttributeKind,
  AttributeMatch,
  CandidateAttributeValue,
  CandidateProfile,
  DiscoveredAttribute,
  ExtractedSignals,
  Platform,
  ProfileRef,
  RefinementSuggestion,
  ResolutionSummary,
  SearchResult,
  TargetProfile,
} from "./types";

export interface ResolutionOutput {
  candidates: CandidateProfile[];
  unattributed: { resultId: string; url: string; title: string; reason: string }[];
  summary: ResolutionSummary;
  discovered: DiscoveredAttribute[];
  signals: Map<string, ExtractedSignals>;
}

export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of Array.from(u.searchParams.keys())) if (/^utm_|^ref$|^fbclid$|^gclid$/i.test(k)) u.searchParams.delete(k);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    return `${u.protocol}//${host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url.trim();
  }
}

export function dedupeResults(results: SearchResult[]): SearchResult[] {
  const byUrl = new Map<string, SearchResult>();
  for (const r of results) {
    const k = canonicalUrl(r.url);
    const existing = byUrl.get(k);
    if (!existing) byUrl.set(k, r);
    else if ((r.contentText?.length ?? 0) > (existing.contentText?.length ?? 0)) byUrl.set(k, { ...r, id: existing.id });
  }
  return Array.from(byUrl.values());
}

// ---------------------------------------------------------------------------
// Union-find
class DSU {
  parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const p = this.parent.get(x)!;
    if (p === x) return x;
    const r = this.find(p);
    this.parent.set(x, r);
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

const profKey = (p: { platform: Platform; handle: string }) => `p:${p.platform}:${p.handle}`;

function strongKeysFor(r: SearchResult, s: ExtractedSignals, target: TargetProfile): string[] {
  const keys: string[] = [];
  if (s.subjectProfile) keys.push(profKey(s.subjectProfile));
  if (s.nameHit) {
    // Linked profiles bind only when the page names the target and links exactly one handle per platform.
    const byPlatform = new Map<Platform, ProfileRef[]>();
    for (const p of s.mentionedProfiles) byPlatform.set(p.platform, [...(byPlatform.get(p.platform) ?? []), p]);
    for (const [, list] of byPlatform) if (list.length === 1) keys.push(profKey(list[0]));
    if (s.emails.length === 1) keys.push(`e:${s.emails[0]}`);
    if (s.phones.length === 1) keys.push(`t:${s.phones[0]}`);
  } else {
    // Without a name hit, a result can still be anchored by an exact target identifier.
    for (const e of s.emails) if (target.attributes.some((a) => a.kind === "email" && a.value === e)) keys.push(`e:${e}`);
    for (const t of s.phones) if (target.attributes.some((a) => a.kind === "phone" && a.value === t)) keys.push(`t:${t}`);
  }
  void r;
  return uniq(keys);
}

function isRelevant(s: ExtractedSignals, target: TargetProfile): boolean {
  if (s.nameHit) return true;
  if (s.subjectProfile && target.identifiers.some((i) => i.platform === s.subjectProfile!.platform && i.handle === s.subjectProfile!.handle)) return true;
  if (s.emails.some((e) => target.attributes.some((a) => a.kind === "email" && a.value === e))) return true;
  if (s.phones.some((p) => target.attributes.some((a) => a.kind === "phone" && a.value === p))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Attribute comparison helpers

type Facet = "organization" | "city" | "designation" | "previous_organization" | "school";
const FACETS: Facet[] = ["organization", "city", "designation", "previous_organization", "school"];

function facetValues(s: ExtractedSignals, f: Facet): string[] {
  switch (f) {
    case "organization":
      return s.organizations;
    case "city":
      return s.cities;
    case "designation":
      return s.designations;
    case "previous_organization":
      return s.previousOrganizations;
    case "school":
      return s.schools;
  }
}

function valuesEqual(kind: AttributeKind, a: string, b: string): boolean {
  switch (kind) {
    case "organization":
    case "previous_organization":
      return sameOrg(a, b);
    case "city":
      return sameCity(a, b);
    case "country":
      return sameCountry(a, b);
    case "designation":
      return norm(a) === norm(b) || norm(a).includes(norm(b)) || norm(b).includes(norm(a));
    case "school":
      return norm(a).includes(norm(b)) || norm(b).includes(norm(a));
    case "age":
      return Math.abs(parseInt(a, 10) - parseInt(b, 10)) <= 3;
    case "website":
      return domainOf(a.startsWith("http") ? a : `https://${a}`) === domainOf(b.startsWith("http") ? b : `https://${b}`);
    default:
      return norm(a) === norm(b);
  }
}

function overlap(kind: AttributeKind, xs: string[], ys: string[]): boolean {
  return xs.some((x) => ys.some((y) => valuesEqual(kind, x, y)));
}

interface ClusterAgg {
  facets: Record<Facet, string[]>;
}

function clusterFacets(ids: string[], signals: Map<string, ExtractedSignals>): ClusterAgg {
  const facets = { organization: [], city: [], designation: [], previous_organization: [], school: [] } as Record<Facet, string[]>;
  for (const id of ids) {
    const s = signals.get(id)!;
    for (const f of FACETS) facets[f].push(...facetValues(s, f));
  }
  return { facets };
}

/** Agreement / conflict between a free-floating result and a cluster. */
export function compareToCluster(s: ExtractedSignals, agg: ClusterAgg): { agree: number; conflict: boolean } {
  let agree = 0;
  let conflict = false;
  for (const f of FACETS) {
    const a = facetValues(s, f);
    const b = agg.facets[f];
    if (!a.length || !b.length) continue;
    if (overlap(f, a, b)) agree++;
    else if (f !== "school") conflict = true;
  }
  return { agree, conflict };
}

// ---------------------------------------------------------------------------

export interface ResolveOptions {
  now?: Date;
  /** How many discovered attributes to feed back into the next iteration. */
  maxDiscovered?: number;
}

export function resolveCandidates(target: TargetProfile, rawResults: SearchResult[], opts: ResolveOptions = {}): ResolutionOutput {
  const results = dedupeResults(rawResults);
  const byId = new Map(results.map((r) => [r.id, r]));
  const signals = new Map<string, ExtractedSignals>();
  for (const r of results) signals.set(r.id, extractSignals(r, target));

  const relevant = results.filter((r) => isRelevant(signals.get(r.id)!, target));

  // 1. Strong-key clustering
  const dsu = new DSU();
  const keyOwner = new Map<string, string>();
  const anchored = new Set<string>();
  for (const r of relevant) {
    const keys = strongKeysFor(r, signals.get(r.id)!, target);
    if (!keys.length) continue;
    anchored.add(r.id);
    dsu.find(r.id);
    for (const k of keys) {
      const owner = keyOwner.get(k);
      if (owner) dsu.union(owner, r.id);
      else keyOwner.set(k, r.id);
    }
  }
  const clusters = new Map<string, string[]>();
  for (const id of anchored) {
    const root = dsu.find(id);
    clusters.set(root, [...(clusters.get(root) ?? []), id]);
  }

  // 2. Weak, ambiguity-aware attachment
  const unattributed: ResolutionOutput["unattributed"] = [];
  const singletons: string[] = [];
  const floating = relevant.filter((r) => !anchored.has(r.id));
  const aggs = new Map(Array.from(clusters.entries()).map(([k, ids]) => [k, clusterFacets(ids, signals)]));
  const attachments: [string, string][] = [];
  for (const r of floating) {
    const s = signals.get(r.id)!;
    const qualifying: string[] = [];
    for (const [root, agg] of aggs) {
      const { agree, conflict } = compareToCluster(s, agg);
      if (agree >= 2 && !conflict) qualifying.push(root);
    }
    if (qualifying.length === 1) attachments.push([qualifying[0], r.id]);
    else if (qualifying.length > 1) unattributed.push({ resultId: r.id, url: r.url, title: r.title, reason: `Matches ${qualifying.length} candidates equally — not attributed` });
    else singletons.push(r.id);
  }
  for (const [root, id] of attachments) clusters.get(root)!.push(id);

  // 3. Floating results with enough context become weak single-source candidates.
  const weakRoots = new Set<string>();
  for (const id of singletons) {
    const s = signals.get(id)!;
    const facetCount = FACETS.filter((f) => facetValues(s, f).length > 0).length;
    if (facetCount >= 2) {
      clusters.set(id, [id]);
      weakRoots.add(id);
    } else {
      const r = byId.get(id)!;
      unattributed.push({ resultId: id, url: r.url, title: r.title, reason: "Name-only mention — insufficient context to attribute" });
    }
  }

  // 4. Build candidate profiles
  const now = (opts.now ?? new Date()).toISOString();
  const candidates: CandidateProfile[] = [];
  for (const [root, ids] of clusters) {
    const c = buildCandidate(root, ids, byId, signals, target, weakRoots.has(root), now);
    if (c) candidates.push(c);
  }
  candidates.sort((a, b) => b.match.score - a.match.score || b.evidenceCount - a.evidenceCount);

  const summary = summarise(target, candidates);
  const discovered = discoverAttributes(target, candidates, opts.maxDiscovered ?? 12);
  return { candidates, unattributed, summary, discovered, signals };
}

/** Short stable hash so a candidate keeps its key across refinement iterations. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
}

function ev(r: SearchResult): AttributeEvidenceRef {
  return { resultId: r.id, url: r.url, title: r.title, domain: domainOf(r.url) };
}

function pushValue(map: Partial<Record<AttributeKind, CandidateAttributeValue[]>>, kind: AttributeKind, value: string, r: SearchResult) {
  const list = (map[kind] ??= []);
  const existing = list.find((v) => valuesEqual(kind, v.value, value));
  if (existing) {
    existing.count++;
    if (!existing.evidence.some((e) => e.resultId === r.id)) existing.evidence.push(ev(r));
  } else list.push({ value, count: 1, evidence: [ev(r)] });
}

function buildCandidate(
  root: string,
  ids: string[],
  byId: Map<string, SearchResult>,
  signals: Map<string, ExtractedSignals>,
  target: TargetProfile,
  weak: boolean,
  now: string,
): CandidateProfile | null {
  const attrs: Partial<Record<AttributeKind, CandidateAttributeValue[]>> = {};
  const profiles = new Map<string, ProfileRef & { evidence: AttributeEvidenceRef[] }>();
  const strongKeys = new Set<string>();
  const names = new Map<string, number>();
  let imageUrl: string | null | undefined;
  let first = now;

  for (const id of ids) {
    const r = byId.get(id)!;
    const s = signals.get(id)!;
    for (const k of strongKeysFor(r, s, target)) strongKeys.add(k);
    if (s.nameMatchedAs) {
      const display = r.name && compareNames(target.name, r.name) !== "none" ? r.name : s.nameMatchedAs;
      names.set(display, (names.get(display) ?? 0) + 1);
      pushValue(attrs, "name", display, r);
    }
    for (const v of s.cities) pushValue(attrs, "city", v, r);
    for (const v of s.states) pushValue(attrs, "state", v, r);
    for (const v of s.countries) pushValue(attrs, "country", v, r);
    for (const v of s.organizations) pushValue(attrs, "organization", v, r);
    for (const v of s.previousOrganizations) pushValue(attrs, "previous_organization", v, r);
    for (const v of s.designations) pushValue(attrs, "designation", v, r);
    for (const v of s.schools) pushValue(attrs, "school", v, r);
    for (const v of s.ages) pushValue(attrs, "age", String(v), r);
    for (const v of s.emails) pushValue(attrs, "email", v, r);
    for (const v of s.phones) pushValue(attrs, "phone", v, r);
    for (const v of s.websites) pushValue(attrs, "website", v, r);
    for (const v of s.events) pushValue(attrs, "event", v, r);
    const profs = [...(s.subjectProfile ? [s.subjectProfile] : []), ...(s.nameHit ? s.mentionedProfiles : [])];
    for (const p of profs) {
      const k = profKey(p);
      const existing = profiles.get(k);
      if (existing) {
        if (!existing.evidence.some((e) => e.resultId === r.id)) existing.evidence.push(ev(r));
      } else profiles.set(k, { ...p, evidence: [ev(r)] });
    }
    if (!imageUrl && r.imageUrl) imageUrl = r.imageUrl;
    if (r.discoveredAt < first) first = r.discoveredAt;
  }

  const hasName = names.size > 0;
  const idMatch = target.identifiers.some((i) => profiles.has(profKey(i)));
  if (!hasName && !idMatch && !Array.from(strongKeys).some((k) => k.startsWith("e:") || k.startsWith("t:"))) return null;

  // "Current" org: an org that also appears as previous elsewhere in the cluster is demoted.
  if (attrs.organization && attrs.previous_organization) {
    attrs.organization = attrs.organization.filter((o) => !attrs.previous_organization!.some((p) => sameOrg(p.value, o.value)) || o.count > 1);
  }
  for (const k of Object.keys(attrs) as AttributeKind[]) attrs[k]!.sort((a, b) => b.count - a.count);

  const displayName = Array.from(names.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? target.name;
  const domains = uniq(ids.map((id) => domainOf(byId.get(id)!.url)).filter(Boolean));
  const profileList = Array.from(profiles.values());
  const match = scoreCandidate(target, attrs, profileList, weak);

  const anchor = Array.from(strongKeys).sort()[0] ?? canonicalUrl(byId.get(ids[0])!.url);
  return {
    clusterKey: `C-${fnv1a(anchor)}`,
    displayName,
    resultIds: ids,
    strongKeys: Array.from(strongKeys),
    weak,
    attributes: attrs,
    profiles: profileList,
    imageUrl: imageUrl ?? null,
    sourceCount: domains.length,
    evidenceCount: ids.length,
    domains,
    firstDiscoveredAt: first,
    lastCheckedAt: now,
    match,
  };
  void root;
}

const MATCHABLE: AttributeKind[] = ["city", "state", "country", "organization", "designation", "previous_organization", "school", "age", "email", "phone", "website"];

export function scoreCandidate(
  target: TargetProfile,
  attrs: Partial<Record<AttributeKind, CandidateAttributeValue[]>>,
  profiles: (ProfileRef & { evidence: AttributeEvidenceRef[] })[],
  weak: boolean,
): CandidateProfile["match"] {
  const breakdown: AttributeMatch[] = [];

  // Name
  const nameVals = attrs.name ?? [];
  const exact = nameVals.find((v) => compareNames(target.name, v.value) === "exact");
  const variant = nameVals.find((v) => compareNames(target.name, v.value) !== "none");
  breakdown.push({
    key: "name",
    label: "Name",
    expected: target.name,
    status: exact || variant ? "match" : "unknown",
    found: nameVals.map((v) => v.value),
    strong: false,
    evidence: (exact ?? variant)?.evidence ?? [],
  });

  for (const kind of MATCHABLE) {
    const expected = target.attributes.filter((a) => a.kind === kind);
    for (const e of expected) {
      const found = attrs[kind] ?? [];
      const hit = found.filter((f) => valuesEqual(kind, f.value, e.value));
      let status: AttributeMatch["status"] = "unknown";
      let foundVals = found.map((f) => f.value);
      let evidence = hit.flatMap((h) => h.evidence);
      if (hit.length) status = "match";
      else if (kind === "organization" && (attrs.previous_organization ?? []).some((p) => sameOrg(p.value, e.value))) {
        status = "conflict";
        const prev = (attrs.previous_organization ?? []).filter((p) => sameOrg(p.value, e.value));
        foundVals = [...foundVals, ...prev.map((p) => `${p.value} (previous)`)];
        evidence = prev.flatMap((p) => p.evidence);
      } else if (found.length && !["email", "phone", "website", "state", "school"].includes(kind)) {
        status = "conflict";
        evidence = found.flatMap((f) => f.evidence);
      }
      breakdown.push({
        key: kind,
        label: ATTRIBUTE_LABEL[kind],
        expected: kind === "organization" || kind === "previous_organization" ? canonicalOrg(e.value) : e.value,
        status,
        found: foundVals,
        strong: status === "match" && (kind === "email" || kind === "phone"),
        evidence,
      });
    }
  }

  for (const id of target.identifiers) {
    const same = profiles.filter((p) => p.platform === id.platform && p.handle === id.handle);
    const other = profiles.filter((p) => p.platform === id.platform && p.handle !== id.handle);
    breakdown.push({
      key: `platform:${id.platform}`,
      label: PLATFORM_LABEL[id.platform],
      expected: id.handle,
      status: same.length ? "match" : other.length ? "conflict" : "unknown",
      found: [...same, ...other].map((p) => p.handle),
      strong: same.length > 0,
      evidence: [...same, ...other].flatMap((p) => p.evidence),
    });
  }

  const matched = breakdown.filter((b) => b.status === "match").length;
  const conflicts = breakdown.filter((b) => b.status === "conflict").length;
  const strongMatches = breakdown.filter((b) => b.strong).length;
  const independentSources = uniq(breakdown.filter((b) => b.status === "match").flatMap((b) => b.evidence.map((e) => e.domain))).length;
  const corroborated = strongMatches >= 2 || (strongMatches >= 1 && independentSources >= 2 && conflicts === 0);
  const score = matched * 10 - conflicts * 15 + (strongMatches ? 20 + strongMatches * 5 : 0) + Math.min(independentSources, 5) * 2 - (weak ? 5 : 0);

  return {
    matched,
    total: breakdown.length,
    conflicts,
    breakdown,
    strongIdentifierMatch: strongMatches > 0,
    corroborated,
    independentSources,
    score,
  };
}

// ---------------------------------------------------------------------------

const SUGGESTABLE: { kind: RefinementSuggestion["kind"]; label: string }[] = [
  { kind: "previous_organization", label: "Previous company" },
  { kind: "age", label: "Approximate age" },
  { kind: "designation", label: "Job title" },
  { kind: "school", label: "College / school" },
  { kind: "organization", label: "Current company" },
  { kind: "city", label: "City / location" },
  { kind: "platform:linkedin", label: "LinkedIn URL" },
  { kind: "platform:github", label: "GitHub username" },
  { kind: "platform:instagram", label: "Instagram username" },
  { kind: "platform:youtube", label: "YouTube channel" },
];

function candidateValues(c: CandidateProfile, kind: RefinementSuggestion["kind"]): string[] {
  if (kind.startsWith("platform:")) return c.profiles.filter((p) => p.platform === kind.slice(9)).map((p) => p.handle);
  return (c.attributes[kind as AttributeKind] ?? []).map((v) => v.value);
}

function targetHas(target: TargetProfile, kind: RefinementSuggestion["kind"]): boolean {
  if (kind.startsWith("platform:")) return target.identifiers.some((i) => i.platform === kind.slice(9));
  return target.attributes.some((a) => a.kind === kind);
}

export function summarise(target: TargetProfile, candidates: CandidateProfile[]): ResolutionSummary {
  if (!candidates.length) {
    return {
      state: "no_candidates",
      message: "No candidate persons found. Add another detail or check source coverage.",
      candidateCount: 0,
      topCandidateKeys: [],
      suggestions: SUGGESTABLE.filter((s) => !targetHas(target, s.kind)).slice(0, 6).map((s) => ({ ...s, why: "Not provided yet" })),
    };
  }
  const top = candidates[0];
  const sameAsTop = (c: CandidateProfile) =>
    c.match.conflicts === 0 && c.match.matched === top.match.matched && c.match.strongIdentifierMatch === top.match.strongIdentifierMatch;
  const contenders = candidates.filter(sameAsTop);
  const suppliedDetails = target.attributes.length + target.identifiers.length;

  let state: ResolutionSummary["state"] = "leading";
  if (top.match.conflicts > 0 || contenders.length >= 2) state = "ambiguous";
  if (suppliedDetails === 0 && candidates.length >= 2) state = "ambiguous";

  const pool = state === "ambiguous" ? (contenders.length >= 2 ? contenders : candidates.slice(0, 5)) : candidates.slice(0, 2);
  const suggestions: (RefinementSuggestion & { rank: number })[] = [];
  for (const s of SUGGESTABLE) {
    if (targetHas(target, s.kind)) continue;
    const vals = pool.map((c) => candidateValues(c, s.kind));
    const distinct = uniq(vals.flat().map((v) => norm(canonicalOrg(v))));
    const known = vals.filter((v) => v.length).length;
    if (distinct.length >= 2) {
      suggestions.push({ ...s, why: `Candidates differ: ${uniq(vals.flat()).slice(0, 3).join(" vs ")}`, rank: 3 + distinct.length });
    } else if (known > 0) {
      suggestions.push({ ...s, why: `Known for ${known} of ${pool.length} candidates`, rank: 1 });
    } else {
      suggestions.push({ ...s, why: "Not yet provided", rank: 0 });
    }
  }
  suggestions.sort((a, b) => b.rank - a.rank);

  const message =
    state === "ambiguous"
      ? `Found ${candidates.length} possible ${candidates.length === 1 ? "person" : "people"}${contenders.length >= 2 ? `, ${contenders.length} match equally well (${top.match.matched}/${top.match.total})` : ""}. Which detail can you provide?`
      : `Found ${candidates.length} possible ${candidates.length === 1 ? "person" : "people"}. Leading candidate matches ${top.match.matched}/${top.match.total} attributes — review evidence and confirm manually.`;

  return {
    state,
    message,
    candidateCount: candidates.length,
    topCandidateKeys: (state === "ambiguous" ? pool : [top]).map((c) => c.clusterKey),
    suggestions: suggestions.slice(0, 6).map(({ rank, ...s }) => (void rank, s)),
  };
}

/** Attributes found on plausible candidates that are not yet part of the target. */
export function discoverAttributes(target: TargetProfile, candidates: CandidateProfile[], max: number): DiscoveredAttribute[] {
  if (!candidates.length) return [];
  const top = candidates[0].match.matched;
  const plausible = candidates.filter((c) => c.match.conflicts === 0 && c.match.matched >= Math.max(2, top - 1)).slice(0, 4);
  const out: DiscoveredAttribute[] = [];
  const known = (kind: string, v: string) =>
    kind.startsWith("platform:")
      ? target.identifiers.some((i) => i.platform === kind.slice(9) && i.handle === v)
      : target.attributes.some((a) => valuesEqual(a.kind, a.value, v) && (a.kind === kind || kind === "organization" || kind === "previous_organization"));
  for (const c of plausible) {
    const kinds: AttributeKind[] = ["previous_organization", "organization", "designation", "school", "event"];
    for (const k of kinds) {
      for (const v of (c.attributes[k] ?? []).slice(0, 2)) {
        if (known(k, v.value) || out.some((o) => o.kind === k && norm(o.value) === norm(v.value))) continue;
        out.push({ kind: k, value: v.value, fromCandidate: c.clusterKey, evidenceUrl: v.evidence[0]?.url ?? "" });
      }
    }
    for (const p of c.profiles) {
      const kind = `platform:${p.platform}` as const;
      if (known(kind, p.handle) || out.some((o) => o.kind === kind && o.value === p.handle)) continue;
      out.push({ kind, value: p.handle, fromCandidate: c.clusterKey, evidenceUrl: p.evidence[0]?.url ?? p.url });
    }
  }
  return out.slice(0, max);
}
