import { api } from "@/lib/api/handler";
import { markChangesSeen } from "@/lib/services/monitoring";

export const POST = api<{ id: string }>(async ({ params }) => {
  await markChangesSeen(params.id);
  return { ok: true };
});
