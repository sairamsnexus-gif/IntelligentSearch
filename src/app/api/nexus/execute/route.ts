import { z } from "zod";
import { api, body } from "@/lib/api/handler";
import { executeTask } from "@/lib/nexus/engines";
import { ENGINE_IDS, TASK_KINDS } from "@/lib/nexus/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

const schema = z.object({
  task: z.object({
    id: z.string().min(1).max(64),
    engine: z.enum(ENGINE_IDS),
    kind: z.enum(TASK_KINDS),
    input: z.object({ query: z.string().max(500).optional(), url: z.string().url().max(2000).optional(), domain: z.string().max(253).optional(), username: z.string().max(60).optional() }),
    jobRef: z.string().max(200).optional(),
  }),
  context: z.object({
    synthetic: z.boolean(),
    clueNames: z.array(z.string().max(120)).max(12),
    places: z.array(z.string().max(120)).max(12),
    organisationHints: z.array(z.string().max(200)).max(12),
    llm: z.object({ enabled: z.boolean(), remainingCalls: z.number().int().min(0).max(1000), maxTokensPerCall: z.number().int().min(64).max(8000) }),
  }),
});

/** Executes ONE unit task for the browser-side orchestrator (stateless; no investigation data is stored server-side). */
export const POST = api(async ({ req }) => executeTask(await body(req, schema)), { rpm: 300 });
