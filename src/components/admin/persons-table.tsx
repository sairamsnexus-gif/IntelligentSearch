"use client";
import Link from "next/link";
import { Pause, Play, RefreshCw } from "lucide-react";
import { Badge, Dot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/panel";
import { DemoBadge } from "@/components/shared/bits";
import { apiFetch, timeAgo } from "@/lib/utils";
import type { PersonSummaryView } from "@/lib/view-types";

export function PersonsTable({ persons, admin, reload }: { persons: PersonSummaryView[]; admin?: boolean; reload: () => void }) {
  if (!persons.length) return <Empty>No monitored persons yet. Search, confirm and lock a person from the Console.</Empty>;
  const act = async (url: string, init: RequestInit) => {
    await apiFetch(url, init);
    reload();
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-[12.5px]" data-testid="persons-table">
        <thead className="label !text-[9px]">
          <tr className="border-b border-line">
            <th className="py-2">Person</th>
            <th>Status</th>
            <th className="text-right">Confirmed attributes</th>
            <th className="text-right">Sources</th>
            <th>Last scan</th>
            <th className="text-center">New findings</th>
            <th className="text-center">Changed</th>
            <th>Monitoring</th>
            {admin && <th className="text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {persons.map((p) => (
            <tr key={p.id} className="border-b border-line/60 hover:bg-panel-3/40" data-testid="person-row">
              <td className="py-2">
                <Link href={`/persons/${p.id}`} className="font-medium text-text hover:text-accent">{p.displayName}</Link>
                <div className="mono flex items-center gap-2 text-[10.5px] text-muted">{p.publicId} {p.isDemo && <DemoBadge />}</div>
              </td>
              <td><Badge tone={p.running ? "accent" : p.monitoringStatus === "active" ? "ok" : "warn"}>{p.running ? "SCANNING" : p.monitoringStatus === "active" ? "ACTIVE" : "PAUSED"}</Badge></td>
              <td className="mono text-right">{p.confirmedAttributes} <span className="text-muted">/ {p.attributes}</span></td>
              <td className="mono text-right">{p.sources}</td>
              <td className="mono text-[11px]">{timeAgo(p.lastScanAt)}</td>
              <td className="text-center">{p.newFindings ? <span className="mono text-alert">🔴 {p.newFindings}</span> : <span className="text-muted">—</span>}</td>
              <td className="text-center">{p.changedFindings ? <span className="mono text-warn">🟡 {p.changedFindings}</span> : <span className="text-muted">—</span>}</td>
              <td className="text-[11.5px]">
                <span className="flex items-center gap-1.5"><Dot tone={p.monitoringStatus === "active" ? "ok" : "warn"} pulse={p.running} /> every {p.intervalHours}h · next {p.monitoringStatus === "active" ? timeAgo(p.nextScanAt) : "—"}</span>
              </td>
              {admin && (
                <td className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" disabled={p.running} onClick={() => act(`/api/persons/${p.id}/scan`, { method: "POST" })} title="Run manual scan" data-testid="admin-scan"><RefreshCw /></Button>
                    {p.monitoringStatus === "active" ? (
                      <Button size="sm" variant="outline" onClick={() => act(`/api/persons/${p.id}/monitoring`, { method: "PATCH", body: JSON.stringify({ status: "paused" }) })} data-testid="admin-pause"><Pause /> Pause</Button>
                    ) : (
                      <Button size="sm" variant="ok" onClick={() => act(`/api/persons/${p.id}/monitoring`, { method: "PATCH", body: JSON.stringify({ status: "active" }) })} data-testid="admin-resume"><Play /> Resume</Button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
