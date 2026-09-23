/** Minimal robots.txt support for direct public-web fetches (pure parser + cached fetcher). */

export interface RobotsRules {
  disallow: string[];
  allow: string[];
}

/** Parse rules for our UA group, falling back to "*". */
export function parseRobots(txt: string, ua = "intelligentsearchbot"): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "disallow" && val) cur.disallow.push(val);
    if (key === "allow" && val) cur.allow.push(val);
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== "*" && ua.includes(a))) ?? groups.find((g) => g.agents.includes("*"));
  return { disallow: mine?.disallow ?? [], allow: mine?.allow ?? [] };
}

function toRe(pattern: string): RegExp {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${esc.endsWith("\\$") ? esc.slice(0, -2) + "$" : esc}`);
}

/** Longest-match wins; Allow beats Disallow on equal length (Google semantics). */
export function isAllowed(rules: RobotsRules, path: string): boolean {
  let best: { len: number; allow: boolean } | null = null;
  for (const d of rules.disallow) if (toRe(d).test(path) && (!best || d.length > best.len)) best = { len: d.length, allow: false };
  for (const a of rules.allow) if (toRe(a).test(path) && (!best || a.length >= best.len)) best = { len: a.length, allow: true };
  return best ? best.allow : true;
}
