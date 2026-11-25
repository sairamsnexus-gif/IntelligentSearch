/**
 * Exact-name preservation + spelling, phonetic and regional-script variants.
 * Variants are SEARCH CANDIDATES only — never evidence of identity.
 */
import type { NameClue, NameVariant } from "./schema";

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const matchCase = (src: string, out: string) => (src[0] && src[0] === src[0].toUpperCase() ? cap(out) : out);

/** Rule-based Latin spelling/phonetic variants for one name token. */
export function latinVariants(token: string): { text: string; method: string }[] {
  const t = token.toLowerCase();
  const out: { text: string; method: string }[] = [];
  const add = (v: string, method: string) => {
    if (v && v !== t && !out.some((o) => o.text.toLowerCase() === v)) out.push({ text: matchCase(token, v), method });
  };
  // s ↔ sh before a vowel at the start (Siva ↔ Shiva)
  if (/^s[aeiou]/.test(t)) add(`sh${t.slice(1)}`, "phonetic: s→sh");
  if (/^sh[aeiou]/.test(t)) add(`s${t.slice(2)}`, "phonetic: sh→s");
  // long final vowel (Siva → Sivaa)
  if (/[aeiou]$/.test(t) && !/([aeiou])\1$/.test(t)) add(`${t}${t.at(-1)}`, "spelling: doubled final vowel");
  if (/([aeiou])\1$/.test(t)) add(t.slice(0, -1), "spelling: single final vowel");
  // final -a ↔ -ah (Asma → Asmah)
  if (/[^h]a$/.test(t)) add(`${t}h`, "spelling: -a → -ah");
  if (/ah$/.test(t)) add(t.slice(0, -1), "spelling: -ah → -a");
  // i ↔ ee (Siva → Seeva), u ↔ oo
  if (/[^e]i[^aeiou]/.test(t)) add(t.replace(/i(?=[^aeiou])/, "ee"), "phonetic: i→ee");
  if (/ee/.test(t)) add(t.replace("ee", "i"), "phonetic: ee→i");
  if (/[^o]u[^aeiou]/.test(t)) add(t.replace(/u(?=[^aeiou])/, "oo"), "phonetic: u→oo");
  // v ↔ w
  if (/v/.test(t)) add(t.replace(/v/g, "w"), "phonetic: v→w");
  // th ↔ t, dh ↔ d
  if (/th/.test(t)) add(t.replace(/th/g, "t"), "phonetic: th→t");
  else if (/t(?!h)/.test(t)) add(t.replace(/t(?!h)/, "th"), "phonetic: t→th");
  if (/dh/.test(t)) add(t.replace(/dh/g, "d"), "phonetic: dh→d");
  // z ↔ s (Asma ↔ Azma)
  if (/[aeiou]s[^h]/.test(t)) add(t.replace(/([aeiou])s(?=[^h])/, "$1z"), "phonetic: s→z");
  return out.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Transliteration: romanised Indian names → Tamil / Devanagari script.

type Unit = { c?: string; v?: string };

const CONS = ["ksh", "ng", "nj", "ch", "sh", "th", "dh", "zh", "kh", "gh", "ph", "bh", "k", "g", "c", "j", "t", "d", "n", "p", "b", "m", "y", "r", "l", "v", "w", "s", "h", "f", "z", "x", "q"];
const VOW = ["aa", "ee", "ii", "oo", "uu", "ai", "au", "ae", "a", "i", "u", "e", "o"];

function tokenise(word: string): Unit[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  const units: Unit[] = [];
  let i = 0;
  while (i < w.length) {
    const c = CONS.find((x) => w.startsWith(x, i));
    if (c) {
      i += c.length;
      const v = VOW.find((x) => w.startsWith(x, i));
      if (v) i += v.length;
      units.push({ c, v });
      continue;
    }
    const v = VOW.find((x) => w.startsWith(x, i));
    if (v) {
      i += v.length;
      units.push({ v });
      continue;
    }
    i++;
  }
  return units;
}

const TA_VOWEL: Record<string, string> = { a: "அ", aa: "ஆ", i: "இ", ee: "ஈ", ii: "ஈ", u: "உ", oo: "ஊ", uu: "ஊ", e: "எ", ae: "ஏ", ai: "ஐ", o: "ஒ", au: "ஔ" };
const TA_SIGN: Record<string, string> = { a: "", aa: "ா", i: "ி", ee: "ீ", ii: "ீ", u: "ு", oo: "ூ", uu: "ூ", e: "ெ", ae: "ே", ai: "ை", o: "ொ", au: "ௌ" };
const TA_CONS: Record<string, string> = { k: "க", g: "க", kh: "க", gh: "க", ng: "ங", ch: "ச", c: "ச", j: "ஜ", nj: "ஞ", t: "ட", d: "ட", th: "த", dh: "த", n: "ன", p: "ப", b: "ப", ph: "ப", bh: "ப", f: "ஃப", m: "ம", y: "ய", r: "ர", l: "ல", v: "வ", w: "வ", zh: "ழ", sh: "ஷ", s: "ஸ", h: "ஹ", z: "ஸ", ksh: "க்ஷ", x: "க்ஸ", q: "க" };
const TA_VIRAMA = "்";

const DE_VOWEL: Record<string, string> = { a: "अ", aa: "आ", i: "इ", ee: "ई", ii: "ई", u: "उ", oo: "ऊ", uu: "ऊ", e: "ए", ae: "ए", ai: "ऐ", o: "ओ", au: "औ" };
const DE_SIGN: Record<string, string> = { a: "", aa: "ा", i: "ि", ee: "ी", ii: "ी", u: "ु", oo: "ू", uu: "ू", e: "े", ae: "े", ai: "ै", o: "ो", au: "ौ" };
const DE_CONS: Record<string, string> = { k: "क", kh: "ख", g: "ग", gh: "घ", ng: "ङ", ch: "च", c: "च", j: "ज", nj: "ञ", t: "ट", d: "ड", th: "त", dh: "ध", n: "न", p: "प", ph: "फ", f: "फ़", b: "ब", bh: "भ", m: "म", y: "य", r: "र", l: "ल", v: "व", w: "व", sh: "श", s: "स", h: "ह", z: "ज़", zh: "ळ", ksh: "क्ष", x: "क्स", q: "क" };
const DE_VIRAMA = "्";

export function toTamil(word: string, opts: { nativeInitialS?: boolean } = {}): string {
  const units = tokenise(word);
  let out = "";
  units.forEach((u, idx) => {
    const last = idx === units.length - 1;
    if (!u.c) {
      out += TA_VOWEL[u.v!] ?? "";
      return;
    }
    let cons = TA_CONS[u.c] ?? "";
    // Native Tamil uses ச for an initial s (Siva → சிவா); medial s stays grantha ஸ (Asma → அஸ்மா).
    if (u.c === "s" && idx === 0 && opts.nativeInitialS !== false) cons = "ச";
    // Initial n is ந, medial/final ன.
    if (u.c === "n" && idx === 0) cons = "ந";
    if (!u.v) {
      out += cons + TA_VIRAMA;
      return;
    }
    const v = last && u.v === "a" ? "aa" : u.v; // names: final a rendered long (சிவா)
    out += cons + (TA_SIGN[v] ?? "");
  });
  return out;
}

export function toDevanagari(word: string): string {
  const units = tokenise(word);
  let out = "";
  units.forEach((u, idx) => {
    const last = idx === units.length - 1;
    if (!u.c) {
      out += DE_VOWEL[u.v!] ?? "";
      return;
    }
    const cons = DE_CONS[u.c] ?? "";
    if (!u.v) {
      out += last ? cons : cons + DE_VIRAMA;
      return;
    }
    const v = last && u.v === "a" ? "aa" : u.v;
    out += cons + (DE_SIGN[v] ?? "");
  });
  return out;
}

/** Scripts worth generating for the clue's region. */
export function scriptsForPlaces(places: string[]): ("tamil" | "devanagari")[] {
  const p = places.join(" ").toLowerCase();
  const tamil = /(chennai|madras|tamil|coimbatore|madurai|trichy|tiruchirappalli|salem|tirunelveli|vellore|erode|tiruppur|puducherry|pondicherry)/.test(p);
  const hindi = /(delhi|noida|gurgaon|gurugram|lucknow|jaipur|bhopal|patna|kanpur|varanasi|indore|uttar|madhya|rajasthan|bihar|haryana)/.test(p);
  const out: ("tamil" | "devanagari")[] = [];
  if (tamil) out.push("tamil");
  if (hindi) out.push("devanagari");
  if (!out.length && /india/.test(p)) out.push("tamil", "devanagari");
  return out;
}

export function buildNameClue(original: string, places: string[], idFor: () => string): NameClue {
  const exact = original.trim().replace(/\s+/g, " ");
  const variants: NameVariant[] = [{ text: exact, method: "exact user input (preserved)", script: "latin", isOriginal: true }];
  const tokens = exact.split(" ");
  const push = (text: string, method: string, script: NameVariant["script"]) => {
    if (text && !variants.some((v) => v.text === text)) variants.push({ text, method, script, isOriginal: false });
  };
  // Per-token Latin variants (vary one token at a time to keep the set bounded)
  tokens.forEach((tok, i) => {
    for (const v of latinVariants(tok)) {
      const t = [...tokens];
      t[i] = v.text;
      push(t.join(" "), v.method, "latin");
    }
  });
  for (const script of scriptsForPlaces(places)) {
    if (script === "tamil") {
      push(tokens.map((t) => toTamil(t)).join(" "), "transliteration: Tamil script", "tamil");
      if (tokens.some((t) => /^s[aeiou]/i.test(t))) push(tokens.map((t) => toTamil(t, { nativeInitialS: false })).join(" "), "transliteration: Tamil script (grantha ஸ)", "tamil");
    }
    if (script === "devanagari") push(tokens.map((t) => toDevanagari(t)).join(" "), "transliteration: Devanagari script", "devanagari");
  }
  return { id: idFor(), original: exact, variants: variants.slice(0, 18) };
}

/** Pair combinations "A B" / "B A" using originals first, then top Latin variants. */
export function nameCombinations(clues: NameClue[], limit = 8): { text: string; method: string }[] {
  if (clues.length < 2) return [];
  const out: { text: string; method: string; rank: number }[] = [];
  const pick = (c: NameClue) => c.variants.filter((v) => v.script === "latin").slice(0, 3);
  for (let i = 0; i < clues.length; i++)
    for (let j = 0; j < clues.length; j++) {
      if (i === j) continue;
      for (const a of pick(clues[i]))
        for (const b of pick(clues[j])) {
          const text = `${a.text} ${b.text}`;
          const rank = Number(!a.isOriginal) + Number(!b.isOriginal);
          if (!out.some((o) => o.text === text)) out.push({ text, method: rank === 0 ? "combination of exact names" : "combination incl. variant", rank });
        }
    }
  return out
    .sort((x, y) => x.rank - y.rank)
    .slice(0, limit)
    .map(({ text, method }) => ({ text, method }));
}

const PLACE_SCRIPT: Record<string, { tamil?: string; devanagari?: string }> = {
  chennai: { tamil: "சென்னை", devanagari: "चेन्नई" },
  coimbatore: { tamil: "கோயம்புத்தூர்" },
  madurai: { tamil: "மதுரை" },
  delhi: { devanagari: "दिल्ली" },
  mumbai: { devanagari: "मुंबई" },
};

export function placeInScript(place: string, script: "tamil" | "devanagari"): string | undefined {
  return PLACE_SCRIPT[place.toLowerCase()]?.[script];
}

/** True when `text` contains the exact name or any of its variants. */
export function matchName(clue: NameClue, haystack: string): NameVariant | undefined {
  const h = ` ${haystack.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")} `;
  return clue.variants.find((v) => h.includes(` ${v.text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim()} `));
}
