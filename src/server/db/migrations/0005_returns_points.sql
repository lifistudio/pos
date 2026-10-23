ALTER TYPE "public"."point_ledger_type" ADD VALUE 'REDEEM';--> statement-breakpoint
ALTER TYPE "public"."point_ledger_type" ADD VALUE 'REFUND';--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_return_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"return_id" uuid NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"amount" bigint NOT NULL,
	"restock" boolean NOT NULL,
	CONSTRAINT "sale_return_items_qty_pos" CHECK ("sale_return_items"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "sale_returns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text NOT NULL,
	"sale_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"shift_id" uuid,
	"created_by" text NOT NULL,
	"refund_method" "payment_method" NOT NULL,
	"refund_amount" bigint NOT NULL,
	"points_reversed" integer DEFAULT 0 NOT NULL,
	"points_restored" integer DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_returns_amount_nonneg" CHECK ("sale_returns"."refund_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "returned_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "points_redeemed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "points_discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "refund_total" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_return_id_sale_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sale_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_sale_item_id_sale_items_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sale_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_return_items_return_idx" ON "sale_return_items" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "sale_return_items_sale_item_idx" ON "sale_return_items" USING btree ("sale_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_returns_number_uq" ON "sale_returns" USING btree ("number");--> statement-breakpoint
CREATE INDEX "sale_returns_sale_idx" ON "sale_returns" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_returns_branch_created_idx" ON "sale_returns" USING btree ("branch_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sale_returns_shift_idx" ON "sale_returns" USING btree ("shift_id");--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_returned_range" CHECK ("sale_items"."returned_qty" between 0 and "sale_items"."qty");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_refund_range" CHECK ("sales"."refund_total" between 0 and "sales"."total");