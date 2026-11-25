"use client";
import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { PlatformGlyph } from "@/components/shared/bits";
import { ATTRIBUTE_LABEL, PURPOSES } from "@/lib/core/labels";
import { PLATFORM_LABEL } from "@/lib/core/profiles";
import type { SessionView } from "@/lib/view-types";
import { cn } from "@/lib/utils";

type Field = { key: string; label: string; placeholder?: string; type?: string };

const GROUPS: { title: string; fields: Field[] }[] = [
  { title: "Location", fields: [{ key: "city", label: "City", placeholder: "Chennai" }, { key: "state", label: "State", placeholder: "Tamil Nadu" }, { key: "country", label: "Country", placeholder: "India" }] },
  {
    title: "Work",
    fields: [
      { key: "organization", label: "Company / Organization", placeholder: "TCS" },
      { key: "designation", label: "Designation / Job title", placeholder: "Project Manager" },
      { key: "previousOrganization", label: "Previous company", placeholder: "Infosys" },
    ],
  },
  { title: "Background", fields: [{ key: "school", label: "School / College" }, { key: "approximateAge", label: "Approximate age", placeholder: "40" }] },
  {
    title: "Profiles & usernames",
    fields: [
      { key: "linkedin", label: "LinkedIn profile", placeholder: "linkedin.com/in/…" },
      { key: "instagram", label: "Instagram username", placeholder: "@username" },
      { key: "facebook", label: "Facebook profile" },
      { key: "x", label: "X / Twitter username" },
      { key: "youtube", label: "YouTube channel" },
      { key: "github", label: "GitHub username" },
      { key: "reddit", label: "Reddit username" },
      { key: "otherSocial", label: "Other social profile", placeholder: "URL" },
    ],
  },
  { title: "Contact", fields: [{ key: "email", label: "Email", type: "email" }, { key: "phone", label: "Mobile number", placeholder: "+91 …" }, { key: "website", label: "Website" }] },
  { title: "Other", fields: [{ key: "otherInfo", label: "Other information" }] },
];

const PURPOSE_LABEL: Record<(typeof PURPOSES)[number], string> = {
  due_diligence: "Due diligence / vendor or partner check",
  recruitment_verification: "Recruitment / background verification (with consent)",
  reconnect: "Reconnecting with a known contact",
  self_monitoring: "Monitoring my own public footprint",
  research: "Journalism / research",
  other: "Other legitimate purpose",
};

