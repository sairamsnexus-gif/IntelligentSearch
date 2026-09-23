import "server-only";
/** Registers job handlers and (optionally) starts the in-process worker + scheduler. */
import "./discovery";
import "./monitoring";
import { startWorker } from "./jobs";
import { schedulerTick } from "./monitoring";
import { getDb, schema } from "@/lib/db/client";
import { env } from "@/lib/config/env";

async function heartbeat() {
  const db = await getDb();
  const value = { at: new Date().toISOString(), pid: process.pid };
  await db.insert(schema.appState).values({ key: "worker_heartbeat", value }).onConflictDoUpdate({ target: schema.appState.key, set: { value, updatedAt: new Date() } });
}

export function ensureWorker(force = false) {
  if (!force && env().RUN_WORKER_IN_PROCESS !== "true") return;
  startWorker({
    concurrency: 2,
    onTick: async () => {
      await heartbeat();
      await schedulerTick();
    },
  });
}
