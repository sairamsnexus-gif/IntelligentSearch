import { api } from "@/lib/api/handler";
import { triggerScan } from "@/lib/services/monitoring";

export const POST = api<{ id: string }>(
  async ({ params, user }) => {
    await triggerScan(params.id, user!.uid);
    return { ok: true };
  },
  { rpm: 10 },
);
