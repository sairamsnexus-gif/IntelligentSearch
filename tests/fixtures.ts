/**
 * Test fixtures built from the fictional DEMO corpus (no real individuals).
 * Primary dataset: Rajesh Kumar · Chennai · TCS · Project Manager.
 */
import { DEMO_DOCS, docVersion } from "@/lib/adapters/demo/corpus";
import { buildTargetProfile, type PersonQuery } from "@/lib/core/input";
import type { SearchResult, TargetProfile } from "@/lib/core/types";

export const baseQuery: PersonQuery = {
  name: "Rajesh Kumar",
  city: "Chennai",
  country: "India",
  organization: "TCS",
  designation: "Project Manager",
  purpose: "due_diligence",
};

export function target(extra: Partial<PersonQuery> = {}): TargetProfile {
  return buildTargetProfile({ ...baseQuery, ...extra });
}

export function demoResult(docId: string, epoch = 0): SearchResult {
  const d = DEMO_DOCS.find((x) => x.id === docId);
  if (!d) throw new Error(`unknown doc ${docId}`);
  const text = docVersion(d, epoch) ?? "";
  return {
    id: `r-${docId}`,
    query: "fixture",
    sourceEngine: "demo",
    sourcePlatform: d.sourcePlatform,
    url: d.url,
    title: d.title,
    description: text.slice(0, 200),
    discoveredAt: "2026-09-23T10:00:00.000Z",
    name: d.name ?? null,
    username: d.username ?? null,
    emails: [],
    phoneNumbers: [],
    contentText: text,
    rawMetadata: {},
    sourceType: d.sourceType,
    isDemo: true,
  };
}

/** Everything a first search would plausibly surface (epoch 0). */
export function initialResults(): SearchResult[] {
  return DEMO_DOCS.filter((d) => !d.availableFrom && d.channels.some((c) => c !== "username")).map((d) => demoResult(d.id));
}

export function syntheticResult(p: Partial<SearchResult> & { url: string; contentText: string }): SearchResult {
  return {
    id: `s-${Math.random().toString(36).slice(2)}`,
    query: "fixture",
    sourceEngine: "test",
    sourcePlatform: "web",
    title: p.title ?? "Untitled",
    description: "",
    discoveredAt: "2026-09-23T10:00:00.000Z",
    emails: [],
    phoneNumbers: [],
    rawMetadata: {},
    sourceType: "web",
    ...p,
  };
}
