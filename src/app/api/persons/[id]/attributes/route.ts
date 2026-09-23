import { z } from "zod";
import { api, body } from "@/lib/api/handler";
import { ATTRIBUTE_KINDS } from "@/lib/core/types";
import { addAttribute } from "@/lib/services/persons";

const schema = z.object({ kind: z.enum(ATTRIBUTE_KINDS).exclude(["name"]), value: z.string().trim().min(1).max(200), confirm: z.literal(true) });

export const POST = api<{ id: string }>(async ({ req, params, user }) => {
  const b = await body(req, schema);
  await addAttribute(params.id, b.kind, b.value, user!.uid);
  return { ok: true };
});
