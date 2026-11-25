/**
 * NEXUS investigation file — the official, portable, versioned JSON format.
 * Pure types + zod validation; client- and server-safe. Never holds secrets.
 */
import { z } from "zod";

export const NEXUS_SCHEMA_ID = "nexus.investigation";
export const NEXUS_SCHEMA_VERSION = 1;

export const ENGINE_IDS = ["page", "searxng", "gpt_researcher", "spiderfoot", "maigret"] as const;
export type EngineId = (typeof ENGINE_IDS)[number];
/** The LLM gateway assists reasoning; it is never counted as a discovery engine. */
export type AssistId = "freellmapi";

export const ENGINE_LABEL: Record<EngineId, string> = {
  page: "Page Investigator (web-scout-ai method)",
  searxng: "SearXNG metasearch",
  gpt_researcher: "GPT Researcher",
  spiderfoot: "SpiderFoot OSINT",
  maigret: "Maigret usernames",
};

export const VERIFICATION_STATES = [
  "primary_source",
  "independently_corroborated",
  "single_source",
  "weak_indication",
  "unverified_hypothesis",
  "contradicted",
  "inaccessible",
  "not_searched",
] as const;
export type Verification = (typeof VERIFICATION_STATES)[number];

export const VERIFICATION_LABEL: Record<Verification, string> = {
  primary_source: "Primary-source supported",
  independently_corroborated: "Independently corroborated",
  single_source: "Single-source supported",
  weak_indication: "Weak indication",
  unverified_hypothesis: "Unverified hypothesis",
  contradicted: "Contradicted",
  inaccessible: "Inaccessible",
  not_searched: "Not searched",
};

