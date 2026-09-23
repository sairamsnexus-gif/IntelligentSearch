import { z } from "zod";
import { api, body } from "@/lib/api/handler";
import { updateMonitoring } from "@/lib/services/monitoring";

const schema = z.object({ status: z.enum(["active", "paused"]).optional(), intervalHours: z.number().int().min(1).max(720).optional() });

export const PATCH = api<{ id: string }>(
  async ({ req, params, user }) => {
    const b = await body(req, schema);
    await updateMonitoring(params.id, b, user!.uid);
    return { ok: true };
  },
  { access: "admin" },
);
