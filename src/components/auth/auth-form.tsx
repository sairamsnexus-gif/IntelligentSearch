"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function AuthForm({ mode }: { mode: "login" | "setup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/setup")
      .then((r) => r.json())
      .then((d: { needsSetup?: boolean }) => {
        if (mode === "login" && d.needsSetup) router.replace("/setup");
        if (mode === "setup" && d.needsSetup === false) router.replace("/login");
      });
  }, [mode, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: { message: string }[] };
    setBusy(false);
    if (!res.ok) return setError(data.issues?.[0]?.message ?? data.error ?? "Failed");
    const next = params.get("next");
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="panel w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-[3px] border border-accent/60">
            <span className="h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_12px_var(--accent)]" />
          </span>
          <div>
            <div className="mono text-[13px] font-semibold tracking-[0.22em] glow-text">NEXUS</div>
            <div className="label !text-[9.5px]">{mode === "login" ? "operator sign-in" : "first-run setup · create admin"}</div>
          </div>
        </div>
        {mode === "setup" && <p className="mb-4 text-[12.5px] text-text-2">No operator account exists yet. The first account becomes the administrator.</p>}
        <div className="space-y-3">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="password">Password {mode === "setup" && "(min 10 chars)"}</Label>
            <Input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="text-[12px] text-alert">{error}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? "Authenticating…" : mode === "login" ? "Sign in" : "Create admin & continue"}
          </Button>
        </div>
        <p className="mt-5 text-[11px] leading-relaxed text-muted">For lawful, legitimate use with publicly available information only. Activity is audit-logged.</p>
      </form>
    </div>
  );
}
