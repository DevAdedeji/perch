ALTER TABLE "visitors" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "visitors" ADD COLUMN "identity_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "identity_secret" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "identity_verification_enabled" boolean DEFAULT false NOT NULL;