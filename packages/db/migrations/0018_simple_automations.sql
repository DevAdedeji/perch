CREATE TYPE "public"."automation_rule_type" AS ENUM('round_robin', 'page_assignment', 'vip_tagging', 'inactivity_reminder', 'auto_close');--> statement-breakpoint
CREATE TABLE "automation_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"execution_key" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "automation_rule_cursors" (
	"rule_id" uuid PRIMARY KEY NOT NULL,
	"next_index" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "automation_rule_type" NOT NULL,
	"config" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_notifications" ADD CONSTRAINT "automation_notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_notifications" ADD CONSTRAINT "automation_notifications_member_id_workspace_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."workspace_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_notifications" ADD CONSTRAINT "automation_notifications_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_notifications" ADD CONSTRAINT "automation_notifications_execution_id_automation_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."automation_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule_cursors" ADD CONSTRAINT "automation_rule_cursors_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_executions_key_uq" ON "automation_executions" USING btree ("execution_key");--> statement-breakpoint
CREATE INDEX "automation_executions_rule_recency_idx" ON "automation_executions" USING btree ("rule_id","executed_at");--> statement-breakpoint
CREATE INDEX "automation_executions_conversation_idx" ON "automation_executions" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_notifications_execution_uq" ON "automation_notifications" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "automation_notifications_member_unread_idx" ON "automation_notifications" USING btree ("member_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "automation_rules_workspace_order_idx" ON "automation_rules" USING btree ("workspace_id","sort_order","created_at");