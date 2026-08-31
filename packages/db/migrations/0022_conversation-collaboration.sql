CREATE TABLE "member_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"recipient_member_id" uuid NOT NULL,
	"actor_member_id" uuid,
	"actor_name" text NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"team_message_id" uuid,
	"excerpt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "member_notifications_target_ck" CHECK (("member_notifications"."type" = 'assignment' and "member_notifications"."source" = 'conversation' and "member_notifications"."conversation_id" is not null and "member_notifications"."message_id" is null and "member_notifications"."team_message_id" is null)
      or ("member_notifications"."type" = 'mention' and "member_notifications"."source" = 'conversation' and "member_notifications"."conversation_id" is not null and "member_notifications"."message_id" is not null and "member_notifications"."team_message_id" is null)
      or ("member_notifications"."type" = 'mention' and "member_notifications"."source" = 'nest' and "member_notifications"."conversation_id" is null and "member_notifications"."message_id" is null and "member_notifications"."team_message_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "collaborator_member_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "mentioned_member_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_messages" ADD COLUMN "mentioned_member_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_notifications" ADD CONSTRAINT "member_notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_notifications" ADD CONSTRAINT "member_notifications_recipient_member_id_workspace_members_id_fk" FOREIGN KEY ("recipient_member_id") REFERENCES "public"."workspace_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_notifications" ADD CONSTRAINT "member_notifications_actor_member_id_workspace_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."workspace_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_notifications" ADD CONSTRAINT "member_notifications_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_notifications" ADD CONSTRAINT "member_notifications_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_notifications" ADD CONSTRAINT "member_notifications_team_message_id_team_messages_id_fk" FOREIGN KEY ("team_message_id") REFERENCES "public"."team_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_notifications_message_recipient_uq" ON "member_notifications" USING btree ("message_id","recipient_member_id") WHERE "member_notifications"."message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "member_notifications_team_message_recipient_uq" ON "member_notifications" USING btree ("team_message_id","recipient_member_id") WHERE "member_notifications"."team_message_id" is not null;--> statement-breakpoint
CREATE INDEX "member_notifications_recipient_unread_idx" ON "member_notifications" USING btree ("recipient_member_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "member_notifications_workspace_recency_idx" ON "member_notifications" USING btree ("workspace_id","created_at");