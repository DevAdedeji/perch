CREATE TYPE "public"."attachment_kind" AS ENUM('message', 'logo');--> statement-breakpoint
CREATE TYPE "public"."attachment_state" AS ENUM('pending', 'claimed', 'processing', 'retrying', 'deleted', 'dead_letter');--> statement-breakpoint
CREATE TABLE "attachment_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"uploader_user_id" uuid,
	"visitor_ref" uuid,
	"kind" "attachment_kind" NOT NULL,
	"public_id" text NOT NULL,
	"secure_url" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"state" "attachment_state" DEFAULT 'pending' NOT NULL,
	"cleanup_reason" text,
	"cleanup_attempts" integer DEFAULT 0 NOT NULL,
	"cleanup_next_attempt_at" timestamp with time zone,
	"cleanup_locked_at" timestamp with time zone,
	"cleanup_last_error" text,
	"claimed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_assets_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "attachment_assets_secure_url_unique" UNIQUE("secure_url"),
	CONSTRAINT "attachment_assets_owner_ck" CHECK (num_nonnulls("attachment_assets"."uploader_user_id", "attachment_assets"."visitor_ref") = 1),
	CONSTRAINT "attachment_assets_scope_ck" CHECK (("attachment_assets"."kind" = 'message' and "attachment_assets"."workspace_id" is not null) or ("attachment_assets"."kind" = 'logo' and "attachment_assets"."uploader_user_id" is not null and "attachment_assets"."visitor_ref" is null)),
	CONSTRAINT "attachment_assets_size_ck" CHECK ("attachment_assets"."byte_size" >= 0 and "attachment_assets"."byte_size" <= 1048576),
	CONSTRAINT "attachment_assets_attempts_ck" CHECK ("attachment_assets"."cleanup_attempts" >= 0 and "attachment_assets"."cleanup_attempts" <= 5)
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "logo_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_logo_asset_id_attachment_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."attachment_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "attachment_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_attachment_asset_id_attachment_assets_id_fk" FOREIGN KEY ("attachment_asset_id") REFERENCES "public"."attachment_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_assets_workspace_state_idx" ON "attachment_assets" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE INDEX "attachment_assets_cleanup_due_idx" ON "attachment_assets" USING btree ("state","cleanup_next_attempt_at");--> statement-breakpoint
CREATE INDEX "attachment_assets_pending_age_idx" ON "attachment_assets" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_attachment_asset_uq" ON "messages" USING btree ("attachment_asset_id") WHERE "messages"."attachment_asset_id" is not null;--> statement-breakpoint
-- Existing message images and logos predate ownership records. They remain
-- readable but cannot be claimed again. New uploads are fully managed.
