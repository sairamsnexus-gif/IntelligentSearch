"use client";
import { Radar } from "lucide-react";
import { Panel, Stat } from "@/components/ui/panel";
import { useApi } from "@/lib/hooks";
import type { PersonSummaryView } from "@/lib/view-types";
import { PersonsTable } from "./persons-table";

export function MonitorDashboard({ isAdmin }: { isAdmin: boolean }) {
  const { data, reload } = useApi<{ persons: PersonSummaryView[] }>("/api/persons", 5000);
  const ps = data?.persons ?? [];
  return (
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Monitored persons" value={ps.length} tone="accent" />
        <Stat label="Active" value={ps.filter((p) => p.monitoringStatus === "active").length} tone="ok" />
        <Stat label="Paused" value={ps.filter((p) => p.monitoringStatus === "paused").length} tone="warn" />
        <Stat label="🔴 New findings" value={ps.reduce((s, p) => s + p.newFindings, 0)} tone="alert" />
        <Stat label="🟡 Changed" value={ps.reduce((s, p) => s + p.changedFindings, 0)} tone="warn" />
      </div>
      <Panel title={<><Radar className="size-3.5 text-accent" /> Monitored persons</>}>
        <PersonsTable persons={ps} admin={isAdmin} reload={reload} />
      </Panel>
    </div>
  );
}
