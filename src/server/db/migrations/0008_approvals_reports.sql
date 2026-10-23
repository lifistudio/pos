CREATE TYPE "public"."return_reason" AS ENUM('SIZE', 'DEFECT', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'CHANGED_MIND', 'OTHER');--> statement-breakpoint
CREATE TABLE "approval_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"permission" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"approved_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_for" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_pins" (
	"user_id" text PRIMARY KEY NOT NULL,
	"pin_hash" text NOT NULL,
	"salt" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sale_returns" ADD COLUMN "reason_code" "return_reason" DEFAULT 'OTHER' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "manual_discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "manual_discount_reason" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "manual_discount_approved_by" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "void_approved_by" text;--> statement-breakpoint
ALTER TABLE "approval_grants" ADD CONSTRAINT "approval_grants_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_grants" ADD CONSTRAINT "approval_grants_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_grants" ADD CONSTRAINT "approval_grants_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_pins" ADD CONSTRAINT "approval_pins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_grants_requester_idx" ON "approval_grants" USING btree ("requested_by","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_manual_discount_approved_by_user_id_fk" FOREIGN KEY ("manual_discount_approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_void_approved_by_user_id_fk" FOREIGN KEY ("void_approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_returns_reason_idx" ON "sale_returns" USING btree ("reason_code","created_at" DESC NULLS LAST);