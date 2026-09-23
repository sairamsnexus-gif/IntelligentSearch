/**
 * Normalised PostgreSQL schema (Drizzle). Works on real Postgres and on the
 * embedded PGlite used for zero-config local development and tests.
 *
 * person
 *  ├── person_attributes      (state: confirmed | user_supplied | system_discovered | unverified)
 *  ├── person_identifiers
 *  ├── person_sources ── snapshots ── changes ── alerts
 *  ├── evidence
 *  ├── search_iterations ── search_queries ── search_results
 *  ├── timeline_events
 *  └── monitoring_jobs
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("analyst"), // admin | analyst
  createdAt: createdAt(),
  lastLoginAt: ts("last_login_at"),
});

export const searchSessions = pgTable(
  "search_sessions",
  {
    id: id(),
    userId: text("user_id").references(() => users.id),
    input: jsonb("input").notNull(),
    /** TargetProfile after free-text extraction and refinements. */
    target: jsonb("target").notNull(),
    purpose: text("purpose").notNull(),
    status: text("status").notNull().default("queued"), // queued | running | completed | failed
    /** UI state: search_in_progress | discovery_results | ask_for_more_information | person_locked | error */
    uiState: text("ui_state").notNull().default("search_in_progress"),
    progress: jsonb("progress").notNull().default(sql`'{}'::jsonb`),
    resolution: jsonb("resolution"),
    unattributed: jsonb("unattributed"),
    coverage: jsonb("coverage"),
    isDemo: boolean("is_demo").notNull().default(false),
    personId: text("person_id"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("search_sessions_user_idx").on(t.userId)],
);

export const persons = pgTable("persons", {
  id: id(),
  seq: serial("seq").notNull(),
  publicId: text("public_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  status: text("status").notNull().default("locked"), // locked | monitoring | paused | archived
  sessionId: text("session_id").references(() => searchSessions.id),
  candidateKey: text("candidate_key"),
  purpose: text("purpose").notNull(),
  imageUrl: text("image_url"),
  isDemo: boolean("is_demo").notNull().default(false),
  lockedAt: ts("locked_at").notNull().defaultNow(),
  lockedBy: text("locked_by").references(() => users.id),
  createdAt: createdAt(),
});

export const candidates = pgTable(
  "candidates",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => searchSessions.id, { onDelete: "cascade" }),
    iteration: integer("iteration").notNull(),
    clusterKey: text("cluster_key").notNull(),
    rank: integer("rank").notNull(),
    displayName: text("display_name").notNull(),
    profile: jsonb("profile").notNull(), // CandidateProfile
    score: integer("score").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("candidates_session_idx").on(t.sessionId, t.iteration)],
);

export const personAttributes = pgTable(
  "person_attributes",
  {
    id: id(),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    state: text("state").notNull(), // confirmed | user_supplied | system_discovered | unverified
    evidenceId: text("evidence_id"),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    removedAt: ts("removed_at"),
  },
  (t) => [index("person_attributes_person_idx").on(t.personId)],
);

export const personIdentifiers = pgTable(
  "person_identifiers",
  {
    id: id(),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    identifierType: text("identifier_type").notNull().default("username"), // username | profile_url
    handle: text("handle").notNull(),
    url: text("url"),
    state: text("state").notNull(),
    verification: jsonb("verification"),
    verifiedAt: ts("verified_at"),
    createdAt: createdAt(),
    removedAt: ts("removed_at"),
  },
  (t) => [uniqueIndex("person_identifiers_unique").on(t.personId, t.platform, t.handle)],
);

