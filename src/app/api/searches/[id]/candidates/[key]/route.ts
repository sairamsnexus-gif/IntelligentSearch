import { api } from "@/lib/api/handler";
import { DomainError } from "@/lib/errors";
import { candidateEvidence } from "@/lib/services/discovery";

export const GET = api<{ id: string; key: string }>(async ({ params }) => {
  const r = await candidateEvidence(params.id, params.key);
  if (!r) throw new DomainError("Candidate not found", 404);
  return r;
});
