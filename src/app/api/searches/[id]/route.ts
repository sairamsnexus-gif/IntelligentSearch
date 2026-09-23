import { api } from "@/lib/api/handler";
import { DomainError } from "@/lib/errors";
import { getSessionView } from "@/lib/services/discovery";

export const GET = api<{ id: string }>(
  async ({ params, user }) => {
    const v = await getSessionView(params.id, user!.role === "admin" ? null : user!.uid);
    if (!v) throw new DomainError("Search not found", 404);
    return v;
  },
  { rpm: 600 },
);
