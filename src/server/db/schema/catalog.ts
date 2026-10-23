import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { branches, id, timestamps } from "./core";

/** Uang dalam rupiah utuh (integer). mode number aman hingga ±9 kuadriliun. */
const money = (name: string) => bigint(name, { mode: "number" });

export const productStatus = pgEnum("product_status", ["DRAFT", "ACTIVE", "ARCHIVED"]);

export const categories = pgTable(
  "categories",
  {
    id: id(),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("categories_slug_uq").on(t.slug), index("categories_parent_idx").on(t.parentId)],
);

/**
 * Master merek. `name_key` = nama dinormalisasi (huruf kecil, tanpa aksen, tanpa spasi/tanda baca) dan unik,
 * sehingga "Coca-Cola", "coca cola", dan "COCA COLA" dianggap merek yang sama. Satu merek bisa dipakai lintas kategori.
 */
export const brands = pgTable(
  "brands",
  {
    id: id(),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("brands_name_key_uq").on(t.nameKey), index("brands_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "restrict" }),
    status: productStatus("status").notNull().default("DRAFT"),
    hasVariants: boolean("has_variants").notNull().default(false),
    weightGram: integer("weight_gram"),
    imageUrl: text("image_url"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("products_slug_uq").on(t.slug),
    index("products_category_idx").on(t.categoryId),
    index("products_brand_idx").on(t.brandId),
    index("products_status_idx").on(t.status),
    index("products_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * Thumbnail produk (satu per produk). Disimpan di Cloudinary bila dikonfigurasi (`provider = cloudinary`,
 * `external_id` = public_id, `data` kosong), atau di Postgres sebagai cadangan tanpa layanan luar (ADR-025).
 * `products.image_url` berisi URL siap tampil (Cloudinary dengan transformasi, atau `/api/v1/products/{id}/thumbnail?v=…`).
 */
export const productImages = pgTable("product_images", {
  productId: uuid("product_id")
    .primaryKey()
    .references(() => products.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("database"),
  externalId: text("external_id"),
  data: bytea("data"),
  mime: text("mime").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  bytes: integer("bytes").notNull(),
  hash: text("hash").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Opsi variasi, misal "Warna", "Ukuran" (maks 3 per produk — divalidasi di service). */
export const productOptions = pgTable(
  "product_options",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("product_options_product_idx").on(t.productId)],
);

export const productOptionValues = pgTable(
  "product_option_values",
  {
    id: id(),
    optionId: uuid("option_id")
      .notNull()
      .references(() => productOptions.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("product_option_values_option_idx").on(t.optionId)],
);

/** Produk tanpa variasi tetap punya tepat 1 varian default. */
export const productVariants = pgTable(
  "product_variants",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    /** Label gabungan nilai opsi, misal "Hitam / L" — denormalisasi untuk tampilan & pencarian. */
    title: text("title").notNull().default("Default"),
    price: money("price").notNull(),
    compareAtPrice: money("compare_at_price"),
    costPrice: money("cost_price"),
    weightGram: integer("weight_gram"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("product_variants_sku_uq").on(t.sku),
    // SKU unik tanpa beda huruf besar/kecil (scan mencocokkan upper(sku)).
    uniqueIndex("product_variants_sku_upper_uq").on(sql`upper(${t.sku})`),
    uniqueIndex("product_variants_barcode_uq").on(t.barcode),
    index("product_variants_product_idx").on(t.productId),
    index("product_variants_sku_trgm_idx").using("gin", sql`${t.sku} gin_trgm_ops`),
    check("product_variants_price_nonneg", sql`${t.price} >= 0`),
  ],
);

export const variantOptionValues = pgTable(
  "variant_option_values",
  {
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    optionValueId: uuid("option_value_id")
      .notNull()
      .references(() => productOptionValues.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("variant_option_values_value_idx").on(t.optionValueId),primaryKey({ columns: [t.variantId, t.optionValueId] })],
);

// ── Stok ────────────────────────────────────────────────────────────────

/** Saldo stok per cabang per varian. Hanya boleh berubah bersama baris `stock_movements` di transaksi yang sama. */
export const inventoryLevels = pgTable(
  "inventory_levels",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    reorderPoint: integer("reorder_point").notNull().default(0),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.variantId] }),
    index("inventory_levels_variant_idx").on(t.variantId),
    check("inventory_levels_on_hand_nonneg", sql`${t.onHand} >= 0`),
    check("inventory_levels_reserved_valid", sql`${t.reserved} >= 0 AND ${t.reserved} <= ${t.onHand}`),
  ],
);

export const stockMovementType = pgEnum("stock_movement_type", [
  "INITIAL",
  "RECEIPT",
  "SALE",
  "RETURN",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "ADJUSTMENT",
  "OPNAME",
]);

/** Ledger stok append-only. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    type: stockMovementType("type").notNull(),
    qtyChange: integer("qty_change").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    reason: text("reason"),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("stock_movements_actor_idx").on(t.actorId),
    index("stock_movements_variant_branch_idx").on(t.variantId, t.branchId, t.createdAt.desc()),
    index("stock_movements_branch_created_idx").on(t.branchId, t.createdAt.desc()),
  ],
);
