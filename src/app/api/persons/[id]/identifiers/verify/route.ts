import { z } from "zod";
import { api, body } from "@/lib/api/handler";
import { PLATFORMS } from "@/lib/core/types";
import { verifyIdentifier } from "@/lib/services/persons";

const schema = z.object({ platform: z.enum(PLATFORMS), value: z.string().trim().min(1).max(300) });

export const POST = api<{ id: string }>(
  async ({ req, params, user }) => {
    const b = await body(req, schema);
    return verifyIdentifier(params.id, b.platform, b.value, user!.uid);
  },
  { rpm: 15 },
);
