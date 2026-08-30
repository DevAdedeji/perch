CREATE TABLE "widget_installation_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"page_hash" text NOT NULL,
	"page_url" text NOT NULL,
	"page_origin" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "widget_installation_signals" ADD CONSTRAINT "widget_installation_signals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "widget_installation_signals_workspace_page_uq" ON "widget_installation_signals" USING btree ("workspace_id","page_hash");--> statement-breakpoint
CREATE INDEX "widget_installation_signals_workspace_recency_idx" ON "widget_installation_signals" USING btree ("workspace_id","last_seen_at");