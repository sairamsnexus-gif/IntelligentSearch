import { api } from "@/lib/api/handler";
import { sessionQueries } from "@/lib/services/discovery";

export const GET = api<{ id: string }>(async ({ params }) => ({ queries: await sessionQueries(params.id) }));
