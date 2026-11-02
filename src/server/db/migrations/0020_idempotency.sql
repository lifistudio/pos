CREATE TABLE "idempotency_keys" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"route" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
-- Data lama: bila ada lebih dari satu QR aktif per dokumen, hanya yang terbaru yang dibiarkan.
UPDATE "payment_intents" p SET "status" = 'EXPIRED'
WHERE p."status" = 'PENDING' AND EXISTS (
  SELECT 1 FROM "payment_intents" n
  WHERE n."reference_type" = p."reference_type" AND n."reference_id" = p."reference_id" AND n."status" = 'PENDING' AND n."created_at" > p."created_at"
);--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_one_pending_uq" ON "payment_intents" USING btree ("reference_type","reference_id") WHERE "payment_intents"."status" = 'PENDING';