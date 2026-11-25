import { Shell } from "@/components/shell/shell";
import { requireUser } from "@/lib/auth/guard";
import { isHosted } from "@/lib/nexus/engines";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  return <Shell user={{ email: u.email, role: u.role }} hosted={isHosted()}>{children}</Shell>;
}
