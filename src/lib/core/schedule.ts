/** Pure scheduling maths used by the monitoring scheduler and job queue. */

export interface ScheduleState {
  status: "active" | "paused";
  intervalHours: number;
  nextRunAt: Date | null;
  running: boolean;
}

export function nextRunAt(from: Date, intervalHours: number): Date {
  return new Date(from.getTime() + intervalHours * 3_600_000);
}

export function isDue(s: ScheduleState, now: Date): boolean {
  if (s.status !== "active" || s.running) return false;
  return !s.nextRunAt || s.nextRunAt.getTime() <= now.getTime();
}

/** Exponential backoff with jitter cap: 30s, 60s, 120s … max 1h. */
export function backoffMs(attempt: number, baseMs = 30_000, maxMs = 3_600_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

/** A monitoring run that has held its lock longer than this is considered crashed. */
export const STALE_RUN_MS = 30 * 60_000;

export function isStale(lockedAt: Date | null, now: Date): boolean {
  return Boolean(lockedAt && now.getTime() - lockedAt.getTime() > STALE_RUN_MS);
}
