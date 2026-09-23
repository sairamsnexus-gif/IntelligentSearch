import { PersonView } from "@/components/person/person-view";
import { requireUser } from "@/lib/auth/guard";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireUser();
  return <PersonView personId={id} isAdmin={u.role === "admin"} />;
}
