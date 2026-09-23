import { api } from "@/lib/api/handler";
import { DomainError } from "@/lib/errors";
import { personDetail } from "@/lib/services/monitoring";

export const GET = api<{ id: string }>(
  async ({ params }) => {
    const p = await personDetail(params.id);
    if (!p) throw new DomainError("Person not found", 404);
    return p;
  },
  { rpm: 600 },
);
