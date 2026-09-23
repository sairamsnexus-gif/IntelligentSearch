"use client";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity } from "lucide-react";
import { Panel, Empty } from "@/components/ui/panel";
import { useApi } from "@/lib/hooks";
import { apiFetch, cn, timeAgo } from "@/lib/utils";
import type { SessionView } from "@/lib/view-types";
import type { SystemStatus } from "@/components/shell/shell";
import { FindPersonPanel } from "./find-person";
import { SearchProgressPanel } from "./progress";
import { EntityGraphPanel } from "./graph";
import { CoveragePanel, LocationPanel, SummaryPanel } from "./side-panels";
import { CandidatesPanel } from "./candidates";

interface RecentSession {
  id: string;
  name: string;
  status: string;
  uiState: string;
  isDemo: boolean;
  createdAt: string;
  personId: string | null;
}

export function Console() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("s");
  const [starting, setStarting] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [pollHint, setPollHint] = useState(0);
  const [polled, setPolled] = useState<SessionView | null>(null);
  const livePoll = !polled || polled.status === "running" || polled.status === "queued";
  const { data: session, reload, setData } = useApi<SessionView>(sessionId ? `/api/searches/${sessionId}?k=${pollHint}` : null, sessionId && livePoll ? 900 : false);
  const { data: status } = useApi<SystemStatus>("/api/system/status");
  const { data: recent } = useApi<{ sessions: RecentSession[] }>(sessionId ? null : "/api/searches");

  const running = session ? session.status === "running" || session.status === "queued" : false;
  if (session !== polled) setPolled(session);

  const focusedCandidate = useMemo(() => session?.candidates.find((c) => c.clusterKey === focused) ?? session?.candidates[0] ?? null, [session, focused]);

  const startSearch = async (payload: Record<string, string>) => {
    setStarting(true);
    try {
      const r = await apiFetch<{ id: string }>("/api/searches", { method: "POST", body: JSON.stringify(payload) });
      setFocused(null);
      router.push(`/?s=${r.id}`);
    } finally {
      setStarting(false);
    }
  };

  const reset = () => {
    setData(null);
    setFocused(null);
    router.push("/");
  };

  return (
    <div className="space-y-3 p-3">
      <div className="grid gap-3 xl:grid-cols-[320px_minmax(0,1fr)_300px]">
        <div className="xl:max-h-[calc(100vh-110px)] xl:min-h-[640px]">
          <FindPersonPanel session={session} busy={starting} onSearch={startSearch} onReset={reset} />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <SearchProgressPanel session={session} />
          <EntityGraphPanel target={session?.target ?? null} candidate={session && session.candidates.length ? focusedCandidate : null} running={running} />
        </div>
        <div className="flex flex-col gap-3">
          <LocationPanel target={session?.target ?? null} candidates={session?.candidates ?? []} />
          <SummaryPanel session={session} resolution={session?.resolution ?? null} />
          <CoveragePanel coverage={session?.coverage ?? status?.coverage ?? []} />
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <CandidatesPanel
          session={session}
          focusedKey={focusedCandidate?.clusterKey ?? null}
          setFocused={setFocused}
          onRefined={() => {
            setPolled(null);
            setPollHint((x) => x + 1);
            void reload();
          }}
          onLocked={(id) => router.push(`/persons/${id}`)}
        />
        <Panel title={<><Activity className="size-3.5 text-accent" /> Activity timeline</>} bodyClassName="max-h-[520px] overflow-y-auto">
          {session ? (
            <ol className="space-y-1.5" data-testid="activity-log">
              {[...session.progress.log].reverse().map((l, i) => (
                <li key={i} className="grid grid-cols-[52px_1fr] gap-2 text-[11.5px]">
                  <span className="mono text-[10px] text-muted">{new Date(l.t).toLocaleTimeString("en-GB", { hour12: false })}</span>
                  <span className={cn("break-words", l.level === "new" ? "text-accent" : l.level === "warn" ? "text-warn" : "text-text-2")}>{l.msg}</span>
                </li>
              ))}
            </ol>
          ) : recent?.sessions.length ? (
            <div>
              <div className="label mb-2">Recent searches</div>
              <ul className="space-y-1">
                {recent.sessions.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => router.push(`/?s=${s.id}`)} className="flex w-full items-center justify-between rounded-[3px] px-2 py-1.5 text-left text-[12px] hover:bg-panel-3">
                      <span className="truncate text-text">{s.name}</span>
                      <span className="mono text-[10px] text-muted">
                        {s.personId ? "LOCKED" : s.uiState.replace(/_/g, " ").toUpperCase()} · {timeAgo(s.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Empty>Search activity streams here.</Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}
