/**
 * Signal extraction from a single canonical SearchResult. Deterministic and
 * explainable: every extracted value comes from a literal match in the
 * document's title/description/content.
 */
import { DESIGNATIONS, KNOWN_ORG_PHRASES, PLACES, COUNTRIES, canonicalCity, canonicalCountry, canonicalOrg } from "./lexicon";
import { containsPhrase, escapeRegExp, findNameInText, norm, uniq } from "./text";
import { extractProfiles, parseProfileUrl } from "./profiles";
import { findPhones } from "./phone";
import type { ExtractedSignals, SearchResult, TargetProfile } from "./types";

const ORG_ALT = [...KNOWN_ORG_PHRASES].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
const CAP_ORG = "[A-Z][\\w&.-]*(?:\\s+[A-Z][\\w&.-]*){0,3}";
const DESIG_ALT = DESIGNATIONS.map(escapeRegExp).join("|");

function docText(r: SearchResult): string {
  return [r.title, r.description, r.name, r.location, r.organization, r.designation, r.contentText].filter(Boolean).join(" \n ");
}

export function extractSignals(r: SearchResult, target: TargetProfile): ExtractedSignals {
  const raw = docText(r);
  const text = raw.replace(/\s+/g, " ");
  const tn = norm(text);

  const nameMatchedAs = findNameInText(target.name, tn) ?? (r.name ? findNameInText(target.name, norm(r.name)) : undefined);
  const subjectProfile = parseProfileUrl(r.url);
  const mentioned = extractProfiles(raw).filter((p) => !(subjectProfile && p.platform === subjectProfile.platform && p.handle === subjectProfile.handle));

  // --- Organisations ------------------------------------------------------
  const previousOrganizations: string[] = [];
  const organizations: string[] = [];
  const prevRe = new RegExp(`(?:\\bex-|\\bformerly (?:at|with) |\\bpreviously (?:at|with|worked at) |\\bprior to that,? (?:at |with )?|\\bbefore (?:joining \\w+,? )?(?:he|she|they)? ?(?:was|worked) (?:at|with) |\\bworked at )(${ORG_ALT}|${CAP_ORG})`, "gi");
  for (const m of text.matchAll(prevRe)) previousOrganizations.push(canonicalOrg(m[1]));
  // "joined TCS from Infosys" → current TCS, previous Infosys
  for (const m of text.matchAll(new RegExp(`\\bjoined (${ORG_ALT}|${CAP_ORG}) from (${ORG_ALT}|${CAP_ORG})`, "gi"))) {
    organizations.push(canonicalOrg(m[1]));
    previousOrganizations.push(canonicalOrg(m[2]));
  }
  if (r.organization) organizations.push(canonicalOrg(r.organization));
  const atRe = new RegExp(`(?:${DESIG_ALT}|works|working|employed|engineer|manager|lead)\\s+(?:at|@|with)\\s+(${ORG_ALT}|${CAP_ORG})`, "gi");
  for (const m of text.matchAll(atRe)) {
    const o = canonicalOrg(m[1]);
    if (!previousOrganizations.some((p) => norm(p) === norm(o))) organizations.push(o);
  }
  // Known org phrases mentioned anywhere count as organisation mentions (weak).
  for (const phrase of KNOWN_ORG_PHRASES) {
    if (phrase.length < 3 && phrase !== phrase.toUpperCase()) continue;
    if (containsPhrase(tn, phrase)) {
      const o = canonicalOrg(phrase);
      if (!previousOrganizations.some((p) => norm(p) === norm(o))) organizations.push(o);
    }
  }
  // The user-supplied org (may not be in lexicon)
  for (const a of target.attributes) {
    if ((a.kind === "organization" || a.kind === "previous_organization") && containsPhrase(tn, a.value)) {
      const o = canonicalOrg(a.value);
      if (a.kind === "previous_organization" || previousOrganizations.some((p) => norm(p) === norm(o))) previousOrganizations.push(o);
      else organizations.push(o);
    }
  }

  // --- Designations -------------------------------------------------------
  const designations: string[] = [];
  if (r.designation) designations.push(r.designation.trim());
  for (const d of DESIGNATIONS) {
    if (containsPhrase(tn, d) && !designations.some((x) => norm(x).includes(norm(d)))) designations.push(d);
  }
  for (const a of target.attributes) {
    if (a.kind === "designation" && containsPhrase(tn, a.value) && !designations.some((x) => norm(x).includes(norm(a.value)))) designations.push(a.value);
  }

  // --- Locations ----------------------------------------------------------
  const cities: string[] = [];
  const states: string[] = [];
  const countries: string[] = [];
  for (const p of PLACES) {
    if ([p.city, ...(p.aliases ?? [])].some((c) => containsPhrase(tn, c))) {
      cities.push(p.city);
    }
    if (containsPhrase(tn, p.state) && p.state !== p.city) states.push(p.state);
  }
  for (const [c, aliases] of Object.entries(COUNTRIES)) {
    if ([c, ...aliases.filter((a) => a.length > 2)].some((a) => containsPhrase(tn, a))) countries.push(c);
  }
  if (r.location) {
    for (const part of r.location.split(/,\s*/)) {
      const city = canonicalCity(part);
      if (PLACES.some((p) => p.city === city)) cities.push(city);
      const ctry = canonicalCountry(part);
      if (COUNTRIES[ctry]) countries.push(ctry);
    }
  }
  for (const a of target.attributes) {
    if (a.kind === "city" && containsPhrase(tn, a.value)) cities.push(canonicalCity(a.value));
    if (a.kind === "state" && containsPhrase(tn, a.value)) states.push(a.value);
  }
  for (const c of cities) {
    const p = PLACES.find((pl) => pl.city === c);
    if (p) countries.push(p.country);
  }

  // --- Schools, ages, events ---------------------------------------------
  const schools: string[] = [];
  for (const m of text.matchAll(/(?:studied at|graduated from|alumn(?:us|a|i) of|degree from|B\.?E\.? from|B\.?Tech from|MBA from) ([A-Z][\w&.-]*(?: (?:of )?[A-Z][\w&.-]*){0,5})/g)) schools.push(m[1]);
  for (const a of target.attributes) if (a.kind === "school" && containsPhrase(tn, a.value)) schools.push(a.value);

  const ages: number[] = [];
  for (const m of text.matchAll(/\b(\d{2})[- ](?:year|yr)s?[- ]old\b|\baged? (\d{2})\b|\bage:? (\d{2})\b/gi)) {
    const n = parseInt(m[1] ?? m[2] ?? m[3], 10);
    if (n >= 16 && n <= 99) ages.push(n);
  }
  for (const m of text.matchAll(/\bborn (?:in )?(19[4-9]\d|200\d)\b/gi)) ages.push(new Date(r.discoveredAt).getUTCFullYear() - parseInt(m[1], 10));

  const events: string[] = [];
  for (const m of text.matchAll(/(?:speaker at|spoke at|talk at|presented at|keynote at|panelist at) ([A-Z][\w-]*(?: [A-Z][\w-]*){0,3} (?:19|20)\d{2})/g)) events.push(m[1]);

  const emails = uniq([...(r.emails ?? []), ...(text.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}(?:\.[a-z]{2,})?/gi) ?? [])].map((e) => e.toLowerCase()));
  const phones = uniq([...(r.phoneNumbers ?? []), ...findPhones(text, countries[0])]);

  const websites: string[] = [];
  for (const m of text.matchAll(/\b(?:website|blog|site|portfolio):?\s+(https?:\/\/[^\s]+|[a-z0-9-]+\.(?:com|in|dev|io|me|org|net)\b)/gi)) websites.push(m[1].toLowerCase());

  return {
    nameHit: Boolean(nameMatchedAs),
    nameMatchedAs,
    subjectProfile,
    mentionedProfiles: mentioned,
    emails,
    phones,
    cities: uniq(cities),
    states: uniq(states),
    countries: uniq(countries),
    organizations: uniq(organizations.filter((o) => !previousOrganizations.some((p) => norm(p) === norm(o)))),
    previousOrganizations: uniq(previousOrganizations),
    designations: uniq(designations),
    schools: uniq(schools),
    ages: uniq(ages),
    websites: uniq(websites),
    events: uniq(events),
  };
}
