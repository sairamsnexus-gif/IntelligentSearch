import { Shell } from "@/components/shell/shell";
import { requireUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  return <Shell user={{ email: u.email, role: u.role }}>{children}</Shell>;
}
