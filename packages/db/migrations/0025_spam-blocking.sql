CREATE TABLE "visitor_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"visitor_ref" uuid NOT NULL,
	"source_conversation_id" uuid,
	"blocked_by_member_id" uuid,
	"blocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unblocked_by_member_id" uuid,
	"unblocked_at" timestamp with time zone,
	CONSTRAINT "visitor_blocks_unblocked_state_ck" CHECK ("visitor_blocks"."unblocked_at" is not null or "visitor_blocks"."unblocked_by_member_id" is null)
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "is_spam" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "spam_marked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "spam_marked_by_member_id" uuid;--> statement-breakpoint
ALTER TABLE "visitor_blocks" ADD CONSTRAINT "visitor_blocks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_blocks" ADD CONSTRAINT "visitor_blocks_visitor_ref_visitors_id_fk" FOREIGN KEY ("visitor_ref") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_blocks" ADD CONSTRAINT "visitor_blocks_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_blocks" ADD CONSTRAINT "visitor_blocks_blocked_by_member_id_workspace_members_id_fk" FOREIGN KEY ("blocked_by_member_id") REFERENCES "public"."workspace_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_blocks" ADD CONSTRAINT "visitor_blocks_unblocked_by_member_id_workspace_members_id_fk" FOREIGN KEY ("unblocked_by_member_id") REFERENCES "public"."workspace_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_blocks_active_visitor_uq" ON "visitor_blocks" USING btree ("visitor_ref") WHERE "visitor_blocks"."unblocked_at" is null;--> statement-breakpoint
CREATE INDEX "visitor_blocks_workspace_recency_idx" ON "visitor_blocks" USING btree ("workspace_id","blocked_at");--> statement-breakpoint
CREATE INDEX "visitor_blocks_workspace_active_idx" ON "visitor_blocks" USING btree ("workspace_id","visitor_ref") WHERE "visitor_blocks"."unblocked_at" is null;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_spam_marked_by_member_id_workspace_members_id_fk" FOREIGN KEY ("spam_marked_by_member_id") REFERENCES "public"."workspace_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_workspace_spam_recency_idx" ON "conversations" USING btree ("workspace_id","is_spam","last_message_at");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_spam_state_ck" CHECK (("conversations"."is_spam" = true and "conversations"."spam_marked_at" is not null) or ("conversations"."is_spam" = false and "conversations"."spam_marked_at" is null));