export const ENTITY_TYPES = ["person", "business", "school", "organisation", "website", "social_profile", "location", "contact_point"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const PREDICATES = [
  "owns",
  "founded",
  "works_at",
  "holds_position",
  "associated_with",
  "represents",
  "operates_at",
  "operates",
  "has_contact",
  "has_official_website",
  "established_in_year",
  "mentions",
  "username_found_on",
  "documented_relationship",
] as const;
export type Predicate = (typeof PREDICATES)[number];

export const TASK_KINDS = ["search", "read_page", "research", "osint_domain", "username"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATUS = ["queued", "running", "pending", "done", "failed", "blocked", "quota", "unavailable", "skipped", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

export const FETCH_STATUS = ["read", "not_opened", "blocked_robots", "login_wall", "http_error", "network_error", "unsupported_type", "too_large", "unsafe_url", "skipped_limit"] as const;
export type FetchStatus = (typeof FETCH_STATUS)[number];

export const LEAD_KINDS = ["name", "business", "school", "organisation", "domain", "url", "username", "place", "phrase"] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];

// ---------------------------------------------------------------------------

const iso = z.string().min(10).max(40);
const id = z.string().min(1).max(80);
const text = (max: number) => z.string().max(max);

export const variantSchema = z.object({
  text: text(200),
  method: text(80),
  script: z.enum(["latin", "tamil", "devanagari"]),
  isOriginal: z.boolean(),
});
export type NameVariant = z.infer<typeof variantSchema>;

export const nameClueSchema = z.object({
  id,
  original: text(200),
  variants: z.array(variantSchema).max(60),
});
export type NameClue = z.infer<typeof nameClueSchema>;

export const cluesSchema = z.object({
  names: z.array(nameClueSchema).max(20),
  places: z.array(text(120)).max(20),
  organisationHints: z.array(text(120)).max(20),
  keywords: z.array(text(80)).max(30),
  urls: z.array(text(2000)).max(50),
  usernames: z.array(text(80)).max(30),
  domains: z.array(text(200)).max(30),
  /** Relationships stated by the user — always unverified hypotheses. */
  userRelationships: z.array(z.object({ a: text(200), b: text(200), description: text(300) })).max(20),
  parsedBy: z.array(z.enum(["rules", "freellmapi"])),
});
export type Clues = z.infer<typeof cluesSchema>;

export const settingsSchema = z.object({
  maxRounds: z.number().int().min(1).max(8),
  maxTasksPerRound: z.number().int().min(1).max(80),
  maxPagesPerDomain: z.number().int().min(1).max(25),
  maxTotalTasks: z.number().int().min(1).max(600),
  leadThreshold: z.number().min(0).max(100),
  engines: z.record(z.enum(ENGINE_IDS), z.boolean()),
  llm: z.object({ enabled: z.boolean(), maxCalls: z.number().int().min(0).max(500), maxTokensPerCall: z.number().int().min(64).max(8000) }),
  synthetic: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const searchHitSchema = z.object({ url: text(2000), title: text(500), snippet: text(1500), rank: z.number().int(), provider: text(80) });
export type SearchHit = z.infer<typeof searchHitSchema>;

export const taskSchema = z.object({
  id,
  engine: z.enum(ENGINE_IDS),
  kind: z.enum(TASK_KINDS),
  round: z.number().int().min(0),
  input: z.object({ query: text(500).optional(), url: text(2000).optional(), domain: text(200).optional(), username: text(80).optional() }),
  reason: text(500),
  leadId: id.optional(),
  status: z.enum(TASK_STATUS),
  createdAt: iso,
  startedAt: iso.optional(),
  completedAt: iso.optional(),
  provider: text(80).optional(),
  error: text(1000).optional(),
  jobRef: text(200).optional(),
  attempts: z.number().int().min(0).max(20),
  /** What this task produced (ids into the ledger). */
  output: z.object({
    hits: z.array(searchHitSchema).max(50),
    sourceIds: z.array(id).max(200),
    leadIds: z.array(id).max(200),
    claimIds: z.array(id).max(500),
    notes: z.array(text(2000)).max(50),
    narrative: text(20000).optional(),
  }),
});
export type Task = z.infer<typeof taskSchema>;

export const discoverySchema = z.object({ engine: z.enum(ENGINE_IDS), taskId: id, at: iso, via: z.enum(["search", "link", "user", "osint", "username", "research"]) });

export const sourceSchema = z.object({
  id,
  url: text(2000),
  canonicalUrl: text(2000),
  domain: text(200),
  title: text(500),
  sourceType: z.enum(["official_site", "directory", "news", "social_profile", "blog", "forum", "document", "search_result", "web"]),
  discoveredBy: z.array(discoverySchema).max(50),
  fetch: z.object({ status: z.enum(FETCH_STATUS), httpStatus: z.number().int().nullable(), reason: text(500), at: iso.optional(), engine: z.enum(ENGINE_IDS).optional() }),
  snippet: text(1500),
  contentHash: text(80).optional(),
  /** MinHash signature of page text, used to detect copied content (press-release syndication). */
  fingerprint: text(400).optional(),
  publishedAt: iso.nullable(),
  firstSeenAt: iso,
  lastCheckedAt: iso,
  copyGroup: id,
  outboundLinks: z.array(text(2000)).max(200),
  followedLinks: z.array(text(2000)).max(200),
  synthetic: z.boolean(),
});
export type Source = z.infer<typeof sourceSchema>;

export const passageSchema = z.object({ id, sourceId: id, text: text(1200) });
export type Passage = z.infer<typeof passageSchema>;

export const entitySchema = z.object({
  id,
  type: z.enum(ENTITY_TYPES),
  name: text(300),
  /** Stable identity key used for merging (never a bare name for persons). */
  key: text(400),
  aliases: z.array(text(300)).max(20),
  attributes: z.record(z.string(), text(500)),
  sourceIds: z.array(id).max(200),
  userDecision: z.enum(["confirmed", "rejected"]).nullable(),
  firstSeenAt: iso,
});
export type Entity = z.infer<typeof entitySchema>;

export const evidenceRefSchema = z.object({ sourceId: id, passageId: id });

export const relationshipSchema = z.object({
  id,
  subjectId: id,
  predicate: z.enum(PREDICATES),
  objectId: id,
  qualifier: text(200).optional(),
  evidence: z.array(evidenceRefSchema).max(50),
  verification: z.enum(VERIFICATION_STATES),
  independentSources: z.number().int().min(0),
  contradictions: z.array(text(500)).max(20),
  provenance: z.object({ engine: z.enum(ENGINE_IDS).or(z.literal("user")), taskId: id.optional(), round: z.number().int(), assistedBy: z.enum(["freellmapi"]).optional() }),
  hypothesis: z.boolean(),
  userDecision: z.enum(["confirmed", "rejected"]).nullable(),
});
export type Relationship = z.infer<typeof relationshipSchema>;

export const contactSchema = z.object({
  id,
  kind: z.enum(["email", "phone", "whatsapp", "address", "website", "social"]),
  value: text(500),
  normalized: text(500),
  entityId: id,
  sourceId: id,
  passageId: id,
  publishedAt: iso.nullable(),
  firstSeenAt: iso,
  lastCheckedAt: iso,
  official: z.boolean(),
  verification: z.enum(VERIFICATION_STATES),
});
export type ContactPoint = z.infer<typeof contactSchema>;

export const claimSchema = z.object({
  id,
  subjectId: id,
  predicate: z.enum(PREDICATES),
  object: text(500),
  objectId: id.optional(),
  sourceId: id,
  passageId: id,
  engine: z.enum(ENGINE_IDS),
  assistedBy: z.enum(["freellmapi"]).optional(),
  verification: z.enum(VERIFICATION_STATES),
  conflictsWith: z.array(id).max(20),
  firstSeenAt: iso,
  lastCheckedAt: iso,
});
export type Claim = z.infer<typeof claimSchema>;

export const leadSchema = z.object({
  id,
  kind: z.enum(LEAD_KINDS),
  value: text(2000),
  key: text(2100),
  from: z.object({ engine: z.enum(ENGINE_IDS).or(z.literal("user")), taskId: id.optional(), sourceId: id.optional(), passageId: id.optional() }),
  score: z.number(),
  reason: text(600),
  status: z.enum(["open", "queued", "investigated", "discarded", "limit_reached"]),
  round: z.number().int(),
  taskIds: z.array(id).max(20),
});
export type Lead = z.infer<typeof leadSchema>;

export const trailSchema = z.object({
  id,
  at: iso,
  round: z.number().int(),
  kind: z.enum(["plan", "search", "page_read", "extracted", "lead", "followup", "comparison", "error", "quota", "user", "checkpoint"]),
  engine: z.enum(ENGINE_IDS).or(z.enum(["user", "nexus", "freellmapi"])),
  text: text(1000),
  refs: z.array(id).max(20),
});
export type TrailEvent = z.infer<typeof trailSchema>;

export const quotaEventSchema = z.object({ provider: text(80), engine: z.enum(ENGINE_IDS).or(z.literal("freellmapi")), at: iso, status: z.number().int().nullable(), message: text(500), resumeAfter: iso.nullable() });
export type QuotaEvent = z.infer<typeof quotaEventSchema>;

export const investigationSchema = z.object({
  schema: z.literal(NEXUS_SCHEMA_ID),
  schemaVersion: z.literal(NEXUS_SCHEMA_VERSION),
  id,
  title: text(200),
  createdAt: iso,
  updatedAt: iso,
  status: z.enum(["draft", "running", "paused", "completed", "stopped"]),
  stopReason: text(300).nullable(),
  request: z.object({ text: text(4000), purpose: text(80), submittedAt: iso }),
  clues: cluesSchema,
  settings: settingsSchema,
  round: z.number().int().min(0),
  tasks: z.array(taskSchema).max(2000),
  sources: z.array(sourceSchema).max(5000),
  passages: z.array(passageSchema).max(20000),
  entities: z.array(entitySchema).max(5000),
  relationships: z.array(relationshipSchema).max(10000),
  contacts: z.array(contactSchema).max(5000),
  claims: z.array(claimSchema).max(20000),
  leads: z.array(leadSchema).max(5000),
  trail: z.array(trailSchema).max(20000),
  quota: z.array(quotaEventSchema).max(1000),
  usage: z.object({ llmCalls: z.number().int().min(0), llmTokens: z.number().int().min(0), searchCalls: z.record(z.string(), z.number().int().min(0)) }),
  checkpoint: z.object({ savedAt: iso, round: z.number().int(), pendingTaskIds: z.array(id) }).nullable(),
  synthetic: z.boolean(),
});
export type Investigation = z.infer<typeof investigationSchema>;

export const DEFAULT_SETTINGS: Settings = {
  maxRounds: 5,
  maxTasksPerRound: 24,
  maxPagesPerDomain: 6,
  maxTotalTasks: 150,
  leadThreshold: 35,
  engines: { page: true, searxng: true, gpt_researcher: true, spiderfoot: true, maigret: true },
  llm: { enabled: true, maxCalls: 40, maxTokensPerCall: 1200 },
  synthetic: false,
};

export function newId(prefix: string): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 12) : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${r}`;
}

export function createInvestigation(requestText: string, clues: Clues, settings: Partial<Settings> = {}, purpose = "research", now = new Date()): Investigation {
  const at = now.toISOString();
  const s: Settings = { ...DEFAULT_SETTINGS, ...settings, engines: { ...DEFAULT_SETTINGS.engines, ...(settings.engines ?? {}) }, llm: { ...DEFAULT_SETTINGS.llm, ...(settings.llm ?? {}) } };
  const title = clues.names.length ? `Investigation: ${clues.names.map((n) => n.original).join(" & ")}${clues.places[0] ? ` · ${clues.places[0]}` : ""}` : requestText.slice(0, 80);
  return {
    schema: NEXUS_SCHEMA_ID,
    schemaVersion: NEXUS_SCHEMA_VERSION,
    id: newId("inv"),
    title,
    createdAt: at,
    updatedAt: at,
    status: "draft",
    stopReason: null,
    request: { text: requestText, purpose, submittedAt: at },
    clues,
    settings: s,
    round: 0,
    tasks: [],
    sources: [],
    passages: [],
    entities: [],
    relationships: [],
    contacts: [],
    claims: [],
    leads: [],
    trail: [],
    quota: [],
    usage: { llmCalls: 0, llmTokens: 0, searchCalls: {} },
    checkpoint: null,
    synthetic: s.synthetic,
  };
}
