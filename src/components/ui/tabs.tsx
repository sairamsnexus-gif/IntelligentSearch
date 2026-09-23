"use client";
import { cn } from "@/lib/utils";

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: string; count?: number; tone?: "alert" | "warn" }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn("flex gap-0.5 overflow-x-auto border-b border-line", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn("mono relative -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[11px] uppercase tracking-[0.14em] transition-colors", value === t.id ? "border-accent text-accent" : "border-transparent text-muted hover:text-text")}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className={cn("ml-1.5 rounded-[3px] px-1 text-[9px]", t.tone === "alert" ? "bg-alert/20 text-alert" : t.tone === "warn" ? "bg-warn/20 text-warn" : "bg-panel-3 text-text-2")}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
