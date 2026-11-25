/**
 * Deterministic page-level extraction (web-scout-ai method, re-implemented):
 * every extracted value carries the passage it came from so it can be shown
 * and re-checked. No LLM needed; the optional LLM pass (server-side) may only
 * ADD facts whose supporting quote appears verbatim in the page text.
 */
import { normalizeContent } from "@/lib/core/change";
import { findPhones, normalizePhone } from "@/lib/core/phone";
import { parseProfileUrl } from "@/lib/core/profiles";
import { PLACES } from "@/lib/core/lexicon";

export type OrgKind = "business" | "school" | "organisation";

export interface ExtractedOrg {
  name: string;
  kind: OrgKind;
  from: "jsonld" | "site_name" | "title" | "text";
  website?: string;
  passage: string;
}
export interface ExtractedPerson {
  name: string;
  role?: string;
  predicate: "founded" | "owns" | "works_at" | "holds_position" | "associated_with";
  orgName?: string;
  passage: string;
}
export interface ExtractedContact {
  kind: "email" | "phone" | "whatsapp" | "address" | "website" | "social";
  value: string;
  normalized: string;
  passage: string;
  fromStructuredData: boolean;
}
export interface ExtractedLink {
  url: string;
  text: string;
  rel: "internal" | "external";
}
export interface ExtractedFact {
  predicate: "established_in_year" | "mentions";
  value: string;
  passage: string;
}

export interface PageExtraction {
  title: string;
  description: string;
  siteName: string;
  canonical: string | null;
  publishedAt: string | null;
  text: string;
  organisations: ExtractedOrg[];
  people: ExtractedPerson[];
  contacts: ExtractedContact[];
  socialProfiles: { platform: string; handle: string; url: string; passage: string }[];
  links: ExtractedLink[];
  facts: ExtractedFact[];
  localities: string[];
}

// ---------------------------------------------------------------------------
// tiny HTML helpers (regex-based, tolerant)

function decode(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : null;
}

function meta(html: string, key: string): string {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const t = m[0];
    const k = (attr(t, "property") ?? attr(t, "name") ?? "").toLowerCase();
    if (k === key) return (attr(t, "content") ?? "").trim();
  }
  return "";
}

function absolutise(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

export function registrableDomain(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const parts = h.split(".");
    if (parts.length > 2 && /^(co|com|org|net|ac|edu|gov)$/.test(parts.at(-2)!) && parts.at(-1)!.length === 2) return parts.slice(-3).join(".");
    return parts.slice(-2).join(".");
  } catch {
    return "";
  }
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

function passageFor(sents: string[], needle: string): string {
  const n = needle.toLowerCase();
  const s = sents.find((x) => x.toLowerCase().includes(n));
  return (s ?? needle).slice(0, 400);
}

// ---------------------------------------------------------------------------

const SCHOOL_RE = /(montessori|school|academy|kindergarten|pre-?school|play ?school|vidyalaya|college|institute)/i;
const BUSINESS_RE = /(garments?|clothing|apparel|textiles?|boutique|exports?|fashion|tailor|store|shop|traders?|enterprises|pvt|private limited|llp|industries)/i;

function orgKind(name: string, types: string[] = []): OrgKind {
  const t = types.join(" ").toLowerCase();
  if (/school|educational|preschool|college/.test(t) || SCHOOL_RE.test(name)) return "school";
  if (/store|localbusiness|clothing|corporation|business/.test(t) || BUSINESS_RE.test(name)) return "business";
  return "organisation";
}

const ROLES: [RegExp, ExtractedPerson["predicate"], string][] = [
  [/co-?founders?/i, "founded", "Co-founder"],
  [/founders?/i, "founded", "Founder"],
  [/proprietors?|owners?/i, "owns", "Owner"],
  [/managing director/i, "holds_position", "Managing Director"],
  [/directors?/i, "holds_position", "Director"],
  [/principal/i, "holds_position", "Principal"],
  [/head of school|head mistress|headmistress|headmaster/i, "holds_position", "Head of School"],
  [/correspondent/i, "holds_position", "Correspondent"],
  [/chair(?:man|woman|person)/i, "holds_position", "Chairperson"],
  [/ceo|chief executive/i, "holds_position", "CEO"],
  [/trustee/i, "holds_position", "Trustee"],
  [/administrator/i, "holds_position", "Administrator"],
  [/partners?/i, "holds_position", "Partner"],
  [/manager/i, "works_at", "Manager"],
  [/teacher|faculty|staff/i, "works_at", "Staff"],
];

const NAME = "(?:(?:Mr|Mrs|Ms|Dr|Smt|Shri|Thiru|Tmt)\\.?\\s+)?[A-Z][a-z'’]+(?:\\s+(?:[A-Z]\\.|[A-Z][a-z'’]+)){0,3}";
const ci = (s: string) => s.replace(/[a-z]/gi, (ch) => (/[a-z]/i.test(ch) ? `[${ch.toUpperCase()}${ch.toLowerCase()}]` : ch));
const ROLE_ALT = ["Co-?Founders?", "Founders?", "Proprietors?", "Owners?", "Managing Director", "Directors?", "Principal", "Head of School", "Headmistress", "Correspondent", "Chair(?:man|woman|person)", "CEO", "Trustees?", "Partners?", "Managers?", "Administrator"]
  .map((r) => r.replace(/\(\?:[^)]*\)|[A-Za-z]+/g, (tok) => (tok.startsWith("(") ? tok : ci(tok))))
  .join("|");
