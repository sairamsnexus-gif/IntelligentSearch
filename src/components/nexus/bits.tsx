"use client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ENGINE_LABEL, VERIFICATION_LABEL, type EngineId, type Investigation, type Verification } from "@/lib/nexus/schema";

export const V_TONE: Record<Verification, "ok" | "accent" | "warn" | "violet" | "alert" | "dark" | "muted"> = {
  primary_source: "ok",
  independently_corroborated: "ok",
  single_source: "accent",
  weak_indication: "warn",
  unverified_hypothesis: "violet",
  contradicted: "alert",
  inaccessible: "dark",
  not_searched: "muted",
};

export const V_COLOR: Record<Verification, string> = {
  primary_source: "#3ddc84",
  independently_corroborated: "#3ddc84",
  single_source: "#2ee6d6",
  weak_indication: "#f5b83d",
  unverified_hypothesis: "#9d8cff",
  contradicted: "#ff4d5e",
  inaccessible: "#62808b",
  not_searched: "#62808b",
};

export function VBadge({ v, className }: { v: Verification; className?: string }) {
  return (
    <Badge tone={V_TONE[v]} className={className} title={VERIFICATION_LABEL[v]}>
      {VERIFICATION_LABEL[v]}
    </Badge>
  );
}

export function EngineTag({ engine, assisted }: { engine: EngineId | "user" | "nexus" | "freellmapi"; assisted?: boolean }) {
  const label = engine === "user" ? "You" : engine === "nexus" ? "NEXUS" : engine === "freellmapi" ? "FreeLLMAPI" : ENGINE_LABEL[engine];
  return (
    <span className={cn("mono inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em]", engine === "user" ? "text-violet" : "text-accent-2")}>
      {label}
      {assisted && <span className="rounded-[2px] border border-violet/40 px-1 text-[9px] text-violet">AI-assisted</span>}
    </span>
  );
}

export function Ext({ href, children, className }: { href: string; children?: React.ReactNode; className?: string }) {
  let safe = "#";
  try {
    const u = new URL(href);
    if (u.protocol === "http:" || u.protocol === "https:") safe = u.toString();
  } catch {
    /* not a URL */
  }
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className={cn("break-all text-accent hover:underline", className)}>
      {children ?? href}
    </a>
  );
}

export function SyntheticFlag({ inv }: { inv: Investigation }) {
  if (!inv.synthetic) return null;
  return <Badge tone="warn">synthetic data</Badge>;
}

export const nameOf = (inv: Investigation, id: string) => inv.entities.find((e) => e.id === id)?.name ?? "?";
export const PRED_LABEL: Record<string, string> = {
  owns: "owns",
  founded: "founded",
  works_at: "works at",
  holds_position: "holds position at",
  associated_with: "associated with",
  represents: "represents",
  operates_at: "operates at",
  operates: "operates",
  has_contact: "has contact",
  has_official_website: "official website",
  established_in_year: "established in",
  mentions: "mentioned on",
  username_found_on: "username found on",
  documented_relationship: "documented relationship",
};
