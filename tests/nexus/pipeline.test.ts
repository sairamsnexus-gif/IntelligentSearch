/**
 * End-to-end NEXUS pipeline over the SYNTHETIC world (clearly labelled fictional
 * data — no real people, businesses or websites). Request under test:
 *   "Find Asma and Siva in Chennai. They may be running a garments business.
 *    Asma may also be associated with a Montessori school."
 */
import { describe, expect, it, beforeAll } from "vitest";
import { parseClues } from "@/lib/nexus/clues";
import { createInvestigation, ENGINE_IDS, type Investigation, type EngineId } from "@/lib/nexus/schema";
import { InvestigationRunner, requeueQuotaTasks, type Executor } from "@/lib/nexus/orchestrator";
import { executeSynthetic } from "@/lib/nexus/synthetic-exec";
import { candidateMatches, reconcile } from "@/lib/nexus/analysis";
import { exportInvestigation, importInvestigation } from "@/lib/nexus/io";
import { setDecision } from "@/lib/nexus/ledger";

const REQUEST = "Find Asma and Siva in Chennai. They may be running a garments business. Asma may also be associated with a Montessori school.";
const noDelay = async () => {};

function newInv(settings: Partial<Investigation["settings"]> = {}) {
  const inv = createInvestigation(REQUEST, parseClues(REQUEST), { synthetic: true, ...settings });
  inv.synthetic = true;
  return inv;
}

async function runAll(inv: Investigation, executor: Executor = async (r) => executeSynthetic(r), available: Set<EngineId> = new Set(ENGINE_IDS)) {
  let cur = inv;
  const runner = new InvestigationRunner({ get: () => cur, set: (n) => (cur = n), executor, available, pollDelayMs: noDelay });
  await runner.run();
  return cur;
}

const ent = (inv: Investigation, id: string) => inv.entities.find((e) => e.id === id)!;
const rel = (inv: Investigation, subj: string, pred: string, obj: string) =>
  inv.relationships.filter((r) => ent(inv, r.subjectId).name === subj && r.predicate === pred && ent(inv, r.objectId).name === obj);