const NOT_PERSON = /^(Our|The|About|Contact|Home|Team|Welcome|Founded|Established|Since|School|Montessori|Garments|Chennai|India|Tamil|Nadu|Leadership|Admissions|Address|Phone|Email|Copyright|Privacy)$/;

function cleanName(n: string): string | null {
  const v = n.replace(/^(Mr|Mrs|Ms|Dr|Smt|Shri|Thiru|Tmt)\.?\s+/, "").trim();
  const first = v.split(/\s+/)[0];
  if (NOT_PERSON.test(first) || v.length < 3) return null;
  if (PLACES.some((p) => p.city.toLowerCase() === v.toLowerCase())) return null;
  return v;
}

function roleOf(raw: string): { role: string; predicate: ExtractedPerson["predicate"] } {
  for (const [re, predicate, role] of ROLES) if (re.test(raw)) return { role, predicate };
  return { role: raw, predicate: "associated_with" };
}

const ORG_WORD = /(Montessori|School|Academy|Garments|Exports|Textiles|Boutique|Trust|Foundation|Limited|Ltd|Pvt|Company|Enterprises|Industries|Traders|Stores?)\b/;

export function extractPeople(text: string, defaultOrg?: string): ExtractedPerson[] {
  const out: ExtractedPerson[] = [];
  const add = (nameRaw: string, roleRaw: string, passage: string) => {
    const name = cleanName(nameRaw);
    if (!name) return;
    const { role, predicate } = roleOf(roleRaw);
    if (!out.some((p) => p.name === name && p.role === role)) out.push({ name, role, predicate, orgName: defaultOrg, passage: passage.slice(0, 400) });
  };
  for (const s of sentences(text)) {
    // "founded by A and B" / "co-founded by A & B" / "run by A"
    for (const m of s.matchAll(new RegExp(`\\b(${ci("co")}-?${ci("founded")}|${ci("founded")}|${ci("started")}|${ci("established")}|${ci("owned")}|${ci("run")}|${ci("managed")})\\s+by\\s+(${NAME})(?:\\s*(?:and|&)\\s*(${NAME}))?`, "g"))) {
      const role = /found|start|establish/i.test(m[1]) ? (/co-?/i.test(m[1]) || m[3] ? "Co-founder" : "Founder") : /owned/i.test(m[1]) ? "Owner" : "Manager";
      add(m[2], role, s);
      if (m[3]) add(m[3], role, s);
    }
    // "<Org>, founded by A" → person tied to the org named in the same sentence
    for (const m of s.matchAll(new RegExp(`((?:[A-Z][\\w'’&.]+\\s){1,5}(?:Montessori|School|Academy|Garments|Exports|Textiles|Boutique|Trust|Foundation)),\\s+(?:co-?)?(?:founded|run|owned|managed)\\s+by\\s+(${NAME})`, "g"))) {
      const name = cleanName(m[2]);
      if (name) {
        const existing = out.find((p) => p.name === name);
        if (existing && !existing.orgName) existing.orgName = m[1].trim();
      }
    }
    // "<Org> was (co-)founded by A and B" → both tied to the org named as the subject
    for (const m of s.matchAll(new RegExp(`((?:[A-Z][\\w'’&.]+\\s){0,4}[A-Z][\\w'’&.]+)\\s+(?:was|is)\\s+(?:${ci("co")}-?)?(?:${ci("founded")}|${ci("started")}|${ci("established")}|${ci("owned")}|${ci("run")}|${ci("managed")})\\s+by\\s+(${NAME})(?:\\s*(?:and|&)\\s*(${NAME}))?`, "g"))) {
      const org = m[1].trim();
      if (!ORG_WORD.test(org) && org.split(/\s+/).length < 2) continue;
      for (const raw of [m[2], m[3]]) {
        const name = raw ? cleanName(raw) : null;
        const existing = name ? out.find((p) => p.name === name) : undefined;
        if (existing && !existing.orgName) existing.orgName = org;
      }
    }
    // "A, Founder" / "A – Principal" / "A (Director)"
    for (const m of s.matchAll(new RegExp(`(${NAME})\\s*(?:,|–|—|-|\\()\\s*(?:our\\s+)?(${ROLE_ALT})\\b`, "g"))) add(m[1], m[2], s);
    // "Founder: A" / "Principal A" / "Founder & Principal: A"
    for (const m of s.matchAll(new RegExp(`\\b(${ROLE_ALT})(?:\\s*(?:&|and)\\s*(?:${ROLE_ALT}))?\\s*[:\\-–]?\\s+(${NAME})`, "g"))) add(m[2], m[1], s);
  }
  return out;
}

