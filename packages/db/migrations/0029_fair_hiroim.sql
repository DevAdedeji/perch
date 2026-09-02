CREATE TYPE "public"."billing_reconciliation_status" AS ENUM('pending', 'processing', 'retrying', 'idle', 'failed');--> statement-breakpoint
ALTER TABLE "workspace_invoices" ADD COLUMN "checkout_claim_token" text;--> statement-breakpoint
ALTER TABLE "workspace_invoices" ADD COLUMN "checkout_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_invoices" ADD COLUMN "reconcile_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_invoices" ADD COLUMN "checkout_closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_invoices" ADD COLUMN "bachs_product_id" text;--> statement-breakpoint
ALTER TABLE "billing_webhook_deliveries" ADD COLUMN "claim_token" text;--> statement-breakpoint
UPDATE "workspace_invoices" SET "checkout_closed_at" = "updated_at";--> statement-breakpoint
WITH "open_checkout" AS (
	SELECT DISTINCT ON ("invoice"."workspace_id") "invoice"."id"
	FROM "workspace_invoices" AS "invoice"
	LEFT JOIN "workspace_subscriptions" AS "subscription"
		ON "subscription"."workspace_id" = "invoice"."workspace_id"
	LEFT JOIN "workspace_invoices" AS "current_invoice"
		ON "current_invoice"."workspace_id" = "subscription"."workspace_id"
		AND "current_invoice"."reference" = "subscription"."last_invoice_reference"
	WHERE "invoice"."status" IN ('pending', 'paid')
		AND "invoice"."bachs_checkout_id" IS NOT NULL
		AND (
			"subscription"."workspace_id" IS NULL
			OR "current_invoice"."id" IS NULL
			OR "invoice"."created_at" > "current_invoice"."created_at"
		)
	ORDER BY "invoice"."workspace_id", "invoice"."created_at" DESC
)
UPDATE "workspace_invoices" AS "invoice"
SET "checkout_closed_at" = NULL,
	"reconcile_until" = now() + interval '24 hours'
FROM "open_checkout"
WHERE "invoice"."id" = "open_checkout"."id";--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invoices_open_checkout_uq" ON "workspace_invoices" USING btree ("workspace_id") WHERE "workspace_invoices"."checkout_closed_at" is null;--> statement-breakpoint
CREATE TABLE "billing_reconciliation_jobs" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"status" "billing_reconciliation_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claim_token" text,
	"claimed_at" timestamp with time zone,
	"requested_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now(),
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_reconciliation_jobs_attempts_ck" CHECK ("billing_reconciliation_jobs"."attempts" between 0 and 6)
);
--> statement-breakpoint
ALTER TABLE "billing_reconciliation_jobs" ADD CONSTRAINT "billing_reconciliation_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_reconciliation_jobs_due_idx" ON "billing_reconciliation_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE TABLE "billing_financial_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text DEFAULT 'duplicate_subscription' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"canonical_subscription_id" text,
	"conflicting_subscription_id" text NOT NULL,
	"invoice_reference" text,
	"amount_cents" integer,
	"currency" text,
	"provider_charge_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"correlation_id" text,
	"last_error" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_financial_conflicts_kind_ck" CHECK ("billing_financial_conflicts"."kind" = 'duplicate_subscription'),
	CONSTRAINT "billing_financial_conflicts_status_ck" CHECK ("billing_financial_conflicts"."status" in ('open', 'resolved')),
	CONSTRAINT "billing_financial_conflicts_attempts_ck" CHECK ("billing_financial_conflicts"."attempts" >= 0)
);--> statement-breakpoint
ALTER TABLE "billing_financial_conflicts" ADD CONSTRAINT "billing_financial_conflicts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_financial_conflicts_subscription_uq" ON "billing_financial_conflicts" USING btree ("conflicting_subscription_id");--> statement-breakpoint
CREATE INDEX "billing_financial_conflicts_status_updated_idx" ON "billing_financial_conflicts" USING btree ("status","updated_at");--> statement-breakpoint
INSERT INTO "billing_reconciliation_jobs" ("workspace_id", "status", "next_attempt_at")
SELECT "workspace_id", 'pending'::billing_reconciliation_status, now()
FROM "workspace_subscriptions"
WHERE "bachs_subscription_id" IS NOT NULL
UNION
SELECT DISTINCT "workspace_id", 'pending'::billing_reconciliation_status, now()
FROM "workspace_invoices"
WHERE "checkout_closed_at" IS NULL AND "bachs_checkout_id" IS NOT NULL
ON CONFLICT ("workspace_id") DO NOTHING;
