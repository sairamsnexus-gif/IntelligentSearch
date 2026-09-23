"use client";
import { useState } from "react";
import { CheckCircle2, CircleHelp, ShieldQuestion, XCircle } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SourceLink } from "@/components/shared/bits";
import { apiFetch } from "@/lib/utils";
import type { VerificationReport } from "@/lib/view-types";

const OPTIONS: { value: string; label: string; placeholder: string }[] = [
  { value: "platform:instagram", label: "Instagram username", placeholder: "rajeshkumar78" },
  { value: "platform:linkedin", label: "LinkedIn profile URL", placeholder: "linkedin.com/in/…" },
  { value: "platform:github", label: "GitHub username", placeholder: "username" },
  { value: "platform:youtube", label: "YouTube channel", placeholder: "@channel" },
  { value: "platform:x", label: "X / Twitter username", placeholder: "@handle" },
  { value: "platform:facebook", label: "Facebook profile", placeholder: "facebook.com/…" },
  { value: "platform:reddit", label: "Reddit username", placeholder: "u/…" },
  { value: "organization", label: "Current company", placeholder: "TCS" },
  { value: "designation", label: "Designation", placeholder: "Senior Project Manager" },
  { value: "previous_organization", label: "Previous company", placeholder: "Infosys" },
  { value: "city", label: "City", placeholder: "Chennai" },
  { value: "school", label: "School / College", placeholder: "Anna University" },
  { value: "age", label: "Approximate age", placeholder: "40" },
  { value: "website", label: "Website", placeholder: "example.com" },
  { value: "email", label: "Email", placeholder: "name@example.com" },
  { value: "phone", label: "Phone", placeholder: "+91 …" },
];

const VERDICT: Record<VerificationReport["verdict"], { tone: "ok" | "warn" | "muted"; label: string; icon: React.ReactNode }> = {
  corroborated: { tone: "ok", label: "Corroborated", icon: <CheckCircle2 className="size-4 text-ok" /> },
  exists_unlinked: { tone: "warn", label: "Exists — not linked", icon: <ShieldQuestion className="size-4 text-warn" /> },
  not_found: { tone: "muted", label: "Not found", icon: <XCircle className="size-4 text-muted" /> },
  not_checked: { tone: "muted", label: "Not checked", icon: <CircleHelp className="size-4 text-muted" /> },
};

export function AddInformationDialog({ open, onClose, personId, publicId, onAdded }: { open: boolean; onClose: () => void; personId: string; publicId: string; onAdded: () => void }) {
  const [type, setType] = useState(OPTIONS[0].value);
  const [value, setValue] = useState("");
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isId = type.startsWith("platform:");

  const reset = () => {
    setValue("");
    setReport(null);
    setConfirm(false);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await apiFetch<VerificationReport>(`/api/persons/${personId}/identifiers/verify`, { method: "POST", body: JSON.stringify({ platform: type.slice(9), value }) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      if (isId) await apiFetch(`/api/persons/${personId}/identifiers`, { method: "POST", body: JSON.stringify({ platform: type.slice(9), value, confirm: true, report }) });
      else await apiFetch(`/api/persons/${personId}/attributes`, { method: "POST", body: JSON.stringify({ kind: type, value, confirm: true }) });
      onAdded();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} title={`Add information to ${publicId}`}>
      <div className="space-y-3" data-testid="add-info-dialog">
        <p className="text-[12px] text-text-2">New details are added to this <b>same</b> person — never a new record — and confirmed identifiers are used in all future searches.</p>
        <div className="grid gap-2 sm:grid-cols-[200px_1fr]">
          <div>
            <Label htmlFor="ai-type">Type</Label>
            <Select id="ai-type" value={type} onChange={(e) => { setType(e.target.value); reset(); }}>
              {OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="ai-value">Value</Label>
            <Input id="ai-value" value={value} placeholder={OPTIONS.find((o) => o.value === type)?.placeholder} onChange={(e) => { setValue(e.target.value); setReport(null); setConfirm(false); }} data-testid="add-info-value" />
          </div>
        </div>

        {isId && !report && (
          <Button variant="primary" onClick={verify} disabled={!value.trim() || busy} data-testid="verify-identifier">
            {busy ? "Verifying against public sources…" : "Verify"}
          </Button>
        )}

        {report && (
          <div className="space-y-2 rounded-[4px] border border-line bg-bg-2/60 p-3" data-testid="verification-report">
            <div className="flex items-center gap-2">
              {VERDICT[report.verdict].icon}
              <Badge tone={VERDICT[report.verdict].tone}>{VERDICT[report.verdict].label}</Badge>
              <span className="mono text-[12px] text-text">{report.platform}:{report.handle}</span>
            </div>
            <p className="text-[12px] text-text-2">{report.message}</p>
            {report.findings.map((f) => (
              <div key={f.url} className="rounded-[3px] border border-line p-2 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{f.title}</span>
                  <SourceLink url={f.url} isDemo={f.isDemo} className="text-[11px]" />
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge tone={f.nameMatch ? "ok" : "warn"}>{f.nameMatch ? "✓ name matches" : "? name not found"}</Badge>
                  {f.matched.map((m) => <Badge key={m} tone="ok">✓ {m}</Badge>)}
                  {f.conflicts.map((m) => <Badge key={m} tone="alert">✕ {m}</Badge>)}
                </div>
              </div>
            ))}
            <details className="text-[11px] text-muted">
              <summary className="cursor-pointer">Searched ({report.searched.length})</summary>
              <ul className="mono mt-1 space-y-0.5">{report.searched.map((s) => <li key={s}>{s}</li>)}</ul>
            </details>
          </div>
        )}

        {(!isId || report) && (
          <label className="flex cursor-pointer items-start gap-2 text-[12px]">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" data-testid="add-info-confirm" />
            I confirm this {isId ? "identifier" : "detail"} belongs to {publicId}.
            {isId && report?.verdict !== "corroborated" && " It will be stored as user-supplied (not corroborated)."}
          </label>
        )}
        {error && <p className="text-[12px] text-alert">{error}</p>}
        {(!isId || report) && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" onClick={add} disabled={!confirm || !value.trim() || busy} data-testid="add-info-submit">
              {isId ? "Verify & add" : "Confirm & add"}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
