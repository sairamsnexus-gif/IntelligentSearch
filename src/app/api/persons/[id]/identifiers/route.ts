import { z } from "zod";
import { api, body } from "@/lib/api/handler";
import { PLATFORMS } from "@/lib/core/types";
import { addIdentifier } from "@/lib/services/persons";
import type { VerificationReport } from "@/lib/view-types";

const schema = z.object({
  platform: z.enum(PLATFORMS),
  value: z.string().trim().min(1).max(300),
  /** The user must explicitly confirm after reviewing the verification report. */
  confirm: z.literal(true),
  report: z.any().nullable().optional(),
});

export const POST = api<{ id: string }>(async ({ req, params, user }) => {
  const b = await body(req, schema);
  return addIdentifier(params.id, b.platform, b.value, (b.report as VerificationReport | null) ?? null, user!.uid);
});
