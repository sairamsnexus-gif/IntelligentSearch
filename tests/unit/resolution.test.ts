import { describe, expect, it } from "vitest";
import { canonicalUrl, dedupeResults, resolveCandidates } from "@/lib/core/resolution";
import type { CandidateProfile } from "@/lib/core/types";
import { demoResult, initialResults, syntheticResult, target } from "../fixtures";

const hasProfile = (c: CandidateProfile, platform: string, handle: string) => c.profiles.some((p) => p.platform === platform && p.handle === handle);
const find = (cs: CandidateProfile[], platform: string, handle: string) => cs.find((c) => hasProfile(c, platform, handle));

describe("candidate grouping", () => {
  const out = resolveCandidates(target(), initialResults());
  const p1 = find(out.candidates, "linkedin", "rajeshkumar-pm-chennai")!;
  const p2 = find(out.candidates, "linkedin", "rajesh-kumar-tcs-projects")!;

  it("binds results that share strong identifiers (profile cross-links)", () => {
    expect(p1).toBeDefined();
    // LinkedIn ↔ GitHub ↔ YouTube ↔ blog are cross-linked
    expect(hasProfile(p1, "github", "rajeshkumar78")).toBe(true);
    expect(hasProfile(p1, "youtube", "agiletalks-rajesh")).toBe(true);
    expect(p1.resultIds).toContain("r-p1-blog");
    expect(p1.strongKeys.length).toBeGreaterThanOrEqual(2);
  });

  it("never merges two people merely because their names match", () => {
    expect(p2).toBeDefined();
    expect(p1.clusterKey).not.toBe(p2.clusterKey);
    for (const c of out.candidates) {
      const personas = new Set(c.resultIds.map((id) => id.replace(/^r-/, "").split("-")[0]));
      expect(personas.size).toBe(1);
    }
  });

  it("attaches an unlinked article only when exactly one candidate qualifies", () => {
    // 'joined TCS from Infosys' agrees with P1 and conflicts with P2 (ex-HCLTech)
    expect(p1.resultIds).toContain("r-p1-news-award");
    // Conference page matches P1 and P2 equally → left unattributed, not guessed
    expect(out.unattributed.map((u) => u.resultId)).toContain("r-shared-conference");
  });

  it("keeps name-only mentions out of candidates", () => {
    expect(out.unattributed.find((u) => u.resultId === "r-shared-pdf")?.reason).toMatch(/Name-only/);
  });

  it("uses stable candidate keys across runs", () => {
    const again = resolveCandidates(target(), initialResults());
    expect(find(again.candidates, "linkedin", "rajeshkumar-pm-chennai")!.clusterKey).toBe(p1.clusterKey);
  });
});