describe("NEXUS pipeline (synthetic world)", () => {
  let inv: Investigation;
  beforeAll(async () => {
    inv = await runAll(newInv());
  });

  it("completes with an explicit stop reason and every task resolved", () => {
    expect(inv.status).toBe("completed");
    expect(inv.stopReason).toBeTruthy();
    expect(inv.tasks.every((t) => !["queued", "running", "pending"].includes(t.status))).toBe(true);
    expect(inv.synthetic).toBe(true);
  });

  it("preserves the exact names and generates spelling + Tamil variants", () => {
    expect(inv.clues.names.map((n) => n.original)).toEqual(["Asma", "Siva"]);
    const siva = inv.clues.names.find((n) => n.original === "Siva")!;
    expect(siva.variants[0]).toMatchObject({ text: "Siva", isOriginal: true });
    const texts = siva.variants.map((v) => v.text);
    expect(texts).toEqual(expect.arrayContaining(["Shiva", "Sivaa", "Seeva", "சிவா"]));
    expect(inv.clues.names.find((n) => n.original === "Asma")!.variants.map((v) => v.text)).toEqual(expect.arrayContaining(["Asmah", "அஸ்மா"]));
    expect(inv.tasks.some((t) => t.input.query?.includes("அஸ்மா"))).toBe(true);
  });

  it("runs every engine and records independent per-engine work", () => {
    const engines = new Set(inv.tasks.map((t) => t.engine));
    for (const e of ENGINE_IDS) expect(engines.has(e)).toBe(true);
    const cov = reconcile(inv);
    expect(cov.byEngine.searxng.done).toBeGreaterThan(0);
    expect(cov.byEngine.page.pagesRead).toBeGreaterThan(5);
    expect(cov.severalEngines.length).toBeGreaterThan(0);
  });

  it("hands leads across engines (SpiderFoot affiliate domain → page read)", () => {
    const sf = inv.tasks.find((t) => t.engine === "spiderfoot" && t.input.domain === "sivasma-garments.example" && t.status === "done");
    expect(sf).toBeTruthy();
    const exportsSrc = inv.sources.find((s) => s.domain === "sivasma-exports.example");
    expect(exportsSrc?.fetch.status).toBe("read");
    expect(exportsSrc?.discoveredBy.map((d) => d.engine)).toContain("spiderfoot");
  });

  it("documents founders/roles with evidence passages and does not merge namesakes", () => {
    const founders = rel(inv, "Asma Siva", "founded", "Little Lotus Montessori");
    expect(founders.length).toBe(1);
    expect(founders[0].evidence.length).toBeGreaterThan(0);
    const p = inv.passages.find((x) => x.id === founders[0].evidence[0].passageId)!;
    expect(p.text).toMatch(/Asma Siva/);
    expect(rel(inv, "Siva Raman", "founded", "Sivasma Garments")[0]?.verification).toBe("primary_source");
    // Two "Asma Siva" records (garments vs school) stay separate until the user decides.
    expect(inv.entities.filter((e) => e.type === "person" && e.name === "Asma Siva").length).toBe(2);
    // Namesakes elsewhere are never attached to the Chennai businesses.
    expect(inv.entities.some((e) => e.name === "Asma Begum" && inv.relationships.some((r) => r.subjectId === e.id && ent(inv, r.objectId).name === "Sivasma Garments"))).toBe(false);
  });

  it("never infers a family or personal relationship", () => {
    const personal = inv.relationships.filter((r) => r.predicate === "documented_relationship");
    expect(personal).toHaveLength(0);
    const userHyp = inv.relationships.find((r) => r.provenance.engine === "user");
    expect(userHyp?.hypothesis).toBe(true);
    expect(userHyp?.verification).toBe("unverified_hypothesis");
  });

  it("attributes public contact points to organisations only", () => {
    expect(inv.contacts.length).toBeGreaterThan(0);
    for (const c of inv.contacts) expect(["business", "school", "organisation"]).toContain(ent(inv, c.entityId).type);
    expect(inv.contacts.some((c) => c.value.includes("info@sivasma-garments.example"))).toBe(true);
  });

  it("records the 2012 vs 2014 establishment-year contradiction", () => {
    const years = inv.claims.filter((c) => c.predicate === "established_in_year");
    expect(years.map((c) => c.object).sort()).toEqual(expect.arrayContaining(["2012", "2014"]));
    expect(years.some((c) => c.verification === "contradicted")).toBe(true);
    expect(years.every((c) => c.conflictsWith.length > 0 || c.verification === "contradicted" || c.object === "2014")).toBe(true);
  });

  it("collapses syndicated copies of one press release into a single copy group", () => {
    const copies = inv.sources.filter((s) => /newswire-a|chennai-business-news|textile-today/.test(s.domain) && s.fetch.status === "read");
    expect(copies.length).toBe(3);
    expect(new Set(copies.map((s) => s.copyGroup)).size).toBe(1);
  });

  it("respects robots.txt and records inaccessible pages without bypass", () => {
    const ig = inv.sources.filter((s) => s.domain === "instagram.com");
    expect(ig.length).toBeGreaterThan(0);
    for (const s of ig) expect(s.fetch.status).toBe("blocked_robots");
    expect(reconcile(inv).inaccessible.length).toBeGreaterThan(0);
  });

  it("treats Maigret username hits as weak indications only", () => {
    const u = inv.claims.filter((c) => c.predicate === "username_found_on");
    expect(u.length).toBeGreaterThan(0);
    for (const c of u) expect(c.verification).toBe("weak_indication");
  });

  it("isolates a SpiderFoot failure while other engines continue", () => {
    const failed = inv.tasks.find((t) => t.engine === "spiderfoot" && t.status === "failed");
    expect(failed?.input.domain).toBe("littlelotus-montessori.example");
    expect(inv.sources.some((s) => s.domain === "littlelotus-montessori.example" && s.fetch.status === "read")).toBe(true);
  });

  it("stops LLM assistance on the free-tier quota (429) and keeps the other engines running", () => {
    const q = inv.quota.find((x) => x.engine === "freellmapi");
    expect(q?.status).toBe(429);
    expect(q?.resumeAfter).toBeTruthy();
    const llmCallsAtQuota = inv.usage.llmCalls;
    expect(llmCallsAtQuota).toBeLessThanOrEqual(inv.settings.llm.maxCalls);
    expect(inv.status).toBe("completed");
    // LLM-assisted evidence is labelled, quoted verbatim and not treated as primary.
    const assisted = inv.relationships.filter((r) => r.provenance.assistedBy === "freellmapi");
    expect(assisted.length).toBeGreaterThan(0);
    for (const r of assisted) expect(["primary_source", "independently_corroborated"]).not.toContain(r.verification);
  });

  it("builds possible-match cards with matches, conflicts and unknowns", () => {
    const cands = candidateMatches(inv);
    const asma = cands.filter((c) => c.kind === "person" && c.entity.name === "Asma Siva");
    expect(asma.length).toBe(2);
    for (const c of asma) {
      expect(c.matches.some((m) => m.what === "Name")).toBe(true);
      expect(c.unknowns.join(" ")).toMatch(/confirmation/);
    }
    const garments = cands.find((c) => c.entity.name === "Sivasma Garments")!;
    expect(garments.conflicts.some((c) => /disagree/i.test(c.detail))).toBe(true);
  });

  it("round-trips through JSON export/import with user decisions and no secrets", () => {
    const person = inv.entities.find((e) => e.name === "Asma Siva")!;
    const withDecision = structuredClone(inv);
    setDecision(withDecision, "entity", person.id, "confirmed");
    const json = exportInvestigation(withDecision);
    expect(json).not.toMatch(/FREELLMAPI_API_KEY|Bearer /);
    const back = importInvestigation(json);
    expect(back.errors).toEqual([]);
    expect(back.ok).toBe(true);
    expect(back.investigation!.entities.find((e) => e.id === person.id)!.userDecision).toBe("confirmed");
    expect(back.investigation!.relationships.length).toBe(inv.relationships.length);
    expect(back.investigation!.synthetic).toBe(true);
  });
});

