"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, Download, Pause, Play, Square, Trash2, Upload, Zap } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DEFAULT_SETTINGS, ENGINE_IDS, ENGINE_LABEL, type EngineId } from "@/lib/nexus/schema";
import type { InvestigationApi } from "./use-investigation";

const EXAMPLE = "Find Asma and Siva in Chennai. They may be running a garments business. Asma may also be associated with a Montessori school.";

export function RequestPanel({ api }: { api: InvestigationApi }) {
  const { inv, running, engines } = api;
  const [text, setText] = useState("");
  const [adv, setAdv] = useState(false);
  const [rounds, setRounds] = useState(DEFAULT_SETTINGS.maxRounds);
  const [perRound, setPerRound] = useState(DEFAULT_SETTINGS.maxTasksPerRound);
  const [total, setTotal] = useState(DEFAULT_SETTINGS.maxTotalTasks);
  const [perDomain, setPerDomain] = useState(DEFAULT_SETTINGS.maxPagesPerDomain);
  const [llm, setLlm] = useState(true);
  const [llmCalls, setLlmCalls] = useState(DEFAULT_SETTINGS.llm.maxCalls);
  const [urls, setUrls] = useState("");
  const [users, setUsers] = useState("");
  const [on, setOn] = useState<Record<EngineId, boolean>>({ ...DEFAULT_SETTINGS.engines });
  const syntheticDefault = engines?.synthetic ?? false;
  const [synthetic, setSynthetic] = useState<boolean | null>(null);
  const syn = synthetic ?? syntheticDefault;

  const status = inv?.status;
  const canStart = !running && text.trim().length >= 4;
  const onStart = () => {
    if (inv && api.dirty && !window.confirm("Start a new investigation? The current one has changes that were not exported (it remains in autosave until replaced).")) return;
    api.start({
      text: text.trim(),
      urls: urls.split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)),
      usernames: users.split(/[\s,]+/).map((u) => u.replace(/^@/, "").trim()).filter(Boolean),
      synthetic: syn,
      settings: { maxRounds: rounds, maxTasksPerRound: perRound, maxTotalTasks: total, maxPagesPerDomain: perDomain, engines: on, llm: { enabled: llm, maxCalls: llmCalls, maxTokensPerCall: DEFAULT_SETTINGS.llm.maxTokensPerCall } },
    });
  };

  return (
    <Panel title={<><Zap className="size-3.5 text-accent" /> Investigation request</>} right={inv ? <StatusBadge status={inv.status} /> : null} className="h-full" bodyClassName="flex flex-col gap-3 overflow-y-auto">
      <div>
        <label htmlFor="nexus-request" className="label">Describe who or what to find</label>
        <textarea
          id="nexus-request"
          data-testid="nexus-request"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={4000}
          placeholder={EXAMPLE}
          className="mt-1 w-full resize-y rounded-[4px] border border-line-2 bg-bg-2 px-2.5 py-2 text-[13px] text-text placeholder:text-muted/70 focus:border-accent/60 focus:outline-none"
        />
        <button type="button" onClick={() => setText(EXAMPLE)} className="mono mt-1 text-[10.5px] text-muted hover:text-accent">
          use example request
        </button>
      </div>

      <label className={cn("flex items-start gap-2 rounded-[4px] border px-2.5 py-2 text-[12px]", syn ? "border-warn/40 bg-warn/[0.06] text-warn" : "border-line text-text-2")}>
        <input type="checkbox" data-testid="nexus-synthetic" checked={syn} onChange={(e) => setSynthetic(e.target.checked)} className="mt-0.5 accent-[var(--amber)]" />
        <span>
          <span className="mono font-semibold tracking-[0.12em]">SYNTHETIC DEMO WORLD</span>
          <span className="block text-[11px] opacity-80">Fictional pages, businesses and people that exercise every engine path without touching the internet.{syntheticDefault ? " No discovery service is configured on this deployment." : ""}</span>
        </span>
      </label>

      <button type="button" onClick={() => setAdv((x) => !x)} className="mono flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] text-muted hover:text-accent">
        {adv ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} Advanced controls
      </button>
      {adv && (
        <div className="space-y-3 rounded-[4px] border border-line bg-bg-2/50 p-2.5" data-testid="nexus-advanced">
          <div className="grid grid-cols-2 gap-2">
            <Num label="Rounds" value={rounds} set={setRounds} min={1} max={8} />
            <Num label="Tasks / round" value={perRound} set={setPerRound} min={4} max={60} />
            <Num label="Total tasks" value={total} set={setTotal} min={10} max={600} />
            <Num label="Pages / domain" value={perDomain} set={setPerDomain} min={1} max={30} />
          </div>
          <div>
            <div className="label mb-1">Engines</div>
            <div className="grid grid-cols-1 gap-1">
              {ENGINE_IDS.map((e) => {
                const st = engines?.engines.find((x) => x.id === e);
                return (
                  <label key={e} className="flex items-center gap-2 text-[12px] text-text-2">
                    <input type="checkbox" checked={on[e]} onChange={(ev) => setOn((o) => ({ ...o, [e]: ev.target.checked }))} className="accent-[var(--accent)]" />
                    {ENGINE_LABEL[e]}
                    {!syn && st && !st.available && <span className="mono text-[9.5px] text-muted">(unavailable here)</span>}
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <label className="flex items-center gap-2 text-[12px] text-text-2">
              <input type="checkbox" checked={llm} onChange={(e) => setLlm(e.target.checked)} className="accent-[var(--accent)]" />
              LLM assistance via FreeLLMAPI (free providers only)
            </label>
            {llm && (
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <Num label="LLM call budget" value={llmCalls} set={setLlmCalls} min={0} max={500} />
                <div className="self-end text-[10.5px] text-muted">{engines ? (engines.llm.available ? "gateway reachable" : engines.llm.reason) : ""}</div>
              </div>
            )}
          </div>
          <div>
            <label className="label" htmlFor="nexus-urls">Pages to investigate (one URL per line)</label>
            <textarea id="nexus-urls" value={urls} onChange={(e) => setUrls(e.target.value)} rows={2} className="mt-1 w-full rounded-[4px] border border-line-2 bg-bg-2 px-2 py-1.5 text-[12px] text-text focus:border-accent/60 focus:outline-none" placeholder="https://…" />
          </div>
          <div>
            <label className="label" htmlFor="nexus-users">Known usernames</label>
            <input id="nexus-users" value={users} onChange={(e) => setUsers(e.target.value)} className="mt-1 h-8 w-full rounded-[4px] border border-line-2 bg-bg-2 px-2 text-[12px] text-text focus:border-accent/60 focus:outline-none" placeholder="@handle, other_handle" />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={onStart} disabled={!canStart} data-testid="nexus-start">
          <Play /> Start
        </Button>
        {running && (
          <>
            <Button onClick={api.pause} data-testid="nexus-pause">
              <Pause /> Pause
            </Button>
            <Button variant="danger" onClick={api.stop}>
              <Square /> Stop
            </Button>
          </>
        )}
        {!running && inv && (status === "paused" || status === "stopped" || status === "completed") && inv.tasks.some((t) => ["queued", "pending", "quota", "running"].includes(t.status)) && (
          <Button variant="ok" onClick={api.resume} data-testid="nexus-resume">
            <Play /> Resume
          </Button>
        )}
      </div>

      {inv?.stopReason && <p className="text-[11.5px] text-text-2" data-testid="nexus-stop-reason">{inv.stopReason}</p>}

      <div className="mt-auto space-y-2 border-t border-line pt-3">
        <div className="flex items-center justify-between">
          <span className="label">Investigation file</span>
          {inv && (api.dirty ? <Badge tone="warn" data-testid="nexus-unsaved">not exported</Badge> : <Badge tone="ok">exported</Badge>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={api.exportJson} disabled={!inv} data-testid="nexus-export">
            <Download /> Export JSON
          </Button>
          <label className={cn("inline-flex h-7 cursor-pointer items-center gap-2 rounded-[4px] border border-line-2 bg-panel-2/60 px-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-text hover:border-accent/60 hover:text-accent", running && "pointer-events-none opacity-40")}>
            <Upload className="size-3.5" /> Import
            <input type="file" accept="application/json,.json" className="hidden" data-testid="nexus-import" onChange={(e) => { const f = e.target.files?.[0]; if (f) void api.importFile(f); e.target.value = ""; }} />
          </label>
          <Button size="sm" variant="ghost" onClick={api.clear} disabled={!inv || running}>
            <Trash2 /> Clear
          </Button>
        </div>
        <p className="text-[10.5px] text-muted">
          Autosaved in this browser{api.saveState === "failed" ? " — autosave failed (storage unavailable); export to keep your work" : ""}. Nothing is stored on the server. Export to keep a copy; exporting does not clear the workspace.
        </p>
      </div>
    </Panel>
  );
}

function Num({ label, value, set, min, max }: { label: string; value: number; set: (n: number) => void; min: number; max: number }) {
  return (
    <label className="block">
      <span className="label !text-[9.5px]">{label}</span>
      <input type="number" value={value} min={min} max={max} onChange={(e) => set(Math.max(min, Math.min(max, Number(e.target.value) || min)))} className="mono mt-0.5 h-8 w-full rounded-[4px] border border-line-2 bg-bg-2 px-2 text-[12px] text-text focus:border-accent/60 focus:outline-none" />
    </label>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === "running" ? "accent" : status === "completed" ? "ok" : status === "paused" ? "warn" : status === "stopped" ? "alert" : "muted";
  return (
    <Badge tone={tone} data-testid="nexus-status">
      {status}
    </Badge>
  );
}
