"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, GitCompare, Pause, Play, Plus, Radar, RefreshCw, Trash2 } from "lucide-react";
import { Panel, Empty, Stat } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Badge, Dot } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { Input, Label } from "@/components/ui/input";
import { ChangeBadge, DemoBadge, Initials, PlatformGlyph, SourceLink, StateBadge } from "@/components/shared/bits";
import { QueryTable } from "@/components/console/progress";
import { AddInformationDialog } from "./add-information";
import { useApi } from "@/lib/hooks";
import { apiFetch, cn, fmtDate, timeAgo } from "@/lib/utils";
import { ATTRIBUTE_LABEL } from "@/lib/core/labels";
import { PLATFORM_LABEL } from "@/lib/core/profiles";
import { PLATFORMS, type AttributeKind, type PlannedQuery, type TargetProfile } from "@/lib/core/types";
import type { ChangeView, PersonDetailView, QueryRowView } from "@/lib/view-types";

type Tab = "identity" | "attributes" | "sources" | "evidence" | "timeline" | "history" | "changes" | "monitoring" | "settings";

export function PersonView({ personId, isAdmin }: { personId: string; isAdmin: boolean }) {
  const [tab, setTab] = useState<Tab>("identity");
  const { data: p, reload, error } = useApi<PersonDetailView>(`/api/persons/${personId}`, 2000);
  const [adding, setAdding] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  if (error) return <div className="p-6 text-alert">{error}</div>;
  if (!p) return <div className="p-6 text-muted">Loading person…</div>;

  const scan = async () => {
    setScanError(null);
    try {
      await apiFetch(`/api/persons/${personId}/scan`, { method: "POST" });
      void reload();
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Scan failed");
    }
  };
  const setMonitoring = async (patch: { status?: "active" | "paused"; intervalHours?: number }) => {
    await apiFetch(`/api/persons/${personId}/monitoring`, { method: "PATCH", body: JSON.stringify(patch) });
    void reload();
  };

  const unseenNew = p.changes.filter((c) => !c.seen && c.changeType === "NEW").length;
  const unseenChanged = p.changes.filter((c) => !c.seen && c.changeType === "CHANGED").length;

  return (
    <div className="space-y-3 p-3">
      <div className="panel p-4">
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/monitor" className="text-muted hover:text-accent" aria-label="Back to monitor">
            <ArrowLeft className="size-4" />
          </Link>
          <Initials name={p.displayName} size={52} />
          <div className="min-w-0">
            <div className="label !text-accent">monitor mode · target identity</div>
            <h1 className="text-[22px] font-semibold leading-tight glow-text" data-testid="person-name">{p.displayName}</h1>
            <div className="mono mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <span className="text-text" data-testid="person-public-id">{p.publicId}</span>
              <span>locked {fmtDate(p.lockedAt, true)}</span>
              <span>purpose: {p.purpose.replace(/_/g, " ")}</span>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {p.isDemo && <DemoBadge />}
            <Badge tone={p.monitoring.status === "active" ? "ok" : "warn"} data-testid="monitoring-status">
              <Dot tone={p.monitoring.status === "active" ? "ok" : "warn"} pulse={p.monitoring.running} /> {p.monitoring.running ? "SCANNING" : p.monitoring.status === "active" ? "MONITORING ACTIVE" : "PAUSED"}
            </Badge>
            <Button variant="outline" onClick={() => setAdding(true)} data-testid="add-information">
              <Plus /> Add information
            </Button>
            <Button variant="primary" onClick={scan} disabled={p.monitoring.running} data-testid="run-scan">
              <RefreshCw className={cn(p.monitoring.running && "animate-spin")} /> {p.monitoring.running ? "Scanning…" : "Run manual scan"}
            </Button>
          </div>
        </div>
        {scanError && <p className="mt-2 text-[12px] text-alert">{scanError}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Confirmed" value={p.confirmedAttributes} tone="ok" />
          <Stat label="Attributes + IDs" value={p.attributes} />
          <Stat label="Sources" value={p.sources} />
          <Stat label="🔴 New" value={unseenNew} tone={unseenNew ? "alert" : "text"} />
          <Stat label="🟡 Changed" value={unseenChanged} tone={unseenChanged ? "warn" : "text"} />
          <Stat label="Last scan" value={<span className="text-[13px]">{timeAgo(p.monitoring.lastRunAt)}</span>} />
          <Stat label="Next scan" value={<span className="text-[13px]">{p.monitoring.status === "paused" ? "paused" : timeAgo(p.monitoring.nextRunAt)}</span>} />
        </div>
      </div>

      <div className="panel">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          className="px-2"
          tabs={[
            { id: "identity", label: "Identity" },
            { id: "attributes", label: "Attributes", count: p.attributesList.filter((a) => !a.removedAt).length },
            { id: "sources", label: "Sources", count: p.sourcesList.length },
            { id: "evidence", label: "Evidence", count: p.evidence.length },
            { id: "timeline", label: "Timeline" },
            { id: "history", label: "Search history" },
            { id: "changes", label: "Changes", count: unseenNew + unseenChanged, tone: unseenNew ? "alert" : "warn" },
            { id: "monitoring", label: "Monitoring" },
            { id: "settings", label: "Settings" },
          ]}
        />
        <div className="p-3">
          {tab === "identity" && <IdentityTab p={p} goChanges={() => setTab("changes")} />}
          {tab === "attributes" && <AttributesTab p={p} isAdmin={isAdmin} reload={reload} onAdd={() => setAdding(true)} />}
          {tab === "sources" && <SourcesTab p={p} />}
          {tab === "evidence" && <EvidenceTab p={p} />}
          {tab === "timeline" && <TimelineTab p={p} />}
          {tab === "history" && <HistoryTab personId={personId} />}
          {tab === "changes" && <ChangesTab p={p} reload={reload} />}
          {tab === "monitoring" && <MonitoringTab p={p} isAdmin={isAdmin} setMonitoring={setMonitoring} scan={scan} />}
          {tab === "settings" && <SettingsTab p={p} isAdmin={isAdmin} setMonitoring={setMonitoring} />}
        </div>
      </div>
      <AddInformationDialog open={adding} onClose={() => setAdding(false)} personId={personId} publicId={p.publicId} onAdded={() => void reload()} />
    </div>
  );
}

function IdentityTab({ p, goChanges }: { p: PersonDetailView; goChanges: () => void }) {
  const ids = p.identifiers.filter((i) => !i.removedAt);
  const attrs = p.attributesList.filter((a) => !a.removedAt && a.kind !== "name");
  const recent = p.changes.slice(0, 6);
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
      <Panel title="Known identifiers">
        <ul className="space-y-1.5" data-testid="known-identifiers">
          {PLATFORMS.filter((pl) => pl !== "other_social").map((pl) => {
            const list = ids.filter((i) => i.platform === pl);
            return (
              <li key={pl} className="flex items-center justify-between gap-2 text-[12.5px]">
                <span className="flex items-center gap-2">
                  <PlatformGlyph platform={pl} /> {PLATFORM_LABEL[pl]}
                </span>
                {list.length ? (
                  <span className="flex items-center gap-1.5">
                    <span className="mono max-w-[140px] truncate text-[11px] text-text-2">{list[0].handle}</span>
                    <span className={cn("mono text-[13px]", list[0].state === "confirmed" ? "text-ok" : list[0].state === "unverified" ? "text-warn" : "text-violet")} title={list[0].state}>
                      {list[0].state === "confirmed" ? "✓" : list[0].state === "unverified" ? "?" : "◐"}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[10.5px] text-muted">✓ confirmed · ◐ discovered / user-supplied · ? unverified</p>
      </Panel>
      <Panel title="Identity profile">
        <ul className="space-y-1">
          {attrs.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="label !text-[9.5px]">{ATTRIBUTE_LABEL[a.kind as AttributeKind] ?? a.kind}</span>
              <span className="flex items-center gap-1.5">
                <span className="truncate text-text">{a.value}</span>
                <span className={cn("mono text-[12px]", a.state === "confirmed" ? "text-ok" : a.state === "unverified" ? "text-warn" : "text-violet")}>{a.state === "confirmed" ? "✓" : a.state === "unverified" ? "?" : "◐"}</span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Latest findings" right={<Button size="sm" variant="ghost" onClick={goChanges}>All changes</Button>}>
        {recent.length ? (
          <ul className="space-y-2">
            {recent.map((c) => (
              <li key={c.id} className="text-[12px]">
                <div className="flex items-center gap-2">
                  <ChangeBadge status={c.changeType === "NO_LONGER_AVAILABLE" ? "NO_LONGER_AVAILABLE" : c.changeType} />
                  <span className="mono text-[10px] text-muted">{fmtDate(c.detectedAt, true)}</span>
                </div>
                <div className="mt-0.5 truncate text-text-2">{c.summary}</div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No changes yet. Run a manual scan or wait for the next scheduled scan.</Empty>
        )}
      </Panel>
    </div>
  );
}

function AttributesTab({ p, isAdmin, reload, onAdd }: { p: PersonDetailView; isAdmin: boolean; reload: () => void; onAdd: () => void }) {
  const remove = async (url: string) => {
    await apiFetch(url, { method: "DELETE" });
    reload();
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <p className="text-[12px] text-text-2">States: <StateBadge state="confirmed" /> <StateBadge state="user_supplied" /> <StateBadge state="system_discovered" /> <StateBadge state="unverified" /></p>
        <Button size="sm" variant="outline" onClick={onAdd}><Plus /> Add information</Button>
      </div>
      <table className="w-full text-left text-[12.5px]" data-testid="attributes-table">
        <thead className="label !text-[9px]">
          <tr className="border-b border-line"><th className="py-1.5">Attribute</th><th>Value</th><th>State</th><th>Note</th><th>Added</th><th /></tr>
        </thead>
        <tbody>
          {p.attributesList.map((a) => (
            <tr key={a.id} className={cn("border-b border-line/60", a.removedAt && "opacity-40 line-through")}>
              <td className="py-1.5 text-text-2">{ATTRIBUTE_LABEL[a.kind as AttributeKind] ?? a.kind}</td>
              <td className="text-text">{a.value}</td>
              <td>{a.removedAt ? <Badge tone="dark">removed</Badge> : <StateBadge state={a.state} />}</td>
              <td className="text-[11.5px] text-muted">{a.note}</td>
              <td className="mono text-[11px] text-muted">{fmtDate(a.createdAt)}</td>
              <td className="text-right">{isAdmin && !a.removedAt && a.kind !== "name" && <button onClick={() => remove(`/api/persons/${p.id}/attributes/${a.id}`)} className="text-muted hover:text-alert" title="Remove as incorrect"><Trash2 className="size-3.5" /></button>}</td>
            </tr>
          ))}
          {p.identifiers.map((i) => (
            <tr key={i.id} className={cn("border-b border-line/60", i.removedAt && "opacity-40 line-through")}>
              <td className="py-1.5 text-text-2"><span className="flex items-center gap-1.5"><PlatformGlyph platform={i.platform} /> {PLATFORM_LABEL[i.platform]}</span></td>
              <td className="mono text-text">{i.url ? <SourceLink url={i.url} isDemo={p.isDemo}>{i.handle}</SourceLink> : i.handle}</td>
              <td>{i.removedAt ? <Badge tone="dark">removed</Badge> : <StateBadge state={i.state} />}</td>
              <td className="text-[11.5px] text-muted">{i.verifiedAt ? `verified ${fmtDate(i.verifiedAt, true)}` : ""}</td>
              <td className="mono text-[11px] text-muted">{fmtDate(i.createdAt)}</td>
              <td className="text-right">{isAdmin && !i.removedAt && <button onClick={() => remove(`/api/persons/${p.id}/identifiers/${i.id}`)} className="text-muted hover:text-alert" title="Remove as incorrect"><Trash2 className="size-3.5" /></button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const METHOD_LABEL: Record<string, [string, "ok" | "warn" | "accent" | "muted"]> = {
  demo: ["demo", "warn"],
  github_api: ["GitHub API", "ok"],
  reddit_api: ["Reddit API", "ok"],
  web_fetch: ["direct fetch", "ok"],
  changedetection: ["changedetection.io", "ok"],
  search_only: ["LIMITED · search results only", "warn"],
};

function SourcesTab({ p }: { p: PersonDetailView }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left text-[12.5px]" data-testid="sources-table">
        <thead className="label !text-[9px]">
          <tr className="border-b border-line"><th className="py-1.5">Status</th><th>Source</th><th>Monitored via</th><th>First seen</th><th>Last checked</th><th>Last changed</th><th>Verification</th><th /></tr>
        </thead>
        <tbody>
          {p.sourcesList.map((s) => {
            const [label, tone] = METHOD_LABEL[s.monitorMethod] ?? [s.monitorMethod, "muted"];
            return (
              <tr key={s.id} className="border-b border-line/60 align-top">
                <td className="py-1.5"><ChangeBadge status={s.status} /></td>
                <td className="max-w-[340px]">
                  <div className="flex items-center gap-1.5"><PlatformGlyph platform={s.platform} /> <span className="truncate text-text">{s.title ?? s.url}</span></div>
                  <div className="mono truncate text-[10.5px] text-muted">{s.url}</div>
                </td>
                <td><Badge tone={tone}>{label}</Badge></td>
                <td className="mono text-[11px]">{fmtDate(s.firstSeenAt, true)}</td>
                <td className="mono text-[11px]">{fmtDate(s.lastCheckedAt, true)}</td>
                <td className="mono text-[11px]">{fmtDate(s.lastChangedAt, true)}</td>
                <td><StateBadge state={s.verificationStatus} /></td>
                <td><SourceLink url={s.url} isDemo={s.isDemo} className="text-[11px]" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EvidenceTab({ p }: { p: PersonDetailView }) {
  if (!p.evidence.length) return <Empty>No evidence yet.</Empty>;
  return (
    <div className="grid gap-2 lg:grid-cols-2" data-testid="evidence-list">
      {p.evidence.map((e) => (
        <div key={e.id} className="rounded-[4px] border border-line bg-bg-2/60 p-3 text-[12.5px]">
          <div className="flex items-center justify-between gap-2">
            <span className="label !text-accent">source · {e.sourceName}</span>
            <StateBadge state={e.verificationStatus} />
          </div>
          <div className="mt-1 font-medium text-text">{e.title}</div>
          <dl className="mono mt-1.5 grid grid-cols-[100px_1fr] gap-y-0.5 text-[11px]">
            <dt className="text-muted">FIRST SEEN</dt><dd>{fmtDate(e.firstSeenAt, true)}</dd>
            <dt className="text-muted">LAST CHECKED</dt><dd>{fmtDate(e.lastSeenAt, true)}</dd>
          </dl>
          <p className="mt-1.5 text-text-2"><span className="label !text-[9px]">detail </span>{e.summary}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {Object.entries(e.extractedAttributes).map(([k, v]) => (
              <Badge key={k} tone="dark">{k.replace("_", " ")}: {v.slice(0, 3).join(", ")}</Badge>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="mono truncate text-[10.5px] text-muted">{e.sourceUrl}</span>
            <SourceLink url={e.sourceUrl} isDemo={e.isDemo} className="text-[11px]" />
          </div>
        </div>
      ))}
    </div>
  );
}

const TL_TONE: Record<string, string> = { new: "bg-alert", changed: "bg-warn", gone: "bg-muted", locked: "bg-ok", discovered: "bg-accent", identifier_added: "bg-ok", source_found: "bg-accent", scan: "bg-accent-2", baseline: "bg-accent-2" };

function TimelineTab({ p }: { p: PersonDetailView }) {
  const byDay = new Map<string, typeof p.timeline>();
  for (const t of p.timeline) {
    const d = fmtDate(t.occurredAt);
    byDay.set(d, [...(byDay.get(d) ?? []), t]);
  }
  return (
    <div className="space-y-4" data-testid="timeline">
      {Array.from(byDay.entries()).map(([day, items]) => (
        <div key={day}>
          <div className="label mb-2 !text-accent">{day}</div>
          <ol className="relative space-y-2 border-l border-line pl-4">
            {items.map((t) => (
              <li key={t.id} className="relative text-[12.5px]">
                <span className={cn("absolute -left-[21px] top-1.5 h-2 w-2 rounded-full", TL_TONE[t.type] ?? "bg-muted")} />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mono text-[10.5px] text-muted">{new Date(t.occurredAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="text-text">{t.title}</span>
                  {t.url && <SourceLink url={t.url} isDemo={p.isDemo} className="text-[11px]">evidence</SourceLink>}
                </div>
                {t.detail && <div className="text-[11.5px] text-text-2">{t.detail}</div>}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function HistoryTab({ personId }: { personId: string }) {
  const { data } = useApi<{ iterations: { id: string; number: number; reason: string; queryCount: number; startedAt: string }[]; queries: QueryRowView[] }>(`/api/persons/${personId}/history`);
  if (!data) return <p className="text-[12px] text-muted">Loading…</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {data.iterations.map((i) => (
          <Badge key={i.id} tone="dark">#{i.number} · {i.reason} · {i.queryCount}q · {fmtDate(i.startedAt, true)}</Badge>
        ))}
      </div>
      <QueryTable queries={data.queries} />
    </div>
  );
}

function DiffView({ c }: { c: ChangeView }) {
  return (
    <div className="mono whitespace-pre-wrap rounded-[3px] border border-line bg-black/40 p-2 text-[11.5px] leading-relaxed">
      {c.diff.map((d, i) => (
        <span key={i} className={d.op === "add" ? "diff-add" : d.op === "remove" ? "diff-remove" : "text-text-2"}>
          {d.text}
        </span>
      ))}
    </div>
  );
}

function ChangesTab({ p, reload }: { p: PersonDetailView; reload: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const markSeen = async () => {
    await apiFetch(`/api/persons/${p.id}/changes/seen`, { method: "POST" });
    reload();
  };
  if (!p.changes.length) return <Empty>No new or changed information detected yet.</Empty>;
  return (
    <div className="space-y-2" data-testid="changes-list">
      <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={markSeen}>Mark all as reviewed</Button></div>
      {p.changes.map((c) => (
        <div key={c.id} className={cn("rounded-[4px] border p-3", !c.seen && c.changeType === "NEW" ? "border-alert/40 bg-alert/[0.04]" : !c.seen && c.changeType === "CHANGED" ? "border-warn/40 bg-warn/[0.04]" : "border-line bg-bg-2/50")} data-testid="change-item" data-type={c.changeType}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ChangeBadge status={c.changeType} />
              <span className="text-[13px] text-text">{c.sourceTitle ?? c.sourceUrl}</span>
            </div>
            <span className="mono text-[10.5px] text-muted">{fmtDate(c.detectedAt, true)}</span>
          </div>
          {c.attributeChanges.length > 0 ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {c.attributeChanges.map((a) => (
                <div key={a.kind} className="contents">
                  <div className="rounded-[3px] border border-alert/30 bg-alert/5 p-2"><div className="label !text-alert">old · {a.kind.replace("_", " ")}</div><div className="text-[13px]">{a.old.join(", ") || "—"}</div></div>
                  <div className="rounded-[3px] border border-ok/30 bg-ok/5 p-2"><div className="label !text-ok">new · {a.kind.replace("_", " ")}</div><div className="text-[13px]">{a.new.join(", ") || "—"}</div></div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[12px] text-text-2">{c.summary}</p>
          )}
          <div className="mt-2 flex gap-2">
            {c.sourceUrl && <SourceLink url={c.sourceUrl} isDemo={p.isDemo} className="mono text-[10.5px] uppercase tracking-[0.12em]">View source</SourceLink>}
            {c.diff.length > 0 && (
              <button onClick={() => setOpen(open === c.id ? null : c.id)} className="mono flex items-center gap-1 text-[10.5px] uppercase tracking-[0.12em] text-accent hover:underline" data-testid="compare-changes">
                <GitCompare className="size-3" /> Compare changes
              </button>
            )}
          </div>
          {open === c.id && <div className="mt-2"><DiffView c={c} /></div>}
        </div>
      ))}
    </div>
  );
}

function MonitoringTab({ p, isAdmin, setMonitoring, scan }: { p: PersonDetailView; isAdmin: boolean; setMonitoring: (x: { status?: "active" | "paused" }) => Promise<void>; scan: () => void }) {
  const { data: plan } = useApi<{ target: TargetProfile; planned: PlannedQuery[] }>(`/api/persons/${p.id}/search-plan`);
  const m = p.monitoring;
  const handles = new Set(p.identifiers.filter((i) => !i.removedAt && i.state === "confirmed").map((i) => i.handle));
  return (
    <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
      <Panel title={<><Radar className="size-3.5 text-accent" /> Monitoring</>}>
        <dl className="grid grid-cols-2 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted">Status</dt><dd className="text-right">{m.running ? "scanning" : m.status}</dd>
          <dt className="text-muted">Interval</dt><dd className="mono text-right">every {m.intervalHours}h</dd>
          <dt className="text-muted">Last scan</dt><dd className="mono text-right">{fmtDate(m.lastRunAt, true)}</dd>
          <dt className="text-muted">Next scan</dt><dd className="mono text-right">{m.status === "paused" ? "paused" : fmtDate(m.nextRunAt, true)}</dd>
          <dt className="text-muted">Scans run</dt><dd className="mono text-right">{m.runCount}</dd>
        </dl>
        {m.lastSummary && (
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            <Stat label="new" value={m.lastSummary.new ?? 0} tone="alert" />
            <Stat label="changed" value={m.lastSummary.changed ?? 0} tone="warn" />
            <Stat label="gone" value={m.lastSummary.gone ?? 0} />
            <Stat label="unchanged" value={m.lastSummary.unchanged ?? 0} tone="ok" />
            <Stat label="checked" value={m.lastSummary.checked ?? 0} />
            <Stat label="queries" value={m.lastSummary.queries ?? 0} />
          </div>
        )}
        {m.lastError && <p className="mt-2 text-[12px] text-alert">Last error: {m.lastError}</p>}
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="primary" onClick={scan} disabled={m.running}><RefreshCw /> Scan now</Button>
          {isAdmin && (m.status === "active" ? <Button size="sm" variant="outline" onClick={() => setMonitoring({ status: "paused" })}><Pause /> Pause</Button> : <Button size="sm" variant="ok" onClick={() => setMonitoring({ status: "active" })}><Play /> Resume</Button>)}
        </div>
        <p className="mt-3 text-[10.5px] text-muted">Each scan re-checks known URLs (hash + diff) and runs a small set of searches built from confirmed identifiers. Expensive providers are cached for 6h.</p>
      </Panel>
      <Panel title="Next scan · search plan (from confirmed identity)">
        {!plan ? (
          <p className="text-[12px] text-muted">Loading…</p>
        ) : (
          <ul className="space-y-1" data-testid="search-plan">
            {plan.planned.map((q) => {
              const usesId = Array.from(handles).some((h) => q.query.includes(h) || q.handle === h);
              return (
                <li key={q.key} className="grid grid-cols-[34px_1fr_auto] items-center gap-2 text-[12px]">
                  <span className="mono text-[10px] text-muted">T{q.tier}</span>
                  <span className={cn("mono truncate", usesId ? "text-ok" : "text-text")}>{q.query}</span>
                  <span className="text-[10.5px] text-muted">{q.channel}</span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[10.5px] text-muted">Queries in green use a confirmed identifier.</p>
      </Panel>
    </div>
  );
}

function SettingsTab({ p, isAdmin, setMonitoring }: { p: PersonDetailView; isAdmin: boolean; setMonitoring: (x: { intervalHours?: number }) => Promise<void> }) {
  const [hours, setHours] = useState(String(p.monitoring.intervalHours));
  const [saved, setSaved] = useState(false);
  return (
    <div className="max-w-lg space-y-4">
      <div>
        <Label htmlFor="interval">Scan interval (hours)</Label>
        <div className="flex gap-2">
          <Input id="interval" type="number" min={1} max={720} value={hours} onChange={(e) => { setHours(e.target.value); setSaved(false); }} disabled={!isAdmin} className="w-32" />
          <Button disabled={!isAdmin} onClick={async () => { await setMonitoring({ intervalHours: Number(hours) }); setSaved(true); }}>Save</Button>
          {saved && <span className="self-center text-[12px] text-ok">Saved</span>}
        </div>
        {!isAdmin && <p className="mt-1 text-[11px] text-muted">Only admins can change monitoring settings.</p>}
      </div>
      <div className="text-[12px] text-text-2">
        <div className="label mb-1">Data handling</div>
        Only public sources are monitored. Login-walled platforms (LinkedIn, Instagram, Facebook, X) are observed through public search results only. No private posts, messages or accounts are accessed.
      </div>
      {p.sessionId && <Link href={`/?s=${p.sessionId}`} className="text-[12px] text-accent hover:underline">Open the original discovery session →</Link>}
    </div>
  );
}
