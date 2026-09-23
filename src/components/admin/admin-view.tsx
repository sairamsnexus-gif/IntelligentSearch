"use client";
import { useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Badge, Dot } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { useApi } from "@/lib/hooks";
import { apiFetch, fmtDate } from "@/lib/utils";
import type { PersonSummaryView } from "@/lib/view-types";
import { PersonsTable } from "./persons-table";

interface ProviderRow {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  health: { status: string; message: string; checkedAt: string; latencyMs?: number };
  roles: string[];
  channels: string[];
  cost: string;
  requires: string[];
  upstream?: string;
  isDemo: boolean;
}

type Tab = "persons" | "providers" | "audit";

const HEALTH_TONE: Record<string, "ok" | "warn" | "alert" | "muted"> = { active: "ok", limited: "warn", unavailable: "alert", disabled: "muted", not_configured: "muted" };

export function AdminView() {
  const [tab, setTab] = useState<Tab>("persons");
  const persons = useApi<{ persons: PersonSummaryView[] }>("/api/persons", 5000);
  const providers = useApi<{ providers: ProviderRow[] }>(tab === "providers" ? "/api/admin/providers" : null);
  const audit = useApi<{ entries: { id: string; userId: string | null; action: string; target: string | null; meta: Record<string, unknown>; createdAt: string }[] }>(tab === "audit" ? "/api/admin/audit" : null);
  const [refreshing, setRefreshing] = useState(false);

  const toggle = async (name: string, enabled: boolean) => {
    await apiFetch("/api/admin/providers", { method: "PATCH", body: JSON.stringify({ name, enabled }) });
    void providers.reload();
  };
  const refresh = async () => {
    setRefreshing(true);
    const d = await apiFetch<{ providers: ProviderRow[] }>("/api/admin/providers?refresh=1");
    providers.setData(d);
    setRefreshing(false);
  };

  return (
    <div className="space-y-3 p-3">
      <div className="panel">
        <div className="flex items-center gap-2 px-4 pt-3">
          <ShieldCheck className="size-4 text-accent" />
          <h1 className="label !text-[12px] !text-text">Administration</h1>
        </div>
        <Tabs<Tab> value={tab} onChange={setTab} className="mt-2 px-2" tabs={[{ id: "persons", label: "Monitored people" }, { id: "providers", label: "Providers & health" }, { id: "audit", label: "Audit log" }]} />
        <div className="p-3">
          {tab === "persons" && <PersonsTable persons={persons.data?.persons ?? []} admin reload={persons.reload} />}
          {tab === "providers" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-text-2">Enable or disable providers. Keys are configured in <code className="mono">.env</code> on the server and never shown here.</p>
                <Button size="sm" onClick={refresh} disabled={refreshing}><RefreshCw className={refreshing ? "animate-spin" : ""} /> Check health</Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-[12.5px]" data-testid="providers-table">
                  <thead className="label !text-[9px]"><tr className="border-b border-line"><th className="py-1.5">Provider</th><th>Roles</th><th>Cost</th><th>Health</th><th>Config</th><th className="text-right">Enabled</th></tr></thead>
                  <tbody>
                    {(providers.data?.providers ?? []).map((p) => (
                      <tr key={p.name} className="border-b border-line/60 align-top">
                        <td className="py-2">
                          <div className="font-medium text-text">{p.label}</div>
                          <div className="text-[11px] text-muted">{p.description}</div>
                          {p.upstream && <div className="mono text-[10px] text-muted">{p.upstream}</div>}
                        </td>
                        <td className="text-[11px] text-text-2">{p.roles.join(", ")}<div className="text-muted">{p.channels.join(", ")}</div></td>
                        <td><Badge tone="dark">{p.cost}</Badge></td>
                        <td className="max-w-[260px]"><span className="flex items-center gap-1.5"><Dot tone={HEALTH_TONE[p.health.status] ?? "muted"} /> <span className="mono text-[11px]">{p.health.status.replace("_", " ")}</span>{p.health.latencyMs !== undefined && <span className="mono text-[10px] text-muted">{p.health.latencyMs}ms</span>}</span><div className="text-[11px] text-muted">{p.health.message}</div></td>
                        <td className="mono text-[10.5px] text-muted">{p.requires.length ? p.requires.join(", ") : "none needed"}</td>
                        <td className="text-right">
                          {p.isDemo ? <Badge tone="warn">auto</Badge> : (
                            <label className="inline-flex cursor-pointer items-center gap-2 text-[11px]">
                              <input type="checkbox" checked={p.enabled} onChange={(e) => toggle(p.name, e.target.checked)} className="accent-[var(--accent)]" data-testid={`toggle-${p.name}`} />
                              {p.enabled ? "on" : "off"}
                            </label>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {tab === "audit" && (
            <Panel title="Audit log (latest 200)">
              <table className="w-full text-left text-[12px]">
                <thead className="label !text-[9px]"><tr className="border-b border-line"><th className="py-1.5">When</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
                <tbody>
                  {(audit.data?.entries ?? []).map((e) => (
                    <tr key={e.id} className="border-b border-line/60"><td className="mono py-1 text-[11px]">{fmtDate(e.createdAt, true)}</td><td className="mono text-accent">{e.action}</td><td className="mono text-[10.5px] text-muted">{e.target}</td><td className="mono text-[10.5px] text-text-2">{JSON.stringify(e.meta)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
