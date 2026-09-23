"use client";
import { useState } from "react";
import { AlertTriangle, Check, CircleHelp, FileSearch, Link2, Lock, UserCheck, X } from "lucide-react";
import { Panel, Empty } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Initials, PlatformGlyph, SourceLink, DemoBadge } from "@/components/shared/bits";
import { useApi } from "@/lib/hooks";
import { apiFetch, cn, fmtDate, safeHref } from "@/lib/utils";
import type { AttributeMatch, CandidateProfile, ResolutionSummary } from "@/lib/core/types";
import type { EvidenceDocView, SessionView } from "@/lib/view-types";

function StatusIcon({ s }: { s: AttributeMatch["status"] }) {
  if (s === "match") return <Check className="size-3.5 text-ok" />;
  if (s === "conflict") return <X className="size-3.5 text-alert" />;
  return <CircleHelp className="size-3.5 text-muted" />;
}

export function CandidateCard({ c, rank, focused, isDemo, onFocus, onEvidence, onSelect, disabled }: { c: CandidateProfile; rank: number; focused: boolean; isDemo: boolean; onFocus: () => void; onEvidence: () => void; onSelect: () => void; disabled: boolean }) {
  const a = c.attributes;
  const pct = c.match.total ? c.match.matched / c.match.total : 0;
  const tone = c.match.conflicts > 0 ? "text-warn" : pct === 1 ? "text-ok" : "text-accent";
  const img = !isDemo ? safeHref(c.imageUrl) : null;
  return (
    <article
      onMouseEnter={onFocus}
      onFocus={onFocus}
      tabIndex={0}
      data-testid="candidate-card"
      data-candidate={c.clusterKey}
      className={cn("panel flex flex-col gap-2.5 p-3 transition-colors", focused ? "border-accent/60 bg-panel-3/70" : "hover:border-line-2")}
    >
      <div className="flex items-start gap-2.5">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-[4px] border border-line object-cover" />
        ) : (
          <Initials name={c.displayName} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="mono text-[10px] text-muted">#{rank}</span>
            <h3 className="truncate text-[14px] font-semibold text-text">{c.displayName}</h3>
          </div>
          <div className="truncate text-[12px] text-text-2">{[a.city?.[0]?.value, a.country?.[0]?.value].filter(Boolean).join(", ") || "Location unknown"}</div>
          <div className="truncate text-[12px] text-text-2">
            {a.organization?.[0]?.value ?? "—"} {a.designation?.[0] ? `· ${a.designation[0].value}` : ""}
          </div>
        </div>
        <div className="text-right">
          <div className="label !text-[9px]">matches</div>
          <div className={cn("mono text-[20px] font-semibold leading-none", tone)} data-testid="match-score">
            {c.match.matched}/{c.match.total}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {c.match.strongIdentifierMatch && <Badge tone="ok"><Link2 className="size-3" /> exact identifier</Badge>}
        {c.match.corroborated && <Badge tone="ok">corroborated · {c.match.independentSources} sources</Badge>}
        {c.match.conflicts > 0 && <Badge tone="warn"><AlertTriangle className="size-3" /> {c.match.conflicts} conflict{c.match.conflicts > 1 ? "s" : ""}</Badge>}
        {c.weak && <Badge tone="dark">single unlinked source</Badge>}
      </div>

      <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {c.match.breakdown.map((b) => (
          <li key={`${b.key}-${b.expected}`} className="flex min-w-0 items-center gap-1.5 text-[11.5px]" title={b.found.length ? `Found: ${b.found.join(", ")}` : "No evidence either way"}>
            <StatusIcon s={b.status} />
            <span className={cn("truncate", b.status === "conflict" ? "text-alert/90" : b.status === "match" ? "text-text" : "text-muted")}>
              {b.key === "name" ? "Name" : b.expected}
              {b.status === "conflict" && b.found[0] ? <span className="text-muted"> ≠ {b.found[0]}</span> : null}
            </span>
          </li>
        ))}
      </ul>

      {c.profiles.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {c.profiles.slice(0, 6).map((p) => (
            <span key={`${p.platform}${p.handle}`} className="flex items-center gap-1 rounded-[3px] border border-line bg-bg-2/70 px-1 py-0.5 text-[10.5px] text-text-2">
              <PlatformGlyph platform={p.platform} className="h-4 min-w-4 text-[8px]" />
              <span className="mono max-w-[120px] truncate">{p.handle}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mono grid grid-cols-2 gap-x-3 text-[10px] text-muted">
        <span>{c.evidenceCount} evidence · {c.sourceCount} sources</span>
        <span className="text-right">first seen {fmtDate(c.firstDiscoveredAt)}</span>
        <span>key {c.clusterKey}</span>
        <span className="text-right">checked {fmtDate(c.lastCheckedAt, true)}</span>
      </div>

      <div className="mt-auto flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" onClick={onEvidence} data-testid="view-evidence">
          <FileSearch /> View evidence
        </Button>
        <Button size="sm" variant="primary" className="flex-1" onClick={onSelect} disabled={disabled} data-testid="select-person">
          <UserCheck /> Select person
        </Button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------

const REFINE_KINDS: { kind: string; label: string; placeholder: string }[] = [
  { kind: "age", label: "Approximate age", placeholder: "40" },
  { kind: "previous_organization", label: "Previous company", placeholder: "Infosys" },
  { kind: "designation", label: "Job title", placeholder: "Project Manager" },
  { kind: "school", label: "College / school", placeholder: "Anna University" },
  { kind: "organization", label: "Current company", placeholder: "TCS" },
  { kind: "city", label: "Location (city)", placeholder: "Chennai" },
  { kind: "platform:linkedin", label: "LinkedIn URL", placeholder: "linkedin.com/in/…" },
  { kind: "platform:instagram", label: "Instagram username", placeholder: "@username" },
  { kind: "platform:github", label: "GitHub username", placeholder: "username" },
  { kind: "platform:youtube", label: "YouTube channel", placeholder: "@channel" },
  { kind: "other", label: "Other", placeholder: "Any other detail" },
];

export function RefineBox({ session, resolution, onRefined }: { session: SessionView; resolution: ResolutionSummary; onRefined: () => void }) {
  const [kind, setKind] = useState<string>(resolution.suggestions[0]?.kind ?? "age");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const body = kind.startsWith("platform:") ? { identifiers: [{ platform: kind.slice(9), value }] } : { attributes: [{ kind, value }] };
      await apiFetch(`/api/searches/${session.id}/refine`, { method: "POST", body: JSON.stringify(body) });
      setValue("");
      onRefined();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };
  const ambiguous = resolution.state !== "leading";
  return (
    <form onSubmit={submit} className={cn("rounded-[4px] border p-3", ambiguous ? "border-warn/40 bg-warn/[0.06]" : "border-line bg-bg-2/50")} data-testid="refine-box">
      <div className="flex flex-wrap items-center gap-2">
        {ambiguous ? <AlertTriangle className="size-4 text-warn" /> : <Check className="size-4 text-ok" />}
        <p className={cn("text-[13px]", ambiguous ? "text-warn" : "text-text-2")}>{ambiguous ? resolution.message : "Add another attribute to narrow further, or review the evidence and select the person."}</p>
      </div>
      {resolution.suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {resolution.suggestions.map((s) => (
            <button type="button" key={s.kind} onClick={() => setKind(s.kind)} title={s.why} className={cn("mono rounded-[3px] border px-2 py-1 text-[10.5px] uppercase tracking-[0.1em]", kind === s.kind ? "border-accent bg-accent/15 text-accent" : "border-line-2 text-text-2 hover:border-accent/50")}>
              {s.label}
              {s.why.startsWith("Candidates differ") && <span className="ml-1 text-warn">●</span>}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-48" aria-label="Detail type">
          {REFINE_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </Select>
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={REFINE_KINDS.find((k) => k.kind === kind)?.placeholder} className="min-w-40 flex-1" aria-label="Detail value" data-testid="refine-value" />
        <Button type="submit" variant={ambiguous ? "primary" : "outline"} disabled={busy || !value.trim()} data-testid="refine-submit">
          {busy ? "Searching…" : "Search again"}
        </Button>
      </div>
      {resolution.suggestions.find((s) => s.kind === kind)?.why && <p className="mt-1.5 text-[11px] text-muted">Why: {resolution.suggestions.find((s) => s.kind === kind)?.why}</p>}
      {error && <p className="mt-1 text-[12px] text-alert">{error}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------

export function EvidenceDialog({ sessionId, candidateKey, onClose, isDemo }: { sessionId: string; candidateKey: string | null; onClose: () => void; isDemo: boolean }) {
  const { data, loading } = useApi<{ candidate: CandidateProfile; documents: EvidenceDocView[] }>(candidateKey ? `/api/searches/${sessionId}/candidates/${candidateKey}` : null);
  const c = data?.candidate;
  return (
    <Dialog open={Boolean(candidateKey)} onClose={onClose} title={`Evidence · candidate ${candidateKey ?? ""}`} wide>
      {loading || !c ? (
        <p className="text-[12px] text-muted">Loading evidence…</p>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Initials name={c.displayName} size={44} />
            <div>
              <div className="text-[16px] font-semibold">{c.displayName}</div>
              <div className="mono text-[11px] text-muted">
                MATCHES {c.match.matched}/{c.match.total} · {c.evidenceCount} documents · {c.sourceCount} domains · bound by {c.strongKeys.length ? c.strongKeys.join(", ") : "attribute agreement only"}
              </div>
            </div>
            {isDemo && <DemoBadge />}
          </div>
          <table className="w-full text-left text-[12px]" data-testid="evidence-table">
            <thead className="label !text-[9px]">
              <tr className="border-b border-line">
                <th className="py-1.5">Attribute</th>
                <th>You supplied</th>
                <th>Status</th>
                <th>Found in sources</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {c.match.breakdown.map((b) => (
                <tr key={`${b.key}-${b.expected}`} className="border-b border-line/60 align-top">
                  <td className="py-1.5 text-text-2">{b.label}</td>
                  <td className="mono">{b.expected}</td>
                  <td>
                    <span className="flex items-center gap-1">
                      <StatusIcon s={b.status} /> {b.status}
                      {b.strong && <Badge tone="ok">strong</Badge>}
                    </span>
                  </td>
                  <td className="text-text-2">{b.found.join(", ") || "—"}</td>
                  <td>
                    <div className="flex flex-col gap-0.5">
                      {b.evidence.slice(0, 3).map((e) => (
                        <SourceLink key={e.resultId} url={e.url} isDemo={isDemo} className="text-[11px]">
                          {e.domain}
                        </SourceLink>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {Object.entries(c.attributes).some(([k]) => !c.match.breakdown.some((b) => b.key === k) && k !== "name") && (
            <div>
              <div className="label mb-1">Also found (not supplied by you — unverified)</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(c.attributes)
                  .filter(([k]) => !c.match.breakdown.some((b) => b.key === k) && k !== "name")
                  .flatMap(([k, vs]) => (vs ?? []).slice(0, 2).map((v) => <Badge key={`${k}${v.value}`} tone="violet">{k.replace("_", " ")}: {v.value} ({v.evidence.length})</Badge>))}
              </div>
            </div>
          )}
          <div>
            <div className="label mb-2">Source documents ({data!.documents.length})</div>
            <div className="space-y-2">
              {data!.documents.map((d) => (
                <div key={d.resultId} className="rounded-[4px] border border-line bg-bg-2/60 p-2.5" data-testid="evidence-doc">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <PlatformGlyph platform={d.sourcePlatform} />
                      <span className="truncate text-[13px] text-text">{d.title}</span>
                    </div>
                    <SourceLink url={d.url} isDemo={d.isDemo} className="text-[11px]" />
                  </div>
                  <div className="mono mt-1 truncate text-[10.5px] text-muted">{d.url}</div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-text-2">{d.contentText.slice(0, 400)}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {d.signals.map((s) => (
                      <Badge key={s.label} tone="dark">
                        {s.label}: {s.values.slice(0, 3).join(", ")}
                      </Badge>
                    ))}
                  </div>
                  <div className="mono mt-1.5 text-[10px] text-muted">
                    via {d.sourceEngine} · query {d.query} · first seen {fmtDate(d.discoveredAt, true)}
                    {d.publishedAt ? ` · published ${fmtDate(d.publishedAt)}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export function ConfirmLockDialog({ session, candidate, onClose, onLocked }: { session: SessionView; candidate: CandidateProfile | null; onClose: () => void; onLocked: (personId: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!candidate) return null;
  const others = session.candidates.filter((c) => c.clusterKey !== candidate.clusterKey && c.match.conflicts === 0 && c.match.matched >= candidate.match.matched);
  const lock = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ personId: string }>("/api/persons", { method: "POST", body: JSON.stringify({ sessionId: session.id, candidateKey: candidate.clusterKey, confirm: true }) });
      onLocked(r.personId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lock failed");
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title="Person confirmed?">
      <div className="space-y-3" data-testid="confirm-dialog">
        <div className="flex items-center gap-3">
          <Initials name={candidate.displayName} size={48} />
          <div>
            <div className="text-[18px] font-semibold">{candidate.displayName}</div>
            <div className="text-[12px] text-text-2">
              {[candidate.attributes.city?.[0]?.value, candidate.attributes.organization?.[0]?.value, candidate.attributes.designation?.[0]?.value].filter(Boolean).join(" · ")}
            </div>
            <div className="mono text-[11px] text-accent">
              MATCHES {candidate.match.matched}/{candidate.match.total} · {candidate.evidenceCount} evidence · {candidate.profiles.length} identifiers
            </div>
          </div>
        </div>
        {candidate.match.conflicts > 0 && (
          <p className="rounded-[3px] border border-warn/40 bg-warn/10 px-2 py-1.5 text-[12px] text-warn">
            {candidate.match.conflicts} of your attributes conflict with this candidate&apos;s evidence. They will be stored as <b>unverified</b>.
          </p>
        )}
        {others.length > 0 && (
          <p className="rounded-[3px] border border-warn/40 bg-warn/10 px-2 py-1.5 text-[12px] text-warn">
            {others.length} other candidate(s) match equally well. Consider adding another detail before locking.
          </p>
        )}
        <p className="text-[12px] leading-relaxed text-text-2">Locking creates a permanent identity record. Matched attributes become <b>confirmed</b>, the candidate&apos;s linked profiles become known identifiers, and a baseline snapshot of every source is taken for monitoring.</p>
        <label className="flex cursor-pointer items-start gap-2 text-[12px] text-text">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" data-testid="confirm-checkbox" />
          I have reviewed the evidence and confirm this is the person I am looking for.
        </label>
        {error && <p className="text-[12px] text-alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={lock} disabled={!confirm || busy} data-testid="lock-person">
            <Lock /> {busy ? "Locking…" : "Lock person & start monitoring"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function CandidatesPanel({
  session,
  focusedKey,
  setFocused,
  onRefined,
  onLocked,
}: {
  session: SessionView | null;
  focusedKey: string | null;
  setFocused: (k: string) => void;
  onRefined: () => void;
  onLocked: (id: string) => void;
}) {
  const [evidenceKey, setEvidenceKey] = useState<string | null>(null);
  const [selectKey, setSelectKey] = useState<string | null>(null);
  const [showUnattributed, setShowUnattributed] = useState(false);
  const running = session?.status === "running" || session?.status === "queued";
  const cands = session?.candidates ?? [];
  return (
    <Panel
      title={<>Potential matches {session && <span className="mono text-accent">({cands.length})</span>}</>}
      right={session?.isDemo ? <DemoBadge /> : null}
      className="min-h-[260px]"
    >
      {!session ? (
        <Empty>Candidates appear here, each with the attributes that match, the ones that conflict, and the evidence behind them.</Empty>
      ) : (
        <div className="space-y-3">
          {session.personId && (
            <p className="rounded-[3px] border border-ok/40 bg-ok/10 px-3 py-2 text-[12.5px] text-ok">
              Person locked from this search. <a className="underline" href={`/persons/${session.personId}`}>Open monitoring profile →</a>
            </p>
          )}
          {!running && session.resolution && !session.personId && <RefineBox session={session} resolution={session.resolution} onRefined={onRefined} />}
          {running && cands.length === 0 && <Empty>Resolving identities from search results…</Empty>}
          {!running && cands.length === 0 && <Empty>No candidate persons yet. Add another detail above.</Empty>}
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
            {cands.map((c, i) => (
              <CandidateCard key={c.clusterKey} c={c} rank={i + 1} focused={focusedKey === c.clusterKey} isDemo={session.isDemo} onFocus={() => setFocused(c.clusterKey)} onEvidence={() => setEvidenceKey(c.clusterKey)} onSelect={() => setSelectKey(c.clusterKey)} disabled={running || Boolean(session.personId)} />
            ))}
          </div>
          {session.unattributed.length > 0 && (
            <div>
              <button className="label hover:text-accent" onClick={() => setShowUnattributed((x) => !x)}>
                {showUnattributed ? "▾" : "▸"} Unattributed mentions ({session.unattributed.length}) — not merged into any candidate
              </button>
              {showUnattributed && (
                <ul className="mt-1.5 space-y-1">
                  {session.unattributed.map((u) => (
                    <li key={u.resultId} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                      <span className="truncate text-text-2">{u.title}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-[11px] text-muted">{u.reason}</span>
                        <SourceLink url={u.url} isDemo={session.isDemo} className="text-[11px]" />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      {session && <EvidenceDialog sessionId={session.id} candidateKey={evidenceKey} onClose={() => setEvidenceKey(null)} isDemo={session.isDemo} />}
      {session && selectKey && <ConfirmLockDialog session={session} candidate={cands.find((c) => c.clusterKey === selectKey) ?? null} onClose={() => setSelectKey(null)} onLocked={onLocked} />}
    </Panel>
  );
}
