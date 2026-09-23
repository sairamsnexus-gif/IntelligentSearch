import { api } from "@/lib/api/handler";
import { queryView } from "@/lib/services/discovery";
import { personSearchHistory } from "@/lib/services/monitoring";

export const GET = api<{ id: string }>(async ({ params }) => {
  const h = await personSearchHistory(params.id);
  return { iterations: h.iterations, queries: h.queries.map(queryView) };
});
