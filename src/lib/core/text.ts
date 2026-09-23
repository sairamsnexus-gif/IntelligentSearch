/** Text + name normalisation primitives (pure). */

export function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Lower-case, strip diacritics/punctuation, collapse whitespace. */
export function norm(s: string | null | undefined): string {
  if (!s) return "";
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.+#\s-]/gu, " ")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string): string[] {
  return norm(s).split(" ").filter(Boolean);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-phrase, case/diacritic-insensitive containment on normalised text. */
export function containsPhrase(haystackNorm: string, phrase: string): boolean {
  const p = norm(phrase);
  if (!p) return false;
  return new RegExp(`(^|\\s)${escapeRegExp(p)}(\\s|$)`).test(haystackNorm);
}

export function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

export interface NameVariant {
  value: string;
  kind: "full" | "initial_first" | "initial_last" | "joined" | "reversed";
}

/**
 * Name variations used both for query generation and for detecting that a
 * document mentions the target. "Rajesh Kumar" →
 * Rajesh Kumar, R Kumar, Rajesh K, Rajeshkumar, Kumar Rajesh.
 */
export function nameVariants(fullName: string): NameVariant[] {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const out: NameVariant[] = [{ value: parts.join(" "), kind: "full" }];
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    out.push({ value: `${first} ${last[0].toUpperCase()}`, kind: "initial_last" });
    out.push({ value: `${first[0].toUpperCase()} ${last}`, kind: "initial_first" });
    out.push({ value: parts.join(""), kind: "joined" });
    out.push({ value: [...parts].reverse().join(" "), kind: "reversed" });
  }
  const seen = new Set<string>();
  return out.filter((v) => {
    const k = norm(v.value);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export type NameMatchLevel = "exact" | "variant" | "none";

/**
 * Does `candidate` refer to the same *name* as `target`? Never implies same person.
 * exact: identical tokens. variant: initials / joined / middle-name tolerant.
 */
export function compareNames(target: string, candidate: string): NameMatchLevel {
  const t = tokens(target);
  const c = tokens(candidate);
  if (!t.length || !c.length) return "none";
  if (t.join(" ") === c.join(" ")) return "exact";
  if (t.join("") === c.join("")) return "variant";
  const tFirst = t[0];
  const tLast = t[t.length - 1];
  const cFirst = c[0];
  const cLast = c[c.length - 1];
  const tokEq = (a: string, b: string) => a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b));
  // first+last with optional middle names/initials in between
  if (tokEq(tFirst, cFirst) && tokEq(tLast, cLast) && (tFirst.length > 1 || cFirst.length > 1) && (tLast.length > 1 || cLast.length > 1)) {
    return "variant";
  }
  // reversed order (common for South-Indian naming)
  if (tokEq(tFirst, cLast) && tokEq(tLast, cFirst) && t.length === c.length) return "variant";
  return "none";
}

/** Returns the variant string found in text, if any. Full name preferred. */
export function findNameInText(fullName: string, textNorm: string): string | undefined {
  const variants = nameVariants(fullName);
  for (const v of variants) {
    // initials-only variants are too weak to count as a hit on their own
    if (v.kind === "initial_first" || v.kind === "initial_last") continue;
    if (containsPhrase(textNorm, v.value)) return v.value;
  }
  // tolerate a middle name/initial between first and last: "Rajesh K Kumar"
  const parts = tokens(fullName);
  if (parts.length >= 2) {
    const re = new RegExp(`(^|\\s)${escapeRegExp(parts[0])}(\\s\\S{1,12}){0,1}\\s${escapeRegExp(parts[parts.length - 1])}(\\s|$)`);
    const m = textNorm.match(re);
    if (m) return m[0].trim();
  }
  return undefined;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
