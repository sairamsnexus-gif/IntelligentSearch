/**
 * JSON export / import with validation, integrity checks and migrations.
 * Investigations never contain API keys or secrets.
 */
import { investigationSchema, NEXUS_SCHEMA_ID, NEXUS_SCHEMA_VERSION, type Investigation } from "./schema";

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

const SECRET_KEYS = /^(api[_-]?key|apikey|x[_-]api[_-]key|secret|client[_-]?secret|[a-z]*[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|id[_-]?token|session[_-]?token|token|password|passwd|authorization|cookie|set[_-]cookie|bearer|credentials?)$/i;

/** Defence in depth: refuse to export anything that looks like a credential field. */
function stripSecrets(v: unknown, depth = 0): unknown {
  if (depth > 12) return v;
  if (Array.isArray(v)) return v.map((x) => stripSecrets(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (!SECRET_KEYS.test(k)) out[k] = stripSecrets(val, depth + 1);
    return out;
  }
  return v;
}

export function exportInvestigation(inv: Investigation): string {
  const clean = stripSecrets(inv) as Investigation;
  return JSON.stringify({ ...clean, exportedAt: new Date().toISOString() }, null, 2);
}

export function exportFileName(inv: Investigation): string {
  const slug = inv.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "investigation";
  return `nexus-${slug}-${inv.updatedAt.slice(0, 10)}.json`;
}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** schemaVersion N → N+1. Version 0 = pre-release drafts without schema markers. */
const MIGRATIONS: Record<number, Migration> = {
  0: (raw) => ({
    ...raw,
    schema: NEXUS_SCHEMA_ID,
    schemaVersion: 1,
    quota: raw.quota ?? [],
    usage: raw.usage ?? { llmCalls: 0, llmTokens: 0, searchCalls: {} },
    checkpoint: raw.checkpoint ?? null,
    stopReason: raw.stopReason ?? null,
    synthetic: raw.synthetic ?? false,
  }),
};

export function migrate(raw: Record<string, unknown>): { data: Record<string, unknown>; migratedFrom: number | null } {
  let v = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;
  const from = v;
  if (v > NEXUS_SCHEMA_VERSION) throw new Error(`File uses schema v${v}, newer than this app (v${NEXUS_SCHEMA_VERSION}). Update NEXUS to open it.`);
  let data = raw;
  while (v < NEXUS_SCHEMA_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`No migration from schema v${v}`);
    data = m(data);
    v += 1;
  }
  return { data, migratedFrom: from === NEXUS_SCHEMA_VERSION ? null : from };
}

export function integrityErrors(inv: Investigation): string[] {
  const errs: string[] = [];
  const ent = new Set(inv.entities.map((e) => e.id));
  const src = new Set(inv.sources.map((s) => s.id));
  const psg = new Set(inv.passages.map((p) => p.id));
  const tasks = new Set(inv.tasks.map((t) => t.id));
  for (const p of inv.passages) if (!src.has(p.sourceId)) errs.push(`Passage ${p.id} references missing source ${p.sourceId}`);
  for (const r of inv.relationships) {
    if (!ent.has(r.subjectId) || !ent.has(r.objectId)) errs.push(`Relationship ${r.id} references a missing entity`);
    for (const e of r.evidence) if (!src.has(e.sourceId) || !psg.has(e.passageId)) errs.push(`Relationship ${r.id} references missing evidence`);
  }
  for (const c of inv.claims) {
    if (!ent.has(c.subjectId)) errs.push(`Claim ${c.id} references missing entity`);
    if (!src.has(c.sourceId) || !psg.has(c.passageId)) errs.push(`Claim ${c.id} references missing evidence`);
  }
  for (const c of inv.contacts) if (!ent.has(c.entityId) || !src.has(c.sourceId)) errs.push(`Contact ${c.id} references a missing record`);
  for (const l of inv.leads) for (const t of l.taskIds) if (!tasks.has(t)) errs.push(`Lead ${l.id} references missing task ${t}`);
  return errs.slice(0, 50);
}

export interface ImportResult {
  ok: boolean;
  investigation?: Investigation;
  errors: string[];
  warnings: string[];
}

export function importInvestigation(text: string, byteLength = text.length): ImportResult {
  if (byteLength > MAX_IMPORT_BYTES) return { ok: false, errors: [`File is ${(byteLength / 1e6).toFixed(1)} MB; the limit is ${MAX_IMPORT_BYTES / 1e6} MB`], warnings: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["Not valid JSON"], warnings: [] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["Top level must be an object"], warnings: [] };
  const r = raw as Record<string, unknown>;
  if (r.schema !== undefined && r.schema !== NEXUS_SCHEMA_ID) return { ok: false, errors: [`Not a NEXUS investigation (schema "${String(r.schema)}")`], warnings: [] };
  const warnings: string[] = [];
  let data: Record<string, unknown>;
  try {
    const m = migrate(r);
    data = m.data;
    if (m.migratedFrom !== null) warnings.push(`Migrated from schema v${m.migratedFrom} to v${NEXUS_SCHEMA_VERSION}`);
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : "Migration failed"], warnings };
  }
  delete data.exportedAt;
  const parsed = investigationSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`), warnings };
  }
  const inv = parsed.data;
  const errs = integrityErrors(inv);
  if (errs.length) return { ok: false, errors: errs, warnings };
  // Work interrupted mid-flight resumes from the checkpoint.
  let resumed = 0;
  for (const t of inv.tasks)
    if (t.status === "running") {
      t.status = "queued";
      resumed++;
    }
  if (resumed) warnings.push(`${resumed} interrupted task(s) re-queued`);
  if (inv.status === "running") inv.status = "paused";
  return { ok: true, investigation: inv, errors: [], warnings };
}
