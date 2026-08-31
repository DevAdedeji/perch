CREATE TYPE "public"."support_outcome_event_type" AS ENUM('resolution', 'csat');--> statement-breakpoint
CREATE TABLE "support_outcome_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"event_type" "support_outcome_event_type" NOT NULL,
	"request_id" uuid,
	"actor_member_id" uuid,
	"rating" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_outcome_events_payload_ck" CHECK (("support_outcome_events"."event_type" = 'resolution' and "support_outcome_events"."request_id" is null and "support_outcome_events"."rating" is null) or ("support_outcome_events"."event_type" = 'csat' and "support_outcome_events"."request_id" is not null and "support_outcome_events"."rating" in ('good', 'bad')))
);
--> statement-breakpoint
ALTER TABLE "support_outcome_events" ADD CONSTRAINT "support_outcome_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_outcome_events" ADD CONSTRAINT "support_outcome_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_outcome_events_conversation_request_uq" ON "support_outcome_events" USING btree ("conversation_id","request_id");--> statement-breakpoint
CREATE INDEX "support_outcome_events_workspace_type_time_idx" ON "support_outcome_events" USING btree ("workspace_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "support_outcome_events_conversation_type_time_idx" ON "support_outcome_events" USING btree ("conversation_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "messages_public_conversation_sender_time_idx" ON "messages" USING btree ("conversation_id","sender_type","created_at") WHERE "messages"."is_internal_note" = false;--> statement-breakpoint
CREATE INDEX "messages_public_sender_time_conversation_idx" ON "messages" USING btree ("sender_type","created_at","conversation_id","sender_id") WHERE "messages"."is_internal_note" = false;--> statement-breakpoint
-- Historical rows do not identify who performed a resolution after reassignment.
-- Backfill those actors as unknown instead of attributing them to the current assignee.
INSERT INTO "support_outcome_events" (
	"workspace_id", "conversation_id", "event_type", "actor_member_id", "occurred_at", "created_at"
)
SELECT
	c."workspace_id",
	c."id",
	'resolution',
	NULL,
	COALESCE(c."resolved_at", c."csat_at"),
	COALESCE(c."resolved_at", c."csat_at")
FROM "conversations" c
WHERE c."resolved_at" IS NOT NULL OR c."csat_at" IS NOT NULL;--> statement-breakpoint
INSERT INTO "support_outcome_events" (
	"workspace_id", "conversation_id", "event_type", "request_id", "actor_member_id", "rating", "occurred_at", "created_at"
)
SELECT
	c."workspace_id",
	c."id",
	'csat',
	gen_random_uuid(),
	NULL,
	c."csat_rating",
	c."csat_at",
	c."csat_at"
FROM "conversations" c
WHERE c."csat_rating" IN ('good', 'bad') AND c."csat_at" IS NOT NULL;
