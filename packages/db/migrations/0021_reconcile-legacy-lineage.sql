-- Early installation-onboarding deploys advanced Drizzle's timestamp past the
-- inbox migration. Reconcile the skipped objects without replacing user data.
DO $$
BEGIN
	CREATE TYPE "public"."conversation_priority" AS ENUM('low', 'normal', 'high', 'urgent');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inbox_saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "priority" "conversation_priority" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "snoozed_until" timestamp with time zone;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'inbox_saved_views_member_id_workspace_members_id_fk'
			AND conrelid = 'public.inbox_saved_views'::regclass
	) THEN
		ALTER TABLE "inbox_saved_views"
			ADD CONSTRAINT "inbox_saved_views_member_id_workspace_members_id_fk"
			FOREIGN KEY ("member_id") REFERENCES "public"."workspace_members"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbox_saved_views_member_name_uq" ON "inbox_saved_views" USING btree ("member_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_saved_views_member_created_idx" ON "inbox_saved_views" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_workspace_priority_recency_idx" ON "conversations" USING btree ("workspace_id","priority","last_message_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_workspace_snoozed_idx" ON "conversations" USING btree ("workspace_id","snoozed_until");
