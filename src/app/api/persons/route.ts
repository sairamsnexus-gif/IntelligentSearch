import { z } from "zod";
import { api, body } from "@/lib/api/handler";
import { lockPerson } from "@/lib/services/persons";
import { listPersons } from "@/lib/services/monitoring";

const lockSchema = z.object({
  sessionId: z.string().uuid(),
  candidateKey: z.string().min(1).max(40),
  /** Explicit human confirmation is mandatory — the system never locks on its own. */
  confirm: z.literal(true),
});

export const GET = api(async () => ({ persons: await listPersons() }));

export const POST = api(
  async ({ req, user }) => {
    const b = await body(req, lockSchema);
    return lockPerson(b.sessionId, b.candidateKey, user!.uid);
  },
  { rpm: 20 },
);
