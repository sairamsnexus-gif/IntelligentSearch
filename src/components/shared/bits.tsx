"use client";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, safeHref } from "@/lib/utils";

const PLATFORM_GLYPH: Record<string, [string, string]> = {
  linkedin: ["in", "#4aa3ff"],
  instagram: ["IG", "#ff7ab6"],
  facebook: ["FB", "#6f9bff"],
  x: ["X", "#e6edf0"],
  youtube: ["YT", "#ff5a5a"],
  github: ["GH", "#c9d1d9"],
  reddit: ["RD", "#ff8a4c"],
  news: ["NW", "#f5b83d"],
  medium: ["MD", "#c9d1d9"],
  web: ["WW", "#2ee6d6"],
  other_social: ["@", "#9d8cff"],
};

export function PlatformGlyph({ platform, className }: { platform?: string | null; className?: string }) {
  const [txt, color] = PLATFORM_GLYPH[platform ?? "web"] ?? PLATFORM_GLYPH.web;
  return (
    <span className={cn("mono inline-flex h-5 min-w-5 items-center justify-center rounded-[3px] border px-1 text-[9px] font-semibold", className)} style={{ color, borderColor: `${color}55`, background: `${color}14` }}>
      {txt}
    </span>
  );
}

/** Opens the original source. Demo URLs render the fictional snapshot locally instead of linking out. */
export function SourceLink({ url, isDemo, children, className }: { url: string; isDemo?: boolean; children?: React.ReactNode; className?: string }) {
  const href = safeHref(url);
  if (!href) return <span className={className}>{children ?? url}</span>;
  if (isDemo)
    return (
      <Link href={`/demo-source?url=${encodeURIComponent(href)}`} target="_blank" className={cn("inline-flex items-center gap-1 text-accent hover:underline", className)}>
        {children ?? "Open source"} <ExternalLink className="size-3" />
      </Link>
    );
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" className={cn("inline-flex items-center gap-1 text-accent hover:underline", className)}>
      {children ?? "Open source"} <ExternalLink className="size-3" />
    </a>
  );
}

export function StateBadge({ state }: { state: string }) {
  const map: Record<string, ["ok" | "accent" | "warn" | "muted" | "violet", string]> = {
    confirmed: ["ok", "✓ confirmed"],
    user_supplied: ["accent", "user supplied"],
    system_discovered: ["violet", "discovered"],
    unverified: ["warn", "? unverified"],
  };
  const [tone, label] = map[state] ?? ["muted", state];
  return <Badge tone={tone}>{label}</Badge>;
}

export function ChangeBadge({ status }: { status: string }) {
  const map: Record<string, ["alert" | "warn" | "ok" | "dark", string]> = {
    NEW: ["alert", "● NEW"],
    CHANGED: ["warn", "● CHANGED"],
    EXISTING: ["ok", "● EXISTING"],
    NO_LONGER_AVAILABLE: ["dark", "● NO LONGER AVAILABLE"],
  };
  const [tone, label] = map[status] ?? ["dark", status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function DemoBadge() {
  return <Badge tone="warn">DEMO DATA</Badge>;
}

export function Initials({ name, size = 40 }: { name: string; size?: number }) {
  const init = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <div className="mono relative flex shrink-0 items-center justify-center rounded-[4px] border border-accent/40 bg-accent/5 text-accent" style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {init}
      <span className="absolute -right-px -top-px h-1.5 w-1.5 border-r border-t border-accent" />
      <span className="absolute -bottom-px -left-px h-1.5 w-1.5 border-b border-l border-accent" />
    </div>
  );
}
