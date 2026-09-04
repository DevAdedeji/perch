ALTER TABLE "messages" ADD COLUMN "client_message_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "request_fingerprint" text;--> statement-breakpoint
ALTER TABLE "team_messages" ADD COLUMN "client_message_id" uuid;--> statement-breakpoint
ALTER TABLE "team_messages" ADD COLUMN "request_fingerprint" text;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_client_request_uq" ON "messages" USING btree ("conversation_id","client_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_messages_client_request_uq" ON "team_messages" USING btree ("workspace_id","member_id","client_message_id");