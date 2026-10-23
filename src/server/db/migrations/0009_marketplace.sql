CREATE TYPE "public"."marketplace_connection_status" AS ENUM('ACTIVE', 'PAUSED', 'ERROR', 'DISCONNECTED');--> statement-breakpoint
CREATE TYPE "public"."marketplace_sync_kind" AS ENUM('ORDERS', 'STOCK', 'LISTINGS', 'WEBHOOK');--> statement-breakpoint
CREATE TYPE "public"."marketplace_sync_status" AS ENUM('OK', 'PARTIAL', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'MARKETPLACE';--> statement-breakpoint
CREATE TABLE "marketplace_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text NOT NULL,
	"channel" "sales_channel" NOT NULL,
	"name" text NOT NULL,
	"external_shop_id" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" "marketplace_connection_status" DEFAULT 'ACTIVE' NOT NULL,
	"pull_orders" boolean DEFAULT true NOT NULL,
	"push_stock" boolean DEFAULT true NOT NULL,
	"stock_buffer" integer DEFAULT 0 NOT NULL,
	"credentials_enc" text,
	"token_expires_at" timestamp with time zone,
	"orders_synced_until" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_listings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_item_id" text NOT NULL,
	"external_model_id" text DEFAULT '0' NOT NULL,
	"external_sku" text,
	"name" text NOT NULL,
	"variant_id" uuid,
	"manual_mapping" boolean DEFAULT false NOT NULL,
	"marketplace_stock" integer,
	"last_pushed_qty" integer,
	"last_pushed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" "marketplace_sync_kind" NOT NULL,
	"status" "marketplace_sync_status" NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mock_marketplace_orders" (
	"order_sn" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
ALTER TABLE "marketplace_connections" ADD CONSTRAINT "marketplace_connections_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_connections" ADD CONSTRAINT "marketplace_connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_connection_id_marketplace_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."marketplace_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_sync_logs" ADD CONSTRAINT "marketplace_sync_logs_connection_id_marketplace_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."marketplace_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_connections_shop_uq" ON "marketplace_connections" USING btree ("provider","external_shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_listings_uq" ON "marketplace_listings" USING btree ("connection_id","external_item_id","external_model_id");--> statement-breakpoint
CREATE INDEX "marketplace_listings_variant_idx" ON "marketplace_listings" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "marketplace_sync_logs_conn_idx" ON "marketplace_sync_logs" USING btree ("connection_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mock_marketplace_orders_shop_idx" ON "mock_marketplace_orders" USING btree ("shop_id","updated_at");--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_connection_id_marketplace_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."marketplace_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Role sistem (Owner) selalu memegang semua permission: tambahkan permission marketplace baru.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p.perm FROM "roles" r CROSS JOIN (VALUES ('marketplace:read'), ('marketplace:manage')) AS p(perm)
WHERE r."is_system" = true
ON CONFLICT DO NOTHING;
