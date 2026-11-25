"use client";
import { Cpu, Fingerprint, MapPin, Radio } from "lucide-react";
import { Panel, Empty } from "@/components/ui/panel";
import { Badge, Dot } from "@/components/ui/badge";
import { ENGINE_IDS, ENGINE_LABEL, type Investigation } from "@/lib/nexus/schema";
import type { EnginesResponse } from "@/lib/nexus/engine-types";
import { cn } from "@/lib/utils";
import { EngineTag, PRED_LABEL, VBadge, nameOf } from "./bits";

export function CluesPanel({ inv }: { inv: Investigation | null }) {
  return (
    <Panel title={<><Fingerprint className="size-3.5 text-accent" /> Clues & name variants</>} bodyClassName="max-h-[300px] overflow-y-auto space-y-3">
      {!inv ? (
        <Empty>Names are kept exactly as written; spelling, phonetic and regional-script variants are searched alongside.</Empty>
      ) : (
        <>
          {inv.clues.names.map((n) => (
            <div key={n.id} data-testid="nexus-clue-name">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-text">{n.original}</span>
                <Badge tone="violet">exact</Badge>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {n.variants.filter((v) => !v.isOriginal).map((v) => (
                  <span key={v.text} title={v.method} className={cn("rounded-[3px] border px-1.5 py-[1px] text-[11px]", v.script === "latin" ? "border-line-2 text-text-2" : "border-accent/30 text-accent")}>
                    {v.text}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <dl className="grid grid-cols-[92px_1fr] gap-x-2 gap-y-1 text-[11.5px]">
            {inv.clues.places.length > 0 && <Row k="Places" v={inv.clues.places.join(", ")} />}
            {inv.clues.organisationHints.length > 0 && <Row k="Context" v={inv.clues.organisationHints.join(" · ")} />}
            {inv.clues.urls.length > 0 && <Row k="URLs" v={inv.clues.urls.join(" ")} />}
            {inv.clues.usernames.length > 0 && <Row k="Usernames" v={inv.clues.usernames.map((u) => `@${u}`).join(" ")} />}
            {inv.clues.userRelationships.map((r, i) => (
              <Row key={i} k="Your link" v={`${r.a} ↔ ${r.b}: ${r.description} (unverified hypothesis — never inferred)`} />
            ))}
          </dl>
        </>
      )}
    </Panel>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="label !text-[9.5px] pt-0.5">{k}</dt>
      <dd className="break-words text-text-2">{v}</dd>
    </>
  );
}

export function EnginesPanel({ inv, engines }: { inv: Investigation | null; engines: EnginesResponse | null }) {
  const counts = (e: string) => {
    const ts = inv?.tasks.filter((t) => t.engine === e) ?? [];
    return { total: ts.length, active: ts.filter((t) => ["queued", "running", "pending"].includes(t.status)).length, done: ts.filter((t) => t.status === "done").length, bad: ts.filter((t) => ["failed", "blocked", "unavailable"].includes(t.status)).length, quota: ts.filter((t) => t.status === "quota").length };
  };
  const synthetic = inv?.synthetic;
  return (
    <Panel title={<><Cpu className="size-3.5 text-accent" /> Engines</>} right={engines?.hosted ? <Badge tone="dark">hosted mode</Badge> : <Badge tone="dark">operator mode</Badge>}>
      <ul className="space-y-2" data-testid="nexus-engines">
        {ENGINE_IDS.map((e) => {
          const st = engines?.engines.find((x) => x.id === e);
          const c = counts(e);
          const enabled = inv ? inv.settings.engines[e] : true;
          const avail = synthetic || st?.available;
          return (
            <li key={e} className="text-[11.5px]">
              <div className="flex items-center gap-2">
                <Dot tone={!enabled ? "muted" : c.active ? "accent" : c.quota ? "warn" : avail ? "ok" : "muted"} pulse={c.active > 0} />
                <span className="text-text">{ENGINE_LABEL[e]}</span>
                <span className="mono ml-auto text-[10px] text-muted">
                  {!enabled ? "OFF" : !avail ? "UNAVAILABLE" : `${c.done}/${c.total}${c.bad ? ` · ${c.bad} failed` : ""}${c.quota ? ` · ${c.quota} quota` : ""}`}
                </span>
              </div>
              {!synthetic && st && !st.available && enabled && <div className="ml-4 text-[10.5px] text-muted">{st.reason}</div>}
            </li>
          );
        })}
        <li className="border-t border-line pt-2 text-[11.5px]">
          <div className="flex items-center gap-2">
            <Dot tone={synthetic ? "warn" : engines?.llm.available ? "ok" : "muted"} />
            <span className="text-text">FreeLLMAPI gateway</span>
            <span className="mono ml-auto text-[10px] text-muted">{inv ? `${inv.usage.llmCalls}/${inv.settings.llm.enabled ? inv.settings.llm.maxCalls : 0} calls` : synthetic ? "SIMULATED" : engines?.llm.available ? "READY" : "OFF"}</span>
          </div>
          <div className="ml-4 text-[10.5px] text-muted">{synthetic ? "Simulated gateway (synthetic mode)" : engines?.llm.reason ?? "…"} · assists extraction only; not a discovery engine</div>
        </li>
      </ul>
      {inv && inv.quota.length > 0 && (
        <div className="mt-3 space-y-1 rounded-[4px] border border-warn/30 bg-warn/[0.06] p-2 text-[11px] text-warn" data-testid="nexus-quota">
          <div className="mono font-semibold tracking-[0.12em]">FREE QUOTA EVENTS</div>
          {inv.quota.slice(-4).map((q, i) => (
            <div key={i}>
              {q.provider}: {q.message}
              {q.resumeAfter ? ` — resume after ${new Date(q.resumeAfter).toLocaleTimeString()}` : ""}
            </div>
          ))}
          <div className="text-warn/80">That provider stopped; other engines continued. No paid fallback is used.</div>
        </div>
      )}
    </Panel>
  );
}

export function ProgressPanel({ inv, running }: { inv: Investigation | null; running: boolean }) {
  if (!inv) return null;
  const by = (s: string[]) => inv.tasks.filter((t) => s.includes(t.status)).length;
  const last = inv.trail.slice(-1)[0];
  return (
    <Panel title={<><Radio className="size-3.5 text-accent" /> Progress</>} scanning={running} right={inv.synthetic ? <Badge tone="warn">synthetic data</Badge> : null}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px] sm:grid-cols-4" data-testid="nexus-progress">
        <span className="text-text-2">Round <b className="mono text-text">{inv.round}</b> of {inv.settings.maxRounds}</span>
        <span className="text-text-2">Tasks done <b className="mono text-text">{by(["done"])}</b> / {inv.tasks.length}</span>
        <span className="text-text-2">In flight <b className="mono text-accent">{by(["queued", "running", "pending"])}</b></span>
        <span className="text-text-2">Failed / blocked <b className="mono text-warn">{by(["failed", "blocked", "unavailable", "quota"])}</b></span>
        <span className="text-text-2">Pages read <b className="mono text-text">{inv.sources.filter((s) => s.fetch.status === "read").length}</b></span>
        <span className="text-text-2">Sources <b className="mono text-text">{inv.sources.length}</b></span>
        <span className="text-text-2">Open leads <b className="mono text-text">{inv.leads.filter((l) => l.status === "open").length}</b></span>
        <span className="text-text-2">LLM calls <b className="mono text-text">{inv.usage.llmCalls}</b></span>
      </div>
      {last && <div className="mono mt-2 truncate text-[10.5px] text-muted">{last.text}</div>}
    </Panel>
  );
}

export function LocationsPanel({ inv, selected }: { inv: Investigation | null; selected: string | null }) {
  const locs = inv?.entities.filter((e) => e.type === "location") ?? [];
  return (
    <Panel title={<><MapPin className="size-3.5 text-accent" /> Locations (from sources)</>} bodyClassName="max-h-[220px] overflow-y-auto">
      {!locs.length ? (
        <Empty>Business and institutional addresses appear here when a source publishes them. Personal home addresses are never collected.</Empty>
      ) : (
        <ul className="space-y-2">
          {locs.map((l) => {
            const rels = inv!.relationships.filter((r) => r.objectId === l.id);
            return (
              <li key={l.id} className={cn("text-[11.5px]", selected && rels.some((r) => r.subjectId === selected) && "rounded-[3px] bg-accent/[0.06]")}>
                <div className="text-text">{l.name}</div>
                {rels.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-1.5 text-text-2">
                    {nameOf(inv!, r.subjectId)} <VBadge v={r.verification} />
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function EntityDetail({ inv, id, decide }: { inv: Investigation; id: string; decide: (kind: "entity" | "relationship", id: string, d: "confirmed" | "rejected" | null) => void }) {
  const e = inv.entities.find((x) => x.id === id);
  if (!e) return null;
  const rels = inv.relationships.filter((r) => r.subjectId === id || r.objectId === id);
  return (
    <Panel title="Selected entity" bodyClassName="space-y-2 max-h-[320px] overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-text">{e.name}</span>
        <Badge tone="dark">{e.type.replace(/_/g, " ")}</Badge>
        {e.userDecision && <Badge tone={e.userDecision === "confirmed" ? "ok" : "alert"}>{e.userDecision} by you</Badge>}
      </div>
      {Object.keys(e.attributes).length > 0 && <div className="text-[11px] text-text-2">{Object.entries(e.attributes).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>}
      <ul className="space-y-1.5">
        {rels.map((r) => (
          <li key={r.id} className="text-[11.5px]">
            <span className="text-text-2">
              {nameOf(inv, r.subjectId)} <span className="text-muted">{PRED_LABEL[r.predicate]}</span> {nameOf(inv, r.objectId)}
              {r.qualifier ? ` (${r.qualifier})` : ""}
            </span>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <VBadge v={r.verification} />
              <EngineTag engine={r.provenance.engine} assisted={Boolean(r.provenance.assistedBy)} />
              <span className="mono text-[10px] text-muted">{r.independentSources} independent</span>
            </div>
          </li>
        ))}
      </ul>
      {!e.key.startsWith("clue:") && ["person", "business", "school", "organisation"].includes(e.type) && (
        <div className="flex gap-2 pt-1">
          <button className="mono text-[10.5px] uppercase tracking-[0.12em] text-ok hover:underline" onClick={() => decide("entity", e.id, e.userDecision === "confirmed" ? null : "confirmed")}>
            {e.userDecision === "confirmed" ? "undo confirm" : "confirm"}
          </button>
          <button className="mono text-[10.5px] uppercase tracking-[0.12em] text-alert hover:underline" onClick={() => decide("entity", e.id, e.userDecision === "rejected" ? null : "rejected")}>
            {e.userDecision === "rejected" ? "undo reject" : "reject"}
          </button>
        </div>
      )}
    </Panel>
  );
}
