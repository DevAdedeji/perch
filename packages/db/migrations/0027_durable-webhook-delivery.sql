CREATE TYPE "public"."webhook_job_status" AS ENUM('pending', 'processing', 'retrying', 'succeeded', 'dead_letter', 'canceled');--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"event" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_name_ck" CHECK ("webhook_events"."event" in ('conversation.created', 'message.created', 'conversation.resolved'))
);
--> statement-breakpoint
CREATE TABLE "webhook_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"status" "webhook_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now(),
	"locked_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_http_status" integer,
	"last_duration_ms" integer,
	"last_error" text,
	"cancel_reason" text,
	"replay_count" integer DEFAULT 0 NOT NULL,
	"last_replay_key" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_jobs_attempts_ck" CHECK ("webhook_jobs"."attempts" between 0 and 6),
	CONSTRAINT "webhook_jobs_replay_count_ck" CHECK ("webhook_jobs"."replay_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_jobs" ADD CONSTRAINT "webhook_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_jobs" ADD CONSTRAINT "webhook_jobs_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_jobs" ADD CONSTRAINT "webhook_jobs_event_id_webhook_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."webhook_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_workspace_dedupe_uq" ON "webhook_events" USING btree ("workspace_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "webhook_events_workspace_created_idx" ON "webhook_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_jobs_endpoint_event_uq" ON "webhook_jobs" USING btree ("endpoint_id","event_id");--> statement-breakpoint
CREATE INDEX "webhook_jobs_due_idx" ON "webhook_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_jobs_endpoint_created_idx" ON "webhook_jobs" USING btree ("endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_jobs_workspace_status_idx" ON "webhook_jobs" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_job_id_webhook_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."webhook_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_job_attempt_idx" ON "webhook_deliveries" USING btree ("job_id","attempt");