"use client";
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Minimal accessible modal (shadcn Dialog API shape, no Radix dependency). */
export function Dialog({ open, onClose, title, children, className, wide }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; className?: string; wide?: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-[2px] sm:p-8" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className={cn("panel w-full outline-none", wide ? "max-w-5xl" : "max-w-xl", className)}>
        <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="label !text-accent">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-accent" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
