"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseClues } from "@/lib/nexus/clues";
import { createInvestigation, ENGINE_IDS, type EngineId, type Investigation, type Lead, type Settings } from "@/lib/nexus/schema";
import { InvestigationRunner, makeTask, requeueQuotaTasks } from "@/lib/nexus/orchestrator";
import { setDecision, trail } from "@/lib/nexus/ledger";
import { exportFileName, exportInvestigation, importInvestigation } from "@/lib/nexus/io";
import type { EnginesResponse, ExecuteRequest, TaskResult } from "@/lib/nexus/engine-types";
import { useApi } from "@/lib/hooks";
import { clearAutosave, loadAutosave, saveAutosave, type AutosaveRecord } from "./storage";

export interface StartOptions {
  text: string;
  urls: string[];
  usernames: string[];
  settings: Partial<Settings>;
  synthetic: boolean;
}

async function executeRemote(req: ExecuteRequest): Promise<TaskResult> {
  const res = await fetch("/api/nexus/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
  if (res.status === 401) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- session expired: hard redirect clears stale state
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    throw new Error("Session expired");
  }
  if (res.status === 429) return { taskId: req.task.id, engine: req.task.engine, status: "quota", quota: { provider: "nexus api", status: 429, message: "NEXUS API rate limit — slow down", retryAfterSec: Number(res.headers.get("retry-after")) || 60 } };
  const data = (await res.json().catch(() => null)) as TaskResult | { error?: string } | null;
  if (!res.ok || !data || !("status" in data)) return { taskId: req.task.id, engine: req.task.engine, status: "failed", error: (data as { error?: string } | null)?.error ?? `HTTP ${res.status}` };
  return data;
}

const nowIso = () => new Date().toISOString();

