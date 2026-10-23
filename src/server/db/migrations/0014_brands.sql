CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "brand_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "brands_name_key_uq" ON "brands" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "brands_name_trgm_idx" ON "brands" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_brand_idx" ON "products" USING btree ("brand_id");--> statement-breakpoint
-- Data: merek teks bebas → master brands. Ejaan yang paling sering dipakai per kunci normal dijadikan nama resmi.
INSERT INTO "brands" ("name", "name_key")
SELECT DISTINCT ON (k.key) k.name, k.key
FROM (
  SELECT regexp_replace(btrim("brand"), '\s+', ' ', 'g') AS name,
         lower(regexp_replace("brand", '[^[:alnum:]]', '', 'g')) AS key,
         count(*) AS uses
  FROM "products"
  WHERE "brand" IS NOT NULL AND btrim("brand") <> ''
  GROUP BY 1, 2
) k
WHERE k.key <> ''
ORDER BY k.key, k.uses DESC, k.name
ON CONFLICT ("name_key") DO NOTHING;--> statement-breakpoint
UPDATE "products" p SET "brand_id" = b."id"
FROM "brands" b
WHERE p."brand" IS NOT NULL AND b."name_key" = lower(regexp_replace(p."brand", '[^[:alnum:]]', '', 'g'));--> statement-breakpoint
-- RBAC: resource baru "brand" — role yang punya hak kategori mendapat hak merek yang setara.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "role_id", replace("permission", 'category:', 'brand:') FROM "role_permissions" WHERE "permission" LIKE 'category:%'
ON CONFLICT DO NOTHING;
