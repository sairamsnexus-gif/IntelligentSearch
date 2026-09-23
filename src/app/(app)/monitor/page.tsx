import { MonitorDashboard } from "@/components/admin/monitor-dashboard";
import { requireUser } from "@/lib/auth/guard";

export default async function MonitorPage() {
  const u = await requireUser();
  return <MonitorDashboard isAdmin={u.role === "admin"} />;
}