export function useInvestigation() {
  const [inv, setInv] = useState<Investigation | null>(null);
  const ref = useRef<Investigation | null>(null);
  const runner = useRef<InvestigationRunner | null>(null);
  const [running, setRunning] = useState(false);
  const [lastExportedAt, setLastExportedAt] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<AutosaveRecord | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "failed">("idle");
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "alert"; text: string } | null>(null);
  const { data: engines } = useApi<EnginesResponse>("/api/nexus/engines");

  // Render throttle: the runner mutates frequently; paint at most every 120ms.
  const pending = useRef<number | null>(null);
  const commit = useCallback((next: Investigation | null, immediate = false) => {
    ref.current = next;
    if (immediate) {
      setInv(next);
      return;
    }
    if (pending.current !== null) return;
    pending.current = window.setTimeout(() => {
      pending.current = null;
      setInv(ref.current);
    }, 120);
  }, []);

  // --- recovery on load
  useEffect(() => {
    void loadAutosave().then((rec) => {
      if (rec?.investigation) setRecovery(rec);
    });
  }, []);

  // --- autosave (debounced)
  useEffect(() => {
    if (!inv) return;
    const t = window.setTimeout(() => {
      void saveAutosave({ savedAt: nowIso(), lastExportedAt, investigation: inv }).then((ok) => setSaveState(ok ? "saved" : "failed"));
    }, 800);
    return () => window.clearTimeout(t);
  }, [inv, lastExportedAt]);

  const dirty = Boolean(inv && (!lastExportedAt || inv.updatedAt > lastExportedAt));

  // --- warn before leaving with unexported work
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const availableFor = useCallback(
    (i: Investigation): Set<EngineId> => {
      if (i.synthetic) return new Set(ENGINE_IDS);
      return new Set((engines?.engines ?? []).filter((e) => e.available).map((e) => e.id));
    },
    [engines],
  );

  const run = useCallback(async () => {
    const cur = ref.current;
    if (!cur || runner.current?.isRunning) return;
    const r = new InvestigationRunner({ get: () => ref.current!, set: (n) => commit(n), executor: executeRemote, available: availableFor(cur) });
    runner.current = r;
    setRunning(true);
    try {
      await r.run();
    } catch (e) {
      setMessage({ tone: "alert", text: `Investigation halted: ${e instanceof Error ? e.message : "unknown error"} — findings so far are preserved.` });
    } finally {
      setRunning(false);
      commit(ref.current, true);
    }
  }, [availableFor, commit]);

  const start = useCallback(
    (o: StartOptions) => {
      const clues = parseClues(o.text);
      for (const u of o.urls) if (!clues.urls.includes(u)) clues.urls.push(u);
      for (const u of o.usernames) if (!clues.usernames.includes(u)) clues.usernames.push(u);
      const next = createInvestigation(o.text, clues, { ...o.settings, synthetic: o.synthetic });
      next.synthetic = o.synthetic;
      setLastExportedAt(null);
      setMessage(null);
      commit(next, true);
      void run();
    },
    [commit, run],
  );

  const pause = useCallback(() => runner.current?.pause(), []);
  const stop = useCallback(() => runner.current?.stop(), []);

  const mutate = useCallback(
    (fn: (d: Investigation) => void) => {
      if (!ref.current) return;
      const d = structuredClone(ref.current);
      fn(d);
      d.updatedAt = nowIso();
      commit(d, true);
    },
    [commit],
  );

  const resume = useCallback(() => {
    mutate((d) => {
      if (d.tasks.some((t) => t.status === "quota")) requeueQuotaTasks(d);
      trail(d, "user", "user", "Investigation resumed");
    });
    void run();
  }, [mutate, run]);

  const decide = useCallback(
    (kind: "entity" | "relationship", id: string, decision: "confirmed" | "rejected" | null) => {
      mutate((d) => setDecision(d, kind, id, decision));
    },
    [mutate],
  );

  /** User-directed follow-up of a specific lead (bypasses the round/threshold planner). */
  const investigateLead = useCallback(
    (leadId: string) => {
      mutate((d) => {
        const l = d.leads.find((x) => x.id === leadId) as Lead | undefined;
        if (!l) return;
        const route: Record<Lead["kind"], { engine: EngineId; kind: "read_page" | "search" | "osint_domain" | "username"; input: Record<string, string> }> = {
          url: { engine: "page", kind: "read_page", input: { url: l.value } },
          domain: { engine: "spiderfoot", kind: "osint_domain", input: { domain: l.value } },
          username: { engine: "maigret", kind: "username", input: { username: l.value } },
          business: { engine: "searxng", kind: "search", input: { query: `"${l.value}"` } },
          school: { engine: "searxng", kind: "search", input: { query: `"${l.value}"` } },
          organisation: { engine: "searxng", kind: "search", input: { query: `"${l.value}"` } },
          name: { engine: "searxng", kind: "search", input: { query: `"${l.value}"${d.clues.places[0] ? ` ${d.clues.places[0]}` : ""}` } },
          place: { engine: "searxng", kind: "search", input: { query: l.value } },
          phrase: { engine: "searxng", kind: "search", input: { query: l.value } },
        };
        const r = route[l.kind];
        const t = makeTask(d, r.engine, r.kind, r.input, `User asked to investigate lead: ${l.reason}`, l.id);
        d.tasks.push(t);
        l.taskIds.push(t.id);
        l.status = "queued";
        trail(d, "user", "user", `User requested follow-up of ${l.kind} “${l.value.slice(0, 120)}”`, [t.id]);
      });
      void run();
    },
    [mutate, run],
  );

  const exportJson = useCallback(() => {
    const cur = ref.current;
    if (!cur) return;
    const blob = new Blob([exportInvestigation(cur)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName(cur);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    // The workspace is NOT cleared after download.
    setLastExportedAt(cur.updatedAt);
    setMessage({ tone: "ok", text: `Exported ${a.download}. The investigation stays open here.` });
  }, []);

  const importFile = useCallback(
    async (file: File) => {
      if (runner.current?.isRunning) {
        setMessage({ tone: "warn", text: "Pause the running investigation before importing another." });
        return;
      }
      if (dirty && !window.confirm("The current investigation has changes that were not exported. Replace it with the imported file?")) return;
      const text = await file.text();
      const r = importInvestigation(text, file.size);
      if (!r.ok || !r.investigation) {
        setMessage({ tone: "alert", text: `Import rejected: ${r.errors.slice(0, 3).join(" · ")}` });
        return;
      }
      setLastExportedAt(r.investigation.updatedAt);
      commit(r.investigation, true);
      setMessage({ tone: "ok", text: `Imported “${r.investigation.title}”.${r.warnings.length ? ` ${r.warnings.join(" · ")}` : ""}` });
    },
    [commit, dirty],
  );

  const clear = useCallback(() => {
    if (runner.current?.isRunning) return;
    if (dirty && !window.confirm("Clear this investigation? It has changes that were not exported.")) return;
    commit(null, true);
    setLastExportedAt(null);
    void clearAutosave();
  }, [commit, dirty]);

  const restore = useCallback(() => {
    if (!recovery) return;
    const r = importInvestigation(JSON.stringify(recovery.investigation));
    if (r.ok && r.investigation) {
      setLastExportedAt(recovery.lastExportedAt);
      commit(r.investigation, true);
      setMessage({ tone: "ok", text: `Recovered autosave from ${new Date(recovery.savedAt).toLocaleString()}.${r.warnings.length ? ` ${r.warnings.join(" · ")}` : ""} Press Resume to continue.` });
    } else setMessage({ tone: "alert", text: `Autosave could not be restored: ${r.errors.slice(0, 2).join(" · ")}` });
    setRecovery(null);
  }, [recovery, commit]);

  const discardRecovery = useCallback(() => {
    setRecovery(null);
    void clearAutosave();
  }, []);

  return useMemo(
    () => ({ inv, running, engines, dirty, saveState, lastExportedAt, recovery, message, setMessage, start, pause, resume, stop, decide, investigateLead, exportJson, importFile, clear, restore, discardRecovery }),
    [inv, running, engines, dirty, saveState, lastExportedAt, recovery, message, start, pause, resume, stop, decide, investigateLead, exportJson, importFile, clear, restore, discardRecovery],
  );
}

export type InvestigationApi = ReturnType<typeof useInvestigation>;
