/**
 * Standalone background worker for production:
 *   RUN_WORKER_IN_PROCESS=false in the web app, then `npm run worker`.
 * Requires DATABASE_URL (PGlite is single-process and cannot be shared).
 */
import { ensureWorker } from "@/lib/services/bootstrap";
import { closeDb, getDb } from "@/lib/db/client";
import { log } from "@/lib/security/logger";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("The standalone worker needs DATABASE_URL (Postgres). For local dev keep RUN_WORKER_IN_PROCESS=true instead.");
    process.exit(1);
  }
  await getDb();
  ensureWorker(true);
  log.info("worker.standalone_ready", {});
  const stop = async () => {
    log.info("worker.stopping", {});
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

void main();
