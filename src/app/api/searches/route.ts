import { api, body } from "@/lib/api/handler";
import { personQuerySchema } from "@/lib/core/input";
import { createSession } from "@/lib/services/discovery";
import { listRecentSessions } from "@/lib/services/persons";
import { audit } from "@/lib/services/timeline";

export const POST = api(
  async ({ req, user }) => {
    const q = await body(req, personQuerySchema);
    const id = await createSession(q, user!.uid);
    await audit(user!.uid, "search.create", id, { purpose: q.purpose });
    return { id };
  },
  { rpm: 20 },
);

export const GET = api(async ({ user }) => ({ sessions: await listRecentSessions(user!.uid, 12) }));
