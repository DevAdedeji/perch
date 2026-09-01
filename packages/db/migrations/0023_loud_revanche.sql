CREATE TYPE "public"."billing_interval" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."billing_webhook_status" AS ENUM('processing', 'completed', 'ignored', 'failed');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('pending', 'paid', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reminder_delivery_status" AS ENUM('pending', 'processing', 'sent', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled');--> statement-breakpoint
CREATE TABLE "billing_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"status" "billing_webhook_status" DEFAULT 'processing' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_webhook_deliveries_provider_event_id_unique" UNIQUE("provider_event_id")
);
--> statement-breakpoint
CREATE TABLE "unanswered_reminder_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"visitor_message_id" uuid NOT NULL,
	"recipient_member_id" uuid NOT NULL,
	"status" "reminder_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" "invoice_status" DEFAULT 'pending' NOT NULL,
	"interval" "billing_interval" NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"bachs_checkout_id" text,
	"checkout_url" text,
	"bachs_charge_id" text,
	"last_error" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invoices_reference_unique" UNIQUE("reference"),
	CONSTRAINT "workspace_invoices_amount_ck" CHECK ("workspace_invoices"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_subscriptions" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"status" "subscription_status" DEFAULT 'canceled' NOT NULL,
	"interval" "billing_interval" DEFAULT 'monthly' NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"bachs_subscription_id" text,
	"last_invoice_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_subscriptions_bachs_subscription_id_unique" UNIQUE("bachs_subscription_id")
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "unanswered_reminder_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "unanswered_reminder_delay_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "unanswered_reminder_business_hours_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "unanswered_reminder_deliveries" ADD CONSTRAINT "unanswered_reminder_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unanswered_reminder_deliveries" ADD CONSTRAINT "unanswered_reminder_deliveries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unanswered_reminder_deliveries" ADD CONSTRAINT "unanswered_reminder_deliveries_visitor_message_id_messages_id_fk" FOREIGN KEY ("visitor_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unanswered_reminder_deliveries" ADD CONSTRAINT "unanswered_reminder_deliveries_recipient_member_id_workspace_members_id_fk" FOREIGN KEY ("recipient_member_id") REFERENCES "public"."workspace_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invoices" ADD CONSTRAINT "workspace_invoices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_webhook_deliveries_status_updated_idx" ON "billing_webhook_deliveries" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "unanswered_reminder_message_recipient_uq" ON "unanswered_reminder_deliveries" USING btree ("visitor_message_id","recipient_member_id");--> statement-breakpoint
CREATE INDEX "unanswered_reminder_due_idx" ON "unanswered_reminder_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "unanswered_reminder_workspace_idx" ON "unanswered_reminder_deliveries" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_invoices_workspace_created_idx" ON "workspace_invoices" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_unanswered_reminder_delay_ck" CHECK ("workspaces"."unanswered_reminder_delay_minutes" between 5 and 1440);