"use client";
import { MapPin } from "lucide-react";
import { Panel, Empty } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { PLACES } from "@/lib/core/lexicon";
import type { CandidateProfile, ResolutionSummary, TargetProfile } from "@/lib/core/types";
import type { CoverageRowView, SessionView } from "@/lib/view-types";
import { cn } from "@/lib/utils";

interface Marker {
  city: string;
  lat: number;
  lon: number;
  count: number;
  target: boolean;
}

function markers(target: TargetProfile | null, cands: CandidateProfile[]): Marker[] {
  const map = new Map<string, Marker>();
  const place = (name: string) => PLACES.find((p) => p.city.toLowerCase() === name.toLowerCase());
  for (const a of target?.attributes ?? []) {
    if (a.kind !== "city") continue;
    const p = place(a.value);
    if (p) map.set(p.city, { city: p.city, lat: p.lat, lon: p.lon, count: 0, target: true });
  }
  for (const c of cands) {
    const city = c.attributes.city?.[0]?.value;
    const p = city ? place(city) : undefined;
    if (!p) continue;
    const m = map.get(p.city) ?? { city: p.city, lat: p.lat, lon: p.lon, count: 0, target: false };
    m.count++;
    map.set(p.city, m);
  }
  return Array.from(map.values());
}

export function LocationPanel({ target, candidates }: { target: TargetProfile | null; candidates: CandidateProfile[] }) {
  const ms = markers(target, candidates);
  const W = 300;
  const H = 170;
  let minLat = 5, maxLat = 32, minLon = 68, maxLon = 92; // default: Indian subcontinent
  if (ms.length) {
    minLat = Math.min(...ms.map((m) => m.lat)) - 4;
    maxLat = Math.max(...ms.map((m) => m.lat)) + 4;
    minLon = Math.min(...ms.map((m) => m.lon)) - 6;
    maxLon = Math.max(...ms.map((m) => m.lon)) + 6;
  }
  const px = (lon: number) => ((lon - minLon) / (maxLon - minLon || 1)) * (W - 20) + 10;
  const py = (lat: number) => H - (((lat - minLat) / (maxLat - minLat || 1)) * (H - 20) + 10);
  return (
    <Panel title={<><MapPin className="size-3.5 text-accent" /> Location insights</>} bodyClassName="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-[4px] border border-line bg-bg-2/70" role="img" aria-label="Candidate locations">
        {Array.from({ length: 13 }).map((_, i) => (
          <line key={`v${i}`} x1={(i * W) / 12} y1={0} x2={(i * W) / 12} y2={H} stroke="#132028" />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <line key={`h${i}`} x1={0} y1={(i * H) / 7} x2={W} y2={(i * H) / 7} stroke="#132028" />
        ))}
        {ms.map((m) => (
          <g key={m.city}>
            {m.target && (
              <>
                <circle cx={px(m.lon)} cy={py(m.lat)} r={12} fill="none" stroke="#2ee6d6" strokeOpacity={0.5} />
                <line x1={px(m.lon) - 18} y1={py(m.lat)} x2={px(m.lon) + 18} y2={py(m.lat)} stroke="#2ee6d6" strokeOpacity={0.4} />
                <line x1={px(m.lon)} y1={py(m.lat) - 18} x2={px(m.lon)} y2={py(m.lat) + 18} stroke="#2ee6d6" strokeOpacity={0.4} />
              </>
            )}
            <circle cx={px(m.lon)} cy={py(m.lat)} r={3 + Math.min(m.count, 6)} fill={m.count ? "rgba(245,184,61,0.25)" : "rgba(46,230,214,0.2)"} stroke={m.count ? "#f5b83d" : "#2ee6d6"} />
            <text x={px(m.lon) + 9} y={py(m.lat) - 7} fill="#cfdde3" fontSize="9.5" className="mono">
              {m.city.toUpperCase()}
            </text>
          </g>
        ))}
        {!ms.length && (
          <text x={W / 2} y={H / 2} fill="#62808b" fontSize="10" textAnchor="middle" className="mono">
            NO LOCATION SIGNALS
          </text>
        )}
      </svg>
      <ul className="space-y-1">
        {ms.map((m) => (
          <li key={m.city} className="flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-2">
              <span className={cn("h-1.5 w-1.5 rounded-full", m.target ? "bg-accent" : "bg-warn")} />
              {m.city}
              {m.target && <Badge tone="accent">input</Badge>}
            </span>
            <span className="mono text-[11px] text-muted">{m.count} candidate{m.count === 1 ? "" : "s"}</span>
          </li>
        ))}
      </ul>
      <p className="text-[10.5px] text-muted">Locations come from public text on sources — not device or live location.</p>
    </Panel>
  );
}

