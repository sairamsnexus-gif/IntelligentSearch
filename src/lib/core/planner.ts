/**
 * SEARCH PLANNER
 *
 * Builds prioritised search hypotheses from a TargetProfile. It does NOT emit
 * the blind Cartesian product of attributes: combinations are generated per
 * priority tier (see docs/SEARCH_ENGINE.md), de-duplicated with an
 * order-insensitive key, filtered against query history, and capped by budget.
 */
import { nameVariants, norm } from "./text";
import { PLATFORM_LABEL, PLATFORM_SITE } from "./profiles";
import type { DiscoveredAttribute, Platform, PlannedQuery, QueryCategory, QueryChannel, TargetProfile } from "./types";

export interface PlannerOptions {
  maxQueries: number;
  /** Channels that at least one available adapter can serve. */
  channels: Set<QueryChannel>;
  /** Canonical keys already executed (query history) — skipped. */
  history?: Set<string>;
  /** Attributes discovered during previous iterations (tier 10). */
  discovered?: DiscoveredAttribute[];
  /** Platforms hinted by free text ("may have a YouTube channel"). */
  platformHints?: Platform[];
  /** Monitoring mode: fewer, higher-precision queries. */
  mode?: "discovery" | "monitor";
  iteration?: number;
}

export interface PlanOutput {
  planned: PlannedQuery[];
  skipped: (PlannedQuery & { skipReason: "duplicate" | "history" | "budget" | "channel_unavailable" })[];
}

const q = (s: string) => `"${s.replace(/"/g, "")}"`;

/** Order-insensitive canonical key: `"Rajesh Kumar" TCS` === `TCS "Rajesh Kumar"`. */
export function queryKey(query: string, channel: QueryChannel = "web"): string {
  const parts: string[] = [];
  const re = /(\w+:)?"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) {
    if (m[2] !== undefined) parts.push(`${(m[1] ?? "").toLowerCase()}"${norm(m[2])}"`);
    else parts.push(m[3].toLowerCase());
  }
  return `${channel}|${parts.sort().join(" ")}`;
}

function attr(profile: TargetProfile, kind: string): string[] {
  return profile.attributes.filter((a) => a.kind === kind).map((a) => a.value);
}

