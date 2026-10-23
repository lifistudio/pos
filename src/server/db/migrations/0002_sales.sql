CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'QRIS', 'DEBIT', 'CREDIT', 'TRANSFER', 'EWALLET');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('PAID', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."shift_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"key" text PRIMARY KEY NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sale_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"variant_title" text NOT NULL,
	"sku" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"cost_price" bigint,
	"discount" bigint DEFAULT 0 NOT NULL,
	"line_total" bigint NOT NULL,
	CONSTRAINT "sale_items_qty_pos" CHECK ("sale_items"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "sale_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sale_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount" bigint NOT NULL,
	"tendered" bigint,
	"change" bigint DEFAULT 0 NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_payments_amount_pos" CHECK ("sale_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"shift_id" uuid,
	"cashier_id" text NOT NULL,
	"channel" text DEFAULT 'POS' NOT NULL,
	"status" "sale_status" DEFAULT 'PAID' NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount_total" bigint DEFAULT 0 NOT NULL,
	"tax_total" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"tax_snapshot" jsonb NOT NULL,
	"note" text,
	"idempotency_key" text NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_total_nonneg" CHECK ("sales"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" "shift_status" DEFAULT 'OPEN' NOT NULL,
	"opening_cash" bigint DEFAULT 0 NOT NULL,
	"expected_cash" bigint,
	"counted_cash" bigint,
	"note" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashier_id_user_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_items_variant_idx" ON "sale_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "sale_payments_sale_idx" ON "sale_payments" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_number_uq" ON "sales" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_idempotency_uq" ON "sales" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sales_branch_created_idx" ON "sales" USING btree ("branch_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sales_shift_idx" ON "sales" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "sales_cashier_idx" ON "sales" USING btree ("cashier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_one_open_per_user_branch" ON "shifts" USING btree ("user_id","branch_id") WHERE "shifts"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "shifts_branch_opened_idx" ON "shifts" USING btree ("branch_id","opened_at" DESC NULLS LAST);