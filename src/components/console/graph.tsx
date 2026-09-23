"use client";
import { Panel, Empty } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { PLATFORM_LABEL } from "@/lib/core/profiles";
import { ATTRIBUTE_LABEL } from "@/lib/core/labels";
import type { AttributeKind, CandidateProfile, TargetProfile } from "@/lib/core/types";

interface GNode {
  id: string;
  label: string;
  kind: string;
  tone: "ok" | "alert" | "violet" | "accent" | "muted";
  evidence: number;
  dashed?: boolean;
}

const TONE: Record<GNode["tone"], string> = { ok: "#3ddc84", alert: "#ff4d5e", violet: "#9d8cff", accent: "#2ee6d6", muted: "#62808b" };

/** Nodes only for relationships backed by evidence on the focused candidate. */
function nodesFor(c: CandidateProfile): GNode[] {
  const nodes: GNode[] = [];
  const statusOf = (key: string, value: string): GNode["tone"] => {
    const b = c.match.breakdown.find((x) => x.key === key);
    if (!b) return "violet";
    if (b.status === "match" && b.found.some((f) => f.toLowerCase().includes(value.toLowerCase()) || value.toLowerCase().includes(f.toLowerCase()))) return "ok";
    if (b.status === "conflict") return "alert";
    return "violet";
  };
  const kinds: AttributeKind[] = ["city", "organization", "designation", "previous_organization", "school", "age", "event"];
  for (const k of kinds) {
    for (const v of (c.attributes[k] ?? []).slice(0, k === "organization" ? 2 : 1)) {
      nodes.push({ id: `${k}:${v.value}`, label: k === "age" ? `~${v.value} yrs` : v.value, kind: ATTRIBUTE_LABEL[k], tone: statusOf(k, v.value), evidence: v.evidence.length });
    }
  }
  for (const p of c.profiles.slice(0, 6)) {
    const b = c.match.breakdown.find((x) => x.key === `platform:${p.platform}`);
    nodes.push({ id: `p:${p.platform}:${p.handle}`, label: p.handle, kind: PLATFORM_LABEL[p.platform], tone: b?.status === "match" ? "ok" : b?.status === "conflict" ? "alert" : "accent", evidence: p.evidence.length });
  }
  const articleDomains = c.domains.filter((d) => !/(linkedin|github|youtube|instagram|facebook|reddit|x)\.com$/.test(d)).slice(0, 2);
  for (const d of articleDomains) nodes.push({ id: `d:${d}`, label: d, kind: "Mention", tone: "muted", evidence: 1 });
  return nodes.slice(0, 12);
}

function nodesForTarget(t: TargetProfile): GNode[] {
  return [
    ...t.attributes.filter((a) => a.kind !== "other").map((a) => ({ id: `${a.kind}:${a.value}`, label: a.value, kind: ATTRIBUTE_LABEL[a.kind], tone: "muted" as const, evidence: 0, dashed: true })),
    ...t.identifiers.map((i) => ({ id: `p:${i.platform}:${i.handle}`, label: i.handle, kind: PLATFORM_LABEL[i.platform], tone: "muted" as const, evidence: 0, dashed: true })),
  ].slice(0, 12);
}

export function EntityGraphPanel({ target, candidate, running }: { target: TargetProfile | null; candidate: CandidateProfile | null; running: boolean }) {
  const nodes = candidate ? nodesFor(candidate) : target ? nodesForTarget(target) : [];
  const W = 640;
  const H = 330;
  const cx = W / 2;
  const cy = H / 2;
  const rx = 245;
  const ry = 120;
  return (
    <Panel
      title="Entity relationship graph"
      right={candidate ? <Badge tone="accent">candidate {candidate.clusterKey}</Badge> : target ? <Badge tone="dark">unverified input</Badge> : null}
      bodyClassName="p-0"
      scanning={running}
    >
      {!target ? (
        <Empty>
          <div>
            <div className="mono text-[12px] tracking-[0.2em] text-accent/70">AWAITING TARGET</div>
            <div className="mt-1">Enter a name to begin discovery. Relationships appear only when supported by evidence.</div>
          </div>
        </Empty>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full max-h-[340px] w-full" role="img" aria-label="Entity relationship graph">
          <defs>
            <radialGradient id="core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#2ee6d6" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#2ee6d6" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="#1a2a32" strokeDasharray="2 5" />
          <ellipse cx={cx} cy={cy} rx={rx * 0.55} ry={ry * 0.55} fill="none" stroke="#1a2a32" strokeDasharray="2 5" />
          {nodes.map((n, i) => {
            const a = (i / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
            const x = cx + Math.cos(a) * rx;
            const y = cy + Math.sin(a) * ry;
            const col = TONE[n.tone];
            return (
              <g key={n.id}>
                <line x1={cx} y1={cy} x2={x} y2={y} stroke={col} strokeOpacity={0.45} strokeWidth={n.evidence > 1 ? 1.6 : 1} strokeDasharray={n.dashed ? "4 4" : undefined} />
                {n.evidence > 0 && (
                  <text x={(cx + x) / 2} y={(cy + y) / 2 - 3} fill="#62808b" fontSize="9" textAnchor="middle" className="mono">
                    {n.evidence}×
                  </text>
                )}
                <circle cx={x} cy={y} r={5} fill="#06080a" stroke={col} strokeWidth={1.5} strokeDasharray={n.dashed ? "2 2" : undefined} />
                <text x={x + (x >= cx ? 10 : -10)} y={y - 2} fill="#cfdde3" fontSize="11.5" textAnchor={x >= cx ? "start" : "end"}>
                  {n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label}
                </text>
                <text x={x + (x >= cx ? 10 : -10)} y={y + 11} fill={col} fontSize="8.5" letterSpacing="1.2" textAnchor={x >= cx ? "start" : "end"} className="mono">
                  {n.kind.toUpperCase()}
                </text>
              </g>
            );
          })}
          <circle cx={cx} cy={cy} r={46} fill="url(#core)" />
          {running && <circle cx={cx} cy={cy} r={16} fill="none" stroke="#2ee6d6" className="pulse-ring" />}
          <circle cx={cx} cy={cy} r={16} fill="#06080a" stroke="#2ee6d6" strokeWidth={1.5} />
          <circle cx={cx} cy={cy} r={4} fill="#2ee6d6" />
          <text x={cx} y={cy + 34} fill="#e6f7f5" fontSize="13" fontWeight={600} textAnchor="middle">
            {candidate?.displayName ?? target.name}
          </text>
          <g className="mono" fontSize="8.5" letterSpacing="1">
            <circle cx={16} cy={H - 30} r={3.5} fill="none" stroke={TONE.ok} />
            <text x={25} y={H - 27} fill="#62808b">MATCHES INPUT</text>
            <circle cx={16} cy={H - 16} r={3.5} fill="none" stroke={TONE.alert} />
            <text x={25} y={H - 13} fill="#62808b">CONFLICTS</text>
            <circle cx={120} cy={H - 30} r={3.5} fill="none" stroke={TONE.violet} />
            <text x={129} y={H - 27} fill="#62808b">DISCOVERED</text>
            <circle cx={120} cy={H - 16} r={3.5} fill="none" stroke={TONE.muted} strokeDasharray="2 2" />
            <text x={129} y={H - 13} fill="#62808b">{candidate ? "MENTION" : "INPUT (NO EVIDENCE YET)"}</text>
          </g>
        </svg>
      )}
    </Panel>
  );
}
