-- Some pre-release databases applied an older migration under this feature's
-- name. Keep those observations and upgrade the table in place.
CREATE TABLE IF NOT EXISTS "widget_installation_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"page_hash" text NOT NULL,
	"page_url" text NOT NULL,
	"page_origin" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "widget_installation_signals" ADD COLUMN IF NOT EXISTS "first_seen_at" timestamp with time zone;--> statement-breakpoint
UPDATE "widget_installation_signals"
SET "first_seen_at" = "last_seen_at"
WHERE "first_seen_at" IS NULL;--> statement-breakpoint
ALTER TABLE "widget_installation_signals" ALTER COLUMN "first_seen_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "widget_installation_signals" ALTER COLUMN "first_seen_at" SET NOT NULL;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'widget_installation_signals_workspace_id_workspaces_id_fk'
			AND conrelid = 'public.widget_installation_signals'::regclass
	) THEN
		ALTER TABLE "widget_installation_signals"
			ADD CONSTRAINT "widget_installation_signals_workspace_id_workspaces_id_fk"
			FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "widget_installation_signals_workspace_page_uq" ON "widget_installation_signals" USING btree ("workspace_id","page_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widget_installation_signals_workspace_recency_idx" ON "widget_installation_signals" USING btree ("workspace_id","last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widget_installation_signals_workspace_first_seen_idx" ON "widget_installation_signals" USING btree ("workspace_id","first_seen_at");
