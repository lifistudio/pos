ALTER TYPE "public"."audit_actor_type" ADD VALUE 'OAUTH' BEFORE 'SYSTEM';--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"auth_method" text DEFAULT 'none' NOT NULL,
	"secret_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scope" text NOT NULL,
	"resource" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"access_hash" text NOT NULL,
	"refresh_hash" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_tokens_expiry" CHECK ("oauth_tokens"."refresh_expires_at" >= "oauth_tokens"."access_expires_at")
);
--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_codes_client_idx" ON "oauth_codes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_codes_user_idx" ON "oauth_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_tokens_access_uq" ON "oauth_tokens" USING btree ("access_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_tokens_refresh_uq" ON "oauth_tokens" USING btree ("refresh_hash");--> statement-breakpoint
CREATE INDEX "oauth_tokens_user_client_idx" ON "oauth_tokens" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_family_idx" ON "oauth_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_client_idx" ON "oauth_tokens" USING btree ("client_id");