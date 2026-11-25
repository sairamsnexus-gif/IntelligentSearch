/**
 * Investigation planner + orchestrator.
 *
 * Round 1 dispatches independent, engine-appropriate tasks derived from the
 * clues. Every later round turns the highest-value open leads (discoveries of
 * any engine) into tasks for the engine best suited to them — cross-engine
 * recursion — until leads run dry, limits are reached, quotas are exhausted
 * or the user pauses/stops.
 */
import { nameCombinations, placeInScript } from "./variants";
import { addRelationship, applyResult, ensureClueEntities, leadKey, trail } from "./ledger";
import { newId, ENGINE_LABEL } from "./schema";
import type { EngineId, Investigation, Lead, Task, TaskKind } from "./schema";
import type { ExecuteRequest, TaskResult } from "./engine-types";
import { registrableDomain } from "./extract";

const nowIso = () => new Date().toISOString();

export function makeTask(inv: Investigation, engine: EngineId, kind: TaskKind, input: Task["input"], reason: string, leadId?: string): Task {
  return { id: newId("task"), engine, kind, round: inv.round, input, reason, leadId, status: "queued", createdAt: nowIso(), attempts: 0, output: { hits: [], sourceIds: [], leadIds: [], claimIds: [], notes: [] } };
}

const q = (s: string) => `"${s.replace(/"/g, "")}"`;

/** Search queries for round 1: exact names first, then context, combinations, variants and regional scripts. */
export function initialQueries(inv: Investigation): { query: string; reason: string }[] {
  const c = inv.clues;
  const out: { query: string; reason: string }[] = [];
  const add = (query: string, reason: string) => {
    if (!out.some((o) => o.query.toLowerCase() === query.toLowerCase())) out.push({ query, reason });
  };
  const place = c.places[0] ?? "";
  const hints = c.organisationHints.map((h) => h.split(/[ /]/)[0]);
  for (const n of c.names) {
    add(`${q(n.original)}${place ? ` ${place}` : ""}`, `Exact name "${n.original}"${place ? ` + ${place}` : ""}`);
    for (const h of hints) add(`${q(n.original)} ${h}${place ? ` ${place}` : ""}`, `Exact name + clue "${h}"`);
  }
  for (const combo of nameCombinations(c.names, 4)) add(`${q(combo.text)}${place ? ` ${place}` : ""}`, `Name combination (${combo.method})`);
  for (const h of hints) if (place) add(`${h} ${place} ${c.names.map((n) => q(n.original)).join(" OR ")}`, `Clue "${h}" in ${place} with either name`);
  // Regional scripts before extra Latin spellings: local-language pages are otherwise never reached.
  for (const n of c.names)
    for (const v of n.variants.filter((x) => x.script !== "latin").slice(0, 1)) {
      const p = place ? placeInScript(place, v.script as "tamil" | "devanagari") ?? place : "";
      add(`${q(v.text)}${p ? ` ${p}` : ""}`, `Regional-script variant "${v.text}" of "${n.original}" (${v.method})`);
    }
  for (const n of c.names)
    for (const v of n.variants.filter((x) => !x.isOriginal && x.script === "latin").slice(0, 2)) add(`${q(v.text)}${place ? ` ${place}` : ""}${hints[0] ? ` ${hints[0]}` : ""}`, `Variant "${v.text}" of "${n.original}" (${v.method})`);
  return out;
}

