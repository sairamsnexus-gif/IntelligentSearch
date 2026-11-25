import { z } from "zod";
import { api, body } from "@/lib/api/handler";
import { parseClues } from "@/lib/nexus/clues";

export const dynamic = "force-dynamic";

const schema = z.object({ text: z.string().min(2).max(4000) });

/** Rule-based clue parsing (deterministic; the same parser also runs in the browser). */
export const POST = api(async ({ req }) => {
  const { text } = await body(req, schema);
  return { clues: parseClues(text) };
}, { rpm: 60 });
