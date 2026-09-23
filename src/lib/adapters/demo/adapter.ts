import "server-only";
/**
 * DEMO adapter — answers every channel from the fictional corpus with
 * query-driven matching, so the planner → discovery → resolution → monitoring
 * pipeline behaves realistically with zero API keys. All results are flagged
 * isDemo and labelled DEMO DATA in the UI.
 */
import { BaseAdapter } from "../base";
import type { AdapterCapabilities, AdapterContext, CheckResult } from "../types";
import { health, makeResult, sleep } from "../http";
import { DEMO_DOCS, docVersion, findDemoDoc, type DemoDoc } from "./corpus";
import { norm } from "@/lib/core/text";
import type { PlannedQuery, SearchResult } from "@/lib/core/types";

interface ParsedQuery {
  phrases: string[];
  words: string[];
  site?: string;
  filetype?: string;
}

export function parseDemoQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { phrases: [], words: [] };
  const re = /(\w+):("([^"]+)"|\S+)|"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    if (m[1]) {
      const val = (m[3] ?? m[2]).toLowerCase();
      if (m[1].toLowerCase() === "site") out.site = val;
      else if (m[1].toLowerCase() === "filetype") out.filetype = val;
      else out.words.push(`${m[1]}:${val}`);
    } else if (m[4]) out.phrases.push(norm(m[4]));
    else if (m[5]) out.words.push(norm(m[5]));
  }
  return out;
}

function visible(doc: DemoDoc, epoch: number): boolean {
  if ((doc.availableFrom ?? 0) > epoch) return false;
  return docVersion(doc, epoch) !== null;
}

export function demoMatches(doc: DemoDoc, pq: ParsedQuery, epoch: number): boolean {
  const text = docVersion(doc, epoch);
  if (text === null) return false;
  const hay = ` ${norm(`${doc.title} ${text} ${doc.url.replace(/[/:.@-]/g, " ")} ${doc.sourcePlatform}`)} `;
  if (pq.site && !doc.url.toLowerCase().includes(pq.site)) return false;
  if (pq.filetype && !doc.url.toLowerCase().endsWith(`.${pq.filetype}`)) return false;
  const needles = [...pq.phrases, ...pq.words].filter(Boolean);
  if (!needles.length) return false;
  return needles.every((n) => hay.includes(` ${n} `) || (n.length > 6 && hay.includes(n)));
}

export class DemoAdapter extends BaseAdapter {
  name = "demo";
  label = "Demo data";
  description = "Fictional corpus used when no real providers are configured. Clearly labelled DEMO DATA.";
  isDemo = true;
  isConfigured() {
    return true;
  }
  capabilities(): AdapterCapabilities {
    return {
      roles: ["search", "username", "monitor"],
      channels: ["web", "news", "github", "reddit", "youtube", "username", "images"],
      coverage: ["web", "news", "reddit", "github", "youtube", "username", "images", "documents"],
      cost: "local",
      requires: [],
    };
  }
  protected async probe() {
    return health("active", "Demo corpus loaded");
  }

  private toResult(doc: DemoDoc, query: string, epoch: number): SearchResult {
    const text = docVersion(doc, epoch) ?? "";
    return makeResult({
      query,
      sourceEngine: "demo",
      sourcePlatform: doc.sourcePlatform,
      url: doc.url,
      title: doc.title,
      description: text.slice(0, 220),
      contentText: text,
      name: doc.name ?? null,
      username: doc.username ?? null,
      publishedAt: doc.publishedAt ?? null,
      sourceType: doc.sourceType,
      rawMetadata: { demo: true, persona: doc.persona },
      isDemo: true,
    });
  }

  async search(q: PlannedQuery, ctx: AdapterContext): Promise<SearchResult[]> {
    await sleep(120 + Math.random() * 280); // make progress visible in the UI
    if (q.channel === "username") return this.searchUsername(q.handle ?? q.query, ctx);
    const pq = parseDemoQuery(q.query);
    // Platform APIs (github/reddit/youtube) behave like name searches on that platform.
    if (q.handle && (q.channel === "github" || q.channel === "reddit")) {
      return DEMO_DOCS.filter((d) => d.username === q.handle && d.channels.includes(q.channel) && visible(d, ctx.demoEpoch)).map((d) => this.toResult(d, q.query, ctx.demoEpoch));
    }
    return DEMO_DOCS.filter((d) => d.channels.includes(q.channel) && visible(d, ctx.demoEpoch) && demoMatches(d, pq, ctx.demoEpoch))
      .slice(0, 10)
      .map((d) => this.toResult(d, q.query, ctx.demoEpoch));
  }

  async searchUsername(username: string, ctx: AdapterContext): Promise<SearchResult[]> {
    const h = username.toLowerCase().replace(/^@/, "");
    return DEMO_DOCS.filter((d) => d.username === h && visible(d, ctx.demoEpoch)).map((d) => this.toResult(d, username, ctx.demoEpoch));
  }
  supportedPlatforms() {
    return ["demo"];
  }
  canMonitor(url: string) {
    return Boolean(findDemoDoc(url));
  }
  async check(url: string, ctx: AdapterContext): Promise<CheckResult> {
    await sleep(80);
    const doc = findDemoDoc(url);
    if (!doc) return { available: false, httpStatus: 404, contentText: "", method: "demo" };
    const text = docVersion(doc, ctx.demoEpoch);
    if (text === null) return { available: false, httpStatus: 404, contentText: "", method: "demo" };
    return { available: true, httpStatus: 200, title: doc.title, contentText: text, method: "demo" };
  }
}