export function planInitial(inv: Investigation, available: Set<EngineId>): Investigation {
  ensureClueEntities(inv);
  for (const r of inv.clues.userRelationships) {
    const a = inv.entities.find((e) => e.key.startsWith("clue:") && e.name === r.a);
    const b = inv.entities.find((e) => e.key.startsWith("clue:") && e.name === r.b);
    if (a && b) addRelationship(inv, a.id, "associated_with", b.id, null, { engine: "user", round: 0 }, r.description, true);
  }
  inv.round = 1;
  const on = (e: EngineId) => inv.settings.engines[e] && available.has(e);
  const tasks: Task[] = [];
  if (on("searxng")) for (const x of initialQueries(inv).slice(0, Math.max(6, Math.floor(inv.settings.maxTasksPerRound * 0.75)))) tasks.push(makeTask(inv, "searxng", "search", { query: x.query }, x.reason));
  if (on("gpt_researcher")) tasks.push(makeTask(inv, "gpt_researcher", "research", { query: researchQuestion(inv) }, "Independent research plan for the whole request"));
  for (const u of inv.clues.urls) {
    if (on("page")) tasks.push(makeTask(inv, "page", "read_page", { url: u }, "URL supplied by the user"));
  }
  const domains = new Set([...inv.clues.domains, ...inv.clues.urls.map((u) => registrableDomain(u)).filter(Boolean)]);
  for (const d of domains) if (on("spiderfoot")) tasks.push(makeTask(inv, "spiderfoot", "osint_domain", { domain: d }, "Domain supplied by the user"));
  for (const u of inv.clues.usernames) if (on("maigret")) tasks.push(makeTask(inv, "maigret", "username", { username: u }, "Username supplied by the user"));
  inv.tasks.push(...tasks);
  for (const l of inv.clues.urls) inv.leads.push({ id: newId("lead"), kind: "url", value: l, key: leadKey("url", l), from: { engine: "user" }, score: 100, reason: "Supplied by user", status: "investigated", round: 0, taskIds: [] });
  trail(inv, "plan", "nexus", `Round 1: ${tasks.length} task(s) across ${new Set(tasks.map((t) => t.engine)).size} engine(s) — ${Array.from(new Set(tasks.map((t) => ENGINE_LABEL[t.engine]))).join(", ")}`);
  const skipped = (Object.keys(ENGINE_LABEL) as EngineId[]).filter((e) => inv.settings.engines[e] && !available.has(e));
  if (skipped.length) trail(inv, "plan", "nexus", `Unavailable in this mode (not investigated): ${skipped.map((e) => ENGINE_LABEL[e]).join(", ")}`);
  return inv;
}

export function researchQuestion(inv: Investigation): string {
  const c = inv.clues;
  const names = c.names.map((n) => n.original).join(" and ");
  return `Public information about ${names || "the subject"}${c.places[0] ? ` in ${c.places[0]}` : ""}${c.organisationHints.length ? ` — clues: ${c.organisationHints.join("; ")}` : ""}. Identify publicly documented businesses, schools or organisations and their public contact details. Do not speculate about private matters.`;
}

/** Turn the best open leads into the next round's tasks (cross-engine handoff). */
export function planNextRound(inv: Investigation, available: Set<EngineId>): Task[] {
  const on = (e: EngineId) => inv.settings.engines[e] && available.has(e);
  const remainingTotal = inv.settings.maxTotalTasks - inv.tasks.length;
  const budget = Math.min(inv.settings.maxTasksPerRound, remainingTotal);
  if (budget <= 0) return [];
  const open = inv.leads.filter((l) => l.status === "open" && l.score >= inv.settings.leadThreshold).sort((a, b) => b.score - a.score);
  const next = inv.round + 1;
  const tasks: Task[] = [];
  const pagesPerDomain = new Map<string, number>();
  for (const s of inv.sources) if (s.fetch.status !== "not_opened") pagesPerDomain.set(s.domain, (pagesPerDomain.get(s.domain) ?? 0) + 1);
  let researchUsed = 0;
  // Never re-run an identical (engine, input) task.
  const seen = new Set(inv.tasks.map((t) => `${t.engine}|${JSON.stringify(t.input)}`));
  const push = (engine: EngineId, kind: TaskKind, input: Task["input"], lead: Lead, reason: string) => {
    if (tasks.length >= budget) return;
    const k = `${engine}|${JSON.stringify(input)}`;
    if (seen.has(k)) return;
    seen.add(k);
    const t = makeTask(inv, engine, kind, input, reason, lead.id);
    t.round = next;
    tasks.push(t);
    lead.taskIds.push(t.id);
  };
  for (const lead of open) {
    if (tasks.length >= budget) break;
    const before = tasks.length;
    switch (lead.kind) {
      case "url": {
        const d = registrableDomain(lead.value);
        if (!on("page")) break;
        if ((pagesPerDomain.get(d) ?? 0) >= inv.settings.maxPagesPerDomain) {
          lead.status = "limit_reached";
          continue;
        }
        pagesPerDomain.set(d, (pagesPerDomain.get(d) ?? 0) + 1);
        push("page", "read_page", { url: lead.value }, lead, `Inspect page: ${lead.reason}`);
        break;
      }
      case "domain":
        if (on("spiderfoot") && !inv.tasks.some((t) => t.engine === "spiderfoot" && t.input.domain === lead.value)) push("spiderfoot", "osint_domain", { domain: lead.value }, lead, `OSINT on discovered domain: ${lead.reason}`);
        if (on("page") && !inv.sources.some((s) => s.domain === lead.value && s.fetch.status === "read")) push("page", "read_page", { url: `https://${lead.value}/` }, lead, `Open official site: ${lead.reason}`);
        break;
      case "business":
      case "school":
      case "organisation": {
        const place = inv.clues.places[0];
        if (on("searxng")) {
          push("searxng", "search", { query: q(lead.value) }, lead, `Search discovered ${lead.kind} name`);
          if (place && !lead.value.toLowerCase().includes(place.toLowerCase())) push("searxng", "search", { query: `${q(lead.value)} ${place}` }, lead, `Search discovered ${lead.kind} + ${place}`);
        }
        if (on("gpt_researcher") && researchUsed < 1) {
          researchUsed++;
          push("gpt_researcher", "research", { query: `Who publicly runs or founded ${lead.value}${place ? ` in ${place}` : ""}, and what are its official public contact details?` }, lead, `Independent research on discovered ${lead.kind}`);
        }
        break;
      }
      case "name":
        if (on("searxng")) push("searxng", "search", { query: `${q(lead.value)}${inv.clues.places[0] ? ` ${inv.clues.places[0]}` : ""}` }, lead, `Search discovered full name: ${lead.reason}`);
        break;
      case "username":
        if (on("maigret") && !inv.tasks.some((t) => t.engine === "maigret" && t.input.username === lead.value)) push("maigret", "username", { username: lead.value }, lead, `Username discovery: ${lead.reason}`);
        break;
      case "place":
      case "phrase":
        if (on("searxng")) push("searxng", "search", { query: lead.value }, lead, lead.reason);
        break;
    }
    lead.status = tasks.length > before ? "queued" : lead.status === "open" ? "discarded" : lead.status;
  }
  return tasks;
}

