import { describe, expect, it } from "vitest";
import { compareNames, findNameInText, nameVariants, norm } from "@/lib/core/text";
import { canonicalCity, canonicalCountry, canonicalOrg, sameOrg } from "@/lib/core/lexicon";
import { parseProfileUrl, profileFromInput } from "@/lib/core/profiles";
import { normalizePhone } from "@/lib/core/phone";
import { extractFromFreeText } from "@/lib/core/freetext";
import { buildTargetProfile, personQuerySchema } from "@/lib/core/input";
import { extractSignals } from "@/lib/core/extract";
import { demoResult, target } from "../fixtures";

describe("text & names", () => {
  it("normalises case, diacritics, punctuation", () => {
    expect(norm("  Rájesh   KUMAR, ")).toBe("rajesh kumar");
  });
  it("builds name variants", () => {
    expect(nameVariants("Rajesh Kumar").map((v) => v.value)).toEqual(["Rajesh Kumar", "Rajesh K", "R Kumar", "RajeshKumar", "Kumar Rajesh"]);
  });
  it("compares names without over-matching", () => {
    expect(compareNames("Rajesh Kumar", "rajesh kumar")).toBe("exact");
    expect(compareNames("Rajesh Kumar", "R Kumar")).toBe("variant");
    expect(compareNames("Rajesh Kumar", "Rajesh K Kumar")).toBe("variant");
    expect(compareNames("Rajesh Kumar", "Kumar Rajesh")).toBe("variant");
    expect(compareNames("Rajesh Kumar", "Rajesh Sharma")).toBe("none");
    expect(compareNames("Rajesh Kumar", "Ramesh Kumar")).toBe("none");
  });
  it("finds names in text including middle initials", () => {
    expect(findNameInText("Rajesh Kumar", norm("By Rajesh K Kumar, photographer"))).toBeTruthy();
    expect(findNameInText("Rajesh Kumar", norm("Rajeshwari Kumaran spoke"))).toBeUndefined();
  });
});

describe("attribute normalisation", () => {
  it("canonicalises organisations, cities, countries", () => {
    expect(canonicalOrg("Tata Consultancy Services")).toBe("TCS");
    expect(canonicalOrg("infosys ltd")).toBe("Infosys");
    expect(sameOrg("HCL Technologies", "HCLTech")).toBe(true);
    expect(canonicalCity("Madras")).toBe("Chennai");
    expect(canonicalCity("bangalore")).toBe("Bengaluru");
    expect(canonicalCountry("UK")).toBe("United Kingdom");
  });

  it("parses social profile URLs and handles", () => {
    expect(parseProfileUrl("https://www.linkedin.com/in/rajeshkumar-pm-chennai/")).toEqual({ platform: "linkedin", handle: "rajeshkumar-pm-chennai", url: "https://www.linkedin.com/in/rajeshkumar-pm-chennai" });
    expect(parseProfileUrl("https://github.com/rajeshkumar78")?.handle).toBe("rajeshkumar78");
    expect(parseProfileUrl("https://github.com/rajeshkumar78/sprint-tools")).toBeUndefined();
    expect(parseProfileUrl("https://www.instagram.com/p/abc123")).toBeUndefined();
    expect(parseProfileUrl("https://twitter.com/RKumar")?.platform).toBe("x");
    expect(parseProfileUrl("https://www.youtube.com/@agiletalks-rajesh")?.handle).toBe("agiletalks-rajesh");
    expect(profileFromInput("instagram", "@RajeshKumar78")).toEqual({ platform: "instagram", handle: "rajeshkumar78", url: "https://www.instagram.com/rajeshkumar78" });
    expect(profileFromInput("instagram", "bad handle!")).toBeUndefined();
  });

  it("normalises phone numbers internationally (signal only)", () => {
    const p = normalizePhone("098400 12345", "India");
    expect(p.e164).toBe("+919840012345");
    expect(p.country).toBe("IN");
    expect(p.valid).toBe(true);
    expect(normalizePhone("+44 20 7946 0958").country).toBe("GB");
    expect(normalizePhone("12").valid).toBe(false);
  });

  it("validates user input and builds a target profile", () => {
    expect(personQuerySchema.safeParse({ name: "" }).success).toBe(false);
    const q = personQuerySchema.parse({ name: " Rajesh  Kumar ", organization: "Tata Consultancy Services", city: "madras", linkedin: "https://in.linkedin.com/in/example" });
    const t = buildTargetProfile(q);
    expect(t.name).toBe("Rajesh Kumar");
    expect(t.attributes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "organization", value: "TCS" }), expect.objectContaining({ kind: "city", value: "Chennai" })]));
    expect(t.identifiers[0]).toMatchObject({ platform: "linkedin", handle: "example" });
  });
});

describe("free-text extraction", () => {
  it("extracts attributes from the 'anything else' note", () => {
    const x = extractFromFreeText("He worked at Infosys before TCS, probably around 40, lives in Chennai and may have a YouTube channel.");
    const get = (k: string) => x.attributes.filter((a) => a.kind === k).map((a) => a.value);
    expect(get("previous_organization")).toEqual(["Infosys"]);
    expect(get("organization")).toEqual(["TCS"]);
    expect(get("age")).toEqual(["40"]);
    expect(get("city")).toEqual(["Chennai"]);
    expect(x.platformHints).toContain("youtube");
  });
  it("extracts identifiers and contact details", () => {
    const x = extractFromFreeText("His GitHub is github.com/rkumar-data and email rk@example.com, studied at Anna University");
    expect(x.identifiers[0]).toMatchObject({ platform: "github", handle: "rkumar-data" });
    expect(x.attributes.find((a) => a.kind === "email")?.value).toBe("rk@example.com");
    expect(x.attributes.find((a) => a.kind === "school")?.value).toBe("Anna University");
  });
});

describe("signal extraction", () => {
  it("extracts literal, explainable signals from a result", () => {
    const s = extractSignals(demoResult("p1-linkedin"), target());
    expect(s.nameHit).toBe(true);
    expect(s.subjectProfile).toMatchObject({ platform: "linkedin", handle: "rajeshkumar-pm-chennai" });
    expect(s.mentionedProfiles).toEqual([expect.objectContaining({ platform: "github", handle: "rajeshkumar78" })]);
    expect(s.organizations).toEqual(["TCS"]);
    expect(s.previousOrganizations).toEqual(["Infosys"]);
    expect(s.designations).toEqual(["Project Manager"]);
    expect(s.cities).toEqual(["Chennai"]);
    expect(s.countries).toContain("India");
  });
  it("detects 'joined X from Y' and ages", () => {
    const s = extractSignals(demoResult("p1-news-award"), target());
    expect(s.previousOrganizations).toEqual(["Infosys"]);
    expect(s.organizations).toEqual(["TCS"]);
    expect(s.ages).toEqual([40]);
  });
});
