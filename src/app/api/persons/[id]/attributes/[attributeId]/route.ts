import { api } from "@/lib/api/handler";
import { removeAttribute } from "@/lib/services/persons";

export const DELETE = api<{ id: string; attributeId: string }>(
  async ({ params, user }) => {
    await removeAttribute(params.id, params.attributeId, user!.uid);
    return { ok: true };
  },
  { access: "admin" },
);