export const personSources = pgTable(
  "person_sources",
  {
    id: id(),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title"),
    sourceType: text("source_type").notNull(),
    sourceName: text("source_name").notNull(),
    platform: text("platform"),
    /** How the source is checked: demo | github_api | reddit_api | web_fetch | changedetection | search_only */
    monitorMethod: text("monitor_method").notNull(),
    monitored: boolean("monitored").notNull().default(true),
    status: text("status").notNull().default("EXISTING"), // NEW | CHANGED | EXISTING | NO_LONGER_AVAILABLE
    verificationStatus: text("verification_status").notNull().default("confirmed"),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastCheckedAt: ts("last_checked_at"),
    lastChangedAt: ts("last_changed_at"),
    contentHash: text("content_hash"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    externalRef: text("external_ref"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("person_sources_unique").on(t.personId, t.canonicalUrl)],
);

export const searchIterations = pgTable("search_iterations", {
  id: id(),
  sessionId: text("session_id").references(() => searchSessions.id, { onDelete: "cascade" }),
  personId: text("person_id").references(() => persons.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  reason: text("reason").notNull(),
  queryCount: integer("query_count").notNull().default(0),
  startedAt: ts("started_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
});

export const searchQueries = pgTable(
  "search_queries",
  {
    id: id(),
    iterationId: text("iteration_id")
      .notNull()
      .references(() => searchIterations.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    personId: text("person_id"),
    iteration: integer("iteration").notNull(),
    query: text("query").notNull(),
    queryKey: text("query_key").notNull(),
    tier: integer("tier").notNull(),
    category: text("category").notNull(),
    channel: text("channel").notNull(),
    reason: text("reason").notNull(),
    adapter: text("adapter"),
    status: text("status").notNull(), // planned | running | done | failed | skipped_duplicate | skipped_history | skipped_budget | skipped_channel_unavailable | cached
    resultCount: integer("result_count").notNull().default(0),
    error: text("error"),
    durationMs: integer("duration_ms"),
    executedAt: ts("executed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("search_queries_session_idx").on(t.sessionId), index("search_queries_person_idx").on(t.personId), index("search_queries_key_idx").on(t.queryKey, t.adapter)],
);

export const searchResults = pgTable(
  "search_results",
  {
    id: id(),
    queryId: text("query_id").references(() => searchQueries.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    personId: text("person_id"),
    iteration: integer("iteration").notNull().default(1),
    query: text("query").notNull(),
    sourceEngine: text("source_engine").notNull(),
    sourcePlatform: text("source_platform").notNull(),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    publishedAt: ts("published_at"),
    discoveredAt: ts("discovered_at").notNull().defaultNow(),
    author: text("author"),
    username: text("username"),
    name: text("name"),
    location: text("location"),
    organization: text("organization"),
    designation: text("designation"),
    emails: jsonb("emails").notNull().default(sql`'[]'::jsonb`),
    phoneNumbers: jsonb("phone_numbers").notNull().default(sql`'[]'::jsonb`),
    imageUrl: text("image_url"),
    contentText: text("content_text").notNull().default(""),
    rawMetadata: jsonb("raw_metadata").notNull().default(sql`'{}'::jsonb`),
    sourceType: text("source_type").notNull(),
    isDemo: boolean("is_demo").notNull().default(false),
  },
  (t) => [index("search_results_session_idx").on(t.sessionId), index("search_results_person_idx").on(t.personId)],
);

export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    personId: text("person_id").references(() => persons.id, { onDelete: "cascade" }),
    sourceId: text("source_id").references(() => personSources.id, { onDelete: "set null" }),
    sourceUrl: text("source_url").notNull(),
    sourceType: text("source_type").notNull(),
    sourceName: text("source_name").notNull(),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    contentSnapshot: text("content_snapshot").notNull().default(""),
    contentHash: text("content_hash").notNull(),
    extractedAttributes: jsonb("extracted_attributes").notNull().default(sql`'{}'::jsonb`),
    verificationStatus: text("verification_status").notNull().default("unverified"), // confirmed | system_discovered | unverified | rejected
    isDemo: boolean("is_demo").notNull().default(false),
  },
  (t) => [index("evidence_person_idx").on(t.personId), uniqueIndex("evidence_person_url_hash").on(t.personId, t.sourceUrl, t.contentHash)],
);

export const snapshots = pgTable(
  "snapshots",
  {
    id: id(),
    sourceId: text("source_id")
      .notNull()
      .references(() => personSources.id, { onDelete: "cascade" }),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    capturedAt: ts("captured_at").notNull().defaultNow(),
    available: boolean("available").notNull(),
    httpStatus: integer("http_status"),
    title: text("title"),
    contentHash: text("content_hash").notNull(),
    contentText: text("content_text").notNull(),
  },
  (t) => [index("snapshots_source_idx").on(t.sourceId, t.capturedAt)],
);

export const changes = pgTable(
  "changes",
  {
    id: id(),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    sourceId: text("source_id").references(() => personSources.id, { onDelete: "cascade" }),
    changeType: text("change_type").notNull(), // NEW | CHANGED | NO_LONGER_AVAILABLE
    detectedAt: ts("detected_at").notNull().defaultNow(),
    previousSnapshotId: text("previous_snapshot_id"),
    currentSnapshotId: text("current_snapshot_id"),
    diff: jsonb("diff").notNull().default(sql`'[]'::jsonb`),
    attributeChanges: jsonb("attribute_changes").notNull().default(sql`'[]'::jsonb`),
    summary: text("summary").notNull(),
    evidenceId: text("evidence_id"),
    seen: boolean("seen").notNull().default(false),
  },
  (t) => [index("changes_person_idx").on(t.personId, t.detectedAt)],
);

export const monitoringJobs = pgTable("monitoring_jobs", {
  id: id(),
  personId: text("person_id")
    .notNull()
    .unique()
    .references(() => persons.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"), // active | paused
  intervalHours: integer("interval_hours").notNull(),
  lastRunAt: ts("last_run_at"),
  nextRunAt: ts("next_run_at"),
  running: boolean("running").notNull().default(false),
  lockedAt: ts("locked_at"),
  runCount: integer("run_count").notNull().default(0),
  lastError: text("last_error"),
  lastSummary: jsonb("last_summary"),
  createdAt: createdAt(),
});

export const alerts = pgTable(
  "alerts",
  {
    id: id(),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    changeId: text("change_id").references(() => changes.id, { onDelete: "cascade" }),
    severity: text("severity").notNull(), // new | changed | gone | info
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
    readAt: ts("read_at"),
  },
  (t) => [index("alerts_person_idx").on(t.personId)],
);

export const timelineEvents = pgTable(
  "timeline_events",
  {
    id: id(),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    evidenceId: text("evidence_id"),
    sourceId: text("source_id"),
    changeId: text("change_id"),
    url: text("url"),
  },
  (t) => [index("timeline_person_idx").on(t.personId, t.occurredAt)],
);

export const sourceAdapters = pgTable("source_adapters", {
  name: text("name").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  lastHealth: jsonb("last_health"),
  lastCheckedAt: ts("last_checked_at"),
});

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(), // discovery | monitor_scan
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("queued"), // queued | running | done | failed
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: ts("run_after").notNull().defaultNow(),
    lockedAt: ts("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.runAfter)],
);

export const auditLog = pgTable("audit_log", {
  id: id(),
  userId: text("user_id"),
  action: text("action").notNull(),
  target: text("target"),
  meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
});

export const appState = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
