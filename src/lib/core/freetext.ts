/**
 * Rule-based extraction of search attributes from the "Anything else you know"
 * free text. Gemini (when configured) augments this server-side; this function
 * always runs so the feature works with zero API keys.
 */
import { COUNTRIES, DESIGNATIONS, KNOWN_ORG_PHRASES, PLACES, canonicalCity, canonicalCountry, canonicalOrg } from "./lexicon";
import { escapeRegExp, norm } from "./text";
import { extractProfiles } from "./profiles";
import { findPhones } from "./phone";
import type { AttributeKind, Platform, TargetAttribute, TargetIdentifier } from "./types";

export interface FreeTextExtraction {
  attributes: TargetAttribute[];
  identifiers: TargetIdentifier[];
  platformHints: Platform[];
}

const ORG_ALT = [...KNOWN_ORG_PHRASES].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
const CAP_ORG = "[A-Z][\\w&.-]*(?:\\s+[A-Z][\\w&.-]*){0,3}";
const ORG = `(${ORG_ALT}|${CAP_ORG})`;

function orgFrom(raw: string): string {
  return canonicalOrg(raw.replace(/\s+(before|and|then|but|in|at)$/i, "").trim());
}

export function extractFromFreeText(text: string): FreeTextExtraction {
  const attrs: TargetAttribute[] = [];
  const push = (kind: AttributeKind, value: string) => {
    const v = value.trim();
    if (!v) return;
    if (!attrs.some((a) => a.kind === kind && norm(a.value) === norm(v))) attrs.push({ kind, value: v, state: "user_supplied" });
  };
  const t = text.replace(/\s+/g, " ");

  // "worked at Infosys before TCS" / "worked at X before joining Y"
  for (const m of t.matchAll(new RegExp(`worked (?:at|for|with|in) ${ORG},? before (?:joining |moving to |switching to )?${ORG}`, "gi"))) {
    push("previous_organization", orgFrom(m[1]));
    push("organization", orgFrom(m[2]));
  }
  for (const m of t.matchAll(new RegExp(`(?:\\bex-|formerly (?:at|with) |previously (?:at|with|worked at) |used to work (?:at|for) )${ORG}`, "gi"))) {
    push("previous_organization", orgFrom(m[1]));
  }
  for (const m of t.matchAll(new RegExp(`(?:works|working|employed|is) (?:at|for|with) ${ORG}`, "gi"))) {
    const org = orgFrom(m[1]);
    if (!attrs.some((a) => a.kind === "previous_organization" && norm(a.value) === norm(org))) push("organization", org);
  }
  // Known orgs mentioned with no relational phrase: treat as organisation if nothing else captured.
  if (!attrs.some((a) => a.kind === "organization" || a.kind === "previous_organization")) {
    const m = t.match(new RegExp(`\\b(${ORG_ALT})\\b`, "i"));
    if (m) push("organization", canonicalOrg(m[1]));
  }

  // Location
  const livesIn = t.match(/(?:lives|living|based|resides|residing|stays|located) in ([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?)/);
  const placeNames = PLACES.flatMap((p) => [p.city, ...(p.aliases ?? [])]);
  if (livesIn) {
    const v = livesIn[1];
    if (Object.keys(COUNTRIES).some((c) => norm(c) === norm(v)) || Object.values(COUNTRIES).flat().includes(norm(v))) push("country", canonicalCountry(v));
    else push("city", canonicalCity(v));
  } else {
    const mentioned = placeNames.filter((p) => new RegExp(`\\b${escapeRegExp(p)}\\b`, "i").test(t));
    const canon = Array.from(new Set(mentioned.map(canonicalCity)));
    if (canon.length === 1) push("city", canon[0]);
  }
  for (const [c, aliases] of Object.entries(COUNTRIES)) {
    if ([c, ...aliases.filter((a) => a.length > 2)].some((a) => new RegExp(`\\b${escapeRegExp(a)}\\b`, "i").test(t))) push("country", c);
  }

  // Age
  const age =
    t.match(/(?:around|about|approximately|approx\.?|roughly|nearly|~)\s*(\d{2})\b/i) ??
    t.match(/\b(\d{2})\s*(?:years?|yrs?)(?:[- ]old)?\b/i) ??
    t.match(/\bage[d]?\s*(?:is\s*)?(\d{2})\b/i);
  if (age) {
    const n = parseInt(age[1], 10);
    if (n >= 16 && n <= 99) push("age", String(n));
  }

  // Designation
  for (const d of DESIGNATIONS) {
    if (new RegExp(`\\b${escapeRegExp(d)}\\b`, "i").test(t)) {
      push("designation", d);
      break; // lexicon is ordered most-specific first
    }
  }

  // School
  const school = t.match(/(?:studied at|graduated from|alumn(?:us|a|i) of|went to|college was) ([A-Z][\w&.-]*(?: (?:of )?[A-Z][\w&.-]*){0,5})/);
  if (school) push("school", school[1]);

  // Contact identifiers
  for (const e of t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []) push("email", e.toLowerCase());
  for (const p of findPhones(t)) push("phone", p);

  const identifiers: TargetIdentifier[] = extractProfiles(t).map((p) => ({ platform: p.platform, handle: p.handle, url: p.url, state: "user_supplied" }));

  // Platform hints ("may have a YouTube channel")
  const hints: Platform[] = [];
  const hintMap: [RegExp, Platform][] = [
    [/youtube/i, "youtube"],
    [/instagram|\binsta\b/i, "instagram"],
    [/github/i, "github"],
    [/linkedin/i, "linkedin"],
    [/facebook/i, "facebook"],
    [/twitter|\bx\.com\b/i, "x"],
    [/reddit/i, "reddit"],
  ];
  for (const [re, p] of hintMap) if (re.test(t) && !identifiers.some((i) => i.platform === p)) hints.push(p);

  // Username mentions: "username rk78", "handle @rk78"
  for (const m of t.matchAll(/(?:username|handle|user ?id)\s*(?:is\s*)?@?([a-z0-9._-]{3,40})/gi)) {
    const platform = hints[0] ?? "other_social";
    identifiers.push({ platform, handle: m[1].toLowerCase(), state: "user_supplied" });
  }

  return { attributes: attrs, identifiers, platformHints: hints };
}
