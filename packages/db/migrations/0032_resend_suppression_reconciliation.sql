CREATE TABLE "resend_suppression_events" (
	"provider_message_id" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resend_suppression_events_reason_ck" CHECK ("resend_suppression_events"."reason" in ('bounce', 'complaint')),
	CONSTRAINT "resend_suppression_events_status_ck" CHECK ("resend_suppression_events"."status" in ('pending', 'processed', 'dead_letter')),
	CONSTRAINT "resend_suppression_events_attempts_ck" CHECK ("resend_suppression_events"."attempts" between 0 and 6)
);
--> statement-breakpoint
CREATE INDEX "resend_suppression_events_due_idx" ON "resend_suppression_events" USING btree ("status","next_attempt_at");