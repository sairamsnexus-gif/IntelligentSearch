import { AdminView } from "@/components/admin/admin-view";
import { requireAdmin } from "@/lib/auth/guard";

export default async function AdminPage() {
  await requireAdmin();
  return <AdminView />;
}
