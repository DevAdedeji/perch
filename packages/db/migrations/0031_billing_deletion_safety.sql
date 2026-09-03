ALTER TABLE "workspaces" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "billing_deletion_receipts" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"deletion_kind" text NOT NULL,
	"bachs_subscription_id" text,
	"provider_status" text,
	"cancel_at_period_end" boolean,
	"provider_confirmed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_deletion_receipts_kind_ck" CHECK ("billing_deletion_receipts"."deletion_kind" in ('workspace', 'account'))
);--> statement-breakpoint
CREATE INDEX "billing_deletion_receipts_subscription_idx" ON "billing_deletion_receipts" USING btree ("bachs_subscription_id");
