ALTER TABLE "workspaces" ADD COLUMN "widget_greeting" text DEFAULT 'Hi there 👋' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "widget_intro" text DEFAULT 'Tell us a bit about you and how we can help.' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "widget_offline_message" text DEFAULT 'We’re away right now, but leave a message and we’ll get back to you.' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "widget_position" text DEFAULT 'right' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "widget_size" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "widget_theme" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "widget_show_branding" boolean DEFAULT true NOT NULL;