export function FindPersonPanel({ session, busy, onSearch, onReset }: { session: SessionView | null; busy: boolean; onSearch: (payload: Record<string, string>) => Promise<void>; onReset: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({ purpose: "due_diligence" });
  const [expanded, setExpanded] = useState(false);
  const [attest, setAttest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  if (session) return <TargetPanel session={session} onReset={onReset} />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!values.name?.trim()) return setError("Name is required");
    if (!attest) return setError("Confirm the responsible-use statement to continue");
    const payload = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
    try {
      await onSearch(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    }
  };

  return (
    <Panel title={<><Search className="size-3.5 text-accent" /> Find a person</>} bodyClassName="overflow-y-auto">
      <form onSubmit={submit} className="space-y-3" data-testid="find-person-form">
        <div>
          <Label htmlFor="name">Name / Full name *</Label>
          <Input id="name" name="name" autoFocus placeholder="Rajesh Kumar" value={values.name ?? ""} onChange={(e) => set("name", e.target.value)} className="h-10 text-[14px]" />
        </div>

        <button type="button" onClick={() => setExpanded((x) => !x)} className="mono flex w-full items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-accent hover:text-[#5ff0e3]" data-testid="toggle-details">
          {expanded ? <ChevronUp className="size-3.5" /> : <Plus className="size-3.5" />}
          {expanded ? "Hide details" : "Add more details"}
        </button>

        {expanded && (
          <div className="space-y-4 border-l border-line-2 pl-3">
            {GROUPS.map((g) => (
              <fieldset key={g.title} className="space-y-2">
                <legend className="label mb-1 !text-accent/80">{g.title}</legend>
                {g.fields.map((f) => (
                  <div key={f.key}>
                    <Label htmlFor={f.key}>{f.label}</Label>
                    <Input id={f.key} name={f.key} type={f.type ?? "text"} placeholder={f.placeholder} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                  </div>
                ))}
              </fieldset>
            ))}
            <div>
              <Label htmlFor="freeText">Anything else you know</Label>
              <Textarea id="freeText" name="freeText" placeholder="He worked at Infosys before TCS, probably around 40, lives in Chennai and may have a YouTube channel." value={values.freeText ?? ""} onChange={(e) => set("freeText", e.target.value)} />
              <p className="mt-1 text-[11px] text-muted">Search attributes are extracted from this note automatically (rules, plus Gemini if configured).</p>
            </div>
          </div>
        )}

        <div>
          <Label htmlFor="purpose">Purpose of search</Label>
          <Select id="purpose" value={values.purpose} onChange={(e) => set("purpose", e.target.value)}>
            {PURPOSES.map((p) => (
              <option key={p} value={p}>
                {PURPOSE_LABEL[p]}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-[11.5px] leading-snug text-text-2">
          <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" data-testid="attest" />
          I will use only publicly available information for a lawful purpose and will not use results to harass, stalk or discriminate.
        </label>
        {error && <p className="text-[12px] text-alert">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy} data-testid="search-person">
          <Search /> {busy ? "Starting…" : "Search person"}
        </Button>
      </form>
    </Panel>
  );
}

function TargetPanel({ session, onReset }: { session: SessionView; onReset: () => void }) {
  const [open, setOpen] = useState(true);
  const t = session.target;
  return (
    <Panel title={<><Search className="size-3.5 text-accent" /> Target</>} right={<Button size="sm" variant="ghost" onClick={onReset} data-testid="new-search"><RotateCcw /> New</Button>} bodyClassName="overflow-y-auto">
      <div className="mono text-[17px] font-semibold text-text glow-text">{t.name}</div>
      <div className="label mt-0.5">purpose · {session.purpose.replace(/_/g, " ")}</div>
      <button onClick={() => setOpen((x) => !x)} className="label mt-3 flex items-center gap-1 hover:text-accent">
        supplied attributes ({t.attributes.length + t.identifiers.length}) {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {t.attributes.map((a, i) => (
            <li key={`a${i}`} className="flex items-center justify-between gap-2 rounded-[3px] border border-line bg-bg-2/60 px-2 py-1 text-[12px]">
              <span className="label !text-[9.5px]">{ATTRIBUTE_LABEL[a.kind]}</span>
              <span className="truncate text-text">{a.value}</span>
            </li>
          ))}
          {t.identifiers.map((i, k) => (
            <li key={`i${k}`} className="flex items-center justify-between gap-2 rounded-[3px] border border-line bg-bg-2/60 px-2 py-1 text-[12px]">
              <span className="flex items-center gap-1.5">
                <PlatformGlyph platform={i.platform} />
                <span className="label !text-[9.5px]">{PLATFORM_LABEL[i.platform]}</span>
              </span>
              <span className="mono truncate text-text">{i.handle}</span>
            </li>
          ))}
          {!t.attributes.length && !t.identifiers.length && <li className="text-[12px] text-muted">Name only — expect many candidates.</li>}
        </ul>
      )}
      {session.extracted && (session.extracted.attributes.length > 0 || session.extracted.identifiers.length > 0 || session.extracted.platformHints.length > 0) && (
        <div className="mt-4 rounded-[4px] border border-violet/30 bg-violet/[0.06] p-2">
          <div className="label !text-violet">extracted from your note {session.extracted.usedAi ? "· freellmapi" : "· rules"}</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {session.extracted.attributes.map((a, i) => (
              <Badge key={i} tone="violet">
                {a.kind.replace("_", " ")}: {a.value}
              </Badge>
            ))}
            {session.extracted.identifiers.map((a, i) => (
              <Badge key={`x${i}`} tone="violet">
                {a.platform}: {a.handle}
              </Badge>
            ))}
            {session.extracted.platformHints.map((p) => (
              <Badge key={p} tone="dark">
                hint: {p}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {session.discovered.length > 0 && (
        <div className="mt-4">
          <div className="label">discovered during search ({session.discovered.length})</div>
          <ul className="mt-1.5 space-y-1">
            {session.discovered.slice(0, 12).map((d, i) => (
              <li key={i} className={cn("flex items-center justify-between gap-2 text-[11.5px]")}>
                <span className="label !text-[9px]">{d.kind.replace("platform:", "").replace("_", " ")}</span>
                <span className="truncate text-violet">{d.value}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10.5px] text-muted">Unverified leads used to generate follow-up searches.</p>
        </div>
      )}
    </Panel>
  );
}
