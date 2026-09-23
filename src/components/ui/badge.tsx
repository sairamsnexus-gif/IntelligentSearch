import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva("inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-[1px] font-mono text-[10px] uppercase tracking-[0.12em] whitespace-nowrap", {
  variants: {
    tone: {
      accent: "border-accent/40 bg-accent/10 text-accent",
      ok: "border-ok/40 bg-ok/10 text-ok",
      warn: "border-warn/40 bg-warn/10 text-warn",
      alert: "border-alert/50 bg-alert/10 text-alert",
      muted: "border-line-2 bg-panel-3 text-text-2",
      violet: "border-violet/40 bg-violet/10 text-violet",
      dark: "border-line bg-black/40 text-muted",
    },
  },
  defaultVariants: { tone: "muted" },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function Dot({ tone = "accent", pulse = false }: { tone?: "accent" | "ok" | "warn" | "alert" | "muted"; pulse?: boolean }) {
  const color = { accent: "bg-accent", ok: "bg-ok", warn: "bg-warn", alert: "bg-alert", muted: "bg-muted" }[tone];
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && <span className={cn("absolute inset-0 rounded-full opacity-60 animate-ping", color)} />}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", color)} />
    </span>
  );
}
