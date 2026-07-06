ALTER TABLE "workspaces" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "widget_primary_color" text DEFAULT '#f59e0b' NOT NULL;