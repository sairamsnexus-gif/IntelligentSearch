"use client";
import { useMemo } from "react";
import { Panel, Empty } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import type { Entity, Investigation } from "@/lib/nexus/schema";
import { V_COLOR } from "./bits";

const ORG = new Set(["business", "school", "organisation"]);
const SHOWN = new Set(["person", "business", "school", "organisation", "location", "social_profile"]);
const KIND_LABEL: Record<string, string> = { person: "PERSON", business: "BUSINESS", school: "SCHOOL", organisation: "ORGANISATION", location: "LOCATION", social_profile: "PROFILE" };

interface Pos {
  e: Entity;
  x: number;
  y: number;
  clue: boolean;
}

/** Evidence graph: nodes are ledger entities; edges are relationships coloured by verification state. */
export function NexusGraph({ inv, running, selected, onSelect }: { inv: Investigation | null; running: boolean; selected: string | null; onSelect: (id: string | null) => void }) {
  const W = 760;
  const H = 380;
  const cx = W / 2;
  const cy = H / 2;

  const layout = useMemo(() => {
    if (!inv) return { nodes: [] as Pos[], edges: [] as Investigation["relationships"] };
    const rels = inv.relationships.filter((r) => r.userDecision !== "rejected");
    const linked = new Set(rels.flatMap((r) => [r.subjectId, r.objectId]));
    const ents = inv.entities.filter((e) => SHOWN.has(e.type) && e.userDecision !== "rejected" && (linked.has(e.id) || e.key.startsWith("clue:")));
    const orgs = ents.filter((e) => ORG.has(e.type)).slice(0, 10);
    const clues = ents.filter((e) => e.key.startsWith("clue:"));
    const others = ents.filter((e) => !ORG.has(e.type) && !e.key.startsWith("clue:")).slice(0, 34);
    const pos = new Map<string, Pos>();
    const angle = new Map<string, number>();
    orgs.forEach((o, i) => {
      const a = (i / Math.max(orgs.length, 1)) * Math.PI * 2 - Math.PI / 2 + 0.3;
      angle.set(o.id, a);
      pos.set(o.id, { e: o, x: cx + Math.cos(a) * 170, y: cy + Math.sin(a) * 92, clue: false });
    });
    clues.forEach((c, i) => {
      const x = cx + (clues.length === 1 ? 0 : (i / (clues.length - 1) - 0.5) * 110);
      pos.set(c.id, { e: c, x, y: cy, clue: true });
    });
    const perAngle = new Map<number, number>();
    others.forEach((o, i) => {
      const linkedOrgs = rels.filter((r) => r.subjectId === o.id || r.objectId === o.id).map((r) => (r.subjectId === o.id ? r.objectId : r.subjectId)).filter((id) => angle.has(id));
      let a = linkedOrgs.length ? linkedOrgs.reduce((s, id) => s + angle.get(id)!, 0) / linkedOrgs.length : (i / Math.max(others.length, 1)) * Math.PI * 2;
      const bucket = Math.round(a * 10);
      const k = perAngle.get(bucket) ?? 0;
      perAngle.set(bucket, k + 1);
      a += (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.3;
      pos.set(o.id, { e: o, x: cx + Math.cos(a) * 330, y: cy + Math.sin(a) * 160, clue: false });
    });
    const edges = rels.filter((r) => pos.has(r.subjectId) && pos.has(r.objectId));
    return { nodes: Array.from(pos.values()), edges, pos };
  }, [inv, cx, cy]);

  const pos = new Map(layout.nodes.map((n) => [n.e.id, n]));
  const focus = selected ? new Set([selected, ...layout.edges.filter((r) => r.subjectId === selected || r.objectId === selected).flatMap((r) => [r.subjectId, r.objectId])]) : null;

  return (
    <Panel title="Entity & evidence graph" right={inv ? <Badge tone="dark">{layout.nodes.length} nodes · {layout.edges.length} links</Badge> : null} bodyClassName="p-0" scanning={running}>
      {!inv ? (
        <Empty>
          <div>
            <div className="mono text-[12px] tracking-[0.2em] text-accent/70">AWAITING REQUEST</div>
            <div className="mt-1">Entities appear only when a source documents them. Links are coloured by evidence strength.</div>
          </div>
        </Empty>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full max-h-[400px] w-full" role="img" aria-label="Entity relationship graph" data-testid="nexus-graph" onClick={() => onSelect(null)}>
          <ellipse cx={cx} cy={cy} rx={170} ry={92} fill="none" stroke="#1a2a32" strokeDasharray="2 5" />
          <ellipse cx={cx} cy={cy} rx={330} ry={160} fill="none" stroke="#1a2a32" strokeDasharray="2 5" />
          {layout.edges.map((r) => {
            const a = pos.get(r.subjectId)!;
            const b = pos.get(r.objectId)!;
            const dim = focus && !(focus.has(r.subjectId) && focus.has(r.objectId));
            return (
              <line key={r.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={V_COLOR[r.verification]} strokeOpacity={dim ? 0.12 : 0.6} strokeWidth={r.independentSources > 1 ? 1.8 : 1.1} strokeDasharray={r.hypothesis ? "5 4" : r.provenance.assistedBy ? "2 3" : undefined}>
                <title>{`${r.predicate.replace(/_/g, " ")} · ${r.verification.replace(/_/g, " ")} · ${r.independentSources} independent source(s)`}</title>
              </line>
            );
          })}
          {layout.nodes.map((n) => {
            const isOrg = ORG.has(n.e.type);
            const col = n.clue ? "#9d8cff" : isOrg ? "#2ee6d6" : n.e.type === "person" ? "#cfdde3" : n.e.type === "location" ? "#f5b83d" : "#19b7c9";
            const dim = focus && !focus.has(n.e.id);
            const right = n.x >= cx;
            return (
              <g key={n.e.id} opacity={dim ? 0.25 : 1} className="cursor-pointer" onClick={(ev) => { ev.stopPropagation(); onSelect(n.e.id); }} data-testid="nexus-graph-node">
                {selected === n.e.id && <circle cx={n.x} cy={n.y} r={11} fill="none" stroke="#2ee6d6" strokeOpacity={0.5} />}
                <circle cx={n.x} cy={n.y} r={isOrg ? 6.5 : 5} fill="#06080a" stroke={col} strokeWidth={1.6} strokeDasharray={n.clue ? "2 2" : undefined} />
                {n.e.userDecision === "confirmed" && <circle cx={n.x} cy={n.y} r={2.2} fill="#3ddc84" />}
                <text x={n.x + (n.clue ? 0 : right ? 10 : -10)} y={n.clue ? n.y - 12 : n.y - 2} fill="#cfdde3" fontSize="11" textAnchor={n.clue ? "middle" : right ? "start" : "end"}>
                  {n.e.name.length > 30 ? `${n.e.name.slice(0, 29)}…` : n.e.name}
                </text>
                <text x={n.x + (n.clue ? 0 : right ? 10 : -10)} y={n.clue ? n.y + 18 : n.y + 10} fill={col} fontSize="8" letterSpacing="1.1" textAnchor={n.clue ? "middle" : right ? "start" : "end"} className="mono">
                  {n.clue ? "YOUR CLUE" : KIND_LABEL[n.e.type]}
                </text>
              </g>
            );
          })}
          <g className="mono" fontSize="8.5" letterSpacing="1">
            {[
              ["#3ddc84", "PRIMARY / CORROBORATED", undefined],
              ["#2ee6d6", "SINGLE SOURCE", undefined],
              ["#f5b83d", "WEAK", undefined],
              ["#ff4d5e", "CONTRADICTED", undefined],
              ["#9d8cff", "HYPOTHESIS (UNVERIFIED)", "5 4"],
            ].map(([c, l, d], i) => (
              <g key={l} transform={`translate(${12 + (i % 3) * 170}, ${H - 28 + Math.floor(i / 3) * 13})`}>
                <line x1={0} y1={-3} x2={16} y2={-3} stroke={c} strokeDasharray={d} />
                <text x={21} y={0} fill="#62808b">{l}</text>
              </g>
            ))}
          </g>
        </svg>
      )}
    </Panel>
  );
}