const ADDRESS_HINT = /(road|rd\.|street|st\.|salai|nagar|avenue|lane|colony|main|cross|layout|block|sector|phase|floor|building|complex|plot|no\.)/i;

export function extractAddresses(text: string): { text: string; city?: string; postalCode?: string }[] {
  const out: { text: string; city?: string; postalCode?: string }[] = [];
  for (const s of text.split(/\n+/).flatMap((l) => l.split(/(?<=[a-z0-9]{3}\.)\s+(?=[A-Z0-9])/))) {
    const pin = s.match(/\b([1-9]\d{2}\s?\d{3})\b/);
    if (!pin || !ADDRESS_HINT.test(s)) continue;
    const city = PLACES.find((p) => [p.city, ...(p.aliases ?? [])].some((c) => new RegExp(`\\b${c}\\b`, "i").test(s)))?.city;
    const t = s.replace(/^.*?\b(address|our address|visit us|location|office)\s*[:\-–]\s*/i, "").replace(/\.$/, "").trim().slice(0, 300);
    if (!out.some((a) => a.text === t)) out.push({ text: t, city, postalCode: pin[1].replace(/\s/g, "") });
  }
  return out;
}

// ---------------------------------------------------------------------------

interface JsonLdNode {
  "@type"?: string | string[];
  [k: string]: unknown;
}

function jsonLdNodes(html: string): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as JsonLdNode;
      if (o["@type"]) nodes.push(o);
      if (Array.isArray(o["@graph"])) (o["@graph"] as unknown[]).forEach(walk);
    }
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1].trim()));
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  return nodes;
}

