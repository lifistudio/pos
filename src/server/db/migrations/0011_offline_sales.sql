ALTER TABLE "sales" ADD COLUMN "offline_ref" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "offline_shortfall" jsonb;