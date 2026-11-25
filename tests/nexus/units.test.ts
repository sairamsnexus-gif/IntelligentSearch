import { describe, expect, it } from "vitest";
import { buildNameClue, latinVariants, matchName, nameCombinations, placeInScript, toTamil } from "@/lib/nexus/variants";
import { parseClues } from "@/lib/nexus/clues";
import { extractPage, extractPeople, registrableDomain } from "@/lib/nexus/extract";
import { fingerprint, fingerprintSimilarity } from "@/lib/nexus/ledger";
import { exportInvestigation, importInvestigation, migrate } from "@/lib/nexus/io";
import { createInvestigation, NEXUS_SCHEMA_VERSION } from "@/lib/nexus/schema";
import { syntheticPage } from "@/lib/nexus/synthetic";
import { syntheticSearch } from "@/lib/nexus/synthetic-exec";

let n = 0;
const id = () => `nm_${++n}`;

describe("name variants", () => {
  it("keeps the exact original first and adds spelling variants", () => {
    const c = buildNameClue("Siva", ["Chennai"], id);
    expect(c.original).toBe("Siva");
    expect(c.variants[0]).toMatchObject({ text: "Siva", isOriginal: true });
    expect(c.variants.length).toBeLessThanOrEqual(18);
    expect(latinVariants("Asma").map((v) => v.text)).toEqual(expect.arrayContaining(["Asmah", "Asmaa"]));
  });
  it("transliterates to Tamil with native ச initially and grantha ஸ medially", () => {
    expect(toTamil("Siva", { nativeInitialS: true })).toBe("சிவா");
    expect(toTamil("Asma")).toBe("அஸ்மா");
    expect(placeInScript("Chennai", "tamil")).toBe("சென்னை");
  });
  it("matches variants as whole words only", () => {
    const c = buildNameClue("Siva", ["Chennai"], id);
    expect(matchName(c, "Mr Shiva Raman")?.text).toBe("Shiva");
    expect(matchName(c, "Sivasma Garments")).toBeUndefined();
    expect(matchName(c, "சிவா நடத்துகிறார்")?.script).toBe("tamil");
  });
  it("combines two names in both orders", () => {
    const combos = nameCombinations([buildNameClue("Asma", [], id), buildNameClue("Siva", [], id)], 6).map((c) => c.text);
    expect(combos.slice(0, 2)).toEqual(expect.arrayContaining(["Asma Siva", "Siva Asma"]));
  });
});

describe("clue parsing (rules)", () => {
  it("extracts names, place, organisation hints and a user-stated (unverified) relationship", () => {
    const c = parseClues("Find Asma and Siva in Chennai. They may be running a garments business. Asma may also be associated with a Montessori school.");
    expect(c.names.map((x) => x.original)).toEqual(["Asma", "Siva"]);
    expect(c.places).toEqual(["Chennai"]);
    expect(c.organisationHints.join(" ")).toMatch(/garment/i);
    expect(c.organisationHints.join(" ")).toMatch(/montessori/i);
    expect(c.userRelationships.length).toBe(1);
    expect(c.parsedBy).toEqual(["rules"]);
  });
  it("extracts URLs, usernames and domains supplied by the user", () => {
    const c = parseClues("Check https://example.org/about and @some_user on example.net");
    expect(c.urls).toEqual(["https://example.org/about"]);
    expect(c.usernames).toEqual(["some_user"]);
    expect(c.domains).toContain("example.net");
  });
});

describe("page extraction", () => {
  it("reads JSON-LD organisation, contacts and founding year from an official home page", () => {
    const p = syntheticPage("https://sivasma-garments.example/")!;
    const x = extractPage(p.html, p.url);
    expect(x.organisations[0]).toMatchObject({ name: "Sivasma Garments", from: "jsonld" });
    expect(x.contacts.some((c) => c.kind === "email" && c.value === "info@sivasma-garments.example")).toBe(true);
    expect(x.contacts.some((c) => c.kind === "phone")).toBe(true);
    expect(x.facts.find((f) => f.predicate === "established_in_year")?.value).toBe("2014");
  });
  it("extracts documented roles and ties them to the named organisation", () => {
    const ppl = extractPeople("Sivasma Garments was co-founded by Siva Raman and Asma Siva in Chennai.");
    expect(ppl.map((p) => [p.name, p.predicate, p.orgName])).toEqual([
      ["Siva Raman", "founded", "Sivasma Garments"],
      ["Asma Siva", "founded", "Sivasma Garments"],
    ]);
    expect(extractPeople("Founder & Principal: Asma Siva.")[0]).toMatchObject({ name: "Asma Siva", predicate: "founded" });
  });
  it("computes registrable domains", () => {
    expect(registrableDomain("https://www.shop.example.co.in/x")).toBe("example.co.in");
    expect(registrableDomain("https://www.instagram.com/x")).toBe("instagram.com");
  });
});

