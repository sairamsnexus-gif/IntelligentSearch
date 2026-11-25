/**
 * Natural-language clue parsing (rule-based; the FreeLLMAPI gateway may add
 * to it server-side). Exact spellings are preserved verbatim.
 */
import { PLACES } from "@/lib/core/lexicon";
import { buildNameClue } from "./variants";
import { newId, type Clues } from "./schema";

const NOT_NAMES = new Set(
  "find search locate look they he she it we i you the a an and or in at of for may might also could be is are was were their his her its this that these those who with from by to on near around probably maybe possibly running run business school montessori garments garment clothing chennai india please investigate check see also note perhaps my our your look try get use contact visit go known called named both together there here what when where why how all any some mr mrs ms dr sir madam".split(" "),
);

export const ORG_TERMS: { re: RegExp; hint: string; kind: "business" | "school" | "organisation" }[] = [
  { re: /\bgarments?\b/i, hint: "garments business", kind: "business" },
  { re: /\b(clothing|apparel|textiles?|boutique|tailoring|fashion)\b/i, hint: "clothing / textile business", kind: "business" },
  { re: /\bexport(s|ers?)?\b/i, hint: "export business", kind: "business" },
  { re: /\bmontessori\b/i, hint: "Montessori school", kind: "school" },
  { re: /\b(play ?school|pre-?school|kindergarten|nursery school|day ?care)\b/i, hint: "pre-school", kind: "school" },
  { re: /\b(school|academy|college|institute)\b/i, hint: "school / education", kind: "school" },
  { re: /\b(restaurant|cafe|bakery|catering)\b/i, hint: "food business", kind: "business" },
  { re: /\b(clinic|hospital|pharmacy)\b/i, hint: "health organisation", kind: "organisation" },
  { re: /\b(trust|foundation|ngo|charity|temple|association)\b/i, hint: "non-profit / association", kind: "organisation" },
];

const KEYWORDS = ["garments", "clothing", "textile", "boutique", "export", "montessori", "school", "pre-school", "kindergarten", "academy", "business", "company", "shop", "store"];

export function parseClues(text: string): Clues {
  const t = text.replace(/\s+/g, " ").trim();
  const urls = Array.from(new Set(t.match(/\bhttps?:\/\/[^\s"'<>]+/gi) ?? [])).map((u) => u.replace(/[.,;)]+$/, ""));
  const withoutUrls = t.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, " ");
  const usernames = Array.from(new Set(Array.from(withoutUrls.matchAll(/(?:^|\s)@([a-z0-9._]{2,40})/gi)).map((m) => m[1].toLowerCase())));
  const domains = Array.from(new Set(Array.from(withoutUrls.matchAll(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|org|net|co\.in|edu|io|school|example))\b/gi)).map((m) => m[1].toLowerCase()).filter((d) => !/@/.test(d))));

  // Places: gazetteer + "in <Place>"
  const places: string[] = [];
  for (const p of PLACES) for (const n of [p.city, ...(p.aliases ?? [])]) if (new RegExp(`\\b${n}\\b`, "i").test(withoutUrls) && !places.includes(p.city)) places.push(p.city);
  for (const m of withoutUrls.matchAll(/\b(?:in|at|near|from)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/g)) {
    const v = m[1];
    if (!places.includes(v) && !NOT_NAMES.has(v.toLowerCase()) && !/school|montessori/i.test(v)) places.push(v);
  }

  // Names: capitalised tokens joined by "and"/","/"&", not places or terms
  const names: string[] = [];
  const isName = (w: string) => /^[A-Z][a-z'’-]{1,30}$/.test(w) && !NOT_NAMES.has(w.toLowerCase()) && !places.some((p) => p.toLowerCase() === w.toLowerCase());
  const tokens = withoutUrls.split(/(\s+|[.,;:!?()])/).filter((x) => x.trim() && !/^[.,;:!?()]$/.test(x));
  for (let i = 0; i < tokens.length; i++) {
    if (!isName(tokens[i])) continue;
    // multi-word name: consecutive capitalised name tokens (e.g. "Asma Rahman")
    let full = tokens[i];
    while (i + 1 < tokens.length && isName(tokens[i + 1])) full += ` ${tokens[++i]}`;
    if (!names.includes(full)) names.push(full);
  }

  let organisationHints = Array.from(new Set(ORG_TERMS.filter((o) => o.re.test(withoutUrls)).map((o) => o.hint)));
  // Drop the generic school hint when a specific one (Montessori, pre-school) is present.
  if (organisationHints.some((h) => h === "Montessori school" || h === "pre-school")) organisationHints = organisationHints.filter((h) => h !== "school / education");
  const keywords = KEYWORDS.filter((k) => new RegExp(`\\b${k}`, "i").test(withoutUrls));

  const userRelationships: Clues["userRelationships"] = [];
  if (names.length >= 2 && /\b(they|together|both|partners?|running)\b/i.test(withoutUrls)) {
    userRelationships.push({ a: names[0], b: names[1], description: "Named together by the user (e.g. possibly running a business together) — user-supplied clue, not verified" });
  }

  return {
    names: names.slice(0, 6).map((n) => buildNameClue(n, places, () => newId("name"))),
    places: places.slice(0, 6),
    organisationHints,
    keywords,
    urls: urls.slice(0, 20),
    usernames: usernames.slice(0, 10),
    domains: domains.filter((d) => !urls.some((u) => u.includes(d))).slice(0, 10),
    userRelationships,
    parsedBy: ["rules"],
  };
}