const typesOf = (n: JsonLdNode) => (Array.isArray(n["@type"]) ? (n["@type"] as string[]) : [String(n["@type"] ?? "")]);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function extractPage(html: string, pageUrl: string): PageExtraction {
  const text = normalizeContent(html.replace(/<\/(nav|header|footer|section|article|aside|ul|ol|table|form)>/gi, "</p>"));
  const sents = sentences(text);
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim()) || meta(html, "og:title");
  const description = meta(html, "description") || meta(html, "og:description");
  const siteName = meta(html, "og:site_name");
  const canonicalTag = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i)?.[0];
  const canonical = canonicalTag ? absolutise(attr(canonicalTag, "href") ?? "", pageUrl) : null;
  let publishedAt: string | null = meta(html, "article:published_time") || html.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1] || null;

  const organisations: ExtractedOrg[] = [];
  const people: ExtractedPerson[] = [];
  const contacts: ExtractedContact[] = [];
  const facts: ExtractedFact[] = [];
  const addContact = (c: ExtractedContact) => {
    if (!contacts.some((x) => x.kind === c.kind && x.normalized === c.normalized)) contacts.push(c);
  };

  // --- structured data (JSON-LD)
  for (const n of jsonLdNodes(html)) {
    const types = typesOf(n);
    const tj = types.join(" ").toLowerCase();
    const snippet = `JSON-LD ${types.join("/")}: ${JSON.stringify(n).slice(0, 360)}`;
    if (/article|newsarticle|blogposting/.test(tj) && !publishedAt) publishedAt = str(n.datePublished) || null;
    if (/organization|business|store|school|preschool|educational|corporation/.test(tj)) {
      const name = str(n.name);
      if (name) organisations.push({ name, kind: orgKind(name, types), from: "jsonld", website: str(n.url) || undefined, passage: snippet });
      const tel = str(n.telephone);
      if (tel) addContact({ kind: "phone", value: tel, normalized: normalizePhone(tel, "India").e164 ?? tel, passage: snippet, fromStructuredData: true });
      const email = str(n.email).replace(/^mailto:/, "");
      if (email) addContact({ kind: "email", value: email, normalized: email.toLowerCase(), passage: snippet, fromStructuredData: true });
      const addr = n.address as Record<string, unknown> | undefined;
      if (addr && typeof addr === "object") {
        const full = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode, addr.addressCountry].map(str).filter(Boolean).join(", ");
        if (full) addContact({ kind: "address", value: full, normalized: full.toLowerCase(), passage: snippet, fromStructuredData: true });
      }
      for (const same of ([] as unknown[]).concat(n.sameAs ?? [])) if (typeof same === "string") addContact({ kind: "social", value: same, normalized: same.toLowerCase(), passage: snippet, fromStructuredData: true });
      const founding = str(n.foundingDate).match(/\b(19|20)\d{2}\b/)?.[0];
      if (founding) facts.push({ predicate: "established_in_year", value: founding, passage: snippet });
      for (const f of ([] as unknown[]).concat(n.founder ?? [])) {
        const fname = typeof f === "string" ? f : str((f as Record<string, unknown>)?.name);
        if (fname && name) people.push({ name: fname, role: "Founder", predicate: "founded", orgName: name, passage: snippet });
      }
    }
  }

  // --- unstructured org signals
  if (siteName) organisations.push({ name: siteName, kind: orgKind(siteName), from: "site_name", passage: `og:site_name "${siteName}"` });
  const titleHead = title.split(/\s[|–—-]\s/)[0]?.trim();
  const isRoot = (() => {
    try {
      return new URL(pageUrl).pathname.replace(/\/+$/, "") === "";
    } catch {
      return false;
    }
  })();
  if (isRoot && titleHead && (SCHOOL_RE.test(titleHead) || BUSINESS_RE.test(titleHead)) && !organisations.some((o) => o.name.toLowerCase() === titleHead.toLowerCase())) {
    organisations.push({ name: titleHead, kind: orgKind(titleHead), from: "title", passage: `Page title: ${title}` });
  }
  // Short business/school heading on a non-article page (e.g. a directory listing)
  const h1 = decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  if (h1 && !/<article/i.test(html) && h1.split(" ").length <= 5 && !/^\d|^(five|top|best|\d+)\b/i.test(h1) && (SCHOOL_RE.test(h1) || BUSINESS_RE.test(h1)) && !organisations.some((o) => o.name.toLowerCase() === h1.toLowerCase())) {
    organisations.push({ name: h1, kind: orgKind(h1), from: "text", passage: `Heading: ${h1}` });
  }
  const primaryOrg = organisations[0]?.name;

  // --- people with publicly documented roles
  for (const p of extractPeople(text, primaryOrg)) if (!people.some((x) => x.name === p.name && x.role === p.role)) people.push(p);

  // --- links, emails, phones, whatsapp, social
  const links: ExtractedLink[] = [];
  const socialProfiles: PageExtraction["socialProfiles"] = [];
  const host = (() => {
    try {
      return new URL(pageUrl).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1], "href");
    if (!href) continue;
    const anchor = decode(m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 120);
    if (/^mailto:/i.test(href)) {
      const e = href.replace(/^mailto:/i, "").split("?")[0];
      addContact({ kind: "email", value: e, normalized: e.toLowerCase(), passage: passageFor(sents, e) || `mailto link "${anchor}"`, fromStructuredData: false });
      continue;
    }
    if (/^tel:/i.test(href)) {
      const t = href.replace(/^tel:/i, "");
      addContact({ kind: "phone", value: t, normalized: normalizePhone(t, "India").e164 ?? t, passage: `tel link "${anchor || t}"`, fromStructuredData: false });
      continue;
    }
    const abs = absolutise(href, pageUrl);
    if (!abs) continue;
    if (/(^|\.)wa\.me\/|api\.whatsapp\.com\/send/i.test(abs)) {
      const num = abs.match(/wa\.me\/(\d+)/)?.[1] ?? new URL(abs).searchParams.get("phone") ?? "";
      addContact({ kind: "whatsapp", value: abs, normalized: num ? `+${num.replace(/^\+/, "")}` : abs, passage: `WhatsApp link "${anchor || abs}"`, fromStructuredData: false });
      continue;
    }
    const prof = parseProfileUrl(abs) ?? (/facebook\.com\/[^/?#]+/i.test(abs) ? { platform: "facebook" as const, handle: abs.split("facebook.com/")[1].split(/[/?#]/)[0].toLowerCase(), url: abs } : undefined);
    if (prof && !socialProfiles.some((s) => s.url === prof.url)) socialProfiles.push({ platform: prof.platform, handle: prof.handle, url: prof.url, passage: `Link "${anchor || prof.url}" on ${host}` });
    const linkHost = new URL(abs).hostname.replace(/^www\./, "");
    if (!links.some((l) => l.url === abs)) links.push({ url: abs, text: anchor, rel: linkHost === host ? "internal" : "external" });
  }
  for (const e of text.match(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi) ?? []) {
    if (/\.(png|jpe?g|gif|svg|webp)$/i.test(e)) continue;
    addContact({ kind: "email", value: e, normalized: e.toLowerCase(), passage: passageFor(sents, e), fromStructuredData: false });
  }
  for (const p of findPhones(text, "India")) addContact({ kind: "phone", value: p, normalized: p, passage: passageFor(sents, p.slice(-6)), fromStructuredData: false });
  for (const a of extractAddresses(text)) addContact({ kind: "address", value: a.text, normalized: a.text.toLowerCase(), passage: a.text, fromStructuredData: false });

  // --- facts
  for (const m of text.matchAll(/\b(?:established|founded|started|since)\s+(?:in\s+)?((?:19|20)\d{2})\b/gi)) {
    if (!facts.some((f) => f.predicate === "established_in_year" && f.value === m[1])) facts.push({ predicate: "established_in_year", value: m[1], passage: passageFor(sents, m[0]) });
  }

  const localities = Array.from(new Set(PLACES.filter((p) => [p.city, ...(p.aliases ?? [])].some((c) => new RegExp(`\\b${c}\\b`, "i").test(text))).map((p) => p.city)));

  return { title, description, siteName, canonical, publishedAt, text: text.slice(0, 60_000), organisations, people, contacts, socialProfiles, links: links.slice(0, 200), facts, localities };
}

/** Link-following priority (web-scout-ai crawler heuristic): about/contact/team pages first. */
export function linkPriority(link: ExtractedLink): number {
  const s = `${link.url} ${link.text}`.toLowerCase();
  if (link.rel !== "internal") return 0;
  if (/(contact|reach-us|locations?|branches|find-us)/.test(s)) return 90;
  if (/(about|who-we-are|our-story|history)/.test(s)) return 85;
  if (/(team|leadership|management|founders?|people|staff|faculty|principal|administration)/.test(s)) return 85;
  if (/(services|products|collections|programs?|admissions|curriculum)/.test(s)) return 50;
  if (/(news|announcements|press|events|blog)/.test(s)) return 45;
  if (/(privacy|terms|cookie|login|signin|cart|checkout|wp-admin|feed|\.(pdf|jpg|png|zip)$)/.test(s)) return 0;
  return 20;
}