export function planQueries(profile: TargetProfile, opts: PlannerOptions): PlanOutput {
  const all: PlannedQuery[] = [];
  const add = (query: string, tier: number, category: QueryCategory, reason: string, channel: QueryChannel = "web", extra: Partial<PlannedQuery> = {}) => {
    all.push({ query: query.trim().replace(/\s+/g, " "), key: queryKey(query, channel), tier, category, channel, reason, ...extra });
  };

  const name = profile.name;
  const N = q(name);
  const variants = nameVariants(name);
  const orgs = attr(profile, "organization");
  const prevOrgs = attr(profile, "previous_organization");
  const cities = attr(profile, "city");
  const states = attr(profile, "state");
  const countries = attr(profile, "country");
  const designations = attr(profile, "designation");
  const schools = attr(profile, "school");
  const emails = attr(profile, "email");
  const phones = attr(profile, "phone");
  const websites = attr(profile, "website");
  const ids = profile.identifiers;
  const monitor = opts.mode === "monitor";

  // Tier 0 — baseline name + name variations
  add(N, 0, "name_variation", "Exact full name");
  if (!monitor) {
    for (const v of variants.slice(1)) add(q(v.value), 0, "name_variation", `Name variation (${v.kind.replace("_", " ")})`);
  }

  // Tier 1 — name + strongest identifier (profile URL > email > phone > username)
  for (const id of ids) {
    if (id.url) add(`${q(id.url.replace(/^https?:\/\/(www\.)?/, ""))}`, 1, "cross_reference", `Exact ${PLATFORM_LABEL[id.platform]} profile URL`, "web", { platform: id.platform });
    add(`${N} ${q(id.handle)}`, 1, "cross_reference", `Name + ${PLATFORM_LABEL[id.platform]} handle`, "web", { platform: id.platform });
  }
  for (const e of emails) add(q(e), 1, "cross_reference", "Exact email address");
  for (const p of phones) add(q(p), 1, "cross_reference", "Exact phone number (E.164)");
  for (const w of websites) add(`${N} ${q(w)}`, 1, "cross_reference", "Name + personal website");

  // Tier 2 — name + company
  for (const o of orgs) add(`${N} ${o}`, 2, "company_location", "Name + company");
  // Tier 3 — name + city / state / country
  for (const c of cities) add(`${N} ${c}`, 3, "company_location", "Name + city");
  for (const s of states) add(`${N} ${q(s)}`, 3, "company_location", "Name + state");
  if (!cities.length) for (const c of countries) add(`${N} ${c}`, 3, "company_location", "Name + country");
  // Tier 4 — name + designation (+ previous org, school)
  for (const d of designations) add(`${N} ${q(d)}`, 4, "professional", "Name + designation");
  for (const p of prevOrgs) add(`${N} ${p}`, 4, "professional", "Name + previous company");
  for (const s of schools) add(`${N} ${q(s)}`, 4, "professional", "Name + school/college");
  // Tier 5 — name + company + city
  for (const o of orgs) for (const c of cities) add(`${N} ${o} ${c}`, 5, "company_location", "Name + company + city");
  // Tier 6 — name + company + designation, name + city + designation
  for (const o of orgs) for (const d of designations) add(`${N} ${o} ${q(d)}`, 6, "professional", "Name + company + designation");
  for (const c of cities) for (const d of designations) add(`${N} ${c} ${q(d)}`, 6, "professional", "Name + city + designation");

  // Tier 7/8 — username + company / city ; plus username discovery channel
  for (const id of ids) {
    const H = q(id.handle);
    add(H, 7, "username", `Username "${id.handle}"`);
    for (const o of orgs) add(`${H} ${o}`, 7, "username", "Username + company");
    for (const c of cities) add(`${H} ${c}`, 8, "username", "Username + city");
    add(id.handle, 7, "username", `Cross-platform username discovery for "${id.handle}"`, "username", { handle: id.handle, platform: id.platform });
    if (id.platform === "github") add(id.handle, 1, "social", "GitHub public profile lookup", "github", { handle: id.handle, platform: "github" });
    if (id.platform === "reddit") add(id.handle, 1, "social", "Reddit public profile lookup", "reddit", { handle: id.handle, platform: "reddit" });
  }

  // Tier 9 — platform-specific + news + documents + images
  const qualifier = orgs[0] ?? cities[0] ?? designations[0];
  const hinted = new Set(opts.platformHints ?? []);
  const platforms: Platform[] = ["linkedin", "github", "youtube", "instagram", "x", "facebook", "reddit"];
  for (const p of platforms) {
    if (ids.some((i) => i.platform === p) && monitor) continue;
    const site = PLATFORM_SITE[p]!;
    const tier = hinted.has(p) ? 8 : 9;
    const cat: QueryCategory = p === "linkedin" || p === "github" ? "professional" : "social";
    add(`site:${site} ${N}${qualifier ? ` ${qualifier.includes(" ") ? q(qualifier) : qualifier}` : ""}`, tier, cat, `${PLATFORM_LABEL[p]} profile search`, "web", { platform: p });
    if (!monitor) add(`${N} ${PLATFORM_LABEL[p].split(" ")[0]}`, 9, cat, `Name + ${PLATFORM_LABEL[p]}`, "web", { platform: p });
  }
  add(`${N}${cities[0] ? ` ${cities[0]}` : ""}`, 9, "social", "GitHub user search (name + location)", "github");
  add(`${N}${orgs[0] ? ` ${orgs[0]}` : ""}`, 9, "social", "Reddit public mentions", "reddit");
  add(`${N}${qualifier ? ` ${qualifier}` : ""}`, 9, "social", "YouTube channel search", "youtube");
  add(`${N}${orgs[0] ? ` ${orgs[0]}` : ""}`, 9, "news", "News mentions (name + company)", "news");
  if (cities[0] && !monitor) add(`${N} ${cities[0]}`, 9, "news", "News mentions (name + city)", "news");
  if (!monitor) {
    add(`${N}${orgs[0] ? ` ${orgs[0]}` : ""} filetype:pdf`, 9, "documents", "Public documents (PDF)");
    add(`${N}${qualifier ? ` ${qualifier}` : ""}`, 9, "images", "Public images", "images");
  }

  // Tier 10 — newly discovered attributes from previous iterations
  for (const d of opts.discovered ?? []) {
    const why = `Discovered on candidate ${d.fromCandidate} (${d.evidenceUrl})`;
    if (d.kind.startsWith("platform:")) {
      const platform = d.kind.slice(9) as Platform;
      add(q(d.value), 10, "discovered", `${why} — ${PLATFORM_LABEL[platform]} handle`);
      for (const o of orgs.slice(0, 1)) add(`${q(d.value)} ${o}`, 10, "discovered", `${why} — handle + company`);
      for (const c of cities.slice(0, 1)) add(`${q(d.value)} ${c}`, 10, "discovered", `${why} — handle + city`);
      add(d.value, 10, "discovered", `${why} — cross-platform username discovery`, "username", { handle: d.value, platform });
    } else {
      add(`${N} ${d.value.includes(" ") ? q(d.value) : d.value}`, 10, "discovered", `${why} — ${d.kind.replace("_", " ")}`);
    }
  }

  // De-duplicate, apply history, channel availability, budget.
  const seen = new Set<string>();
  const planned: PlannedQuery[] = [];
  const skipped: PlanOutput["skipped"] = [];
  const sorted = all.map((p, i) => ({ p, i })).sort((a, b) => a.p.tier - b.p.tier || a.i - b.i).map((x) => x.p);
  for (const p of sorted) {
    if (seen.has(p.key)) {
      skipped.push({ ...p, skipReason: "duplicate" });
      continue;
    }
    seen.add(p.key);
    if (opts.history?.has(p.key)) {
      skipped.push({ ...p, skipReason: "history" });
      continue;
    }
    if (!opts.channels.has(p.channel)) {
      skipped.push({ ...p, skipReason: "channel_unavailable" });
      continue;
    }
    if (planned.length >= opts.maxQueries) {
      skipped.push({ ...p, skipReason: "budget" });
      continue;
    }
    planned.push(p);
  }
  return { planned, skipped };
}

export const CATEGORY_LABEL: Record<QueryCategory, string> = {
  name_variation: "Name variations",
  company_location: "Company & location",
  professional: "Professional profiles",
  social: "Social media",
  news: "News",
  images: "Images",
  documents: "Documents",
  username: "Username discovery",
  cross_reference: "Cross-reference",
  discovered: "Discovered attributes",
};
