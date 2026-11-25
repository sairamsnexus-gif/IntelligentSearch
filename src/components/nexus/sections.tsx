"use client";
import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { Panel, Empty } from "@/components/ui/panel";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { candidateMatches, reconcile } from "@/lib/nexus/analysis";
import { ENGINE_IDS, ENGINE_LABEL, VERIFICATION_STATES, type EngineId, type Investigation } from "@/lib/nexus/schema";
import { EngineTag, Ext, PRED_LABEL, VBadge, nameOf } from "./bits";
import type { InvestigationApi } from "./use-investigation";

type TabId = "findings" | "matches" | "relationships" | "evidence" | "trail" | "leads" | "contacts" | "coverage";

export function Sections({ api, select }: { api: InvestigationApi; select: (id: string) => void }) {
  const inv = api.inv;
  const [tab, setTab] = useState<TabId>("findings");
  const cands = useMemo(() => (inv ? candidateMatches(inv) : []), [inv]);
  const cov = useMemo(() => (inv ? reconcile(inv) : null), [inv]);
  if (!inv) return null;
  const openLeads = inv.leads.filter((l) => l.status === "open" || l.status === "limit_reached" || l.status === "discarded").length;
  return (
    <Panel bodyClassName="p-0" className="min-h-[420px]">
      <Tabs<TabId>
        value={tab}
        onChange={setTab}
        className="px-2"
        tabs={[
          { id: "findings", label: "A · Engine findings", count: inv.tasks.length },
          { id: "matches", label: "B · Possible matches", count: cands.length },
          { id: "relationships", label: "C · Relationships", count: inv.relationships.length },
          { id: "evidence", label: "D · Source evidence", count: inv.sources.length },
          { id: "trail", label: "E · Investigation trail", count: inv.trail.length },
          { id: "leads", label: "F · Unresolved leads", count: openLeads, tone: "warn" },
          { id: "contacts", label: "Public contacts", count: inv.contacts.length },
          { id: "coverage", label: "Coverage", count: cov?.inaccessible.length ?? 0, tone: "alert" },
        ]}
      />
      <div className="max-h-[720px] overflow-y-auto p-3" data-testid={`nexus-tab-${tab}`}>
        {tab === "findings" && <Findings inv={inv} />}
        {tab === "matches" && <Matches inv={inv} cands={cands} decide={api.decide} select={select} />}
        {tab === "relationships" && <Relationships inv={inv} decide={api.decide} select={select} />}
        {tab === "evidence" && <Evidence inv={inv} />}
        {tab === "trail" && <Trail inv={inv} />}
        {tab === "leads" && <Leads inv={inv} follow={api.investigateLead} running={api.running} />}
        {tab === "contacts" && <Contacts inv={inv} />}
        {tab === "coverage" && cov && <CoverageView inv={inv} cov={cov} />}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- A
function Findings({ inv }: { inv: Investigation }) {
  const [engine, setEngine] = useState<EngineId>("searxng");
  const tasks = inv.tasks.filter((t) => t.engine === engine);
  const src = new Map(inv.sources.map((s) => [s.id, s]));
  return (
    <div className="space-y-3">
      <p className="text-[11.5px] text-text-2">Each engine&apos;s own results, kept separate. Cross-engine conclusions live in Possible matches and Relationships.</p>
      <div className="flex flex-wrap gap-1.5">
        {ENGINE_IDS.map((e) => (
          <button key={e} onClick={() => setEngine(e)} className={cn("mono rounded-[3px] border px-2 py-1 text-[10.5px] uppercase tracking-[0.12em]", engine === e ? "border-accent/60 bg-accent/10 text-accent" : "border-line-2 text-muted hover:text-text")}>
            {ENGINE_LABEL[e]} <span className="opacity-70">{inv.tasks.filter((t) => t.engine === e).length}</span>
          </button>
        ))}
      </div>
      {!tasks.length ? (
        <Empty>{inv.settings.engines[engine] ? "This engine has not run any task in this investigation (unavailable in this mode, or no lead routed to it)." : "Engine switched off for this investigation."}</Empty>
      ) : (
        <ul className="space-y-2" data-testid="nexus-findings">
          {tasks.map((t) => (
            <li key={t.id} className="rounded-[4px] border border-line bg-bg-2/40 p-2.5 text-[11.5px]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={t.status === "done" ? "ok" : ["failed", "blocked", "unavailable"].includes(t.status) ? "alert" : t.status === "quota" ? "warn" : "accent"}>{t.status}</Badge>
                <span className="mono text-[10px] text-muted">R{t.round}</span>
                <span className="break-all text-text">{t.input.query ?? t.input.url ?? t.input.domain ?? (t.input.username ? `@${t.input.username}` : "")}</span>
                {t.provider && <span className="mono ml-auto text-[10px] text-muted">{t.provider}</span>}
              </div>
              <div className="mt-1 text-text-2">{t.reason}</div>
              {t.error && <div className="mt-1 text-alert">{t.error}</div>}
              {t.output.hits.length > 0 && (
                <ol className="mt-1.5 space-y-1">
                  {t.output.hits.slice(0, 8).map((h) => (
                    <li key={h.url}>
                      <Ext href={h.url}>{h.title || h.url}</Ext>
                      <div className="text-[11px] text-muted">{h.snippet}</div>
                    </li>
                  ))}
                </ol>
              )}
              {t.engine === "page" &&
                t.output.sourceIds.map((sid) => {
                  const s = src.get(sid);
                  return s ? (
                    <div key={sid} className="mt-1 text-[11px]">
                      <span className={s.fetch.status === "read" ? "text-ok" : "text-warn"}>{s.fetch.status.replace(/_/g, " ")}</span> <span className="text-muted">— {s.fetch.reason}</span>
                    </div>
                  ) : null;
                })}
              {t.output.narrative && (
                <details className="mt-1.5">
                  <summary className="mono cursor-pointer text-[10.5px] uppercase tracking-[0.12em] text-violet">AI-generated research notes (leads, not evidence)</summary>
                  <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-[11.5px] text-text-2">{t.output.narrative}</pre>
                </details>
              )}
              {t.output.notes.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted">
                  {t.output.notes.slice(0, 12).map((n, i) => (
                    <li key={i} className="break-words">· {n}</li>
                  ))}
                </ul>
              )}
              {t.output.leadIds.length > 0 && <div className="mono mt-1 text-[10px] text-accent-2">→ {t.output.leadIds.length} lead(s) handed to other engines</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- B
function Matches({ inv, cands, decide, select }: { inv: Investigation; cands: ReturnType<typeof candidateMatches>; decide: InvestigationApi["decide"]; select: (id: string) => void }) {
  if (!cands.length) return <Empty>No possible matches yet. Matches appear when a source documents a person or organisation consistent with your clues.</Empty>;
  return (
    <div className="space-y-3">
      <p className="text-[11.5px] text-text-2">Possible matches — not conclusions. People with the same name are never merged on name alone; confirm or reject each yourself.</p>
      <div className="grid gap-3 lg:grid-cols-2" data-testid="nexus-matches">
        {cands.map((c) => (
          <article key={c.entity.id} className={cn("rounded-[4px] border p-3", c.entity.userDecision === "confirmed" ? "border-ok/50 bg-ok/[0.04]" : c.entity.userDecision === "rejected" ? "border-alert/40 opacity-60" : "border-line bg-bg-2/40")} data-testid="nexus-match">
            <header className="flex flex-wrap items-center gap-2">
              <button onClick={() => select(c.entity.id)} className="text-[13.5px] font-semibold text-text hover:text-accent">
                {c.entity.name}
              </button>
              <Badge tone="dark">{c.kind}</Badge>
              <span className="mono text-[10px] text-muted">clue: {c.clue}</span>
              <span className="ml-auto">
                <VBadge v={c.bestVerification} />
              </span>
            </header>
            <Block title="Why it may match" tone="ok" items={c.matches.map((m) => `${m.what}: ${m.detail}`)} />
            <Block title="Conflicts" tone="alert" items={c.conflicts.map((m) => `${m.what}: ${m.detail}`)} empty="None found" />
            <Block title="Unknown" tone="muted" items={c.unknowns} />
            <div className="mt-2 text-[11px] text-muted">
              {c.relationships.filter((r) => !r.hypothesis).length} documented link(s) · {c.sources} source(s)
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant={c.entity.userDecision === "confirmed" ? "ok" : "outline"} onClick={() => decide("entity", c.entity.id, c.entity.userDecision === "confirmed" ? null : "confirmed")} data-testid="nexus-confirm">
                <Check /> {c.entity.userDecision === "confirmed" ? "Confirmed" : "Confirm"}
              </Button>
              <Button size="sm" variant={c.entity.userDecision === "rejected" ? "danger" : "ghost"} onClick={() => decide("entity", c.entity.id, c.entity.userDecision === "rejected" ? null : "rejected")}>
                <X /> {c.entity.userDecision === "rejected" ? "Rejected" : "Reject"}
              </Button>
            </div>
          </article>
        ))}
      </div>
      {inv.clues.userRelationships.length > 0 && <p className="text-[11px] text-violet">Your stated link between the named people stays an unverified hypothesis unless a source explicitly documents it. NEXUS never infers family relationships from surnames, photos, proximity or co-occurrence.</p>}
    </div>
  );
}

function Block({ title, items, tone, empty }: { title: string; items: string[]; tone: "ok" | "alert" | "muted"; empty?: string }) {
  if (!items.length && !empty) return null;
  return (
    <div className="mt-2">
      <div className={cn("label !text-[9.5px]", tone === "ok" ? "!text-ok" : tone === "alert" ? "!text-alert" : "")}>{title}</div>
      <ul className="mt-0.5 space-y-0.5 text-[11.5px] text-text-2">
        {items.length ? items.map((x, i) => <li key={i}>· {x}</li>) : <li className="text-muted">{empty}</li>}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- C
function Relationships({ inv, decide, select }: { inv: Investigation; decide: InvestigationApi["decide"]; select: (id: string) => void }) {
  const psg = new Map(inv.passages.map((p) => [p.id, p]));
  const src = new Map(inv.sources.map((s) => [s.id, s]));
  const rels = [...inv.relationships].sort((a, b) => VERIFICATION_STATES.indexOf(a.verification) - VERIFICATION_STATES.indexOf(b.verification));
  if (!rels.length) return <Empty>No documented relationships yet.</Empty>;
  return (
    <ul className="space-y-2" data-testid="nexus-relationships">
      {rels.map((r) => (
        <li key={r.id} className={cn("rounded-[4px] border border-line bg-bg-2/40 p-2.5 text-[11.5px]", r.userDecision === "rejected" && "opacity-50")}>
          <div className="flex flex-wrap items-center gap-1.5">
            <button className="font-semibold text-text hover:text-accent" onClick={() => select(r.subjectId)}>{nameOf(inv, r.subjectId)}</button>
            <span className="text-muted">{PRED_LABEL[r.predicate]}</span>
            <button className="font-semibold text-text hover:text-accent" onClick={() => select(r.objectId)}>{nameOf(inv, r.objectId)}</button>
            {r.qualifier && <span className="text-text-2">({r.qualifier})</span>}
            <span className="ml-auto flex items-center gap-1.5">
              <VBadge v={r.verification} />
              <EngineTag engine={r.provenance.engine} assisted={Boolean(r.provenance.assistedBy)} />
            </span>
          </div>
          <div className="mt-1 text-[11px] text-muted">{r.hypothesis ? "Hypothesis from your request — not evidence." : `${r.independentSources} independent source(s) · ${r.evidence.length} evidence passage(s)`}</div>
          {r.evidence.slice(0, 3).map((ev, i) => {
            const p = psg.get(ev.passageId);
            const s = src.get(ev.sourceId);
            return (
              <blockquote key={i} className="mt-1 border-l-2 border-line-2 pl-2 text-[11.5px] text-text-2">
                “{p?.text}” {s && <Ext href={s.url} className="text-[10.5px]">{s.domain}</Ext>}
              </blockquote>
            );
          })}
          {r.contradictions.map((c, i) => (
            <div key={i} className="mt-1 text-alert">⚠ {c}</div>
          ))}
          {!r.hypothesis && (
            <div className="mt-1.5 flex gap-3">
              <button className="mono text-[10px] uppercase tracking-[0.12em] text-ok hover:underline" onClick={() => decide("relationship", r.id, r.userDecision === "confirmed" ? null : "confirmed")}>{r.userDecision === "confirmed" ? "confirmed ✓" : "confirm"}</button>
              <button className="mono text-[10px] uppercase tracking-[0.12em] text-alert hover:underline" onClick={() => decide("relationship", r.id, r.userDecision === "rejected" ? null : "rejected")}>{r.userDecision === "rejected" ? "rejected ✕" : "reject"}</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- D
function Evidence({ inv }: { inv: Investigation }) {
  const [filter, setFilter] = useState<"all" | "read" | "other">("all");
  const sources = inv.sources.filter((s) => filter === "all" || (filter === "read" ? s.fetch.status === "read" : s.fetch.status !== "read"));
  const groupSize = (g: string) => inv.sources.filter((s) => s.copyGroup === g).length;
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {(["all", "read", "other"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn("mono rounded-[3px] border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]", filter === f ? "border-accent/60 text-accent" : "border-line-2 text-muted")}>
            {f === "all" ? "All" : f === "read" ? "Opened" : "Not opened / inaccessible"}
          </button>
        ))}
      </div>
      <ul className="space-y-2" data-testid="nexus-evidence">
        {sources.map((s) => {
          const claims = inv.claims.filter((c) => c.sourceId === s.id && c.predicate !== "mentions");
          const passages = inv.passages.filter((p) => p.sourceId === s.id);
          return (
            <li key={s.id} className="rounded-[4px] border border-line bg-bg-2/40 p-2.5 text-[11.5px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={s.fetch.status === "read" ? "ok" : s.fetch.status === "not_opened" ? "muted" : "warn"}>{s.fetch.status.replace(/_/g, " ")}</Badge>
                <Badge tone={s.sourceType === "official_site" ? "accent" : "dark"}>{s.sourceType.replace(/_/g, " ")}</Badge>
                {groupSize(s.copyGroup) > 1 && <Badge tone="violet" title="Same or near-identical text published on several sites — counted as one independent source">copy group ×{groupSize(s.copyGroup)}</Badge>}
                {s.synthetic && <Badge tone="warn">synthetic</Badge>}
                <span className="ml-auto flex gap-1">{Array.from(new Set(s.discoveredBy.map((d) => d.engine))).map((e) => <EngineTag key={e} engine={e} />)}</span>
              </div>
              <div className="mt-1 font-medium text-text">{s.title || s.domain}</div>
              <Ext href={s.url} className="text-[11px]" />
              {s.fetch.status !== "read" && <div className="mt-0.5 text-[11px] text-muted">{s.fetch.reason}</div>}
              {s.publishedAt && <div className="mono text-[10px] text-muted">published {s.publishedAt.slice(0, 10)}</div>}
              {claims.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {claims.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-1.5">
                      <span className="text-text-2">{nameOf(inv, c.subjectId)} · {PRED_LABEL[c.predicate]} · {c.object}</span>
                      <VBadge v={c.verification} />
                      {c.assistedBy && <span className="mono text-[9.5px] text-violet">AI-assisted</span>}
                    </li>
                  ))}
                </ul>
              )}
              {passages.length > 0 && (
                <details className="mt-1">
                  <summary className="mono cursor-pointer text-[10px] uppercase tracking-[0.12em] text-muted">{passages.length} evidence passage(s)</summary>
                  {passages.map((p) => (
                    <blockquote key={p.id} className="mt-1 border-l-2 border-line-2 pl-2 text-text-2">“{p.text}”</blockquote>
                  ))}
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- E
function Trail({ inv }: { inv: Investigation }) {
  return (
    <ol className="space-y-1" data-testid="nexus-trail">
      {[...inv.trail].reverse().map((t) => (
        <li key={t.id} className="grid grid-cols-[60px_36px_120px_1fr] gap-2 text-[11.5px]">
          <span className="mono text-[10px] text-muted">{new Date(t.at).toLocaleTimeString("en-GB", { hour12: false })}</span>
          <span className="mono text-[10px] text-muted">R{t.round}</span>
          <EngineTag engine={t.engine} />
          <span className={cn("break-words", t.kind === "error" ? "text-warn" : t.kind === "quota" ? "text-warn" : t.kind === "user" ? "text-violet" : t.kind === "followup" ? "text-accent" : "text-text-2")}>{t.text}</span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- F
function Leads({ inv, follow, running }: { inv: Investigation; follow: (id: string) => void; running: boolean }) {
  const leads = inv.leads.filter((l) => l.status !== "queued" && l.status !== "investigated").sort((a, b) => b.score - a.score);
  if (!leads.length) return <Empty>No unresolved leads.</Empty>;
  return (
    <div className="space-y-2">
      <p className="text-[11.5px] text-text-2">Leads that were not followed — below the relevance threshold ({inv.settings.leadThreshold}), beyond the round or per-domain limits, or not routed. You can follow any of them manually.</p>
      <ul className="space-y-1.5" data-testid="nexus-leads">
        {leads.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-[4px] border border-line bg-bg-2/40 px-2.5 py-1.5 text-[11.5px]">
            <Badge tone="dark">{l.kind}</Badge>
            <span className="break-all text-text">{l.value}</span>
            <span className="text-muted">— {l.reason}</span>
            <span className="mono text-[10px] text-muted">{l.status.replace(/_/g, " ")} · priority {l.score}</span>
            <Button size="sm" className="ml-auto" disabled={running} onClick={() => follow(l.id)}>
              Investigate
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- contacts
function Contacts({ inv }: { inv: Investigation }) {
  const byOrg = new Map<string, Investigation["contacts"]>();
  for (const c of inv.contacts) byOrg.set(c.entityId, [...(byOrg.get(c.entityId) ?? []), c]);
  const src = new Map(inv.sources.map((s) => [s.id, s]));
  if (!byOrg.size) return <Empty>Only public business and institutional contact points published by an organisation are collected. Private personal contact details are never harvested.</Empty>;
  return (
    <div className="space-y-3" data-testid="nexus-contacts">
      <p className="text-[11.5px] text-text-2">Public contact points of organisations, each with the page that published it.</p>
      {Array.from(byOrg.entries()).map(([org, cs]) => {
        const grouped = new Map<string, typeof cs>();
        for (const c of cs) grouped.set(`${c.kind}|${c.normalized}`, [...(grouped.get(`${c.kind}|${c.normalized}`) ?? []), c]);
        return (
          <div key={org}>
            <div className="text-[12.5px] font-semibold text-text">{nameOf(inv, org)}</div>
            <ul className="mt-1 space-y-1">
              {Array.from(grouped.values()).map((g) => (
                <li key={g[0].id} className="flex flex-wrap items-center gap-2 text-[11.5px]">
                  <Badge tone="dark">{g[0].kind}</Badge>
                  <span className="text-text">{g[0].value}</span>
                  {g.some((c) => c.official) ? <Badge tone="ok">official site</Badge> : <Badge tone="accent">third-party</Badge>}
                  <span className="text-muted">
                    {g.map((c) => src.get(c.sourceId)?.domain).filter((d, i, a) => d && a.indexOf(d) === i).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- coverage
function CoverageView({ inv, cov }: { inv: Investigation; cov: ReturnType<typeof reconcile> }) {
  return (
    <div className="space-y-4 text-[11.5px]" data-testid="nexus-coverage">
      <p className="text-text-2">What was and was not searched. NEXUS cannot see everything on the internet; this shows the boundaries of this investigation.</p>
      <table className="w-full text-left">
        <thead className="label !text-[9.5px]">
          <tr>
            <th className="py-1">Engine</th>
            <th>Tasks</th>
            <th>Done</th>
            <th>Failed / blocked</th>
            <th>URLs surfaced</th>
            <th>Pages read</th>
          </tr>
        </thead>
        <tbody className="mono text-[11px]">
          {ENGINE_IDS.map((e) => (
            <tr key={e} className="border-t border-line">
              <td className="py-1 font-sans text-text">{ENGINE_LABEL[e]}</td>
              <td>{cov.byEngine[e].tasks}</td>
              <td>{cov.byEngine[e].done}</td>
              <td>{cov.byEngine[e].failed}</td>
              <td>{cov.byEngine[e].urls}</td>
              <td>{cov.byEngine[e].pagesRead}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <CovList title="Found by more than one engine" items={cov.severalEngines.map((x) => `${x.url} — ${x.engines.map((e) => ENGINE_LABEL[e]).join(", ")}`)} />
      <CovList title="Found by only one engine" items={cov.onlyOneEngine.map((x) => `${x.url} — ${ENGINE_LABEL[x.engine]}`)} />
      <CovList title="Reached only by following links" items={cov.viaLinks} />
      <CovList title="Inaccessible (robots.txt, sign-in walls, errors — not bypassed)" items={cov.inaccessible.map((x) => `${x.url} — ${x.reason}`)} tone="warn" />
      <CovList title="Discovered but not opened" items={cov.unexplored} />
      <CovList title="Engines not run in this investigation" items={ENGINE_IDS.filter((e) => !inv.tasks.some((t) => t.engine === e)).map((e) => `${ENGINE_LABEL[e]} — ${inv.settings.engines[e] ? "unavailable in this mode or no lead routed to it" : "switched off"}`)} tone="warn" />
      <CovList title="Free quota events" items={cov.quota.map((q) => `${q.provider}: ${q.message}`)} tone="warn" />
    </div>
  );
}

function CovList({ title, items, tone }: { title: string; items: string[]; tone?: "warn" }) {
  return (
    <div>
      <div className={cn("label !text-[9.5px]", tone === "warn" && "!text-warn")}>
        {title} ({items.length})
      </div>
      {items.length > 0 && (
        <ul className="mt-1 space-y-0.5 break-all text-text-2">
          {items.slice(0, 60).map((x, i) => (
            <li key={i}>· {x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
