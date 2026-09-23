/** User input schema + conversion into a TargetProfile (pure, client-safe). */
import { z } from "zod";
import { canonicalCity, canonicalCountry, canonicalOrg } from "./lexicon";
import { normalizePhone } from "./phone";
import { profileFromInput } from "./profiles";
import type { AttributeKind, AttributeState, Platform, TargetAttribute, TargetIdentifier, TargetProfile } from "./types";

const s = (max = 200) => z.string().trim().max(max).optional().or(z.literal(""));

export { PURPOSES } from "./labels";
import { PURPOSES } from "./labels";

export const personQuerySchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  city: s(),
  state: s(),
  country: s(),
  organization: s(),
  designation: s(),
  linkedin: s(300),
  instagram: s(300),
  facebook: s(300),
  x: s(300),
  youtube: s(300),
  github: s(300),
  reddit: s(300),
  otherSocial: s(300),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  phone: s(40),
  website: s(300),
  previousOrganization: s(),
  school: s(),
  approximateAge: s(10),
  otherInfo: s(1000),
  freeText: s(2000),
  purpose: z.enum(PURPOSES).default("due_diligence"),
});

export type PersonQuery = z.infer<typeof personQuerySchema>;

const FIELD_TO_KIND: [keyof PersonQuery, AttributeKind][] = [
  ["city", "city"],
  ["state", "state"],
  ["country", "country"],
  ["organization", "organization"],
  ["designation", "designation"],
  ["previousOrganization", "previous_organization"],
  ["school", "school"],
  ["approximateAge", "age"],
  ["email", "email"],
  ["phone", "phone"],
  ["website", "website"],
  ["otherInfo", "other"],
];

const FIELD_TO_PLATFORM: [keyof PersonQuery, Platform][] = [
  ["linkedin", "linkedin"],
  ["instagram", "instagram"],
  ["facebook", "facebook"],
  ["x", "x"],
  ["youtube", "youtube"],
  ["github", "github"],
  ["reddit", "reddit"],
  ["otherSocial", "other_social"],
];

export function canonicalAttributeValue(kind: AttributeKind, value: string, country?: string): string {
  const v = value.trim();
  switch (kind) {
    case "city":
      return canonicalCity(v);
    case "country":
      return canonicalCountry(v);
    case "organization":
    case "previous_organization":
      return canonicalOrg(v);
    case "email":
      return v.toLowerCase();
    case "phone":
      return normalizePhone(v, country).e164 ?? v;
    case "age": {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? String(n) : v;
    }
    default:
      return v;
  }
}

export function buildTargetProfile(q: PersonQuery, state: AttributeState = "user_supplied"): TargetProfile {
  const attributes: TargetAttribute[] = [];
  const country = q.country ? canonicalCountry(q.country) : undefined;
  for (const [field, kind] of FIELD_TO_KIND) {
    const raw = q[field];
    if (typeof raw === "string" && raw.trim()) {
      attributes.push({ kind, value: canonicalAttributeValue(kind, raw, country), state });
    }
  }
  const identifiers: TargetIdentifier[] = [];
  for (const [field, platform] of FIELD_TO_PLATFORM) {
    const raw = q[field];
    if (typeof raw === "string" && raw.trim()) {
      const p = profileFromInput(platform, raw);
      if (p) identifiers.push({ platform, handle: p.handle, url: p.url || undefined, state });
    }
  }
  return { name: q.name.trim().replace(/\s+/g, " "), attributes, identifiers };
}

/** Merge extra attributes/identifiers into a profile without duplicates. */
export function mergeIntoProfile(
  base: TargetProfile,
  extraAttrs: TargetAttribute[],
  extraIds: TargetIdentifier[],
): TargetProfile {
  const attrs = [...base.attributes];
  for (const a of extraAttrs) {
    if (!attrs.some((b) => b.kind === a.kind && b.value.toLowerCase() === a.value.toLowerCase())) attrs.push(a);
  }
  const ids = [...base.identifiers];
  for (const i of extraIds) {
    if (!ids.some((b) => b.platform === i.platform && b.handle === i.handle)) ids.push(i);
  }
  return { name: base.name, attributes: attrs, identifiers: ids };
}

export { ATTRIBUTE_LABEL } from "./labels";
