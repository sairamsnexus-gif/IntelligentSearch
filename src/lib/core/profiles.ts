/** Social-profile URL parsing and identifier normalisation (pure). */
import type { Platform, ProfileRef } from "./types";

const RESERVED: Record<string, Set<string>> = {
  instagram: new Set(["p", "reel", "reels", "explore", "stories", "accounts", "tv"]),
  x: new Set(["home", "search", "i", "intent", "share", "hashtag", "explore", "settings"]),
  github: new Set(["orgs", "topics", "search", "features", "about", "pricing", "login", "marketplace", "sponsors", "settings", "explore"]),
  facebook: new Set(["pages", "groups", "events", "watch", "sharer", "sharer.php", "login", "profile.php"]),
  youtube: new Set(["watch", "results", "feed", "playlist", "shorts"]),
};

const PATTERNS: { platform: Platform; re: RegExp; canonical: (h: string) => string }[] = [
  { platform: "linkedin", re: /^(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([^/?#]+)/i, canonical: (h) => `https://www.linkedin.com/in/${h}` },
  { platform: "instagram", re: /^instagram\.com\/([^/?#]+)/i, canonical: (h) => `https://www.instagram.com/${h}` },
  { platform: "facebook", re: /^(?:m\.)?facebook\.com\/([^/?#]+)/i, canonical: (h) => `https://www.facebook.com/${h}` },
  { platform: "x", re: /^(?:x|twitter)\.com\/([^/?#]+)/i, canonical: (h) => `https://x.com/${h}` },
  { platform: "youtube", re: /^youtube\.com\/(?:@([^/?#]+)|c\/([^/?#]+)|user\/([^/?#]+)|channel\/([^/?#]+))/i, canonical: (h) => `https://www.youtube.com/@${h}` },
  { platform: "github", re: /^github\.com\/([^/?#]+)\/?$/i, canonical: (h) => `https://github.com/${h}` },
  { platform: "reddit", re: /^(?:old\.)?reddit\.com\/(?:u|user)\/([^/?#]+)/i, canonical: (h) => `https://www.reddit.com/user/${h}` },
];

export function normalizeHandle(h: string): string {
  return decodeURIComponent(h).trim().replace(/^@/, "").replace(/\/+$/, "").toLowerCase();
}

/** If `url` is a profile page on a known platform, return it. */
export function parseProfileUrl(url: string): ProfileRef | undefined {
  let s = url.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return undefined;
  }
  const hostPath = `${u.hostname.replace(/^www\./i, "")}${u.pathname}`;
  for (const p of PATTERNS) {
    const m = hostPath.match(p.re);
    if (!m) continue;
    const raw = m.slice(1).find(Boolean);
    if (!raw) continue;
    const handle = normalizeHandle(raw);
    if (!handle || RESERVED[p.platform]?.has(handle)) return undefined;
    return { platform: p.platform, handle, url: p.canonical(handle) };
  }
  return undefined;
}

/**
 * Accepts whatever a user typed for a platform (URL, @handle, bare handle)
 * and returns a normalised ProfileRef.
 */
export function profileFromInput(platform: Platform, input: string): ProfileRef | undefined {
  const v = input.trim();
  if (!v) return undefined;
  if (/[./]/.test(v) && /\.(com|in)\b/i.test(v)) {
    const parsed = parseProfileUrl(v);
    if (parsed && (parsed.platform === platform || platform === "other_social")) return parsed;
    if (platform === "other_social") return { platform, handle: v.toLowerCase(), url: v.startsWith("http") ? v : `https://${v}` };
    return undefined;
  }
  const handle = normalizeHandle(v);
  if (!/^[a-z0-9._-]{1,60}$/i.test(handle)) return undefined;
  const pat = PATTERNS.find((p) => p.platform === platform);
  return { platform, handle, url: pat ? pat.canonical(handle) : "" };
}

const URL_RE = /\bhttps?:\/\/[^\s"'<>()]+|\b(?:www\.)?(?:linkedin\.com\/in|instagram\.com|github\.com|x\.com|twitter\.com|youtube\.com\/@|reddit\.com\/u(?:ser)?|facebook\.com)\/?[^\s"'<>()]*/gi;

export function extractUrls(text: string): string[] {
  return Array.from(new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, ""))));
}

export function extractProfiles(text: string): ProfileRef[] {
  const out = new Map<string, ProfileRef>();
  for (const u of extractUrls(text)) {
    const p = parseProfileUrl(u);
    if (p) out.set(`${p.platform}:${p.handle}`, p);
  }
  return Array.from(out.values());
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X / Twitter",
  youtube: "YouTube",
  github: "GitHub",
  reddit: "Reddit",
  other_social: "Other social",
};

export const PLATFORM_SITE: Record<Platform, string | undefined> = {
  linkedin: "linkedin.com",
  instagram: "instagram.com",
  facebook: "facebook.com",
  x: "x.com",
  youtube: "youtube.com",
  github: "github.com",
  reddit: "reddit.com",
  other_social: undefined,
};
