import { api } from "@/lib/api/handler";
import { searchPlanForPerson } from "@/lib/services/persons";

export const GET = api<{ id: string }>(async ({ params }) => searchPlanForPerson(params.id));
