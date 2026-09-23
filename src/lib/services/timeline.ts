import "server-only";
import { getDb, schema, type Db } from "@/lib/db/client";

type Inserter = Pick<Db, "insert">;

export async function addTimeline(
  db: Inserter,
  e: { personId: string; type: string; title: string; detail?: string | null; occurredAt?: Date; url?: string | null; evidenceId?: string | null; sourceId?: string | null; changeId?: string | null },
) {
  await db.insert(schema.timelineEvents).values({
    personId: e.personId,
    type: e.type,
    title: e.title,
    detail: e.detail ?? null,
    occurredAt: e.occurredAt ?? new Date(),
    url: e.url ?? null,
    evidenceId: e.evidenceId ?? null,
    sourceId: e.sourceId ?? null,
    changeId: e.changeId ?? null,
  });
}

/** Responsible-use audit trail: who searched/locked/changed what (ids only, no payloads). */
export async function audit(userId: string | null, action: string, target: string | null, meta: Record<string, unknown> = {}) {
  const db = await getDb();
  await db.insert(schema.auditLog).values({ userId, action, target, meta });
}