describe("copy detection", () => {
  it("flags near-identical syndicated text and separates different articles", () => {
    const a = "Sivasma Garments opened a new showroom in Velachery on Monday. The store, run by the Chennai clothing firm, stocks cotton sarees and kurtas made in Tiruppur. The company said the showroom would employ twenty people from the neighbourhood and would stay open on weekends during the festival season, with a tailoring counter for alterations and a section for school uniforms.";
    const b = a.replace("Monday", "Monday morning");
    const c = "Little Lotus Montessori in Adyar announced admissions for the new academic year with a focus on mixed-age classrooms.";
    expect(fingerprintSimilarity(fingerprint(a), fingerprint(b))).toBeGreaterThanOrEqual(0.6);
    expect(fingerprintSimilarity(fingerprint(a), fingerprint(c))).toBeLessThan(0.2);
  });
});

describe("synthetic search world", () => {
  it("supports exact phrases, OR groups and Tamil queries", () => {
    expect(syntheticSearch('"Asma Siva" Chennai').length).toBeGreaterThan(0);
    expect(syntheticSearch('garments Chennai "Asma" OR "Siva"').length).toBeGreaterThan(0);
    expect(syntheticSearch('"அஸ்மா" சென்னை').map((h) => h.url)).toContain("https://tamil-news.example/2026/01/montessori-adyar");
    expect(syntheticSearch('"Nobody Here" Mumbai')).toEqual([]);
  });
});

describe("investigation JSON", () => {
  const base = () => createInvestigation("Find Asma in Chennai", parseClues("Find Asma in Chennai"));
  it("validates, rejects foreign/invalid files and enforces the size limit", () => {
    expect(importInvestigation("not json").ok).toBe(false);
    expect(importInvestigation(JSON.stringify({ schema: "other.thing" })).errors[0]).toMatch(/Not a NEXUS/);
    expect(importInvestigation("{}", 30 * 1024 * 1024).errors[0]).toMatch(/limit/);
    const bad = JSON.parse(exportInvestigation(base()));
    bad.relationships = [{ id: "rel_x", subjectId: "nope", objectId: "nope2" }];
    expect(importInvestigation(JSON.stringify(bad)).ok).toBe(false);
  });
  it("migrates a v0 draft and refuses newer schema versions", () => {
    const v0 = JSON.parse(exportInvestigation(base()));
    delete v0.schema;
    delete v0.schemaVersion;
    delete v0.quota;
    delete v0.usage;
    const r = importInvestigation(JSON.stringify(v0));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/Migrated from schema v0/);
    expect(() => migrate({ schemaVersion: NEXUS_SCHEMA_VERSION + 1 })).toThrow(/newer/);
  });
  it("strips credential-like fields on export but keeps token counters", () => {
    const inv = base() as unknown as Record<string, unknown>;
    (inv as { settings: Record<string, unknown> }).settings.apiKey = "sk-should-not-leak";
    inv.password = "x";
    const json = exportInvestigation(inv as never);
    expect(json).not.toMatch(/sk-should-not-leak/);
    expect(json).not.toMatch(/"password"/);
    expect(json).toMatch(/maxTokensPerCall/);
  });
  it("re-queues interrupted tasks on import", () => {
    const inv = base();
    inv.status = "running";
    inv.tasks.push({ id: "task_1", engine: "searxng", kind: "search", round: 1, input: { query: "x" }, reason: "t", status: "running", createdAt: inv.createdAt, attempts: 1, output: { hits: [], sourceIds: [], leadIds: [], claimIds: [], notes: [] } });
    const r = importInvestigation(exportInvestigation(inv));
    expect(r.investigation!.tasks[0].status).toBe("queued");
    expect(r.investigation!.status).toBe("paused");
  });
});
