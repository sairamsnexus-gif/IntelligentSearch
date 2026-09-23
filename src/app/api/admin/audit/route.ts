import { desc } from "drizzle-orm";
import { api } from "@/lib/api/handler";
import { getDb, schema } from "@/lib/db/client";

export const GET = api(
  async () => {
    const db = await getDb();
    const rows = await db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.createdAt)).limit(200);
    return { entries: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  },
  { access: "admin" },
);
