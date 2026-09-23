import { z } from "zod";
import { api, body } from "@/lib/api/handler";
import { canonicalAttributeValue } from "@/lib/core/input";
import { profileFromInput } from "@/lib/core/profiles";
import { ATTRIBUTE_KINDS, PLATFORMS, type TargetAttribute, type TargetIdentifier } from "@/lib/core/types";
import { DomainError } from "@/lib/errors";
import { refineSession } from "@/lib/services/discovery";

const schema = z.object({
  attributes: z.array(z.object({ kind: z.enum(ATTRIBUTE_KINDS), value: z.string().trim().min(1).max(200) })).max(10).default([]),
  identifiers: z.array(z.object({ platform: z.enum(PLATFORMS), value: z.string().trim().min(1).max(300) })).max(10).default([]),
});

export const POST = api<{ id: string }>(
  async ({ req, params }) => {
    const b = await body(req, schema);
    const attrs: TargetAttribute[] = b.attributes.filter((a) => a.kind !== "name").map((a) => ({ kind: a.kind, value: canonicalAttributeValue(a.kind, a.value), state: "user_supplied" }));
    const ids: TargetIdentifier[] = [];
    for (const i of b.identifiers) {
      const p = profileFromInput(i.platform, i.value);
      if (!p) throw new DomainError(`Invalid ${i.platform} value`);
      ids.push({ platform: i.platform, handle: p.handle, url: p.url || undefined, state: "user_supplied" });
    }
    if (!attrs.length && !ids.length) throw new DomainError("Provide at least one detail");
    try {
      await refineSession(params.id, attrs, ids);
    } catch (e) {
      throw new DomainError(e instanceof Error ? e.message : "Cannot refine", 409);
    }
    return { ok: true };
  },
  { rpm: 20 },
);
