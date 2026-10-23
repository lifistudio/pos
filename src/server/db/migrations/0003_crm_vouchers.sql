CREATE TYPE "public"."point_ledger_type" AS ENUM('EARN', 'REVERSE', 'ADJUST');--> statement-breakpoint
CREATE TYPE "public"."voucher_customer_scope" AS ENUM('ALL', 'MEMBER', 'TIER', 'CUSTOMER');--> statement-breakpoint
CREATE TYPE "public"."voucher_product_scope" AS ENUM('ALL', 'CATEGORY', 'PRODUCT', 'VARIANT');--> statement-breakpoint
CREATE TYPE "public"."voucher_status" AS ENUM('ACTIVE', 'PAUSED');--> statement-breakpoint
CREATE TYPE "public"."voucher_target_type" AS ENUM('CATEGORY', 'PRODUCT', 'VARIANT', 'TIER', 'CUSTOMER', 'BRANCH');--> statement-breakpoint
CREATE TYPE "public"."voucher_usage_status" AS ENUM('APPLIED', 'REVERSED');--> statement-breakpoint
CREATE TYPE "public"."voucher_value_type" AS ENUM('NOMINAL', 'PERCENT');--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"birth_date" date,
	"notes" text,
	"is_member" boolean DEFAULT false NOT NULL,
	"member_no" text,
	"tier_id" uuid,
	"points" integer DEFAULT 0 NOT NULL,
	"total_spent" bigint DEFAULT 0 NOT NULL,
	"visit_count" integer DEFAULT 0 NOT NULL,
	"last_visit_at" timestamp with time zone,
	"consent_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_points_nonneg" CHECK ("customers"."points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "membership_tiers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"min_spend" bigint DEFAULT 0 NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"points_per_10k" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_tiers_discount_range" CHECK ("membership_tiers"."discount_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "point_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" "point_ledger_type" NOT NULL,
	"change" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"sale_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voucher_targets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"voucher_id" uuid NOT NULL,
	"type" "voucher_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"is_exclusion" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voucher_usages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"voucher_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"customer_id" uuid,
	"discount" bigint NOT NULL,
	"sale_total" bigint NOT NULL,
	"status" "voucher_usage_status" DEFAULT 'APPLIED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"value_type" "voucher_value_type" NOT NULL,
	"value" integer NOT NULL,
	"max_discount" bigint,
	"min_spend" bigint DEFAULT 0 NOT NULL,
	"max_spend" bigint,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"quota_total" integer,
	"quota_used" integer DEFAULT 0 NOT NULL,
	"quota_per_customer" integer,
	"product_scope" "voucher_product_scope" DEFAULT 'ALL' NOT NULL,
	"customer_scope" "voucher_customer_scope" DEFAULT 'ALL' NOT NULL,
	"status" "voucher_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vouchers_value_pos" CHECK ("vouchers"."value" > 0),
	CONSTRAINT "vouchers_percent_range" CHECK ("vouchers"."value_type" <> 'PERCENT' or "vouchers"."value" <= 10000),
	CONSTRAINT "vouchers_quota_valid" CHECK ("vouchers"."quota_total" is null or "vouchers"."quota_used" <= "vouchers"."quota_total")
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "member_discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "voucher_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "voucher_code" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "voucher_discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "points_earned" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tier_id_membership_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."membership_tiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_ledger" ADD CONSTRAINT "point_ledger_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_targets" ADD CONSTRAINT "voucher_targets_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_usages" ADD CONSTRAINT "voucher_usages_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_usages" ADD CONSTRAINT "voucher_usages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_phone_uq" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_member_no_uq" ON "customers" USING btree ("member_no");--> statement-breakpoint
CREATE INDEX "customers_name_trgm_idx" ON "customers" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customers_tier_idx" ON "customers" USING btree ("tier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_tiers_name_uq" ON "membership_tiers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "point_ledger_customer_idx" ON "point_ledger" USING btree ("customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "voucher_targets_voucher_idx" ON "voucher_targets" USING btree ("voucher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voucher_targets_uq" ON "voucher_targets" USING btree ("voucher_id","type","target_id","is_exclusion");--> statement-breakpoint
CREATE UNIQUE INDEX "voucher_usages_sale_uq" ON "voucher_usages" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "voucher_usages_voucher_idx" ON "voucher_usages" USING btree ("voucher_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "voucher_usages_customer_idx" ON "voucher_usages" USING btree ("voucher_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_code_uq" ON "vouchers" USING btree ("code");--> statement-breakpoint
CREATE INDEX "vouchers_status_idx" ON "vouchers" USING btree ("status","starts_at");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_customer_idx" ON "sales" USING btree ("customer_id","created_at" DESC NULLS LAST);