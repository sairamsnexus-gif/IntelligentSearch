import * as React from "react";
import { cn } from "@/lib/utils";

export function Panel({ title, right, className, bodyClassName, children, scanning }: { title?: React.ReactNode; right?: React.ReactNode; className?: string; bodyClassName?: string; children: React.ReactNode; scanning?: boolean }) {
  return (
    <section className={cn("panel flex min-w-0 flex-col overflow-hidden", className)}>
      {scanning && <div className="scanline" aria-hidden />}
      {(title || right) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <h2 className="label !text-text-2 flex items-center gap-2">{title}</h2>
          {right}
        </header>
      )}
      <div className={cn("min-h-0 flex-1 p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, tone = "text" }: { label: string; value: React.ReactNode; tone?: "text" | "accent" | "ok" | "warn" | "alert" }) {
  const color = { text: "text-text", accent: "text-accent", ok: "text-ok", warn: "text-warn", alert: "text-alert" }[tone];
  return (
    <div className="rounded-[4px] border border-line bg-bg-2/60 px-2.5 py-2">
      <div className="label !text-[9.5px]">{label}</div>
      <div className={cn("mono mt-0.5 text-lg leading-none tabular-nums", color)}>{value}</div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-20 items-center justify-center px-4 text-center text-[12px] text-muted">{children}</div>;
}
