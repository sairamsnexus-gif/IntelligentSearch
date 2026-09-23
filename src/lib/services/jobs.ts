import "server-only";
/**
 * Postgres-backed job queue (FOR UPDATE SKIP LOCKED) — no Redis required.
 * Runs in-process for local dev (RUN_WORKER_IN_PROCESS=true) or as a separate
 * `npm run worker` process in production.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { backoffMs, STALE_RUN_MS } from "@/lib/core/schedule";
import { log } from "@/lib/security/logger";

export type JobType = "discovery" | "baseline" | "monitor_scan";

export interface JobRow {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

type Handler = (payload: Record<string, unknown>, job: JobRow) => Promise<void>;
const handlers = new Map<JobType, Handler>();

export function registerHandler(type: JobType, h: Handler) {
  handlers.set(type, h);
}

export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: { runAfter?: Date; maxAttempts?: number } = {}) {
  const db = await getDb();
  const [row] = await db
    .insert(schema.jobs)
    .values({ type, payload, runAfter: opts.runAfter ?? new Date(), maxAttempts: opts.maxAttempts ?? 3 })
    .returning({ id: schema.jobs.id });
  kick();
  return row.id;
}

async function claim(workerId: string): Promise<JobRow | null> {
  const db = await getDb();
  const res = await db.execute(sql`
    UPDATE jobs SET status = 'running', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs WHERE status = 'queued' AND run_after <= now()
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts, max_attempts`);
  const r = (res as unknown as { rows: Record<string, unknown>[] }).rows[0];
  if (!r) return null;
  return { id: String(r.id), type: r.type as JobType, payload: (r.payload ?? {}) as Record<string, unknown>, attempts: Number(r.attempts), maxAttempts: Number(r.max_attempts) };
}

async function finish(job: JobRow, err?: unknown) {
  const db = await getDb();
  if (!err) {
    await db.update(schema.jobs).set({ status: "done", finishedAt: new Date(), lastError: null }).where(eq(schema.jobs.id, job.id));
    return;
  }
  const message = err instanceof Error ? err.message.slice(0, 500) : "failed";
  const retry = job.attempts < job.maxAttempts;
  await db
    .update(schema.jobs)
    .set(retry ? { status: "queued", runAfter: new Date(Date.now() + backoffMs(job.attempts, 5_000, 300_000)), lastError: message, lockedAt: null } : { status: "failed", finishedAt: new Date(), lastError: message })
    .where(eq(schema.jobs.id, job.id));
  log.error("job.failed", { jobId: job.id, type: job.type, attempt: job.attempts, willRetry: retry, error: message });
}

export async function recoverStaleJobs() {
  const db = await getDb();
  await db
    .update(schema.jobs)
    .set({ status: "queued", lockedAt: null })
    .where(and(eq(schema.jobs.status, "running"), lt(schema.jobs.lockedAt, new Date(Date.now() - STALE_RUN_MS))));
}

/** Process at most one job. Returns true if a job ran. Exposed for tests. */
export async function runOnce(workerId = "inline"): Promise<boolean> {
  const job = await claim(workerId);
  if (!job) return false;
  const h = handlers.get(job.type);
  try {
    if (!h) throw new Error(`No handler for job type ${job.type}`);
    await h(job.payload, job);
    await finish(job);
  } catch (e) {
    await finish(job, e);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Worker loop

interface WorkerState {
  started: boolean;
  active: number;
  timer?: ReturnType<typeof setInterval>;
  wake?: () => void;
  onTick?: () => Promise<void>;
}
const g = globalThis as unknown as { __isWorker?: WorkerState };
const ws: WorkerState = (g.__isWorker ??= { started: false, active: 0 });

function kick() {
  ws.wake?.();
}

export function startWorker(opts: { concurrency?: number; onTick?: () => Promise<void>; workerId?: string } = {}) {
  if (ws.started) return;
  ws.started = true;
  ws.onTick = opts.onTick;
  const concurrency = opts.concurrency ?? 2;
  const workerId = opts.workerId ?? `worker-${process.pid}`;
  const pump = async () => {
    while (ws.active < concurrency) {
      ws.active++;
      let ran = false;
      try {
        ran = await runOnce(workerId);
      } catch (e) {
        log.error("worker.pump_error", { error: e instanceof Error ? e.message : "unknown" });
      } finally {
        ws.active--;
      }
      if (!ran) break;
    }
  };
  ws.wake = () => void pump();
  let ticks = 0;
  ws.timer = setInterval(() => {
    void pump();
    if (ticks++ % 30 === 0) {
      void recoverStaleJobs().catch(() => undefined);
      void ws.onTick?.().catch((e) => log.error("worker.tick_error", { error: e instanceof Error ? e.message : "unknown" }));
    }
  }, 1000);
  log.info("worker.started", { workerId, concurrency });
}

export function workerStarted() {
  return ws.started;
}
