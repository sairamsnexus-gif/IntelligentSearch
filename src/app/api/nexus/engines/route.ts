import { api } from "@/lib/api/handler";
import { enginesResponse } from "@/lib/nexus/engines";

export const dynamic = "force-dynamic";

export const GET = api(async () => enginesResponse(), { rpm: 60 });
