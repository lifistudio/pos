CREATE TYPE "public"."online_order_status" AS ENUM('PENDING_PAYMENT', 'PAID', 'PACKED', 'SHIPPED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."payment_intent_status" AS ENUM('PENDING', 'PAID', 'EXPIRED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."sales_channel" AS ENUM('WEBSITE', 'WHATSAPP', 'INSTAGRAM', 'SHOPEE', 'TOKOPEDIA', 'TIKTOK', 'LAZADA', 'OTHER');--> statement-breakpoint
CREATE TABLE "online_order_items" (
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"variant_title" text NOT NULL,
	"sku" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"line_total" bigint NOT NULL,
	CONSTRAINT "online_order_items_order_id_variant_id_pk" PRIMARY KEY("order_id","variant_id"),
	CONSTRAINT "online_order_items_qty_pos" CHECK ("online_order_items"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "online_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"channel" "sales_channel" NOT NULL,
	"external_order_no" text,
	"status" "online_order_status" DEFAULT 'PENDING_PAYMENT' NOT NULL,
	"customer_id" uuid,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"shipping_address" text NOT NULL,
	"courier" text,
	"tracking_no" text,
	"shipping_fee" bigint DEFAULT 0 NOT NULL,
	"subtotal" bigint NOT NULL,
	"tax_total" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"tax_snapshot" jsonb NOT NULL,
	"note" text,
	"reserved_until" timestamp with time zone NOT NULL,
	"sale_id" uuid,
	"created_by" text,
	"paid_at" timestamp with time zone,
	"packed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_orders_total_nonneg" CHECK ("online_orders"."total" >= 0 and "online_orders"."shipping_fee" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text NOT NULL,
	"event_key" text NOT NULL,
	"intent_id" uuid,
	"payload" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text NOT NULL,
	"gateway_order_id" text NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" uuid NOT NULL,
	"method" text DEFAULT 'QRIS' NOT NULL,
	"amount" bigint NOT NULL,
	"status" "payment_intent_status" DEFAULT 'PENDING' NOT NULL,
	"provider_ref" text,
	"qr_string" text,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_intents_amount_pos" CHECK ("payment_intents"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "shipping_fee" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "online_order_items" ADD CONSTRAINT "online_order_items_order_id_online_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."online_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_order_items" ADD CONSTRAINT "online_order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "online_orders_number_uq" ON "online_orders" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "online_orders_sale_uq" ON "online_orders" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "online_orders_external_uq" ON "online_orders" USING btree ("channel","external_order_no") WHERE "online_orders"."external_order_no" is not null;--> statement-breakpoint
CREATE INDEX "online_orders_branch_created_idx" ON "online_orders" USING btree ("branch_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "online_orders_pending_idx" ON "online_orders" USING btree ("reserved_until") WHERE "online_orders"."status" = 'PENDING_PAYMENT';--> statement-breakpoint
CREATE INDEX "online_orders_status_idx" ON "online_orders" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_key_uq" ON "payment_events" USING btree ("provider","event_key");--> statement-breakpoint
CREATE INDEX "payment_events_intent_idx" ON "payment_events" USING btree ("intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_gateway_order_uq" ON "payment_intents" USING btree ("provider","gateway_order_id");--> statement-breakpoint
CREATE INDEX "payment_intents_reference_idx" ON "payment_intents" USING btree ("reference_type","reference_id","created_at" DESC NULLS LAST);