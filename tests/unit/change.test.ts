import { describe, expect, it } from "vitest";
import { availabilityFromFetch, compareSnapshots, computeDiff, normalizeContent } from "@/lib/core/change";
import { backoffMs, isDue, isStale, nextRunAt } from "@/lib/core/schedule";

const snap = (text: string, available = true) => ({ contentHash: `h:${normalizeContent(text)}`, contentText: normalizeContent(text), available });

describe("snapshot normalisation", () => {
  it("strips markup, scripts and cosmetic whitespace", () => {
    const a = normalizeContent("<html><script>var t=Date.now()</script><h1>Rajesh  Kumar</h1><p>Project Manager</p></html>");
    const b = normalizeContent("<html><h1>Rajesh Kumar</h1>\n\n<p>Project   Manager</p></html>");
    expect(a).toBe(b);
    expect(a).not.toMatch(/Date\.now/);
  });
});

describe("change detection", () => {
  it("classifies NEW / UNCHANGED / CHANGED / NO_LONGER_AVAILABLE", () => {
    expect(compareSnapshots(null, snap("Project Manager at TCS")).type).toBe("NEW");
    expect(compareSnapshots(snap("Project Manager at TCS"), snap("Project Manager at TCS")).type).toBe("UNCHANGED");
    expect(compareSnapshots(snap("Project Manager at TCS"), snap("Senior Project Manager at TCS")).type).toBe("CHANGED");
    expect(compareSnapshots(snap("Project Manager at TCS"), snap("", false)).type).toBe("NO_LONGER_AVAILABLE");
    expect(compareSnapshots(snap("", false), snap("", false)).type).toBe("UNCHANGED");
    expect(compareSnapshots(snap("", false), snap("Back online")).type).toBe("CHANGED");
  });

  it("produces a readable word-level diff (OLD → NEW)", () => {
    const d = computeDiff("Rajesh Kumar. Project Manager at TCS. Chennai.", "Rajesh Kumar. Senior Project Manager at TCS. Chennai.");
    expect(d.filter((p) => p.op === "add").map((p) => p.text.trim())).toContain("Senior");
    expect(d.some((p) => p.op === "remove")).toBe(false);
    const r = compareSnapshots(snap("Project Manager"), snap("Senior Project Manager"));
    expect(r.summary).toMatch(/Senior/);
  });

  it("applies the availability policy (hard 404 vs transient errors)", () => {
    expect(availabilityFromFetch(200, 0)).toBe("available");
    expect(availabilityFromFetch(404, 0)).toBe("gone");
    expect(availabilityFromFetch(503, 0)).toBe("transient_error");
    expect(availabilityFromFetch(null, 2)).toBe("gone");
  });
});

describe("monitoring scheduler maths", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  it("computes next run from the interval", () => {
    expect(nextRunAt(now, 24).toISOString()).toBe("2026-09-24T12:00:00.000Z");
  });
  it("decides due-ness respecting pause and running flags", () => {
    const past = new Date(now.getTime() - 1000);
    expect(isDue({ status: "active", intervalHours: 24, nextRunAt: past, running: false }, now)).toBe(true);
    expect(isDue({ status: "paused", intervalHours: 24, nextRunAt: past, running: false }, now)).toBe(false);
    expect(isDue({ status: "active", intervalHours: 24, nextRunAt: past, running: true }, now)).toBe(false);
    expect(isDue({ status: "active", intervalHours: 24, nextRunAt: nextRunAt(now, 1), running: false }, now)).toBe(false);
  });
  it("uses capped exponential backoff and detects stale locks", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(30)).toBe(3_600_000);
    expect(isStale(new Date(now.getTime() - 31 * 60_000), now)).toBe(true);
    expect(isStale(new Date(now.getTime() - 60_000), now)).toBe(false);
  });
});
