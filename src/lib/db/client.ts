import "server-only";
import path from "node:path";
import fs from "node:fs";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import * as schema from "./schema";
import { env } from "@/lib/config/env";
import { log } from "@/lib/security/logger";

export type Db = NodePgDatabase<typeof schema>;

interface DbHolder {
  promise?: Promise<Db>;
  close?: () => Promise<void>;
  driver?: "postgres" | "pglite";
}

// Survive Next.js dev hot-reloads and multiple module instances in one process.
const g = globalThis as unknown as { __isDb?: DbHolder };
const holder: DbHolder = (g.__isDb ??= {});

function migrationsFolder() {
  return path.join(process.cwd(), "drizzle");
}

async function init(): Promise<Db> {
  const e = env();
  if (e.DATABASE_URL) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: e.DATABASE_URL, max: 10 });
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder: migrationsFolder() });
    holder.close = () => pool.end();
    holder.driver = "postgres";
    log.info("db.ready", { driver: "postgres" });
    return db;
  }
  // Embedded Postgres (WASM) — zero-config local dev / tests.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzleLite } = await import("drizzle-orm/pglite");
  const { migrate: migrateLite } = await import("drizzle-orm/pglite/migrator");
  const dir = e.PGLITE_DATA_DIR;
  if (!dir.startsWith("memory://")) fs.mkdirSync(path.resolve(dir), { recursive: true });
  const client = new PGlite(dir.startsWith("memory://") ? undefined : path.resolve(dir));
  const db = drizzleLite(client, { schema });
  await migrateLite(db, { migrationsFolder: migrationsFolder() });
  holder.close = () => client.close();
  holder.driver = "pglite";
  log.info("db.ready", { driver: "pglite" });
  return db as unknown as Db;
}

export function getDb(): Promise<Db> {
  if (!holder.promise) {
    holder.promise = init().catch((err) => {
      holder.promise = undefined;
      throw err;
    });
  }
  return holder.promise;
}

export function dbDriver() {
  return holder.driver ?? (env().DATABASE_URL ? "postgres" : "pglite");
}

export async function closeDb() {
  await holder.close?.();
  holder.promise = undefined;
  holder.close = undefined;
}

export { schema };