const STATE_LABEL: Record<string, [string, "warn" | "ok" | "alert" | "accent" | "muted"]> = {
  search_in_progress: ["SEARCH IN PROGRESS", "accent"],
  discovery_results: ["DISCOVERY RESULTS", "ok"],
  ask_for_more_information: ["ASK FOR MORE INFORMATION", "warn"],
  person_locked: ["PERSON LOCKED", "ok"],
  error: ["ERROR", "alert"],
};

export function SummaryPanel({ session, resolution }: { session: SessionView | null; resolution: ResolutionSummary | null }) {
  if (!session) {
    return (
      <Panel title="Search summary">
        <ol className="space-y-1.5 text-[12px] text-text-2">
          {["Discover", "Match", "Show evidence", "Ask user", "Confirm", "Lock", "Monitor"].map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className="mono flex h-4 w-4 items-center justify-center rounded-[2px] border border-line-2 text-[9px] text-accent">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[11px] text-muted">The system never decides identity on its own. You confirm the person before anything is locked or monitored.</p>
      </Panel>
    );
  }
  const [label, tone] = STATE_LABEL[session.uiState] ?? ["—", "muted"];
  const top = session.candidates[0];
  return (
    <Panel title="Search summary" right={<Badge tone={tone} data-testid="ui-state">{label}</Badge>}>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
        <dt className="text-muted">Target</dt>
        <dd className="truncate text-right text-text">{session.target.name}</dd>
        <dt className="text-muted">Queries executed</dt>
        <dd className="mono text-right">{session.progress.completed}</dd>
        <dt className="text-muted">Iterations</dt>
        <dd className="mono text-right">{session.progress.iteration}</dd>
        <dt className="text-muted">Candidates</dt>
        <dd className="mono text-right">{session.candidates.length}</dd>
        <dt className="text-muted">Best match</dt>
        <dd className="mono text-right text-accent">{top ? `${top.match.matched}/${top.match.total}` : "—"}</dd>
        <dt className="text-muted">Unattributed</dt>
        <dd className="mono text-right">{session.unattributed.length}</dd>
      </dl>
      {resolution && <p className={cn("mt-3 rounded-[3px] border px-2 py-1.5 text-[11.5px]", resolution.state === "leading" ? "border-ok/30 bg-ok/5 text-ok" : "border-warn/30 bg-warn/5 text-warn")}>{resolution.message}</p>}
    </Panel>
  );
}

const COV_ICON: Record<CoverageRowView["status"], [string, string]> = {
  ACTIVE: ["●", "text-ok"],
  LIMITED: ["◐", "text-warn"],
  UNAVAILABLE: ["○", "text-muted"],
  DEMO: ["◆", "text-warn"],
};

export function CoveragePanel({ coverage }: { coverage: CoverageRowView[] }) {
  return (
    <Panel title="Source coverage">
      {!coverage.length ? (
        <Empty>Checking providers…</Empty>
      ) : (
        <ul className="space-y-1" data-testid="coverage">
          {coverage.map((c) => (
            <li key={c.key} className="flex items-center justify-between gap-2 text-[12px]" title={c.note || c.via.join(", ")}>
              <span className="text-text-2">{c.label}</span>
              <span className={cn("mono text-[10.5px] tracking-[0.1em]", COV_ICON[c.status][1])}>
                {COV_ICON[c.status][0]} {c.status}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[10.5px] text-muted">A source is only shown ACTIVE when an adapter actually queries it. LIMITED = public search results only.</p>
    </Panel>
  );
}
