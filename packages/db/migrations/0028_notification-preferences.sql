CREATE TYPE "public"."notification_category" AS ENUM('assignment', 'mention', 'unanswered_reminder');--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"category" "notification_category" NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"browser_enabled" boolean DEFAULT false NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_member_id_workspace_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."workspace_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_member_category_uq" ON "notification_preferences" USING btree ("member_id","category");--> statement-breakpoint
CREATE INDEX "notification_preferences_member_idx" ON "notification_preferences" USING btree ("member_id");--> statement-breakpoint
INSERT INTO "notification_preferences" ("member_id", "category", "in_app_enabled", "browser_enabled", "email_enabled")
SELECT "workspace_members"."id", "defaults"."category"::"notification_category", true, false, "defaults"."email_enabled"
FROM "workspace_members"
CROSS JOIN (VALUES
	('assignment', false),
	('mention', false),
	('unanswered_reminder', true)
) AS "defaults"("category", "email_enabled");
