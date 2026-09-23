import { describe, expect, it } from "vitest";
import { planQueries, queryKey } from "@/lib/core/planner";
import type { QueryChannel } from "@/lib/core/types";
import { target } from "../fixtures";

const ALL: Set<QueryChannel> = new Set(["web", "news", "github", "reddit", "youtube", "username", "images"]);

describe("search planner — generation", () => {
  const plan = planQueries(target({ linkedin: "linkedin.com/in/example", instagram: "rajeshkumar78" }), { maxQueries: 200, channels: ALL });
  const qs = plan.planned.map((p) => p.query);

  it("generates name variations", () => {
    expect(qs).toEqual(expect.arrayContaining(['"Rajesh Kumar"', '"Rajesh K"', '"R Kumar"', '"RajeshKumar"', '"Kumar Rajesh"']));
  });

  it("generates tiered permutations of supplied attributes", () => {
    expect(qs).toContain('"Rajesh Kumar" TCS');
    expect(qs).toContain('"Rajesh Kumar" Chennai');
    expect(qs).toContain('"Rajesh Kumar" "Project Manager"');
    expect(qs).toContain('"Rajesh Kumar" TCS Chennai');
    expect(qs).toContain('"Rajesh Kumar" TCS "Project Manager"');
    expect(qs).toContain('"Rajesh Kumar" Chennai "Project Manager"');
  });

  it("generates platform-specific and username searches", () => {
    expect(qs).toContain('site:linkedin.com "Rajesh Kumar" TCS');
    expect(qs).toContain('site:github.com "Rajesh Kumar" TCS');
    expect(qs).toContain('"rajeshkumar78"');
    expect(qs).toContain('"rajeshkumar78" TCS');
    expect(qs).toContain('"rajeshkumar78" Chennai');
    expect(plan.planned.some((p) => p.channel === "username" && p.handle === "rajeshkumar78")).toBe(true);
  });

  it("orders strongest identifiers first (tier 1 before tier 2 before tier 9)", () => {
    const tiers = plan.planned.map((p) => p.tier);
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers);
    const t1 = plan.planned.find((p) => p.tier === 1);
    expect(t1?.category).toBe("cross_reference");
    expect(plan.planned.find((p) => p.query === '"linkedin.com/in/example"')?.tier).toBe(1);
  });

  it("does not generate the blind Cartesian product", () => {
    // 5 name variants × 4 attrs × every subset would be hundreds; tiers keep it small.
    expect(plan.planned.length + plan.skipped.length).toBeLessThan(90);
  });

  it("records a reason for every query", () => {
    expect(plan.planned.every((p) => p.reason.length > 3)).toBe(true);
  });
});

describe("search planner — deduplication, history, budget", () => {
  it("query keys are order- and case-insensitive", () => {
    expect(queryKey('"Rajesh Kumar" TCS')).toBe(queryKey('tcs "rajesh  kumar"'));
    expect(queryKey('"Rajesh Kumar" TCS', "web")).not.toBe(queryKey('"Rajesh Kumar" TCS', "news"));
  });

  it("never plans the same key twice", () => {
    const p = planQueries(target(), { maxQueries: 200, channels: ALL });
    const keys = p.planned.map((x) => x.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("skips queries already in history", () => {
    const first = planQueries(target(), { maxQueries: 200, channels: ALL });
    const history = new Set(first.planned.map((p) => p.key));
    const second = planQueries(target(), { maxQueries: 200, channels: ALL, history });
    expect(second.planned).toHaveLength(0);
    expect(second.skipped.every((s) => s.skipReason === "history" || s.skipReason === "duplicate")).toBe(true);
  });

  it("enforces the budget and keeps the highest-priority queries", () => {
    const p = planQueries(target(), { maxQueries: 5, channels: ALL });
    expect(p.planned).toHaveLength(5);
    expect(p.skipped.some((s) => s.skipReason === "budget")).toBe(true);
    expect(Math.max(...p.planned.map((x) => x.tier))).toBeLessThanOrEqual(Math.min(...p.skipped.filter((s) => s.skipReason === "budget").map((s) => s.tier)));
  });

  it("marks queries for unavailable channels instead of pretending to run them", () => {
    const p = planQueries(target(), { maxQueries: 200, channels: new Set(["web"]) });
    expect(p.planned.every((x) => x.channel === "web")).toBe(true);
    expect(p.skipped.some((s) => s.skipReason === "channel_unavailable" && s.channel === "reddit")).toBe(true);
  });
});

describe("search planner — iteration & monitoring", () => {
  it("turns discovered attributes into tier-10 queries", () => {
    const p = planQueries(target(), {
      maxQueries: 200,
      channels: ALL,
      discovered: [
        { kind: "previous_organization", value: "Infosys", fromCandidate: "C-1", evidenceUrl: "https://x" },
        { kind: "platform:github", value: "rajeshkumar78", fromCandidate: "C-1", evidenceUrl: "https://x" },
        { kind: "event", value: "Agile India 2025", fromCandidate: "C-1", evidenceUrl: "https://x" },
      ],
    });
    const t10 = p.planned.filter((x) => x.tier === 10).map((x) => x.query);
    expect(t10).toEqual(expect.arrayContaining(['"Rajesh Kumar" Infosys', '"rajeshkumar78"', '"rajeshkumar78" TCS', '"rajeshkumar78" Chennai', '"Rajesh Kumar" "Agile India 2025"']));
  });

  it("uses newly confirmed identifiers in monitoring mode", () => {
    const t = target();
    t.identifiers.push({ platform: "instagram", handle: "rajeshkumar78", state: "confirmed" });
    const p = planQueries(t, { maxQueries: 20, channels: ALL, mode: "monitor" });
    expect(p.planned.some((q) => q.query.includes("rajeshkumar78"))).toBe(true);
    expect(p.planned.length).toBeLessThanOrEqual(20);
    expect(p.planned.some((q) => q.category === "name_variation" && q.query !== '"Rajesh Kumar"')).toBe(false);
  });
});