// ---------------------------------------------------------------------------
// Orchestrator

export type Executor = (req: ExecuteRequest) => Promise<TaskResult>;

export interface RunnerHooks {
  get: () => Investigation;
  set: (next: Investigation) => void;
  executor: Executor;
  available: Set<EngineId>;
  concurrency?: Partial<Record<EngineId, number>>;
  pollDelayMs?: (ms: number) => Promise<void>;
}

const DEFAULT_CONC: Record<EngineId, number> = { page: 3, searxng: 2, gpt_researcher: 1, spiderfoot: 1, maigret: 1 };

export class InvestigationRunner {
  private stopFlag: "pause" | "stop" | null = null;
  private running = false;
  constructor(private h: RunnerHooks) {}

  pause() {
    this.stopFlag = "pause";
  }
  stop() {
    this.stopFlag = "stop";
  }
  get isRunning() {
    return this.running;
  }

  private mutate(fn: (inv: Investigation) => void) {
    const next = structuredClone(this.h.get());
    fn(next);
    next.updatedAt = nowIso();
    this.h.set(next);
  }

  private quotaPaused(engine: EngineId): boolean {
    const inv = this.h.get();
    const last = [...inv.quota].reverse().find((q) => q.engine === engine);
    if (!last) return false;
    return !last.resumeAfter || Date.parse(last.resumeAfter) > Date.now();
  }

