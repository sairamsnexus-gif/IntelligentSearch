CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"change_id" text,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"target" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"iteration" integer NOT NULL,
	"cluster_key" text NOT NULL,
	"rank" integer NOT NULL,
	"display_name" text NOT NULL,
	"profile" jsonb NOT NULL,
	"score" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "changes" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"source_id" text,
	"change_type" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"previous_snapshot_id" text,
	"current_snapshot_id" text,
	"diff" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attribute_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text NOT NULL,
	"evidence_id" text,
	"seen" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text,
	"source_id" text,
	"source_url" text NOT NULL,
	"source_type" text NOT NULL,
	"source_name" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"content_snapshot" text DEFAULT '' NOT NULL,
	"content_hash" text NOT NULL,
	"extracted_attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verification_status" text DEFAULT 'unverified' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "monitoring_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"interval_hours" integer NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"running" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_jobs_person_id_unique" UNIQUE("person_id")
);
--> statement-breakpoint
CREATE TABLE "person_attributes" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"state" text NOT NULL,
	"evidence_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "person_identifiers" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"platform" text NOT NULL,
	"identifier_type" text DEFAULT 'username' NOT NULL,
	"handle" text NOT NULL,
	"url" text,
	"state" text NOT NULL,
	"verification" jsonb,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "person_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"title" text,
	"source_type" text NOT NULL,
	"source_name" text NOT NULL,
	"platform" text,
	"monitor_method" text NOT NULL,
	"monitored" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'EXISTING' NOT NULL,
	"verification_status" text DEFAULT 'confirmed' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_changed_at" timestamp with time zone,
	"content_hash" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"external_ref" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" serial NOT NULL,
	"public_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'locked' NOT NULL,
	"session_id" text,
	"candidate_key" text,
	"purpose" text NOT NULL,
	"image_url" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persons_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "search_iterations" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"person_id" text,
	"number" integer NOT NULL,
	"reason" text NOT NULL,
	"query_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "search_queries" (
	"id" text PRIMARY KEY NOT NULL,
	"iteration_id" text NOT NULL,
	"session_id" text,
	"person_id" text,
	"iteration" integer NOT NULL,
	"query" text NOT NULL,
	"query_key" text NOT NULL,
	"tier" integer NOT NULL,
	"category" text NOT NULL,
	"channel" text NOT NULL,
	"reason" text NOT NULL,
	"adapter" text,
	"status" text NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"duration_ms" integer,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_results" (
	"id" text PRIMARY KEY NOT NULL,
	"query_id" text,
	"session_id" text,
	"person_id" text,
	"iteration" integer DEFAULT 1 NOT NULL,
	"query" text NOT NULL,
	"source_engine" text NOT NULL,
	"source_platform" text NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"published_at" timestamp with time zone,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"author" text,
	"username" text,
	"name" text,
	"location" text,
	"organization" text,
	"designation" text,
	"emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"phone_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_url" text,
	"content_text" text DEFAULT '' NOT NULL,
	"raw_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_type" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"input" jsonb NOT NULL,
	"target" jsonb NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"ui_state" text DEFAULT 'search_in_progress' NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolution" jsonb,
	"unattributed" jsonb,
	"coverage" jsonb,
	"is_demo" boolean DEFAULT false NOT NULL,
	"person_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"person_id" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available" boolean NOT NULL,
	"http_status" integer,
	"title" text,
	"content_hash" text NOT NULL,
	"content_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_adapters" (
	"name" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_health" jsonb,
	"last_checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "timeline_events" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"evidence_id" text,
	"source_id" text,
	"change_id" text,
	"url" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'analyst' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_session_id_search_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."search_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_source_id_person_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."person_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_source_id_person_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."person_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_jobs" ADD CONSTRAINT "monitoring_jobs_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_attributes" ADD CONSTRAINT "person_attributes_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_identifiers" ADD CONSTRAINT "person_identifiers_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_sources" ADD CONSTRAINT "person_sources_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_session_id_search_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."search_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_iterations" ADD CONSTRAINT "search_iterations_session_id_search_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."search_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_iterations" ADD CONSTRAINT "search_iterations_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_queries" ADD CONSTRAINT "search_queries_iteration_id_search_iterations_id_fk" FOREIGN KEY ("iteration_id") REFERENCES "public"."search_iterations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_results" ADD CONSTRAINT "search_results_query_id_search_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."search_queries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_sessions" ADD CONSTRAINT "search_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_source_id_person_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."person_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_person_idx" ON "alerts" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "candidates_session_idx" ON "candidates" USING btree ("session_id","iteration");--> statement-breakpoint
CREATE INDEX "changes_person_idx" ON "changes" USING btree ("person_id","detected_at");--> statement-breakpoint
CREATE INDEX "evidence_person_idx" ON "evidence" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_person_url_hash" ON "evidence" USING btree ("person_id","source_url","content_hash");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "person_attributes_person_idx" ON "person_attributes" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_identifiers_unique" ON "person_identifiers" USING btree ("person_id","platform","handle");--> statement-breakpoint
CREATE UNIQUE INDEX "person_sources_unique" ON "person_sources" USING btree ("person_id","canonical_url");--> statement-breakpoint
CREATE INDEX "search_queries_session_idx" ON "search_queries" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "search_queries_person_idx" ON "search_queries" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "search_queries_key_idx" ON "search_queries" USING btree ("query_key","adapter");--> statement-breakpoint
CREATE INDEX "search_results_session_idx" ON "search_results" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "search_results_person_idx" ON "search_results" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "search_sessions_user_idx" ON "search_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "snapshots_source_idx" ON "snapshots" USING btree ("source_id","captured_at");--> statement-breakpoint
CREATE INDEX "timeline_person_idx" ON "timeline_events" USING btree ("person_id","occurred_at");