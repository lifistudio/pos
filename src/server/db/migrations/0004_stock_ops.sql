CREATE TYPE "public"."opname_mode" AS ENUM('PARTIAL', 'FULL');--> statement-breakpoint
CREATE TYPE "public"."opname_status" AS ENUM('COUNTING', 'POSTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "stock_opname_items" (
	"opname_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"counted_qty" integer DEFAULT 0 NOT NULL,
	"system_qty" integer,
	"difference" integer,
	"counted_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_opname_items_opname_id_variant_id_pk" PRIMARY KEY("opname_id","variant_id"),
	CONSTRAINT "stock_opname_items_counted_nonneg" CHECK ("stock_opname_items"."counted_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_opnames" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"mode" "opname_mode" DEFAULT 'PARTIAL' NOT NULL,
	"status" "opname_status" DEFAULT 'COUNTING' NOT NULL,
	"note" text,
	"created_by" text,
	"posted_by" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfer_items" (
	"transfer_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty_sent" integer NOT NULL,
	"qty_received" integer,
	CONSTRAINT "stock_transfer_items_transfer_id_variant_id_pk" PRIMARY KEY("transfer_id","variant_id"),
	CONSTRAINT "stock_transfer_items_qty_pos" CHECK ("stock_transfer_items"."qty_sent" > 0),
	CONSTRAINT "stock_transfer_items_recv_valid" CHECK ("stock_transfer_items"."qty_received" is null or ("stock_transfer_items"."qty_received" >= 0 and "stock_transfer_items"."qty_received" <= "stock_transfer_items"."qty_sent"))
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"status" "transfer_status" DEFAULT 'DRAFT' NOT NULL,
	"note" text,
	"receive_note" text,
	"created_by" text,
	"sent_by" text,
	"sent_at" timestamp with time zone,
	"received_by" text,
	"received_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfers_diff_branch" CHECK ("stock_transfers"."from_branch_id" <> "stock_transfers"."to_branch_id")
);
--> statement-breakpoint
ALTER TABLE "stock_opname_items" ADD CONSTRAINT "stock_opname_items_opname_id_stock_opnames_id_fk" FOREIGN KEY ("opname_id") REFERENCES "public"."stock_opnames"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opname_items" ADD CONSTRAINT "stock_opname_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opname_items" ADD CONSTRAINT "stock_opname_items_counted_by_user_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_posted_by_user_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_sent_by_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_opnames_number_uq" ON "stock_opnames" USING btree ("number");--> statement-breakpoint
CREATE INDEX "stock_opnames_branch_idx" ON "stock_opnames" USING btree ("branch_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "stock_opnames_one_counting_per_branch" ON "stock_opnames" USING btree ("branch_id") WHERE "stock_opnames"."status" = 'COUNTING';--> statement-breakpoint
CREATE INDEX "stock_transfer_items_variant_idx" ON "stock_transfer_items" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_transfers_number_uq" ON "stock_transfers" USING btree ("number");--> statement-breakpoint
CREATE INDEX "stock_transfers_from_idx" ON "stock_transfers" USING btree ("from_branch_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stock_transfers_to_idx" ON "stock_transfers" USING btree ("to_branch_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stock_transfers_status_idx" ON "stock_transfers" USING btree ("status");