  private llmRemaining(inv: Investigation): number {
    const llmQuota = [...inv.quota].reverse().find((q) => q.engine === "freellmapi");
    if (llmQuota && (!llmQuota.resumeAfter || Date.parse(llmQuota.resumeAfter) > Date.now())) return 0;
    return inv.settings.llm.enabled ? Math.max(0, inv.settings.llm.maxCalls - inv.usage.llmCalls) : 0;
  }

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopFlag = null;
    const delay = this.h.pollDelayMs ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    this.mutate((inv) => {
      inv.status = "running";
      inv.stopReason = null;
      // tasks interrupted by a reload/crash are retried
      for (const t of inv.tasks) if (t.status === "running") t.status = "queued";
      if (inv.round === 0) planInitial(inv, this.h.available);
    });
    const conc = { ...DEFAULT_CONC, ...(this.h.concurrency ?? {}) };
    const inFlight = new Map<string, Promise<void>>();
    try {
      while (true) {
        if (this.stopFlag) break;
        const inv = this.h.get();
        const active = inv.tasks.filter((t) => t.status === "queued" || t.status === "running" || t.status === "pending");
        const dispatchable = inv.tasks.filter((t) => (t.status === "queued" || (t.status === "pending" && !inFlight.has(t.id))) && !this.quotaPaused(t.engine));
        // Dispatch within per-engine concurrency
        for (const t of dispatchable) {
          const runningForEngine = Array.from(inFlight.keys()).filter((id) => inv.tasks.find((x) => x.id === id)?.engine === t.engine).length;
          if (runningForEngine >= conc[t.engine] || inFlight.has(t.id)) continue;
          const isPoll = t.status === "pending";
          this.mutate((d) => {
            const x = d.tasks.find((y) => y.id === t.id)!;
            x.status = isPoll ? "pending" : "running";
            x.startedAt ??= nowIso();
            x.attempts += 1;
          });
          const p = (async () => {
            if (isPoll) await delay(1500);
            const cur = this.h.get();
            const req: ExecuteRequest = {
              task: { id: t.id, engine: t.engine, kind: t.kind, input: t.input, jobRef: t.jobRef },
              context: { synthetic: cur.synthetic, clueNames: cur.clues.names.map((n) => n.original), places: cur.clues.places, organisationHints: cur.clues.organisationHints, llm: { enabled: cur.settings.llm.enabled, remainingCalls: this.llmRemaining(cur), maxTokensPerCall: cur.settings.llm.maxTokensPerCall } },
            };
            let result: TaskResult;
            try {
              result = await this.h.executor(req);
            } catch (e) {
              result = { taskId: t.id, engine: t.engine, status: "failed", error: e instanceof Error ? e.message : "Executor error" };
            }
            this.mutate((d) => {
              applyResult(d, result);
              d.checkpoint = { savedAt: nowIso(), round: d.round, pendingTaskIds: d.tasks.filter((x) => ["queued", "running", "pending", "quota"].includes(x.status)).map((x) => x.id) };
            });
          })().finally(() => inFlight.delete(t.id));
          inFlight.set(t.id, p);
        }
        if (inFlight.size) {
          await Promise.race(inFlight.values());
          continue;
        }
        // Nothing in flight. Are there tasks waiting only on exhausted quotas?
        const blocked = active.filter((t) => this.quotaPaused(t.engine));
        if (blocked.length && blocked.length === active.length) {
          const engines = Array.from(new Set(blocked.map((t) => ENGINE_LABEL[t.engine])));
          this.mutate((d) => {
            d.status = "paused";
            d.stopReason = `Free quota exhausted for ${engines.join(", ")} — resume after the quota resets. Completed findings are preserved.`;
          });
          return;
        }
        // Quota-failed tasks are re-queued only on an explicit resume.
        // Round complete → plan next
        const cur = this.h.get();
        if (cur.round >= cur.settings.maxRounds) {
          this.finish(`Configured round limit reached (${cur.settings.maxRounds})`);
          return;
        }
        if (cur.tasks.length >= cur.settings.maxTotalTasks) {
          this.finish(`Configured task limit reached (${cur.settings.maxTotalTasks})`);
          return;
        }
        let planned = 0;
        this.mutate((d) => {
          const tasks = planNextRound(d, this.h.available);
          planned = tasks.length;
          if (!tasks.length) return;
          d.round += 1;
          d.tasks.push(...tasks);
          trail(d, "followup", "nexus", `Round ${d.round}: ${tasks.length} follow-up task(s) from new leads — ${Array.from(new Set(tasks.map((t) => ENGINE_LABEL[t.engine]))).join(", ")}`, tasks.map((t) => t.id).slice(0, 20));
        });
        if (!planned) {
          this.finish("No new relevant leads above the threshold");
          return;
        }
      }
      if (this.stopFlag === "pause") {
        await Promise.allSettled(inFlight.values());
        this.mutate((d) => {
          d.status = "paused";
          d.stopReason = "Paused by user";
          trail(d, "user", "user", "Investigation paused");
        });
      } else if (this.stopFlag === "stop") {
        await Promise.allSettled(inFlight.values());
        this.mutate((d) => {
          for (const t of d.tasks) if (t.status === "queued" || t.status === "pending") t.status = "cancelled";
          d.status = "stopped";
          d.stopReason = "Stopped by user";
          trail(d, "user", "user", "Investigation stopped");
        });
      }
    } finally {
      this.running = false;
    }
  }

  private finish(reason: string) {
    this.mutate((d) => {
      d.status = "completed";
      d.stopReason = reason;
      for (const l of d.leads) if (l.status === "open" && l.score >= d.settings.leadThreshold) l.status = "open";
      trail(d, "checkpoint", "nexus", `Investigation round ${d.round} complete — ${reason}`);
    });
  }
}

/** Re-queue quota-blocked tasks (explicit user resume after the reset). */
export function requeueQuotaTasks(inv: Investigation, now = new Date()) {
  for (const t of inv.tasks) if (t.status === "quota") t.status = "queued";
  inv.quota = inv.quota.map((q) => ({ ...q, resumeAfter: q.resumeAfter && Date.parse(q.resumeAfter) > now.getTime() ? q.resumeAfter : now.toISOString() }));
}
