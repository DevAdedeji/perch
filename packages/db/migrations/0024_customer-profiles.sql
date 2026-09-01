CREATE TABLE "visitor_tags" (
	"visitor_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visitors" ADD COLUMN "profile_name" text;--> statement-breakpoint
ALTER TABLE "visitors" ADD COLUMN "profile_email" text;--> statement-breakpoint
ALTER TABLE "visitors" ADD COLUMN "company" text;--> statement-breakpoint
ALTER TABLE "visitors" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "visitors" ADD COLUMN "internal_note" text;--> statement-breakpoint
ALTER TABLE "visitors" ADD COLUMN "profile_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "visitor_tags" ADD CONSTRAINT "visitor_tags_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_tags" ADD CONSTRAINT "visitor_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_tags_uq" ON "visitor_tags" USING btree ("visitor_id","tag_id");--> statement-breakpoint
CREATE INDEX "visitor_tags_tag_idx" ON "visitor_tags" USING btree ("tag_id");