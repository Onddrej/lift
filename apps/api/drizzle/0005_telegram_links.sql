CREATE TABLE "telegram_links" (
	"user_id" text PRIMARY KEY NOT NULL,
	"chat_id" text,
	"username" text,
	"link_code" text,
	"link_code_expires_at" timestamp,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"unit" text DEFAULT 'kg' NOT NULL,
	"daily_time" text DEFAULT '07:30' NOT NULL,
	"daily_enabled" boolean DEFAULT true NOT NULL,
	"weekly_enabled" boolean DEFAULT true NOT NULL,
	"last_daily_on" text,
	"last_weekly_on" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_links_chat_idx" ON "telegram_links" USING btree ("chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_links_code_idx" ON "telegram_links" USING btree ("link_code");