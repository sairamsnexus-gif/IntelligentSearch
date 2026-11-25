import { eq } from "drizzle-orm";
import { api } from "@/lib/api/handler";
import { activeAdapters, computeCoverage } from "@/lib/adapters/registry";
import { dbDriver, getDb, schema } from "@/lib/db/client";
import { aiConfigured } from "@/lib/ai/assist";
import { env } from "@/lib/config/env";

export const GET = api(async ({ user }) => {
  const active = await activeAdapters();
  const db = await getDb();
  const hb = await db.query.appState.findFirst({ where: eq(schema.appState.key, "worker_heartbeat") });
  const at = (hb?.value as { at?: string } | undefined)?.at;
  return {
    user: user ? { email: user.email, role: user.role } : null,
    demo: active.demo,
    demoReason: active.demoReason,
    coverage: computeCoverage(active),
    adapters: [...new Set([...active.search, ...active.username, ...active.monitor].map((a) => a.name))],
    worker: { lastHeartbeat: at ?? null, healthy: Boolean(at && Date.now() - Date.parse(at) < 90_000) },
    db: dbDriver(),
    ai: aiConfigured(),
    monitorIntervalHours: env().MONITOR_INTERVAL_HOURS,
    maxIterations: env().MAX_DISCOVERY_ITERATIONS,
  };
});
