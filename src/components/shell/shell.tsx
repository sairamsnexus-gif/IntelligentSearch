"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Crosshair, LogOut, Network, Radar, ShieldCheck } from "lucide-react";
import { Dot } from "@/components/ui/badge";
import { useApi } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import type { CoverageRowView } from "@/lib/view-types";

export interface SystemStatus {
  demo: boolean;
  demoReason: string;
  coverage: CoverageRowView[];
  adapters: string[];
  worker: { lastHeartbeat: string | null; healthy: boolean };
  db: string;
  ai: boolean;
  monitorIntervalHours: number;
}

const NAV = [
  { href: "/", label: "Investigate", icon: Network },
  { href: "/person-search", label: "Person search", icon: Crosshair, legacy: true },
  { href: "/monitor", label: "Monitor", icon: Radar, legacy: true },
  { href: "/admin", label: "Admin", icon: ShieldCheck, admin: true, legacy: true },
];

export function Shell({ user, hosted, children }: { user: { email: string; role: string }; hosted: boolean; children: React.ReactNode }) {
  const path = usePathname();
  // Hosted mode has no database: the legacy status endpoint is not called.
  const { data: status } = useApi<SystemStatus>(hosted ? null : "/api/system/status", 15_000);
  const legacyPage = path !== "/";
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    // Full reload on sign-out intentionally clears all client state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  };
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
        <div className="flex h-12 items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="relative flex h-6 w-6 items-center justify-center rounded-[3px] border border-accent/60">
              <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_12px_var(--accent)]" />
            </span>
            <span className="mono text-[13px] font-semibold tracking-[0.3em] text-text glow-text">NEXUS</span>
            <span className="label hidden !text-[9.5px] lg:inline">{"// multi-engine public-source intelligence"}</span>
          </Link>
          <nav className="ml-1 flex min-w-0 items-center gap-0.5 overflow-x-auto" aria-label="Main">
            {NAV.filter((n) => (!n.admin || user.role === "admin") && (!hosted || !n.legacy)).map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href) || (n.href === "/monitor" && path.startsWith("/persons"));
              return (
                <Link key={n.href} href={n.href} title={n.label} className={cn("mono flex h-8 items-center gap-1.5 rounded-[4px] px-2.5 text-[11px] uppercase tracking-[0.14em]", active ? "bg-accent/10 text-accent" : "text-muted hover:text-text")}>
                  <n.icon className="size-3.5" />
                  <span className="hidden md:inline">{n.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            {status && legacyPage && (
              <div className="hidden items-center gap-3 md:flex">
                <Indicator label="DB" value={status.db === "pglite" ? "EMBEDDED" : "POSTGRES"} tone="ok" />
                <Indicator label="WORKER" value={status.worker.healthy ? "ONLINE" : "WAITING"} tone={status.worker.healthy ? "ok" : "warn"} pulse={status.worker.healthy} />
                <Indicator label="SOURCES" value={status.demo ? "DEMO" : `${status.adapters.length} ACTIVE`} tone={status.demo ? "warn" : "accent"} />
                <Indicator label="AI" value={status.ai ? "FREELLMAPI" : "RULES"} tone={status.ai ? "accent" : "muted"} />
              </div>
            )}
            <span className="mono hidden text-[11px] text-muted sm:inline">{user.email}</span>
            <button onClick={logout} className="text-muted hover:text-accent" title="Sign out" aria-label="Sign out">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
        {status?.demo && legacyPage && (
          <div className="flex items-center gap-2 border-t border-warn/30 bg-warn/[0.07] px-4 py-1.5 text-[11.5px] text-warn">
            <Activity className="size-3.5" />
            <span className="mono font-semibold tracking-[0.14em]">DEMO DATA</span>
            <span className="text-warn/80">— every person, source and result shown is fictional. {status.demoReason}. Add provider keys in <code className="mono">.env</code> to search the public web.</span>
          </div>
        )}
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line px-4 py-2 text-[11px] text-muted">
        Public-source information only · robots.txt respected · no private accounts, no authentication bypass, no private contact harvesting · relationships are never inferred · free services only — no paid APIs, no paid fallback.
      </footer>
    </div>
  );
}

function Indicator({ label, value, tone, pulse }: { label: string; value: string; tone: "ok" | "warn" | "accent" | "muted"; pulse?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <Dot tone={tone} pulse={pulse} />
      <span className="label !text-[9.5px]">{label}</span>
      <span className="mono text-[10.5px] text-text-2">{value}</span>
    </span>
  );
}
