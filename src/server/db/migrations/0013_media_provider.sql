ALTER TABLE "product_images" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "provider" text DEFAULT 'database' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "external_id" text;