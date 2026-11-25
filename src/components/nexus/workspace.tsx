"use client";
import { useState } from "react";
import { History, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useInvestigation } from "./use-investigation";
import { RequestPanel } from "./request-panel";
import { NexusGraph } from "./graph";
import { CluesPanel, EnginesPanel, EntityDetail, LocationsPanel, ProgressPanel } from "./side";
import { Sections } from "./sections";

export function NexusWorkspace() {
  const api = useInvestigation();
  const [selected, setSelected] = useState<string | null>(null);
  const { inv } = api;
  return (
    <div className="space-y-3 p-3">
      {api.recovery && !inv && (
        <div className="flex flex-wrap items-center gap-3 rounded-[4px] border border-accent/40 bg-accent/[0.06] px-3 py-2 text-[12px] text-text" data-testid="nexus-recovery">
          <History className="size-4 text-accent" />
          <span>
            Unsaved investigation found in this browser: <b>{api.recovery.investigation.title}</b> (autosaved {new Date(api.recovery.savedAt).toLocaleString()}).
          </span>
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="primary" onClick={api.restore} data-testid="nexus-restore">
              Restore
            </Button>
            <Button size="sm" variant="ghost" onClick={api.discardRecovery}>
              Discard
            </Button>
          </span>
        </div>
      )}
      {api.message && (
        <div className={cn("flex items-center gap-2 rounded-[4px] border px-3 py-1.5 text-[12px]", api.message.tone === "ok" ? "border-ok/40 text-ok" : api.message.tone === "warn" ? "border-warn/40 text-warn" : "border-alert/50 text-alert")} data-testid="nexus-message">
          <span className="flex-1">{api.message.text}</span>
          <button onClick={() => api.setMessage(null)} aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {inv?.synthetic && (
        <div className="rounded-[4px] border border-warn/30 bg-warn/[0.07] px-3 py-1.5 text-[11.5px] text-warn" data-testid="nexus-synthetic-banner">
          <span className="mono font-semibold tracking-[0.14em]">SYNTHETIC DEMO DATA</span> — every page, business, person and contact in this investigation is fictional (*.example domains). No real web request was made.
        </div>
      )}
      <div className="grid gap-3 xl:grid-cols-[330px_minmax(0,1fr)_310px]">
        <div className="xl:min-h-[640px]">
          <RequestPanel api={api} />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <ProgressPanel inv={inv} running={api.running} />
          <NexusGraph inv={inv} running={api.running} selected={selected} onSelect={setSelected} />
          <CluesPanel inv={inv} />
        </div>
        <div className="flex flex-col gap-3">
          {inv && selected && <EntityDetail inv={inv} id={selected} decide={api.decide} />}
          <EnginesPanel inv={inv} engines={api.engines} />
          <LocationsPanel inv={inv} selected={selected} />
        </div>
      </div>
      <Sections api={api} select={setSelected} />
    </div>
  );
}
