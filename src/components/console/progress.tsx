"use client";
import { useState } from "react";
import { CheckCircle2, CircleDashed, ListTree, Loader2, MinusCircle } from "lucide-react";
import { Panel, Stat } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { CATEGORY_LABEL } from "@/lib/core/planner";
import { useApi } from "@/lib/hooks";
import type { QueryCategory } from "@/lib/core/types";
import type { QueryRowView, SessionView } from "@/lib/view-types";
import { cn } from "@/lib/utils";

const ORDER: QueryCategory[] = ["name_variation", "company_location", "professional", "social", "news", "images", "documents", "username", "cross_reference", "discovered"];

export function SearchProgressPanel({ session }: { session: SessionView | null }) {
  const [showQueries, setShowQueries] = useState(false);
  const p = session?.progress;
  const running = session && (session.status === "running" || session.status === "queued");
  const pct = p && p.planned ? Math.round((p.completed / p.planned) * 100) : 0;
  const title = !session ? "Search idle" : running ? (p?.phase === "resolving" ? "Identity resolution" : "Search in progress") : session.status === "failed" ? "Search failed" : "Search complete";
  return (
    <Panel
      scanning={Boolean(running)}
      title={
        <>
          <span className={cn("h-1.5 w-1.5 rounded-full", running ? "bg-accent blink" : session ? "bg-ok" : "bg-muted")} /> {title}
        </>
      }
      right={
        session && (
          <div className="flex items-center gap-2">
            {p && <Badge tone="accent">iteration {p.iteration || 1} / {p.maxIterations}</Badge>}
            <Button size="sm" variant="ghost" onClick={() => setShowQueries(true)} data-testid="view-queries">
              <ListTree /> Queries
            </Button>
          </div>
        )
      }
    >
      {!session || !p ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Searches run" value="—" />
          <Stat label="Sources found" value="—" />
          <Stat label="Potential matches" value="—" />
          <Stat label="Attributes discovered" value="—" />
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="flex items-baseline justify-between">
              <span className="mono text-[13px] text-text" data-testid="progress-count">
                <span className="text-accent">{p.completed}</span> / {p.planned} searches completed
              </span>
              <span className="mono text-[11px] text-muted">{pct}%</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-gradient-to-r from-accent-2 to-accent transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {ORDER.filter((c) => p.categories[c]).map((c) => {
              const s = p.categories[c];
              const done = s.done >= s.planned;
              return (
                <div key={c} className="flex items-center justify-between text-[12px]">
                  <span className="flex items-center gap-2 text-text-2">
                    {done ? <CheckCircle2 className="size-3.5 text-ok" /> : running ? <Loader2 className="size-3.5 animate-spin text-accent" /> : <CircleDashed className="size-3.5 text-muted" />}
                    {CATEGORY_LABEL[c]}
                  </span>
                  <span className="mono text-[11px] text-muted">
                    {s.done}/{s.planned}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Searches run" value={p.completed} tone="accent" />
            <Stat label="Sources found" value={p.sourcesFound} />
            <Stat label="Potential matches" value={p.potentialMatches} tone={p.potentialMatches > 1 ? "warn" : "ok"} />
            <Stat label="Attributes discovered" value={p.attributesDiscovered} tone="accent" />
          </div>
          {p.failed > 0 && <p className="text-[11.5px] text-warn">{p.failed} provider call(s) failed — see Queries. Results from other sources were kept.</p>}
          {session.error && <p className="text-[12px] text-alert">Error: {session.error}</p>}
        </div>
      )}
      {session && <QueriesDialog open={showQueries} onClose={() => setShowQueries(false)} sessionId={session.id} />}
    </Panel>
  );
}

export function QueriesDialog({ open, onClose, sessionId, url }: { open: boolean; onClose: () => void; sessionId?: string; url?: string }) {
  const { data } = useApi<{ queries: QueryRowView[] }>(open ? (url ?? `/api/searches/${sessionId}/queries`) : null);
  return (
    <Dialog open={open} onClose={onClose} title="Search history · generated queries" wide>
      <QueryTable queries={data?.queries ?? []} />
    </Dialog>
  );
}

export function QueryTable({ queries }: { queries: QueryRowView[] }) {
  const byIt = new Map<number, QueryRowView[]>();
  for (const q of queries) byIt.set(q.iteration, [...(byIt.get(q.iteration) ?? []), q]);
  if (!queries.length) return <p className="text-[12px] text-muted">No queries recorded yet.</p>;
  return (
    <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
      {Array.from(byIt.entries()).map(([it, qs]) => (
        <div key={it}>
          <div className="label mb-1.5 !text-accent">{it === 0 ? "Verification" : `Iteration ${it}`} · {qs.filter((q) => q.adapter).length} executed · {qs.filter((q) => !q.adapter).length} skipped</div>
          <table className="w-full text-left text-[11.5px]">
            <thead className="label !text-[9px]">
              <tr className="border-b border-line">
                <th className="py-1 pr-2">Tier</th>
                <th className="py-1 pr-2">Query</th>
                <th className="py-1 pr-2">Channel</th>
                <th className="py-1 pr-2">Source</th>
                <th className="py-1 pr-2">Status</th>
                <th className="py-1 pr-2 text-right">Results</th>
                <th className="py-1">Reason</th>
              </tr>
            </thead>
            <tbody>
              {qs.map((q) => (
                <tr key={q.id} className="border-b border-line/60 align-top">
                  <td className="mono py-1 pr-2 text-muted">T{q.tier}</td>
                  <td className="mono py-1 pr-2 text-text">{q.query}</td>
                  <td className="py-1 pr-2 text-text-2">{q.channel}</td>
                  <td className="mono py-1 pr-2 text-text-2">{q.adapter ?? "—"}</td>
                  <td className="py-1 pr-2">
                    {q.status === "failed" ? (
                      <span className="text-alert" title={q.error ?? ""}>failed</span>
                    ) : q.status.startsWith("skipped") ? (
                      <span className="flex items-center gap-1 text-muted"><MinusCircle className="size-3" />{q.status.replace("skipped_", "")}</span>
                    ) : (
                      <span className={q.status === "cached" ? "text-violet" : "text-ok"}>{q.status}</span>
                    )}
                  </td>
                  <td className="mono py-1 pr-2 text-right text-text">{q.adapter ? q.resultCount : ""}</td>
                  <td className="py-1 text-muted">{q.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