describe("identity matching & conflicts", () => {
  const out = resolveCandidates(target(), initialResults());
  const p1 = find(out.candidates, "linkedin", "rajeshkumar-pm-chennai")!;
  const p3 = find(out.candidates, "linkedin", "rajesh-kumar-sse-tcs")!;
  const p4 = find(out.candidates, "linkedin", "rajeshkumar-blr-pm")!;
  const p5 = find(out.candidates, "linkedin", "rajesh-kumar-cts")!;

  it("explains matches attribute by attribute with evidence", () => {
    expect(p1.match.matched).toBe(5);
    expect(p1.match.total).toBe(5);
    for (const b of p1.match.breakdown.filter((x) => x.status === "match")) expect(b.evidence.length).toBeGreaterThan(0);
  });

  it("detects conflicting attributes", () => {
    const status = (c: CandidateProfile, key: string) => c.match.breakdown.find((b) => b.key === key)?.status;
    expect(status(p3, "designation")).toBe("conflict");
    expect(status(p4, "city")).toBe("conflict");
    expect(status(p5, "organization")).toBe("conflict");
    expect(p3.match.conflicts).toBeGreaterThan(0);
  });

  it("ranks conflict-free candidates above conflicting ones", () => {
    const idx = (c: CandidateProfile) => out.candidates.indexOf(c);
    expect(idx(p1)).toBeLessThan(idx(p3));
    expect(idx(p1)).toBeLessThan(idx(p4));
  });

  it("reports ambiguity instead of choosing when candidates tie", () => {
    expect(out.summary.state).toBe("ambiguous");
    expect(out.summary.message).toMatch(/Which detail can you provide/);
    expect(out.summary.suggestions[0].kind).toBe("previous_organization");
    expect(out.summary.suggestions[0].why).toMatch(/Infosys|HCLTech/);
  });

  it("narrows to a leading candidate after the user adds a discriminating attribute", () => {
    const refined = resolveCandidates(target({ previousOrganization: "Infosys" }), initialResults());
    expect(refined.summary.state).toBe("leading");
    expect(refined.candidates[0].profiles.some((p) => p.handle === "rajeshkumar-pm-chennai")).toBe(true);
    const p2 = find(refined.candidates, "linkedin", "rajesh-kumar-tcs-projects")!;
    expect(p2.match.breakdown.find((b) => b.key === "previous_organization")?.status).toBe("conflict");
  });

  it("treats an exact user-supplied profile URL as a strong signal and highlights corroboration", () => {
    const t = target({ github: "rajeshkumar78", linkedin: "linkedin.com/in/rajeshkumar-pm-chennai" });
    const r = resolveCandidates(t, initialResults());
    const top = r.candidates[0];
    expect(hasProfile(top, "linkedin", "rajeshkumar-pm-chennai")).toBe(true);
    expect(top.match.strongIdentifierMatch).toBe(true);
    expect(top.match.corroborated).toBe(true);
    expect(r.summary.state).toBe("leading");
  });

  it("flags a different handle on the same platform as a conflict", () => {
    const r = resolveCandidates(target({ linkedin: "linkedin.com/in/someone-else" }), initialResults());
    const c = find(r.candidates, "linkedin", "rajeshkumar-pm-chennai")!;
    expect(c.match.breakdown.find((b) => b.key === "platform:linkedin")?.status).toBe("conflict");
  });
});

describe("iterative discovery", () => {
  it("surfaces new attributes from plausible candidates for the next iteration", () => {
    const out = resolveCandidates(target(), initialResults());
    const values = out.discovered.map((d) => `${d.kind}:${d.value}`);
    expect(values).toEqual(expect.arrayContaining(["previous_organization:Infosys", "platform:github:rajeshkumar78"]));
    expect(out.discovered.every((d) => d.evidenceUrl.startsWith("https://"))).toBe(true);
    // Values from conflicting candidates are not used to drive new searches
    expect(values).not.toContain("previous_organization:Wipro");
  });
});

describe("result normalisation", () => {
  it("canonicalises URLs and deduplicates results", () => {
    expect(canonicalUrl("https://WWW.LinkedIn.com/in/abc/?utm_source=x#top")).toBe("https://linkedin.com/in/abc");
    const a = demoResult("p1-linkedin");
    const b = { ...a, id: "dup", url: a.url + "/?utm_medium=email", contentText: a.contentText + " more" };
    const d = dedupeResults([a, b]);
    expect(d).toHaveLength(1);
    expect(d[0].contentText).toMatch(/more$/);
  });

  it("anchors a result by an exact email even without a name hit", () => {
    const t = target({ email: "rk.pm@example.com" });
    const r = syntheticResult({ url: "https://forum.example.com/u/42", contentText: "Contact: rk.pm@example.com" });
    const out = resolveCandidates(t, [r]);
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].match.strongIdentifierMatch).toBe(true);
  });

  it("returns no candidates for irrelevant results", () => {
    const out = resolveCandidates(target(), [syntheticResult({ url: "https://example.com", contentText: "Nothing about anyone" })]);
    expect(out.summary.state).toBe("no_candidates");
    expect(out.summary.suggestions.length).toBeGreaterThan(0);
  });
});
