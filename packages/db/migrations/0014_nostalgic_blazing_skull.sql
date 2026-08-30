CREATE INDEX "article_groups_workspace_order_idx" ON "article_groups" USING btree ("workspace_id","sort_order");--> statement-breakpoint
CREATE INDEX "articles_workspace_status_created_idx" ON "articles" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_workspace_recency_idx" ON "audit_logs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_recency_idx" ON "sessions" USING btree ("user_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");