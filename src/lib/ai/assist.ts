import "server-only";
/**
 * Optional AI assistance via the operator's FreeLLMAPI gateway (the only LLM
 * path; no direct paid providers). Used ONLY to extract structured attributes
 * from free text. Never used to decide identity, and every extracted value must
 * literally appear in the source text to be kept.
 */
import { z } from "zod";
import { chat, gatewayConfig, parseJsonReply } from "@/lib/nexus/freellmapi";
import { log } from "@/lib/security/logger";
import { norm } from "@/lib/core/text";

export function aiConfigured() {
  return gatewayConfig().ok;
}

const extractionSchema = z.object({
  city: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
  organization: z.string().nullish(),
  previous_organizations: z.array(z.string()).nullish(),
  designation: z.string().nullish(),
  school: z.string().nullish(),
  approximate_age: z.number().int().nullish(),
  usernames: z.array(z.object({ platform: z.string(), handle: z.string() })).nullish(),
});
export type AiExtraction = z.infer<typeof extractionSchema>;

const PROMPT = `Extract search attributes about ONE person from the user's note.
Return JSON with keys: city, state, country, organization (current employer), previous_organizations (array), designation, school, approximate_age (integer), usernames (array of {platform, handle}).
Use null when not stated. Do not guess. Do not infer sensitive traits (health, religion, ethnicity, politics).`;

export async function extractWithAi(text: string): Promise<AiExtraction | null> {
  if (!aiConfigured() || !text.trim()) return null;
  try {
    const r = await chat([{ role: "system", content: PROMPT }, { role: "user", content: `NOTE:\n${text.slice(0, 4000)}` }], 600, { json: true });
    if (!r.ok) return null;
    const parsed = extractionSchema.safeParse(parseJsonReply(r.content));
    if (!parsed.success) return null;
    return groundInText(parsed.data, text);
  } catch (err) {
    log.warn("ai.extract_failed", { error: err instanceof Error ? err.message : "unknown" });
    return null;
  }
}

/** Drop any value that does not literally occur in the source text (anti-hallucination). */
export function groundInText(x: AiExtraction, text: string): AiExtraction {
  const t = norm(text);
  const keep = (v?: string | null) => (v && t.includes(norm(v)) ? v : null);
  return {
    city: keep(x.city),
    state: keep(x.state),
    country: keep(x.country),
    organization: keep(x.organization),
    previous_organizations: (x.previous_organizations ?? []).filter((v) => t.includes(norm(v))),
    designation: keep(x.designation),
    school: keep(x.school),
    approximate_age: x.approximate_age && t.includes(String(x.approximate_age)) ? x.approximate_age : null,
    usernames: (x.usernames ?? []).filter((u) => t.includes(u.handle.toLowerCase())),
  };
}
