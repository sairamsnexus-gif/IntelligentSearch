"use client";
/**
 * Browser-local persistence (IndexedDB). The investigation never leaves the
 * browser except through an explicit JSON export or the per-task engine calls.
 * Nothing is auto-cleared after export.
 */
import type { Investigation } from "@/lib/nexus/schema";

const DB = "nexus";
const STORE = "investigations";
const KEY = "current";

export interface AutosaveRecord {
  savedAt: string;
  lastExportedAt: string | null;
  investigation: Investigation;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

export async function loadAutosave(): Promise<AutosaveRecord | null> {
  try {
    return ((await tx("readonly", (s) => s.get(KEY))) as AutosaveRecord | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveAutosave(rec: AutosaveRecord): Promise<boolean> {
  try {
    await tx("readwrite", (s) => s.put(rec, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function clearAutosave(): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(KEY));
  } catch {
    /* ignore */
  }
}
