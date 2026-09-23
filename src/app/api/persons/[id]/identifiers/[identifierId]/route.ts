import { api } from "@/lib/api/handler";
import { removeIdentifier } from "@/lib/services/persons";

export const DELETE = api<{ id: string; identifierId: string }>(
  async ({ params, user }) => {
    await removeIdentifier(params.id, params.identifierId, user!.uid);
    return { ok: true };
  },
  { access: "admin" },
);