describe("NEXUS pipeline control", () => {
  it("pauses on an exhausted search quota, preserves findings, and resumes later", async () => {
    let quotaOn = true;
    const exec: Executor = async (r) => {
      if (r.task.engine === "searxng" && quotaOn && r.task.input.query?.includes("Siva")) return { taskId: r.task.id, engine: "searxng", status: "quota", quota: { provider: "searxng (synthetic)", status: 429, message: "rate limited", retryAfterSec: 600 } };
      return executeSynthetic(r);
    };
    let inv = await runAll(newInv({ engines: { page: true, searxng: true, gpt_researcher: false, spiderfoot: false, maigret: false } }), exec);
    expect(["paused", "completed"]).toContain(inv.status);
    expect(inv.quota.some((q) => q.engine === "searxng")).toBe(true);
    const quotaTasks = inv.tasks.filter((t) => t.status === "quota").length;
    expect(quotaTasks).toBeGreaterThan(0);
    const sourcesBefore = inv.sources.length;
    // After the reset the user resumes: quota tasks re-queue and run.
    quotaOn = false;
    requeueQuotaTasks(inv, new Date(Date.now() + 3_600_000));
    inv = await runAll(inv, exec);
    expect(inv.tasks.filter((t) => t.status === "quota")).toHaveLength(0);
    expect(inv.sources.length).toBeGreaterThanOrEqual(sourcesBefore);
  });

  it("resumes from a checkpoint after a mid-run pause (export → import → resume)", async () => {
    let cur = newInv();
    let n = 0;
    const runner: InvestigationRunner = new InvestigationRunner({
      get: () => cur,
      set: (x) => (cur = x),
      executor: async (r) => {
        if (++n === 6) runner.pause();
        return executeSynthetic(r);
      },
      available: new Set(ENGINE_IDS),
      pollDelayMs: noDelay,
    });
    await runner.run();
    expect(cur.status).toBe("paused");
    expect(cur.checkpoint).toBeTruthy();
    const restored = importInvestigation(exportInvestigation(cur));
    expect(restored.ok).toBe(true);
    const done = await runAll(restored.investigation!);
    expect(done.status).toBe("completed");
    expect(done.sources.some((s) => s.domain === "littlelotus-montessori.example" && s.fetch.status === "read")).toBe(true);
  });

  it("marks engines unavailable in this mode as not investigated (no fabricated results)", async () => {
    const inv = await runAll(newInv(), async (r) => executeSynthetic(r), new Set<EngineId>(["searxng", "page"]));
    expect(inv.tasks.every((t) => t.engine === "searxng" || t.engine === "page")).toBe(true);
    expect(inv.trail.some((t) => /Unavailable in this mode/.test(t.text))).toBe(true);
  });
});
