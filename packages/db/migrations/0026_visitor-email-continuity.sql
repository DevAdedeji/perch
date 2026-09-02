CREATE TYPE "public"."visitor_email_source" AS ENUM('prechat', 'unsigned_identify', 'host_asserted');--> statement-breakpoint
CREATE TYPE "public"."visitor_email_suppression_reason" AS ENUM('unsubscribe', 'bounce', 'complaint');--> statement-breakpoint
CREATE TABLE "visitor_conversation_reads" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"visitor_ref" uuid NOT NULL,
	"last_message_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visitor_email_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email_hash" text NOT NULL,
	"reason" "visitor_email_suppression_reason" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visitor_reply_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"visitor_ref" uuid NOT NULL,
	"visitor_message_id" uuid NOT NULL,
	"agent_message_id" uuid NOT NULL,
	"recipient_email_hash" text NOT NULL,
	"status" "reminder_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"token_expires_at" timestamp with time zone NOT NULL,
	"token_consumed_at" timestamp with time zone,
	"provider_message_id" text,
	"last_error" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visitor_reply_deliveries_attempts_ck" CHECK ("visitor_reply_deliveries"."attempts" between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "visitors" ADD COLUMN "email_source" "visitor_email_source";--> statement-breakpoint
ALTER TABLE "visitors" ADD COLUMN "email_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "visitors" ADD COLUMN "reply_email_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "visitors" ADD COLUMN "reply_email_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "visitor_reply_email_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "visitor_conversation_reads" ADD CONSTRAINT "visitor_conversation_reads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_conversation_reads" ADD CONSTRAINT "visitor_conversation_reads_visitor_ref_visitors_id_fk" FOREIGN KEY ("visitor_ref") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_conversation_reads" ADD CONSTRAINT "visitor_conversation_reads_last_message_id_messages_id_fk" FOREIGN KEY ("last_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_email_suppressions" ADD CONSTRAINT "visitor_email_suppressions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_reply_deliveries" ADD CONSTRAINT "visitor_reply_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_reply_deliveries" ADD CONSTRAINT "visitor_reply_deliveries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_reply_deliveries" ADD CONSTRAINT "visitor_reply_deliveries_visitor_ref_visitors_id_fk" FOREIGN KEY ("visitor_ref") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_reply_deliveries" ADD CONSTRAINT "visitor_reply_deliveries_visitor_message_id_messages_id_fk" FOREIGN KEY ("visitor_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_reply_deliveries" ADD CONSTRAINT "visitor_reply_deliveries_agent_message_id_messages_id_fk" FOREIGN KEY ("agent_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visitor_conversation_reads_visitor_idx" ON "visitor_conversation_reads" USING btree ("visitor_ref","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_email_suppressions_workspace_email_uq" ON "visitor_email_suppressions" USING btree ("workspace_id","email_hash");--> statement-breakpoint
CREATE INDEX "visitor_email_suppressions_workspace_created_idx" ON "visitor_email_suppressions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_reply_deliveries_turn_email_uq" ON "visitor_reply_deliveries" USING btree ("visitor_message_id","recipient_email_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_reply_deliveries_agent_message_uq" ON "visitor_reply_deliveries" USING btree ("agent_message_id");--> statement-breakpoint
CREATE INDEX "visitor_reply_deliveries_due_idx" ON "visitor_reply_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "visitor_reply_deliveries_conversation_idx" ON "visitor_reply_deliveries" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "visitor_reply_deliveries_recipient_idx" ON "visitor_reply_deliveries" USING btree ("recipient_email_hash","created_at");